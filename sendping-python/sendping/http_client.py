"""Internal HTTP layer for the SendPing SDK. Stdlib only (urllib + json)."""

import email.utils
import http.client
import json
import math
import re
import time
import urllib.error
import urllib.request
from urllib.parse import quote, urlencode

from .exceptions import SendPingError

DEFAULT_BASE_URL = "https://www.sendping.co/api"

# Keep in sync with pyproject.toml "version".
VERSION = "1.0.0"
USER_AGENT = f"sendping-python/{VERSION}"

# The API accepts an Idempotency-Key of 1-255 characters (measured after the
# server trims the value -- the storage column is VARCHAR(255), so 255, not
# 256) and rejects anything else with `invalid_idempotency_key` (400). Only
# POST /emails, POST /emails/batch, and received-email reply/forward read the header at all; every other
# endpoint ignores it, so a retry there creates a second resource.
#
# Exported for discoverability only -- the SDK sends the key as given and lets
# the server be the authority.
IDEMPOTENCY_KEY_MAX_LENGTH = 255

# Defaults for the timeout + retry policy. Override per client via the
# module-level `sendping.timeout` (seconds) and `sendping.max_retries`.
DEFAULT_TIMEOUT = 30.0  # seconds
DEFAULT_MAX_RETRIES = 2
# Only 429/503 are candidates. _retry_allowed also checks progress and whether
# a write was rejected before processing or protected by an operation key.
_RETRYABLE_STATUS = (429, 503)


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward API credentials or message data to a redirect target.
        return None


_opener = urllib.request.build_opener(_NoRedirectHandler())


def _retry_allowed(req, status, body):
    count = body.get("sent_count")
    if (body.get("id") or (isinstance(count, (int, float)) and count > 0)
            or body.get("sent") or body.get("reserved")
            or body.get("name") == "batch_incomplete"):
        return False
    if status != 503 or req.get_method() in ("GET", "HEAD"):
        return True
    if body.get("name") in ("service_unavailable", "sending_service_unavailable",
                            "sending_configuration_unavailable", "contacts_busy", "contacts_timeout"):
        return True
    return bool(req.get_method() == "POST" and (req.get_header("Idempotency-key") or "").strip()
                and re.search(r"/emails(?:/batch|/receiving/[^/]+/(?:reply|forward))?$", req.full_url))


def path_escape(value):
    """Percent-encode a path segment so an id like ``../api-keys`` can't
    traverse the URL path and forge a request to a different endpoint."""
    return quote(str(value), safe="")


def build_query(params):
    """Build ``''`` or ``'?a=b&c=d'`` from a dict, dropping ``None`` values."""
    if not params:
        return ""
    filtered = {k: str(v) for k, v in params.items() if v is not None}
    return f"?{urlencode(filtered)}" if filtered else ""


def paginate(params):
    """Build the ``?limit=&after=&before=`` query string from pagination params."""
    if not params:
        return ""
    return build_query(
        {
            "limit": params.get("limit"),
            "after": params.get("after"),
            "before": params.get("before"),
        }
    )


def _config():
    # Late import: reads the module-level `sendping.api_key` / `base_url`
    # set by the caller (resend-python style configuration).
    import sendping

    api_key = getattr(sendping, "api_key", None)
    if not api_key or not isinstance(api_key, str):
        raise SendPingError(
            0,
            "missing_api_key",
            'sendping.api_key must be set, e.g. sendping.api_key = "mb_xxxxxxxxx"',
        )
    base_url = (getattr(sendping, "base_url", None) or DEFAULT_BASE_URL).rstrip("/")
    timeout = getattr(sendping, "timeout", None)
    timeout = DEFAULT_TIMEOUT if timeout is None else float(timeout)
    max_retries = getattr(sendping, "max_retries", None)
    max_retries = DEFAULT_MAX_RETRIES if max_retries is None else max(0, int(max_retries))
    return api_key, base_url, timeout, max_retries


def _parse_retry_after(header):
    """Parse a Retry-After header (delta-seconds or HTTP-date) → seconds.
    Returns None when absent or unparseable. Not capped — this is the value
    reported on the raised error, and a quota error can legitimately ask you to
    wait an hour.

    Nothing in here may raise: it runs while the SendPingError for a failed
    response is being built, so an exception would REPLACE the API's
    {statusCode, name, message} with an unrelated one and leave the caller with
    nothing to branch on. RFC 9110 allows either form and a proxy may rewrite
    the value, so an unrecognised one simply means "no advice":
    parsedate_to_datetime RAISES on a non-date (it does not return None), and a
    non-finite float would reach time.sleep() as nan/inf."""
    if not header:
        return None
    try:
        seconds = float(header)
        if math.isfinite(seconds):
            return max(0.0, seconds)
        return None
    except (TypeError, ValueError):
        pass
    try:
        parsed = email.utils.parsedate_to_datetime(str(header))
    except (TypeError, ValueError, OverflowError):
        return None
    if parsed is None:
        return None
    try:
        return max(0.0, parsed.timestamp() - time.time())
    except (OSError, OverflowError, ValueError):
        return None


def _retry_after_seconds(header):
    """The Retry-After delay to actually sleep for, capped at 30s so a long
    server-suggested wait can't stall the caller."""
    seconds = _parse_retry_after(header)
    return None if seconds is None else min(seconds, 30.0)


def _headers(api_key, json_body, options):
    # A non-empty User-Agent is MANDATORY: the API gates every /api/* resource
    # on it and answers a missing one with 403 validation_error, before auth.
    headers = {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": USER_AGENT,
    }
    if json_body:
        headers["Content-Type"] = "application/json"
    # Sent verbatim: the server trims the value and owns the 1-255 bound
    # (IDEMPOTENCY_KEY_MAX_LENGTH), answering an out-of-range key with
    # 400 invalid_idempotency_key. Validating here would only risk drifting
    # from the server.
    #
    # Stringify BEFORE testing emptiness. Only an absent/None or empty key
    # means "no idempotency" -- integer 0 and the string "0" are both VALID
    # 1-character keys (readIdemKey accepts any 1-255 char value). A bare
    # truthiness gate sent 12345 but silently dropped 0, so a caller keying off
    # a zero-based counter or an id of 0 got a plain send for that one email:
    # an application retry, or this module's own 429/503 retry, then delivered
    # it a SECOND time.
    #
    # What is DROPPED is enumerated, not what is allowed. An allow-list of
    # (str, int, float) looks tidier and is a regression: str() used to accept
    # anything, and a uuid.UUID -- what a Django UUIDField or a SQLAlchemy Uuid
    # column actually hands you, and the idiomatic key for an order id -- is an
    # OBJECT, not a str. Allow-listing silently dropped it, reintroducing this
    # exact defect on a far more common input than the integer 0 that prompted
    # the fix. Only bools (which stringify to a bogus "True") and containers (a
    # bogus "[]"/"{}") are skipped; everything else is stringified as before, so
    # uuid.UUID and Decimal keep working and ruby's `value.to_s` stays aligned.
    raw = options.get("idempotency_key") if options else None
    if raw is not None and not isinstance(raw, (bool, list, tuple, set, dict)):
        key = str(raw)
        if key != "":
            headers["Idempotency-Key"] = key
    return headers


def _parse_body(raw):
    """Parse a JSON response body into a dict, or ``{}`` when it isn't one."""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _sent_count(body):
    """How many emails a partial-failure body reports as already sent.

    ``POST /emails/batch`` answers a mid-batch failure with the error envelope
    plus ``sent`` / ``sent_count`` when some emails already went out."""
    count = body.get("sent_count")
    if isinstance(count, int) and not isinstance(count, bool) and count > 0:
        return count
    sent = body.get("sent")
    return len(sent) if isinstance(sent, list) else 0


def _error_from(status, raw, headers=None):
    body = _parse_body(raw)
    retry_after = _parse_retry_after(headers.get("Retry-After") if headers else None)
    return SendPingError(
        status,
        body.get("name", "application_error"),
        body.get("message", f"Request failed with status {status}"),
        body=body,
        retry_after=retry_after,
    )


def request(method, path, body=None, options=None):
    """Make a JSON API request. Returns the parsed JSON body (``None`` when the
    response is empty). Raises :class:`SendPingError` on any non-2xx status."""
    api_key, base_url, timeout, max_retries = _config()
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        base_url + path, data=data, headers=_headers(api_key, True, options), method=method
    )
    raw = _send(req, timeout, max_retries)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return raw.decode("utf-8", "replace")


def request_raw(method, path, options=None):
    """Make a request to an endpoint that streams raw binary bytes (attachment /
    raw MIME downloads). Returns ``bytes``. Raises :class:`SendPingError` on
    any non-2xx status (the error body is JSON even on binary routes)."""
    api_key, base_url, timeout, max_retries = _config()
    req = urllib.request.Request(
        base_url + path, data=None, headers=_headers(api_key, False, options), method=method
    )
    return _send(req, timeout, max_retries)


def _send(req, timeout, max_retries):
    """Send with a socket timeout, retrying only 429/503 (Retry-After aware)."""
    attempt = 0
    while True:
        try:
            with _opener.open(req, timeout=timeout if timeout > 0 else None) as res:
                return res.read()
        except urllib.error.HTTPError as err:
            raw = b""
            headers = err.headers
            try:
                raw = err.read()
            except (OSError, http.client.HTTPException) as read_error:
                raise SendPingError(0, "network_error", str(read_error)) from None
            finally:
                # HTTPError is also a file-like response. Leaving it open leaks
                # its socket/file descriptor on every 4xx/5xx and each retry.
                err.close()
            # A batch send that failed PART WAY THROUGH answers 429 (quota,
            # reputation) with `sent`/`sent_count` naming the emails that
            # already went out. Retrying that would send them a second time,
            # so a partial-success body is never retried.
            should_retry = (
                err.code in _RETRYABLE_STATUS
                and attempt < max_retries
                and _retry_allowed(req, err.code, _parse_body(raw))
            )
            if should_retry:
                retry_after = _retry_after_seconds(
                    headers.get("Retry-After") if headers else None
                )
                time.sleep(retry_after if retry_after is not None else min(30.0, 0.5 * (2 ** attempt)))
                attempt += 1
                continue
            raise _error_from(err.code, raw, headers) from None
        except urllib.error.URLError as err:
            # Includes socket.timeout (raised as URLError.reason on timeout).
            raise SendPingError(0, "network_error", str(getattr(err, "reason", err))) from None
        except (OSError, http.client.HTTPException) as err:
            # Direct socket timeouts and truncated response bodies are not
            # necessarily wrapped in URLError. Their send outcome is unknown.
            raise SendPingError(0, "network_error", str(err)) from None

"""Webhooks resource + local Svix-style signature verification.

``Webhooks.verify(payload, headers, secret)`` (or the module-level
``verify_webhook_signature``) is a pure local computation using hmac/hashlib —
it makes no HTTP request. It mirrors the backend signing scheme:
``"{svix-id}.{svix-timestamp}.{body}"`` → base64 HMAC-SHA256, tagged ``v1,``.
"""

import base64
import binascii
import hashlib
import hmac
import math
import time
from typing import List, TypedDict

from . import http_client
from .http_client import paginate, path_escape as _e


class CreateParams(TypedDict, total=False):
    endpoint: str  # required
    events: List[str]  # required, e.g. ['email.delivered', 'email.bounced']
    secret: str  # optional caller-supplied signing secret (else generated, returned once)


class UpdateParams(TypedDict, total=False):
    endpoint: str
    events: List[str]
    status: str  # 'enabled' | 'disabled'


def _header_pairs(headers):
    """Best-effort ``(name, value)`` pairs out of ANY header container.

    ``items()`` first, because that is the one accessor every header type in the
    Python web stack agrees on: dict, ``http.client.HTTPMessage``, Django's
    ``request.headers``, Starlette/FastAPI's ``Headers`` — and Flask's, which is
    the one that made this necessary. Werkzeug's ``Headers.__iter__`` yields
    ``(key, value)`` TUPLES rather than keys, so iterating it and treating each
    element as a name matched nothing and ``Webhooks.verify(body,
    request.headers, secret)`` — the call this package's own README shows —
    answered ``missing_headers`` for every genuinely signed delivery.
    """
    if headers is None:
        return []
    items = getattr(headers, "items", None)
    if callable(items):
        try:
            return list(items())
        except Exception:  # pragma: no cover - exotic container
            pass
    try:
        entries = list(headers)
    except TypeError:
        return []
    pairs = []
    for entry in entries:
        # A pair-yielding container (werkzeug) vs. a mapping that yields keys.
        if isinstance(entry, (tuple, list)) and len(entry) == 2:
            pairs.append((entry[0], entry[1]))
            continue
        try:
            pairs.append((entry, headers[entry]))
        except (KeyError, IndexError, TypeError, AttributeError):
            continue
    return pairs


def _read_header(headers, name):
    """Case-insensitively read a single header value (first if it's a list)."""
    lower = name.lower()
    for key, value in _header_pairs(headers):
        if str(key).lower() == lower:
            if isinstance(value, (list, tuple)):
                return value[0] if value else None
            return value
    return None


# Base64 alphabet as BYTE values, plus the URL-safe spellings of the last two
# characters. Bytes, not characters, because rule 5 in `_b64_lenient` reduces the
# suffix to bytes before anything in it is looked up in this table.
_B64_ALPHABET = frozenset(
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/-_"
)

# `-`/`_` are the URL-safe spellings of `+`/`/`: TRANSLATED, never dropped (rule 3).
_B64_URLSAFE = bytes.maketrans(b"-_", b"+/")


def _b64_lenient(text):
    """Decode base64 the way the signer does, not the way Python does.

    The backend derives its key with Node's ``Buffer.from(suffix, 'base64')``
    (lib/crypto.ts ``secretToKey``), and every SDK has to reproduce that byte for
    byte: a key that differs from the signer's does not fail loudly, it reports
    ``no_match``, so a correctly configured endpoint silently treats every
    genuine delivery as forged. Node's rules are NOT the RFC's — following the
    RFC is exactly how this shipped broken twice — and all five of these matter:

    1. ``=`` TERMINATES the input. Everything from the first ``=`` onward is
       DISCARDED; it is not "padding to be stripped". ``"YWJj====ZA"`` is
       ``b"abc"``, not ``b"abcd"``, and ``"Y=WJj"`` decodes to NOTHING (which
       sends ``_secret_to_key`` down its raw-bytes fallback). Stripping ``=``
       and decoding the rest was this function's own residual divergence — the
       one 5.0.0 propagated to five other SDKs by porting it.
    2. Characters outside the alphabet are SKIPPED, never fatal: whitespace,
       punctuation and non-ASCII are ignored, so ``"YW!Jj"`` is ``b"abc"``.
    3. ``-`` and ``_`` are the URL-safe spellings of ``+`` and ``/`` and must be
       TRANSLATED, not dropped.
    4. A trailing group of ONE character carries no whole byte and contributes
       nothing; 2 chars give 1 byte, 3 give 2.
    5. The unit Node reads is the LOW 8 BITS OF EACH UTF-16 CODE UNIT, not the
       codepoint and not the UTF-8 bytes: `Buffer.from(str, 'base64')` masks
       every code unit with ``0xFF`` before the table lookup. So ``"YWŁj"`` is
       ``b"abc"`` mangled to ``616023`` (U+0141 & 0xFF = 0x41 ``A``), U+013D
       masks to 0x3D and TERMINATES the input under rule 1, and an astral
       character contributes its two SURROGATE halves' low bytes — ``"𝑁"`` is
       0xD835/0xDC41 → ``"5A"`` → the single byte 0xE4, never its UTF-8 bytes.
       This is
       why it must run BEFORE rules 1-4: split the raw string on ``=`` and
       U+013D never terminates anything. Invisible to ASCII tests, which is how
       all nine SDKs scored a clean sweep on the old corpus while diverging on
       every secret carrying a codepoint above 0xFF.

    ``base64.b64decode`` obeys none of this — it raises ``binascii.Error`` on a
    length that is not a multiple of four, silently discards ``-``/``_``, and
    happily decodes past an interior ``=``. So it is used only for the final
    fixed-up group decode; the truncation, the alphabet filter and the URL-safe
    translation are done here, because that is where every language's built-in
    parts ways with Node. A caller-supplied secret (the ``secret`` field on
    POST /webhooks, which the backend accepts verbatim with no shape
    validation) can be any of these shapes.
    """
    # Rule 5 first: UTF-16LE lays out two bytes per code unit little-endian, so
    # `[0::2]` IS the `& 0xFF` mask. `surrogatepass` is mandatory — without it an
    # astral character (or a lone surrogate a caller pasted in) raises instead of
    # yielding the two halves Node sees, and `text.encode("utf-8")` here would
    # give U+1D441 three bytes of entirely different values.
    masked = text.encode("utf-16-le", "surrogatepass")[0::2]
    head = masked.split(b"=", 1)[0]
    cleaned = bytes(b for b in head if b in _B64_ALPHABET).translate(_B64_URLSAFE)
    remainder = len(cleaned) % 4
    if remainder == 1:
        cleaned = cleaned[:-1]  # a single leftover character encodes no byte
    elif remainder:
        cleaned += b"=" * (4 - remainder)
    try:
        return base64.b64decode(cleaned)
    except (ValueError, binascii.Error):  # pragma: no cover - defensive
        return b""


def _secret_to_key(secret):
    """Derive the HMAC key from a ``whsec_``-prefixed secret (base64-decode the
    suffix); a secret without the prefix is used as raw UTF-8 bytes.

    The fallback shape is as load-bearing as the decoder and is easy to get
    subtly wrong: when the suffix decodes to ZERO bytes — ``whsec_``, ``whsec_=``,
    ``whsec_Y``, ``whsec_!!!!`` — the server keys off the WHOLE secret including
    the ``whsec_`` prefix, not the suffix and not an empty key. Anything else
    here fails exactly as invisibly as a wrong decoder.
    """
    s = str(secret or "")
    if s.startswith("whsec_"):
        decoded = _b64_lenient(s[len("whsec_"):])
        if decoded:
            return decoded
    return s.encode("utf-8")


def verify_webhook_signature(payload, headers, secret, tolerance_sec=300):
    """Verify a webhook delivery's Svix-style signature against your endpoint's
    signing secret.

    ``payload`` MUST be the exact raw request body string the server sent (do
    not re-serialize parsed JSON — whitespace differences break the signature).
    ``headers`` accepts the svix-id / svix-timestamp / svix-signature headers
    (read case-insensitively); a header may carry multiple space-separated
    signatures, any one matching makes the delivery valid.

    ``tolerance_sec`` is the max allowed clock skew (default 300; pass 0 to
    skip the freshness check).

    Returns ``{"valid": True}`` or ``{"valid": False, "reason": ...}``.
    """
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8")
    sig_id = _read_header(headers, "svix-id")
    timestamp = _read_header(headers, "svix-timestamp")
    sig_header = _read_header(headers, "svix-signature")
    if not sig_id or not timestamp or not sig_header:
        return {"valid": False, "reason": "missing_headers"}
    if not secret:
        return {"valid": False, "reason": "missing_secret"}

    # Optional timestamp freshness check (default 5-minute tolerance; 0 disables).
    if tolerance_sec and tolerance_sec > 0:
        try:
            ts = float(timestamp)
        except (TypeError, ValueError):
            return {"valid": False, "reason": "invalid_timestamp"}
        if not math.isfinite(ts):
            return {"valid": False, "reason": "invalid_timestamp"}
        if abs(int(time.time()) - ts) > tolerance_sec:
            return {"valid": False, "reason": "timestamp_out_of_tolerance"}

    signed = f"{sig_id}.{timestamp}.{payload}"
    expected = base64.b64encode(
        hmac.new(_secret_to_key(secret), signed.encode("utf-8"), hashlib.sha256).digest()
    ).decode("ascii")

    # The header may contain multiple space-separated `v1,<sig>` entries; any match wins.
    for part in str(sig_header).split(" "):
        part = part.strip()
        if not part:
            continue
        sig = part[len("v1,"):] if part.startswith("v1,") else part
        if hmac.compare_digest(sig, expected):
            return {"valid": True}
    return {"valid": False, "reason": "no_match"}


class Webhooks:
    """``sendping.Webhooks`` — the /webhooks endpoints."""

    CreateParams = CreateParams
    UpdateParams = UpdateParams

    @classmethod
    def create(cls, params):
        """Create a webhook. The signing secret is shown ONCE, only here.
        POST /webhooks"""
        return http_client.request("POST", "/webhooks", params)

    @classmethod
    def get(cls, webhook_id):
        """Retrieve a webhook. GET /webhooks/:id"""
        return http_client.request("GET", f"/webhooks/{_e(webhook_id)}")

    @classmethod
    def list(cls, params=None):
        """List webhooks. GET /webhooks"""
        return http_client.request("GET", f"/webhooks{paginate(params)}")

    @classmethod
    def update(cls, webhook_id, params):
        """Update a webhook. PATCH /webhooks/:id"""
        return http_client.request("PATCH", f"/webhooks/{_e(webhook_id)}", params)

    @classmethod
    def rotate(cls, webhook_id):
        """Rotate the signing secret. The new plaintext ``signing_secret`` is
        returned ONCE; the old secret stops verifying immediately.
        POST /webhooks/:id/rotate"""
        return http_client.request("POST", f"/webhooks/{_e(webhook_id)}/rotate")

    @classmethod
    def test(cls, webhook_id):
        """Send a synchronous test delivery and return the endpoint's live
        result. POST /webhooks/:id/test

        A FAILED delivery is still HTTP 200, so this does NOT raise when your
        endpoint rejects the test. The outcome is the ``ok`` key::

            {"object": "webhook_test", "id": "<id>",
             "ok": True,  "status": 200}                 # endpoint accepted it
            {"object": "webhook_test", "id": "<id>",
             "ok": False, "error": "lookup_failed"}      # it did not

            result = sendping.Webhooks.test(webhook_id)
            if not result["ok"]:
                print("test delivery failed:", result.get("error"))

        ``status`` is your endpoint's HTTP status when it responded at all;
        ``error`` says why the delivery failed (e.g. ``"lookup_failed"``,
        ``"webhook missing or disabled"``). It is a single attempt — no
        retries are scheduled.
        """
        return http_client.request("POST", f"/webhooks/{_e(webhook_id)}/test")

    @classmethod
    def remove(cls, webhook_id):
        """Delete a webhook. DELETE /webhooks/:id"""
        return http_client.request("DELETE", f"/webhooks/{_e(webhook_id)}")

    @classmethod
    def verify(cls, payload, headers, secret, tolerance_sec=300):
        """Verify a webhook delivery signature (pure local computation).
        See :func:`sendping.verify_webhook_signature`."""
        return verify_webhook_signature(payload, headers, secret, tolerance_sec)

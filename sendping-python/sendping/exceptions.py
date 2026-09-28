"""Exceptions raised by the SendPing SDK."""


class SendPingError(Exception):
    """An API (or transport) error.

    Carries the ``{statusCode, name, message}`` body returned by the
    SendPing API on non-2xx responses. ``status_code`` is 0 for
    transport-level failures (``name`` = ``network_error``) and for
    client-side configuration errors (``name`` = ``missing_api_key``).

    Match on :attr:`name`, never on :attr:`message` — messages are scrubbed of
    provider identifiers server-side and are not a stable contract. Some
    handlers also override the status a ``name`` normally maps to, so read
    :attr:`status_code` rather than assuming one from the name.

    Errors can carry extra data alongside the three envelope fields; the whole
    parsed body is kept on :attr:`body`, with the common extras surfaced as:

    * :attr:`limit` — plan/quota rejections (``plan_limit_reached``,
      ``*_quota_exceeded``, ``contact_limit_reached``) describe the cap that
      was hit and the next plan up.
    * :attr:`reputation` — reputation gates (``reputation_paused``,
      ``reputation_limit_exceeded``).
    * :attr:`sent` / :attr:`sent_count` — a ``POST /emails/batch`` that failed
      part way through, naming the emails that DID go out.
    * :attr:`retry_after` — the ``Retry-After`` header in seconds, when set.
    """

    def __init__(
        self,
        status_code=0,
        name="application_error",
        message="",
        body=None,
        retry_after=None,
    ):
        super().__init__(message or name)
        self.status_code = status_code
        self.name = name
        self.message = message
        self.body = body if isinstance(body, dict) else {}
        self.retry_after = retry_after

    @property
    def statusCode(self):  # noqa: N802 — mirrors the API error body key
        """Alias matching the API error body key ``statusCode``."""
        return self.status_code

    @property
    def id(self):
        """Original email for a failed or unconfirmed send; inspect before resending."""
        value = self.body.get("id")
        return value if isinstance(value, str) else None

    @property
    def reserved(self):
        """Reserved batch prefix, including unconfirmed provider handoffs."""
        value = self.body.get("reserved")
        return value if isinstance(value, list) else []

    @property
    def unsent_count(self):
        """Never-attempted tail, distinct from unconfirmed reserved emails."""
        value = self.body.get("unsent_count")
        return value if isinstance(value, int) and not isinstance(value, bool) else None

    @property
    def limit(self):
        """The ``limit`` object on plan/quota errors, else ``None``.

        A ``limit`` the API sends in a shape this version does not expect reads
        as ``None`` rather than being handed back raw, so ``e.limit["kind"]``
        never raises from inside a caller's error handler. The raw value is
        still on :attr:`body`."""
        value = self.body.get("limit")
        return value if isinstance(value, dict) else None

    @property
    def reputation(self):
        """The ``reputation`` object on reputation errors, else ``None``.

        Same shape tolerance as :attr:`limit`."""
        value = self.body.get("reputation")
        return value if isinstance(value, dict) else None

    @property
    def sent(self):
        """Emails already sent before a batch failed part way through.

        ``[]`` on every other error — unlike :attr:`limit` and
        :attr:`reputation`, this is a list rather than ``None``, so it can be
        iterated unconditionally."""
        value = self.body.get("sent")
        return value if isinstance(value, list) else []

    @property
    def sent_count(self):
        """How many emails went out before a batch failed part way through.

        Falls back to ``len(sent)`` when the body carried the list but not the
        count, and is therefore ``0`` — not ``None`` — on every other error."""
        count = self.body.get("sent_count")
        if isinstance(count, int) and not isinstance(count, bool):
            return count
        return len(self.sent)

    def __str__(self):
        return f"[{self.name}] {self.message} (status {self.status_code})"

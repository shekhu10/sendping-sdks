"""Emails resource — send, retrieve, attachments, and inbound (receiving)."""

from typing import Any, Dict, List, TypedDict, Union

from . import http_client
from .http_client import build_query, paginate, path_escape as _e


class Attachment(TypedDict, total=False):
    filename: str
    content: str  # base64-encoded file content (provide `content` OR `path`)
    path: str  # hosted URL to fetch the file from (provide `content` OR `path`)
    content_type: str
    content_id: str  # Content-ID for inline/related parts (cid: references)


# `from` is a Python keyword, so the params types use the functional syntax.
SendParams = TypedDict(
    "SendParams",
    {
        "from": str,  # required
        "to": Union[str, List[str]],  # required
        "subject": str,  # required
        "bcc": Union[str, List[str]],
        "cc": Union[str, List[str]],
        "reply_to": Union[str, List[str]],
        # Ordinary links you write are converted to TRACKED redirects at send
        # time (anchors, markdown links, and bare URLs/domains) when the sending
        # domain has click tracking on. Link text is preserved and opt-out links
        # are never wrapped. What you send is stored and returned UNCHANGED —
        # only the delivered copy carries the tracking URL.
        "html": str,
        # Plain-text alternative. URLs in it are rewritten to tracked redirects
        # too, so a click counts whichever alternative the recipient's client
        # renders. Omit to derive it from html; pass "" to send no text part.
        "text": str,
        "preview_text": str,  # inbox preheader, max 150 chars
        "headers": Dict[str, str],
        "attachments": List[Attachment],
        "scheduled_at": str,  # ISO 8601 timestamp to schedule the send
        "topic_id": str,  # drop recipients unsubscribed from this topic
        "template_id": str,  # send using a saved template
        "template": Dict[str, Any],  # nested {id | alias, variables} reference
        "variables": Dict[str, Any],  # values for {{ placeholder }} variables
    },
    total=False,
)

UpdateParams = TypedDict("UpdateParams", {"scheduled_at": str})


class ListParams(TypedDict, total=False):
    limit: int
    after: str
    before: str
    campaign_id: str  # only emails sent by this campaign (incl. its follow-ups)
    automation_id: str  # only emails sent by this automation (ignored with campaign_id)
    source: str  # 'individual' restricts to all one-off sends, 'api' to API-key sends, 'dashboard' to dashboard-composed mail
    domain_id: str  # only emails sent from this sending domain (domain id)
    status: str  # match the value reads expose as `last_event`, e.g. 'delivered'
    search: str  # substring match over recipients, subject and sender
    folder: str  # mailbox folder: outbox | sent | scheduled | failed


class ReceivingListParams(TypedDict, total=False):
    limit: int
    after: str
    before: str
    received_for: str  # only messages received for this address


class AttachmentListParams(TypedDict, total=False):
    limit: int
    after: str
    before: str

ForwardParams = TypedDict(
    "ForwardParams",
    {
        "from": str,  # required: a verified sending address to forward from
        "to": Union[str, List[str]],  # required
        "subject": str,
    },
    total=False,
)

ReplyParams = TypedDict(
    "ReplyParams",
    {
        "from": str,  # required
        "html": str,
        "text": str,
        "subject": str,  # defaults to `Re: ...` (keeps the thread)
    },
    total=False,
)


class Emails:
    """``sendping.Emails`` — the /emails endpoints."""

    SendParams = SendParams
    UpdateParams = UpdateParams
    ListParams = ListParams
    Attachment = Attachment

    class Receiving:
        """Inbound (received) email — ``sendping.Emails.Receiving``."""

        ForwardParams = ForwardParams
        ReplyParams = ReplyParams
        ListParams = ReceivingListParams
        AttachmentListParams = AttachmentListParams

        @classmethod
        def list(cls, params=None):
            """List received emails, optionally filtered by ``received_for``
            (only messages received for that address). GET /emails/receiving

            Called with no ``limit`` and no cursor this returns up to 1000
            messages in one response; pass ``limit`` for normal 1-100 paging."""
            params = params or {}
            qs = build_query(
                {
                    "limit": params.get("limit"),
                    "after": params.get("after"),
                    "before": params.get("before"),
                    "received_for": params.get("received_for"),
                }
            )
            return http_client.request("GET", f"/emails/receiving{qs}")

        @classmethod
        def list_addresses(cls):
            """Per-address inbound stats (total, replies, interested and the
            last received time for each receiving address). Not paginated.
            GET /emails/receiving/addresses"""
            return http_client.request("GET", "/emails/receiving/addresses")

        @classmethod
        def get(cls, email_id):
            """Retrieve a received email. GET /emails/receiving/:id"""
            return http_client.request("GET", f"/emails/receiving/{_e(email_id)}")

        @classmethod
        def list_attachments(cls, email_id, params=None):
            """List a received email's attachments.
            GET /emails/receiving/:id/attachments

            With no ``limit`` and no ``after`` cursor this returns up to 1,000
            attachments, with ``has_more`` set when that cap bites; supplying
            either applies normal paging."""
            return http_client.request(
                "GET", f"/emails/receiving/{_e(email_id)}/attachments{paginate(params)}"
            )

        @classmethod
        def get_attachment(cls, email_id, attachment_id):
            """Download one attachment of a received email as raw ``bytes``.
            GET /emails/receiving/:id/attachments/:attachment_id (streams binary)."""
            return http_client.request_raw(
                "GET", f"/emails/receiving/{_e(email_id)}/attachments/{_e(attachment_id)}"
            )

        @classmethod
        def get_raw(cls, email_id):
            """Download the original RFC822/MIME message as raw ``bytes``.
            GET /emails/receiving/:id/raw (streams message/rfc822)."""
            return http_client.request_raw("GET", f"/emails/receiving/{_e(email_id)}/raw")

        @classmethod
        def forward(cls, email_id, params, options=None):
            """Forward a received email. POST /emails/receiving/:id/forward"""
            return http_client.request(
                "POST", f"/emails/receiving/{_e(email_id)}/forward", params, options
            )

        @classmethod
        def reply(cls, email_id, params, options=None):
            """Reply to a received email's sender, threaded into the same
            conversation. POST /emails/receiving/:id/reply"""
            return http_client.request("POST", f"/emails/receiving/{_e(email_id)}/reply", params, options)

        @classmethod
        def remove(cls, email_id):
            """Delete a received email. DELETE /emails/receiving/:id"""
            return http_client.request("DELETE", f"/emails/receiving/{_e(email_id)}")

    @classmethod
    def send(cls, params, options=None):
        """Send a single email. POST /emails

        Pass ``options={"idempotency_key": "..."}`` to safely retry: replaying
        the key returns the original response instead of sending twice. The key
        must be 1-255 characters after the server trims it
        (:data:`~sendping.IDEMPOTENCY_KEY_MAX_LENGTH`); the server, not this
        SDK, rejects anything else with 400 ``invalid_idempotency_key``.
        ``tags`` is not a supported field — sending it is a 422."""
        return http_client.request("POST", "/emails", params, options)

    @classmethod
    def batch(cls, params, options=None):
        """Send up to 100 emails in one request. POST /emails/batch
        (alias of ``sendping.Batch.send``).

        Batch items reject ``attachments`` and ``scheduled_at`` — send those
        individually via :meth:`send`. ``options={"idempotency_key": "..."}``
        is honoured here too (same 1-255 rule as :meth:`send`).

        SUCCESS COMES IN TWO SHAPES, chosen by batch SIZE alone. Up to 40 emails
        are sent while the request is open (200) and the response carries no
        ``queued`` key at all — never ``queued: False``. From 41 to 100 they are
        accepted and QUEUED instead (202): ``queued`` is ``True``,
        ``queued_count == len(result["data"])``, and those ids are real but
        still ``scheduled`` — nothing has been transmitted yet. Read
        ``result.get("queued")`` before treating a batch as sent, and poll
        :meth:`get` for the outcome. A batch carrying an ``@test.sendping.co``
        simulator recipient in ``to``, ``cc`` or ``bcc`` stays inline at any
        size. See ``sendping.Batch.send`` for the timeout caveat on large
        inline batches.

        A failure PART WAY THROUGH always names the emails that already went out
        on the raised error's ``sent`` / ``sent_count`` — with or without a key.
        Always read them before resending, or you re-deliver that prefix. The key
        changes only the STATUS: with one the partial answer is recorded and
        returned as its canonical 429/503, so this SDK's automatic retry replays
        it and sends nothing; without one the same name and body come back as a
        422, precisely so the retry cannot re-run the batch."""
        return http_client.request("POST", "/emails/batch", params, options)

    @classmethod
    def list(cls, params=None):
        """List sent emails (trimmed list items — no status/html/text/events,
        and unset cc/bcc/reply_to come back as ``None`` rather than ``[]``).
        Optional filters: ``campaign_id``, ``automation_id``,
        ``source`` (``individual`` for all one-off sends, ``api`` for API-key
        sends, ``dashboard`` for dashboard-composed mail; ignored when
        ``campaign_id`` or ``automation_id`` is supplied), ``domain_id``,
        ``status`` (matched against the
        value reads expose as ``last_event``), ``search`` (recipients,
        subject, sender) and ``folder`` (``outbox`` / ``sent`` / ``scheduled`` /
        ``failed``). GET /emails"""
        params = params or {}
        qs = build_query(
            {
                "limit": params.get("limit"),
                "after": params.get("after"),
                "before": params.get("before"),
                "campaign_id": params.get("campaign_id"),
                "automation_id": params.get("automation_id"),
                "source": params.get("source"),
                "domain_id": params.get("domain_id"),
                "status": params.get("status"),
                "search": params.get("search"),
                "folder": params.get("folder"),
            }
        )
        return http_client.request("GET", f"/emails{qs}")

    @classmethod
    def sources(cls):
        """Per-source send metrics — one row per campaign and automation, plus
        an ``api`` row (one-off API-key sends) and an ``individual`` row
        (dashboard-composed one-offs), with delivered/opened/clicked counts.
        ``id``/``name``/``subject``/``status`` are ``None`` for the ``api``
        and ``individual`` rows. Not paginated. GET /emails/sources"""
        return http_client.request("GET", "/emails/sources")

    @classmethod
    def get(cls, email_id):
        """Retrieve a sent email and its events. GET /emails/:id"""
        return http_client.request("GET", f"/emails/{_e(email_id)}")

    @classmethod
    def list_attachments(cls, email_id):
        """List a sent email's attachments (not paginated — every attachment
        is returned). GET /emails/:id/attachments"""
        return http_client.request("GET", f"/emails/{_e(email_id)}/attachments")

    @classmethod
    def get_attachment(cls, email_id, attachment_id):
        """Retrieve one attachment of a sent email.
        GET /emails/:id/attachments/:attachment_id"""
        return http_client.request(
            "GET", f"/emails/{_e(email_id)}/attachments/{_e(attachment_id)}"
        )

    @classmethod
    def update(cls, email_id, params):
        """Reschedule a scheduled email. PATCH /emails/:id"""
        return http_client.request("PATCH", f"/emails/{_e(email_id)}", params)

    @classmethod
    def cancel(cls, email_id):
        """Cancel a scheduled email. POST /emails/:id/cancel"""
        return http_client.request("POST", f"/emails/{_e(email_id)}/cancel")

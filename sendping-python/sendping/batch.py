"""Batch send resource — ``sendping.Batch.send([...])``."""

from . import http_client


class Batch:
    """``sendping.Batch`` — the /emails/batch endpoint."""

    @classmethod
    def send(cls, params, options=None):
        """Send up to 100 emails in one request. POST /emails/batch

        ``params`` is a list of :class:`sendping.Emails.SendParams` dicts.
        Batch items reject ``attachments`` and ``scheduled_at`` — send those
        individually via ``sendping.Emails.send``.

        TWO MODES, chosen by batch SIZE alone, and BOTH are success — branch on
        ``result.get("queued")``, not on the absence of an error:

        * **1-40 emails** are sent while the request is open (200). The response
          carries NO ``queued`` key at all — never ``queued: False``. Every id
          in ``result["data"]`` has already been handed to the mail service.
        * **41-100 emails** are accepted, written as due-now sends and delivered
          in the background (202): ``result["queued"]`` is ``True`` and
          ``result["queued_count"] == len(result["data"])``. Those ids are real
          (``sendping.Emails.get(id)`` works) but the emails start at
          ``scheduled`` and NOTHING has been transmitted yet — reporting them as
          sent, or tearing down state on return, is wrong for this case.

        Queuing is the only way the documented 100-email maximum can be accepted
        at all: 100 inline sends run past the platform's request ceiling. A batch
        carrying an ``@test.sendping.co`` simulator recipient in ``to``, ``cc`` or
        ``bcc`` stays inline at any size.

        An inline batch near the 40-email boundary can take ~100s server-side,
        far past the 30s default ``sendping.timeout`` — raise it if you send
        batches that large, and always pass ``options={"idempotency_key": ...}``,
        since a client that gives up mid-request cannot tell what was already
        sent."""
        return http_client.request("POST", "/emails/batch", params, options)

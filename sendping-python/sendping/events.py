"""Events resource — send custom events that trigger automations, plus
custom-event definitions. DOMAIN-FIRST: ``domain`` is REQUIRED on
``Events.send`` (only automations belonging to that domain are triggered)."""

from typing import Any, Dict, TypedDict, Union

from . import http_client
from .http_client import paginate, path_escape as _e


class SendParams(TypedDict, total=False):
    event: str  # the custom event name automations trigger on (`name` = alias)
    name: str  # alias for `event`
    domain: str  # REQUIRED: the sending domain this event belongs to
    contact_id: str  # identify the contact by id (contact_id OR email)
    email: str  # identify the contact by email (contact_id OR email)
    payload: Dict[str, Any]  # arbitrary event payload (`data` = alias)
    data: Dict[str, Any]  # alias for `payload`


class CreateParams(TypedDict, total=False):
    name: str  # required (cannot start with the reserved `sendping:` prefix)
    schema: Dict[str, str]  # flat key -> 'string' | 'number' | 'boolean' | 'date'


class UpdateParams(TypedDict, total=False):
    # The name is immutable (automations reference it) — sending `name` is a
    # 422. Only the payload schema can be changed; None clears it.
    schema: Union[Dict[str, str], None]


class Events:
    """``sendping.Events`` — the /events endpoints."""

    SendParams = SendParams
    CreateParams = CreateParams
    UpdateParams = UpdateParams

    @classmethod
    def send(cls, params, options=None):
        """Send a custom event that automations can trigger on (``domain`` is
        required). POST /events/send

        ``options={"idempotency_key": ...}`` is still forwarded as
        ``Idempotency-Key``, but only POST /emails, POST /emails/batch, and received-email reply/forward
        honour that header — the server ignores it here, so a retry ingests a
        SECOND event and can enroll the contact twice. De-duplicate on your
        side instead."""
        return http_client.request("POST", "/events/send", params, options)

    @classmethod
    def create(cls, params, options=None):
        """Create a custom-event definition (name + optional payload schema).
        POST /events

        A body carrying ``contact_id``/``email`` is treated as an event INGEST
        instead (identical to :meth:`send`). ``options`` carries no idempotency
        guarantee here — see :meth:`send`."""
        return http_client.request("POST", "/events", params, options)

    @classmethod
    def list(cls, params=None):
        """List custom-event definitions. GET /events"""
        return http_client.request("GET", f"/events{paginate(params)}")

    @classmethod
    def update(cls, event_id, params):
        """Update a custom-event definition's payload schema. The event NAME is
        immutable — create a new event to rename. PATCH /events/:id"""
        return http_client.request("PATCH", f"/events/{_e(event_id)}", params)

    @classmethod
    def remove(cls, event_id):
        """Delete a custom-event definition. DELETE /events/:id"""
        return http_client.request("DELETE", f"/events/{_e(event_id)}")

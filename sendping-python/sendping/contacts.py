"""Contacts resource — DOMAIN-FIRST flat /contacts API plus the nested
/audiences/:id/contacts variants, bulk imports, segment membership and topics.

Domain-first model: each sending domain has its own contact POOL — the same
address on two domains is two records with separate consent. On the flat
``/contacts`` API, ``domain`` is REQUIRED to create/list and disambiguates an
EMAIL id on get/update/remove. Pass ``audience_id`` instead to target a
specific audience via the nested API.
"""

from typing import Dict, List, TypedDict, Union

from . import http_client
from .http_client import build_query, paginate, path_escape as _e


class CreateParams(TypedDict, total=False):
    domain: str  # REQUIRED on the flat /contacts API (when audience_id is omitted)
    audience_id: str  # target a specific audience via the nested API instead
    email: str  # required
    first_name: str
    last_name: str
    unsubscribed: bool
    properties: Dict[str, Union[str, int, float]]


class UpdateParams(TypedDict, total=False):
    id: str  # required: contact id OR email
    domain: str  # disambiguates an EMAIL id across domains (flat API)
    audience_id: str  # omit for the flat /contacts/:id API
    first_name: str
    last_name: str
    unsubscribed: bool
    properties: Dict[str, Union[str, int, float]]


class ContactInput(TypedDict, total=False):
    email: str  # required
    first_name: str
    last_name: str
    unsubscribed: bool
    properties: Dict[str, Union[str, int, float]]


class UpdateTopicsParams(TypedDict):
    topics: List[Dict[str, str]]  # [{"id": ..., "subscription": "opt_in" | "opt_out"}]


class ImportCsvParams(TypedDict, total=False):
    audience_id: str  # required
    csv: str  # inline CSV text (max 5 MB, 10,000 rows) — or pass storage_key
    storage_key: str  # key from create_import_upload(), for files too big to inline
    file_name: str  # archived name for inline CSV; defaults to contacts.csv
    on_conflict: str  # 'upsert' (default) | 'skip'
    create_properties: bool  # False -> don't auto-register unseen columns
    segment_id: str  # add every imported email to this segment


class ImportUploadParams(TypedDict, total=False):
    audience_id: str  # required
    filename: str  # required, must end in .csv
    size: int  # required, bytes; max 256 MB


class Contacts:
    """``sendping.Contacts`` — the /contacts (+ nested audience) endpoints."""

    CreateParams = CreateParams
    UpdateParams = UpdateParams
    ContactInput = ContactInput
    UpdateTopicsParams = UpdateTopicsParams
    ImportCsvParams = ImportCsvParams
    ImportUploadParams = ImportUploadParams

    @classmethod
    def create(cls, params):
        """Create a contact. Domain-first: pass ``domain`` to create in that
        domain's contact pool via the flat ``/contacts`` API (required there),
        or ``audience_id`` to target a specific audience via the nested API."""
        body = dict(params)
        audience_id = body.pop("audience_id", None)
        domain = body.pop("domain", None)
        if audience_id:
            # The nested audience route derives its pool from the path.
            return http_client.request("POST", f"/audiences/{_e(audience_id)}/contacts", body)
        if domain is not None:
            body["domain"] = domain
        return http_client.request("POST", "/contacts", body)

    @classmethod
    def get(cls, params):
        """Retrieve a contact by id or email — ``{"id", "domain"?, "audience_id"?}``.
        An id is exact; an EMAIL can exist in several domains' pools, so pass
        ``domain`` to pick the pool (omitted → the oldest match anywhere)."""
        cid = _e(params["id"])
        audience_id = params.get("audience_id")
        if audience_id:
            return http_client.request("GET", f"/audiences/{_e(audience_id)}/contacts/{cid}")
        qs = build_query({"domain": params.get("domain")})
        return http_client.request("GET", f"/contacts/{cid}{qs}")

    @classmethod
    def list(cls, params=None):
        """List contacts. Domain-first: ``domain`` is required on the flat
        ``/contacts`` list (names the pool); or pass ``audience_id`` for the
        nested list. ``segment_id`` filters either variant."""
        params = params or {}
        audience_id = params.get("audience_id")
        qs = build_query(
            {
                "domain": params.get("domain") if not audience_id else None,
                "limit": params.get("limit"),
                "after": params.get("after"),
                "before": params.get("before"),
                "segment_id": params.get("segment_id"),
            }
        )
        base = f"/audiences/{_e(audience_id)}/contacts" if audience_id else "/contacts"
        return http_client.request("GET", f"{base}{qs}")

    @classmethod
    def batch(cls, params):
        """Bulk-import contacts from a list — ``{"domain" | "audience_id",
        "contacts", "on_conflict"?}``. Upserts by email; max 10,000 per call.
        ``on_conflict='skip'`` leaves existing contacts untouched.

        Domain-first, like :meth:`create`: pass ``domain`` for the flat
        ``/contacts/batch`` API, or ``audience_id`` for the nested one. USE THIS
        for many contacts — one batch takes the account's contact-limit lock
        once, where a ``create()`` loop takes it per contact.

        Rows without a valid ``email`` are counted as ``skipped`` rather than
        failing the request, and ``properties`` are NOT checked against the
        contact-property registry here (unlike the single-contact writes).
        POST /contacts/batch, or POST /audiences/:id/contacts/batch"""
        qs = build_query({"on_conflict": params.get("on_conflict")})
        audience_id = params.get("audience_id")
        if audience_id:
            return http_client.request(
                "POST",
                f"/audiences/{_e(audience_id)}/contacts/batch{qs}",
                {"contacts": params["contacts"]},
            )
        # The nested route derives its pool from the path; only the flat route
        # takes ``domain`` (in the body, same as POST /contacts).
        body = {"contacts": params["contacts"]}
        domain = params.get("domain")
        if domain is not None:
            body["domain"] = domain
        return http_client.request("POST", f"/contacts/batch{qs}", body)

    @classmethod
    def import_csv(cls, params):
        """Bulk-import contacts from CSV. Upserts by email. By default every
        non-builtin CSV column is auto-registered as a custom property; pass
        ``create_properties=False`` for strict mode. ``segment_id`` adds every
        imported email to that segment. POST /audiences/:id/contacts/import

        Pass ``csv`` for inline text (max 5 MB and 10,000 rows), or a
        ``storage_key`` from :meth:`create_import_upload` for anything larger."""
        qs = build_query(
            {
                "on_conflict": params.get("on_conflict"),
                "create_properties": (
                    "false" if params.get("create_properties") is False else None
                ),
                "segment_id": params.get("segment_id"),
            }
        )
        body = {}
        for key in ("csv", "storage_key", "file_name"):
            if params.get(key) is not None:
                body[key] = params[key]
        return http_client.request(
            "POST", f"/audiences/{_e(params['audience_id'])}/contacts/import{qs}", body
        )

    @classmethod
    def create_import_upload(cls, params):
        """Mint a presigned direct-upload URL for a CSV too large to inline
        (up to 256 MB) — ``{"audience_id", "filename", "size"}``. PUT the file
        to the returned ``upload_url``, then pass the returned ``storage_key``
        to :meth:`import_csv`. POST /audiences/:id/contacts/import/upload

        The ``upload_url`` is a bearer credential — do not log it."""
        return http_client.request(
            "POST",
            f"/audiences/{_e(params['audience_id'])}/contacts/import/upload",
            {"filename": params["filename"], "size": params["size"]},
        )

    @classmethod
    def update(cls, params):
        """Update a contact. On the flat API, pass ``domain`` when ``id`` is
        an EMAIL (disambiguates across pools). PATCH /contacts/:id"""
        body = dict(params)
        cid = _e(body.pop("id"))
        audience_id = body.pop("audience_id", None)
        domain = body.pop("domain", None)
        if audience_id:
            return http_client.request(
                "PATCH", f"/audiences/{_e(audience_id)}/contacts/{cid}", body
            )
        if domain is not None:
            body["domain"] = domain
        return http_client.request("PATCH", f"/contacts/{cid}", body)

    @classmethod
    def remove(cls, params):
        """Delete a contact — ``{"id", "domain"?, "audience_id"?}``. On the
        flat API, pass ``domain`` when ``id`` is an EMAIL."""
        cid = _e(params["id"])
        audience_id = params.get("audience_id")
        if audience_id:
            return http_client.request("DELETE", f"/audiences/{_e(audience_id)}/contacts/{cid}")
        qs = build_query({"domain": params.get("domain")})
        return http_client.request("DELETE", f"/contacts/{cid}{qs}")

    @classmethod
    def add_to_segment(cls, contact_id, segment_id):
        """Add a contact to a segment. POST /contacts/:id/segments/:segment_id"""
        return http_client.request(
            "POST", f"/contacts/{_e(contact_id)}/segments/{_e(segment_id)}"
        )

    @classmethod
    def remove_from_segment(cls, contact_id, segment_id):
        """Remove a contact from a segment. DELETE /contacts/:id/segments/:segment_id"""
        return http_client.request(
            "DELETE", f"/contacts/{_e(contact_id)}/segments/{_e(segment_id)}"
        )

    @classmethod
    def list_segments(cls, contact_id, params=None):
        """List the segments a contact belongs to (``id``/``name``/
        ``created_at`` only, not full segment objects). Called with no
        pagination params this returns up to 1,000 segments in one response,
        with ``has_more`` set when that cap bites — pass ``limit`` for normal
        1-100 paging. GET /contacts/:id/segments"""
        return http_client.request(
            "GET", f"/contacts/{_e(contact_id)}/segments{paginate(params)}"
        )

    @classmethod
    def get_topics(cls, contact_id, params=None):
        """Get a contact's topic subscriptions. Called with no pagination
        params this returns up to 1,000 topics in one response, with
        ``has_more`` set when that cap bites. GET /contacts/:id/topics"""
        return http_client.request(
            "GET", f"/contacts/{_e(contact_id)}/topics{paginate(params)}"
        )

    @classmethod
    def update_topics(cls, contact_id, params):
        """Update a contact's topic subscriptions. PATCH /contacts/:id/topics"""
        return http_client.request("PATCH", f"/contacts/{_e(contact_id)}/topics", params)

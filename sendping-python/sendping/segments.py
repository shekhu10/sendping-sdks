"""Segments resource — DOMAIN-FIRST: segments belong to a sending domain.
``domain`` is REQUIRED on create and list; names are unique within a domain
(reusable across domains) and every domain carries an auto-created "General"
segment."""

from typing import Any, Dict, TypedDict

from . import http_client
from .http_client import build_query, paginate, path_escape as _e


class CreateParams(TypedDict, total=False):
    domain: str  # REQUIRED: the sending domain this segment belongs to
    name: str  # required
    # {status?, email_contains?, property_filters?, engagement?} — each key is
    # also accepted at the top level of the body, where `filter` wins.
    filter: Dict[str, Any]


class UpdateParams(TypedDict, total=False):
    # A segment's domain cannot change: sending `domain` (or `audience_id`) at
    # all is a 422 — create a new segment on the other domain instead.
    name: str
    filter: Dict[str, Any]


class ListParams(TypedDict, total=False):
    domain: str  # REQUIRED: the sending domain whose segments to list
    limit: int
    after: str
    before: str


class Segments:
    """``sendping.Segments`` — the /segments endpoints."""

    CreateParams = CreateParams
    UpdateParams = UpdateParams
    ListParams = ListParams

    @classmethod
    def create(cls, params):
        """Create a segment on a sending domain (``domain`` is required).
        POST /segments"""
        return http_client.request("POST", "/segments", params)

    @classmethod
    def get(cls, segment_id):
        """Retrieve a segment. GET /segments/:id"""
        return http_client.request("GET", f"/segments/{_e(segment_id)}")

    @classmethod
    def list(cls, params):
        """List a domain's segments (``domain`` is required; includes the
        auto-created "General" segment). GET /segments?domain=..."""
        qs = build_query(
            {
                "domain": params["domain"],
                "limit": params.get("limit"),
                "after": params.get("after"),
                "before": params.get("before"),
            }
        )
        return http_client.request("GET", f"/segments{qs}")

    @classmethod
    def contacts(cls, segment_id, params=None):
        """Preview the contacts a segment currently resolves to (filter matches
        plus explicit memberships). Items are a reduced contact shape with no
        ``properties``. Called with no pagination params this returns up to
        1,000 contacts in one response, with ``has_more`` set when that cap
        bites — pass ``limit`` for normal 1-100 paging.
        GET /segments/:id/contacts"""
        return http_client.request(
            "GET", f"/segments/{_e(segment_id)}/contacts{paginate(params)}"
        )

    @classmethod
    def update(cls, segment_id, params):
        """Update a segment. PATCH /segments/:id"""
        return http_client.request("PATCH", f"/segments/{_e(segment_id)}", params)

    @classmethod
    def remove(cls, segment_id):
        """Delete a segment. DELETE /segments/:id"""
        return http_client.request("DELETE", f"/segments/{_e(segment_id)}")

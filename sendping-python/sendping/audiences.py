"""Audiences resource (incl. Google Sheet contact import)."""

from typing import TypedDict

from . import http_client
from .http_client import paginate, path_escape as _e


class CreateParams(TypedDict):
    name: str


class ImportSheetParams(TypedDict, total=False):
    url: str  # required: link-shared Google Sheet URL
    segment_name: str


class Audiences:
    """``sendping.Audiences`` — the /audiences endpoints."""

    CreateParams = CreateParams
    ImportSheetParams = ImportSheetParams

    @classmethod
    def create(cls, params):
        """Create an audience. POST /audiences"""
        return http_client.request("POST", "/audiences", params)

    @classmethod
    def get(cls, audience_id):
        """Retrieve an audience. GET /audiences/:id"""
        return http_client.request("GET", f"/audiences/{_e(audience_id)}")

    @classmethod
    def list(cls, params=None):
        """List audiences. GET /audiences"""
        return http_client.request("GET", f"/audiences{paginate(params)}")

    @classmethod
    def update(cls, audience_id, params):
        """Rename an audience. PATCH /audiences/:id"""
        return http_client.request("PATCH", f"/audiences/{_e(audience_id)}", params)

    @classmethod
    def import_sheet(cls, audience_id, params):
        """Import contacts from a link-shared Google Sheet. Header columns
        become contact properties (usable as ``{{merge_tags}}``); rows land in
        a fresh segment. POST /audiences/:id/contacts/import-sheet"""
        return http_client.request(
            "POST", f"/audiences/{_e(audience_id)}/contacts/import-sheet", params
        )

    @classmethod
    def remove(cls, audience_id):
        """Delete an audience. DELETE /audiences/:id"""
        return http_client.request("DELETE", f"/audiences/{_e(audience_id)}")

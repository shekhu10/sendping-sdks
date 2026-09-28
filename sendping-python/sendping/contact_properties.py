"""Contact properties (custom fields) resource."""

from typing import TypedDict, Union

from . import http_client
from .http_client import paginate, path_escape as _e


class CreateParams(TypedDict, total=False):
    key: str  # REQUIRED: canonical merge-tag key (`name` is accepted as an alias)
    name: str  # alias for `key`
    type: str  # 'string' (default) | 'number' — immutable once created
    fallback_value: Union[str, int, float]


class UpdateParams(TypedDict, total=False):
    fallback_value: Union[str, int, float, None]  # only fallback_value is mutable


class ContactProperties:
    """``sendping.ContactProperties`` — the /contact-properties endpoints."""

    CreateParams = CreateParams
    UpdateParams = UpdateParams

    @classmethod
    def create(cls, params):
        """Register a custom contact property. POST /contact-properties"""
        return http_client.request("POST", "/contact-properties", params)

    @classmethod
    def get(cls, property_id):
        """Retrieve a contact property. GET /contact-properties/:id"""
        return http_client.request("GET", f"/contact-properties/{_e(property_id)}")

    @classmethod
    def list(cls, params=None):
        """List contact properties. GET /contact-properties"""
        return http_client.request("GET", f"/contact-properties{paginate(params)}")

    @classmethod
    def update(cls, property_id, params):
        """Update a contact property (key/type are immutable).
        PATCH /contact-properties/:id"""
        return http_client.request("PATCH", f"/contact-properties/{_e(property_id)}", params)

    @classmethod
    def remove(cls, property_id):
        """Delete a contact property. DELETE /contact-properties/:id"""
        return http_client.request("DELETE", f"/contact-properties/{_e(property_id)}")

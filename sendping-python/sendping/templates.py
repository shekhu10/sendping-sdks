"""Templates resource (incl. duplicate + publish)."""

from typing import Any, Dict, List, TypedDict, Union

from . import http_client
from .http_client import paginate, path_escape as _e

CreateParams = TypedDict(
    "CreateParams",
    {
        "name": str,  # required
        "alias": str,  # optional stable handle for sending by alias
        "subject": Union[str, None],
        "from": Union[str, None],
        "reply_to": Union[str, List[str]],
        "html": Union[str, None],
        "text": Union[str, None],
        "variables": List[Dict[str, Any]],  # [{key, type?, fallback_value?}]
    },
    total=False,
)

UpdateParams = TypedDict(
    "UpdateParams",
    {
        "name": str,
        "alias": str,
        "subject": Union[str, None],
        "from": Union[str, None],
        "reply_to": Union[str, List[str]],
        "html": Union[str, None],
        "text": Union[str, None],
        "variables": List[Dict[str, Any]],
    },
    total=False,
)


class DuplicateParams(TypedDict, total=False):
    name: str
    alias: str


class Templates:
    """``sendping.Templates`` — the /templates endpoints."""

    CreateParams = CreateParams
    UpdateParams = UpdateParams
    DuplicateParams = DuplicateParams

    @classmethod
    def create(cls, params):
        """Create a template. POST /templates"""
        return http_client.request("POST", "/templates", params)

    @classmethod
    def get(cls, template_id):
        """Retrieve a template. GET /templates/:id"""
        return http_client.request("GET", f"/templates/{_e(template_id)}")

    @classmethod
    def list(cls, params=None):
        """List templates. GET /templates"""
        return http_client.request("GET", f"/templates{paginate(params)}")

    @classmethod
    def update(cls, template_id, params):
        """Update a template. PATCH /templates/:id"""
        return http_client.request("PATCH", f"/templates/{_e(template_id)}", params)

    @classmethod
    def duplicate(cls, template_id, params=None):
        """Duplicate a template. POST /templates/:id/duplicate"""
        return http_client.request(
            "POST",
            f"/templates/{_e(template_id)}/duplicate",
            params if params is not None else {},
        )

    @classmethod
    def publish(cls, template_id):
        """Publish a template (make its latest draft live).
        POST /templates/:id/publish"""
        return http_client.request("POST", f"/templates/{_e(template_id)}/publish")

    @classmethod
    def remove(cls, template_id):
        """Delete a template. DELETE /templates/:id"""
        return http_client.request("DELETE", f"/templates/{_e(template_id)}")

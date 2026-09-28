"""Topics resource — DOMAIN-FIRST: topics belong to a sending domain.
``domain`` is REQUIRED on create and list; names are reusable across domains."""

from typing import TypedDict, Union

from . import http_client
from .http_client import build_query, path_escape as _e


class CreateParams(TypedDict, total=False):
    domain: str  # REQUIRED: the sending domain this topic belongs to
    name: str  # required
    default_subscription: str  # required: 'opt_in' | 'opt_out'
    visibility: str  # 'public' | 'private'
    description: Union[str, None]


class UpdateParams(TypedDict, total=False):
    name: str
    description: Union[str, None]
    visibility: str  # 'public' | 'private'


class ListParams(TypedDict, total=False):
    domain: str  # REQUIRED: the sending domain whose topics to list
    limit: int
    after: str
    before: str


class Topics:
    """``sendping.Topics`` — the /topics endpoints."""

    CreateParams = CreateParams
    UpdateParams = UpdateParams
    ListParams = ListParams

    @classmethod
    def create(cls, params):
        """Create a topic on a sending domain (``domain`` is required).
        POST /topics"""
        return http_client.request("POST", "/topics", params)

    @classmethod
    def get(cls, topic_id):
        """Retrieve a topic. GET /topics/:id"""
        return http_client.request("GET", f"/topics/{_e(topic_id)}")

    @classmethod
    def list(cls, params):
        """List a domain's topics (``domain`` is required).
        GET /topics?domain=..."""
        qs = build_query(
            {
                "domain": params["domain"],
                "limit": params.get("limit"),
                "after": params.get("after"),
                "before": params.get("before"),
            }
        )
        return http_client.request("GET", f"/topics{qs}")

    @classmethod
    def update(cls, topic_id, params):
        """Update a topic. PATCH /topics/:id"""
        return http_client.request("PATCH", f"/topics/{_e(topic_id)}", params)

    @classmethod
    def remove(cls, topic_id):
        """Delete a topic. DELETE /topics/:id"""
        return http_client.request("DELETE", f"/topics/{_e(topic_id)}")

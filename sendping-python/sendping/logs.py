"""API request logs resource."""

from typing import TypedDict

from . import http_client
from .http_client import build_query, path_escape as _e


class ListParams(TypedDict, total=False):
    limit: int
    after: str
    before: str
    method: str  # filter to an exact HTTP method, e.g. 'POST'
    status: int  # filter to an exact response status, e.g. 200 or 429


class Logs:
    """``sendping.Logs`` — the /logs endpoints (read-only)."""

    ListParams = ListParams

    @classmethod
    def list(cls, params=None):
        """List API request logs. Cursor-paginated (``limit``/``after``/
        ``before``) with optional ``method`` and ``status`` filters. GET /logs"""
        params = params or {}
        qs = build_query(
            {
                "limit": params.get("limit"),
                "after": params.get("after"),
                "before": params.get("before"),
                "method": params.get("method"),
                "status": params.get("status"),
            }
        )
        return http_client.request("GET", f"/logs{qs}")

    @classmethod
    def get(cls, log_id):
        """Retrieve a log entry (with request/response bodies). GET /logs/:id"""
        return http_client.request("GET", f"/logs/{_e(log_id)}")

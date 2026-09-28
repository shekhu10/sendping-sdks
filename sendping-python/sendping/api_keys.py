"""API keys resource."""

from . import http_client
from .http_client import paginate


class ApiKeys:
    """``sendping.ApiKeys`` — the /api-keys endpoints.

    Listing only, by design. Keys are created, re-scoped and revoked in the
    SendPing dashboard by a signed-in user: the API answers 403
    ``dashboard_only`` to every API-key caller on those routes, whatever the
    key's scopes. Exposing only ``list`` means a leaked key cannot mint itself
    a replacement or widen its own access."""

    @classmethod
    def list(cls, params=None):
        """List API keys (non-secret prefixes only; revoked keys excluded).
        Called with no pagination params this returns up to 1,000 keys in one
        response, with ``has_more`` set when that cap bites. GET /api-keys"""
        return http_client.request("GET", f"/api-keys{paginate(params)}")

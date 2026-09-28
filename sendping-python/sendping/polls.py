"""Polls resource — read-only results of the in-email poll widget."""

from . import http_client
from .http_client import paginate, path_escape as _e


class Polls:
    """``sendping.Polls`` — the /polls endpoints (read-only)."""

    @classmethod
    def list(cls, params=None):
        """One summary row per email that has poll responses. GET /polls"""
        return http_client.request("GET", f"/polls{paginate(params)}")

    @classmethod
    def get(cls, email_id):
        """The aggregated answer breakdown for one email. GET /polls/:email_id"""
        return http_client.request("GET", f"/polls/{_e(email_id)}")

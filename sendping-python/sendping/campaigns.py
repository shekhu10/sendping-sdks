"""Campaigns resource — bulk sends to a domain's contact pool (DOMAIN-FIRST:
``domain`` is required on create and picks the contact pool the campaign
targets; ``from`` may be a different verified domain)."""

from typing import Any, Dict, List, TypedDict, Union

from . import http_client
from .http_client import paginate, path_escape as _e

CreateParams = TypedDict(
    "CreateParams",
    {
        "domain": str,  # REQUIRED: the sending domain whose contact pool to target
        "from": str,  # required
        "subject": str,  # required
        "html": str,
        "text": str,
        "reply_to": Union[str, List[str]],
        "preview_text": str,
        "name": str,
        "segment_id": str,  # target a segment instead of everyone
        "topic_id": str,  # gate recipients by a topic subscription
        "recurrence": str,  # 'daily' | 'weekly' | 'monthly'
        "recurrence_every": int,  # periods between recurring sends (1-365)
        "ab_test": Dict[str, Any],  # A/B-test configuration
        "followups": List[Dict[str, Any]],  # engagement follow-ups (max 5)
        "list_to": bool,
        "unsubscribe_policy": str,  # 'account' | 'domain' | 'ignore'
        "send": bool,  # send immediately on create
        "scheduled_at": str,
        "schedule_timezone": str,  # IANA zone the schedule + daily batching run in
        "daily_batch_size": int,  # max recipients per batch-day (1-100000)
    },
    total=False,
)

UpdateParams = TypedDict(
    "UpdateParams",
    {
        "name": str,
        "from": str,
        "subject": str,
        "html": str,
        "text": str,
        "reply_to": Union[str, List[str]],
        "preview_text": str,
        "domain": str,  # re-point at another domain's pool (draft campaigns only)
        "segment_id": Union[str, None],
        "topic_id": Union[str, None],
        "recurrence": str,
        "recurrence_every": int,
        "ab_test": Dict[str, Any],
        "followups": List[Dict[str, Any]],  # replace pending follow-ups (max 5; [] clears)
        "list_to": bool,  # enable (True) or clear (False) the mailing-list To address
        "unsubscribe_policy": str,  # 'account' | 'domain' | 'ignore'
        "schedule_timezone": Union[str, None],  # IANA zone (None clears to account tz)
        "daily_batch_size": Union[int, None],  # 1-100000 (None clears)
    },
    total=False,
)


class Campaigns:
    """``sendping.Campaigns`` — the /campaigns endpoints."""

    CreateParams = CreateParams
    UpdateParams = UpdateParams

    @classmethod
    def create(cls, params):
        """Create a campaign (``domain`` is required). POST /campaigns"""
        return http_client.request("POST", "/campaigns", params)

    @classmethod
    def get(cls, campaign_id):
        """Retrieve a campaign. GET /campaigns/:id"""
        return http_client.request("GET", f"/campaigns/{_e(campaign_id)}")

    @classmethod
    def list(cls, params=None):
        """List campaigns. GET /campaigns"""
        return http_client.request("GET", f"/campaigns{paginate(params)}")

    @classmethod
    def update(cls, campaign_id, params):
        """Update a campaign. PATCH /campaigns/:id"""
        return http_client.request("PATCH", f"/campaigns/{_e(campaign_id)}", params)

    @classmethod
    def send(cls, campaign_id, params=None):
        """Send now, or schedule with ``{"scheduled_at": ...}``. An optional
        ``"schedule_timezone"`` (IANA name) is persisted onto the campaign so
        daily batching evaluates batch-days in that zone.
        POST /campaigns/:id/send"""
        return http_client.request(
            "POST", f"/campaigns/{_e(campaign_id)}/send", params if params is not None else {}
        )

    @classmethod
    def cancel(cls, campaign_id):
        """Cancel a scheduled campaign (returns it to draft).
        POST /campaigns/:id/cancel"""
        return http_client.request("POST", f"/campaigns/{_e(campaign_id)}/cancel")

    @classmethod
    def stats(cls, campaign_id):
        """Per-campaign analytics (counts, engagement rates, top links).
        GET /campaigns/:id/stats"""
        return http_client.request("GET", f"/campaigns/{_e(campaign_id)}/stats")

    @classmethod
    def engagement(cls, campaign_id):
        """Who opened, clicked and replied — per-recipient engagement rows.
        Each of the three lists is capped at 500 rows and this endpoint is not
        paginated. GET /campaigns/:id/engagement"""
        return http_client.request("GET", f"/campaigns/{_e(campaign_id)}/engagement")

    @classmethod
    def ab(cls, campaign_id):
        """A/B winner evaluation for an A/B campaign (422 when the campaign is
        not an A/B test). Note the camelCase ``zScore`` / ``pValue`` keys in the
        result. GET /campaigns/:id/ab"""
        return http_client.request("GET", f"/campaigns/{_e(campaign_id)}/ab")

    @classmethod
    def remove(cls, campaign_id):
        """Delete a campaign. DELETE /campaigns/:id"""
        return http_client.request("DELETE", f"/campaigns/{_e(campaign_id)}")

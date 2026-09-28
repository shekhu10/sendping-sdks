"""Domains resource — create, verify, claim, and one-click DNS providers."""

from typing import Dict, TypedDict

from . import http_client
from .http_client import build_query, paginate, path_escape as _e

# Regions a domain can be created in today.
AVAILABLE_REGIONS = ("us-east-1", "ap-south-1")


class CreateParams(TypedDict, total=False):
    name: str  # required, at least two DNS labels
    region: str  # one of AVAILABLE_REGIONS; defaults to us-east-1
    custom_return_path: str  # MAIL FROM subdomain (Return-Path); defaults to 'send'
    open_tracking: bool  # default False
    click_tracking: bool  # default True
    custom_tracking: bool  # serve tracking links from your own subdomain
    tracking_subdomain: str  # custom tracking host label, e.g. 'email' (implies custom_tracking)
    tls: str  # 'opportunistic' | 'enforced'
    receiving: bool  # accept inbound mail (or use capabilities.receiving)
    capabilities: Dict[str, str]  # e.g. {"receiving": "enabled"}


class UpdateParams(TypedDict, total=False):
    open_tracking: bool
    click_tracking: bool
    tracking_subdomain: str
    custom_tracking: bool
    custom_return_path: str  # single DNS label, e.g. 'send'
    tls: str  # 'opportunistic' | 'enforced'
    receiving: bool
    capabilities: Dict[str, str]


class ClaimParams(TypedDict, total=False):
    name: str  # required
    region: str


class Domains:
    """``sendping.Domains`` — the /domains endpoints."""

    CreateParams = CreateParams
    UpdateParams = UpdateParams
    ClaimParams = ClaimParams
    AVAILABLE_REGIONS = AVAILABLE_REGIONS

    @classmethod
    def tracking_health(cls, domain_id):
        """Check tracking HTTPS readiness; an unavailable host schedules server-side repair."""
        return http_client.request("GET", f"/domains/{_e(domain_id)}/tracking-health")

    @classmethod
    def create(cls, params):
        """Add a sending domain. POST /domains"""
        return http_client.request("POST", "/domains", params)

    @classmethod
    def get(cls, domain_id):
        """Retrieve a domain (with its DNS records). GET /domains/:id"""
        return http_client.request("GET", f"/domains/{_e(domain_id)}")

    @classmethod
    def list(cls, params=None):
        """List domains. Called with no pagination params this returns up to
        1,000 domains in one response, with ``has_more`` set when that cap
        bites; pending claims (status ``claim``) are never listed here — read
        them with :meth:`get_claim`. GET /domains"""
        return http_client.request("GET", f"/domains{paginate(params)}")

    @classmethod
    def mx_check(cls, name):
        """Look up a domain's live MX records and whether they all point at
        SendPing — ``{"has_mx", "ours", "records"}``. Fails open: a DNS
        failure reports no records rather than raising.
        GET /domains/mx-check?name=..."""
        return http_client.request("GET", f"/domains/mx-check{build_query({'name': name})}")

    @classmethod
    def records_csv(cls, domain_id):
        """Download a domain's DNS records as CSV ``bytes`` (not JSON) — handy
        for handing to whoever runs your DNS.
        GET /domains/:id/records.csv"""
        return http_client.request_raw("GET", f"/domains/{_e(domain_id)}/records.csv")

    @classmethod
    def update(cls, domain_id, params):
        """Update domain settings. PATCH /domains/:id"""
        return http_client.request("PATCH", f"/domains/{_e(domain_id)}", params)

    @classmethod
    def verify(cls, domain_id):
        """Trigger DNS verification. POST /domains/:id/verify"""
        return http_client.request("POST", f"/domains/{_e(domain_id)}/verify")

    @classmethod
    def claim(cls, params):
        """Claim a domain already verified elsewhere. POST /domains/claim"""
        return http_client.request("POST", "/domains/claim", params)

    @classmethod
    def get_claim(cls, domain_id):
        """Retrieve a domain's claim record. GET /domains/:id/claim"""
        return http_client.request("GET", f"/domains/{_e(domain_id)}/claim")

    @classmethod
    def verify_claim(cls, domain_id):
        """Verify a domain claim. POST /domains/:id/claim/verify"""
        return http_client.request("POST", f"/domains/{_e(domain_id)}/claim/verify")

    @classmethod
    def detect_dns(cls, domain_id):
        """Detect the domain's DNS provider and available one-click apply
        methods. GET /domains/:id/dns/detect"""
        return http_client.request("GET", f"/domains/{_e(domain_id)}/dns/detect")

    @classmethod
    def apply_cloudflare_dns(cls, domain_id, params):
        """Apply this domain's DNS records via the Cloudflare API, then
        auto-verify. POST /domains/:id/dns/cloudflare — ``{"token": ...}``"""
        return http_client.request("POST", f"/domains/{_e(domain_id)}/dns/cloudflare", params)

    @classmethod
    def apply_godaddy_dns(cls, domain_id, params):
        """Apply this domain's DNS records via the GoDaddy API, then
        auto-verify. POST /domains/:id/dns/godaddy — ``{"key", "secret"}``"""
        return http_client.request("POST", f"/domains/{_e(domain_id)}/dns/godaddy", params)

    @classmethod
    def apply_namecheap_dns(cls, domain_id, params):
        """Apply this domain's DNS records via the Namecheap API (existing
        records preserved), then auto-verify.
        POST /domains/:id/dns/namecheap — ``{"apiUser", "apiKey", "userName"?}``"""
        return http_client.request("POST", f"/domains/{_e(domain_id)}/dns/namecheap", params)

    @classmethod
    def remove(cls, domain_id):
        """Delete a domain. DELETE /domains/:id"""
        return http_client.request("DELETE", f"/domains/{_e(domain_id)}")

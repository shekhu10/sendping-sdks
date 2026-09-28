//! `sendping.domains` — verified sending/receiving domains, claims of
//! domains verified elsewhere, and one-click DNS application.

use std::sync::Arc;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::client::{page_query, seg, Config};
use crate::types::{ListResponse, ObjectAck, PaginationParams, RemovedResponse, Result};

/// Outbound TLS policy for a domain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tls {
    Opportunistic,
    Enforced,
}

/// Whether a domain capability (e.g. receiving) is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CapabilityStatus {
    Enabled,
    Disabled,
}

/// One DNS record the domain owner must publish.
#[derive(Debug, Clone, Deserialize)]
pub struct DomainRecord {
    /// `DKIM` | `SPF` | `DMARC` | `Tracking` | `Receiving MX`.
    pub record: String,
    pub name: String,
    #[serde(rename = "type")]
    pub record_type: String,
    pub ttl: String,
    pub status: String,
    pub value: String,
    pub priority: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DomainCapabilities {
    pub sending: CapabilityStatus,
    pub receiving: CapabilityStatus,
}

/// A sending domain and its DNS records.
#[derive(Debug, Clone, Deserialize)]
pub struct Domain {
    pub object: String,
    pub id: String,
    pub name: String,
    /// Aggregated verification status: `not_started`, `pending`, `verified`,
    /// `partially_verified`, `partially_failed`, `failed`,
    /// `temporary_failure`, or `revoked`.
    pub status: String,
    pub region: String,
    /// The DNS zone the registrar manages (e.g. `acme.com` when `name` is
    /// `replies.acme.com`). Record names should be entered relative to it.
    pub zone: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub records: Vec<DomainRecord>,
    /// MAIL FROM subdomain (Return-Path); defaults to `send`.
    pub custom_return_path: Option<String>,
    pub open_tracking: Option<bool>,
    pub click_tracking: Option<bool>,
    /// Open/click tracking subdomain label (`None` ⇒ tracking on the shared host).
    pub tracking_subdomain: Option<String>,
    pub tls: Option<Tls>,
    pub capabilities: Option<DomainCapabilities>,
    pub tracking_domain: Option<String>,
    pub tracking_verified: Option<bool>,
    /// When the provider status was last refreshed.
    pub aws_last_checked_at: Option<String>,
    /// Why the last provider status check failed, when it did.
    pub aws_check_error: Option<String>,
}

/// One MX record found by `domains.mx_check`.
#[derive(Debug, Clone, Deserialize)]
pub struct MxRecord {
    pub exchange: String,
    #[serde(default)]
    pub priority: u32,
}

/// Result of `domains.mx_check` (`GET /domains/mx-check`). DNS failures fail
/// OPEN: you get `has_mx: false` with an empty `records`, not an error.
#[derive(Debug, Clone, Deserialize)]
pub struct MxCheckResult {
    #[serde(default)]
    pub has_mx: bool,
    /// True only when EVERY MX host is a SendPing host.
    #[serde(default)]
    pub ours: bool,
    /// Sorted by ascending `priority`.
    #[serde(default)]
    pub records: Vec<MxRecord>,
}

/// Capabilities to enable on create/update, e.g. receiving.
#[derive(Debug, Clone, Default, Serialize)]
pub struct CapabilitiesInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiving: Option<CapabilityStatus>,
}

/// Options for `domains.create` (`POST /domains`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct CreateDomainOptions {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    /// MAIL FROM subdomain (Return-Path); defaults to `send`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_return_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_tracking: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub click_tracking: Option<bool>,
    /// Custom tracking host label, e.g. `email` ⇒ `email.<domain>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracking_subdomain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tls: Option<Tls>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<CapabilitiesInput>,
}

impl CreateDomainOptions {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            ..Default::default()
        }
    }

    pub fn with_region(mut self, region: impl Into<String>) -> Self {
        self.region = Some(region.into());
        self
    }

    pub fn with_custom_return_path(mut self, custom_return_path: impl Into<String>) -> Self {
        self.custom_return_path = Some(custom_return_path.into());
        self
    }

    pub fn with_open_tracking(mut self, open_tracking: bool) -> Self {
        self.open_tracking = Some(open_tracking);
        self
    }

    pub fn with_click_tracking(mut self, click_tracking: bool) -> Self {
        self.click_tracking = Some(click_tracking);
        self
    }

    pub fn with_tracking_subdomain(mut self, tracking_subdomain: impl Into<String>) -> Self {
        self.tracking_subdomain = Some(tracking_subdomain.into());
        self
    }

    pub fn with_tls(mut self, tls: Tls) -> Self {
        self.tls = Some(tls);
        self
    }

    /// Enable/disable inbound receiving for this domain.
    pub fn with_receiving(mut self, receiving: CapabilityStatus) -> Self {
        self.capabilities
            .get_or_insert_with(CapabilitiesInput::default)
            .receiving = Some(receiving);
        self
    }
}

/// Options for `domains.update` (`PATCH /domains/:id`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateDomainOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_tracking: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub click_tracking: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracking_subdomain: Option<String>,
    /// Enable/disable the custom open/click tracking host for this domain.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_tracking: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tls: Option<Tls>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<CapabilitiesInput>,
}

impl UpdateDomainOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_open_tracking(mut self, open_tracking: bool) -> Self {
        self.open_tracking = Some(open_tracking);
        self
    }

    pub fn with_click_tracking(mut self, click_tracking: bool) -> Self {
        self.click_tracking = Some(click_tracking);
        self
    }

    pub fn with_tracking_subdomain(mut self, tracking_subdomain: impl Into<String>) -> Self {
        self.tracking_subdomain = Some(tracking_subdomain.into());
        self
    }

    pub fn with_custom_tracking(mut self, custom_tracking: bool) -> Self {
        self.custom_tracking = Some(custom_tracking);
        self
    }

    pub fn with_tls(mut self, tls: Tls) -> Self {
        self.tls = Some(tls);
        self
    }

    pub fn with_receiving(mut self, receiving: CapabilityStatus) -> Self {
        self.capabilities
            .get_or_insert_with(CapabilitiesInput::default)
            .receiving = Some(receiving);
        self
    }
}

/// The TXT record proving ownership during a claim.
#[derive(Debug, Clone, Deserialize)]
pub struct DomainClaimRecord {
    #[serde(rename = "type")]
    pub record_type: String,
    pub name: String,
    pub value: Option<String>,
    pub ttl: String,
}

/// A claim on a domain already verified by another account (takeover path;
/// last verifier wins).
#[derive(Debug, Clone, Deserialize)]
pub struct DomainClaim {
    pub object: String,
    pub id: String,
    pub name: String,
    pub domain_id: String,
    pub region: String,
    pub status: String,
    pub record: DomainClaimRecord,
    pub blocked_reason: Option<String>,
    pub failure_reason: Option<String>,
    pub created_at: String,
    pub expires_at: String,
}

/// Options for `domains.claim` (`POST /domains/claim`).
#[derive(Debug, Clone, Serialize)]
pub struct ClaimDomainOptions {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
}

impl ClaimDomainOptions {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            region: None,
        }
    }

    pub fn with_region(mut self, region: impl Into<String>) -> Self {
        self.region = Some(region.into());
        self
    }
}

/// DNS provider detection result (`GET /domains/:id/dns/detect`).
#[derive(Debug, Clone, Deserialize)]
pub struct DnsDetection {
    pub provider: Value,
    #[serde(default)]
    pub nameservers: Vec<String>,
    /// The one-click apply methods available (Cloudflare token, GoDaddy
    /// key/secret, hosted Domain Connect, panel deep-link).
    #[serde(default)]
    pub methods: Vec<Value>,
}

/// Credentials for the Namecheap one-click DNS apply.
#[derive(Debug, Clone, Serialize)]
pub struct NamecheapDnsOptions {
    #[serde(rename = "apiUser")]
    pub api_user: String,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    #[serde(rename = "userName", skip_serializing_if = "Option::is_none")]
    pub user_name: Option<String>,
}

impl NamecheapDnsOptions {
    pub fn new(api_user: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            api_user: api_user.into(),
            api_key: api_key.into(),
            user_name: None,
        }
    }

    pub fn with_user_name(mut self, user_name: impl Into<String>) -> Self {
        self.user_name = Some(user_name.into());
        self
    }
}

/// `sendping.domains`.
#[derive(Clone, Debug)]
pub struct DomainsSvc {
    config: Arc<Config>,
}

/// HTTPS tracking readiness, separate from sending-domain DNS verification.
#[derive(Debug, Clone, Deserialize)]
pub struct DomainTrackingHealth {
    pub custom_host: Option<String>,
    pub status: String,
    pub checked_at: String,
}

impl DomainsSvc {
    /// Check HTTPS readiness; an unavailable host schedules server-side repair.
    pub async fn tracking_health(&self, id: &str) -> Result<DomainTrackingHealth> {
        self.config
            .send(self.config.request(
                Method::GET,
                &format!("/domains/{}/tracking-health", seg(id)),
            ))
            .await
    }

    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// Add a domain. `POST /domains`
    pub async fn create(&self, options: CreateDomainOptions) -> Result<Domain> {
        self.config
            .send(self.config.request(Method::POST, "/domains").json(&options))
            .await
    }

    /// Retrieve a domain and its DNS records. `GET /domains/:id`
    pub async fn get(&self, domain_id: &str) -> Result<Domain> {
        let path = format!("/domains/{}", seg(domain_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// Check whether a domain already publishes MX records, and whether they
    /// point at SendPing. `GET /domains/mx-check?name=`
    pub async fn mx_check(&self, name: &str) -> Result<MxCheckResult> {
        let req = self
            .config
            .request(Method::GET, "/domains/mx-check")
            .query(&[("name", name)]);
        self.config.send(req).await
    }

    /// Download this domain's DNS records as CSV bytes (the route streams
    /// `text/csv`, not JSON). `GET /domains/:id/records.csv`
    pub async fn records_csv(&self, domain_id: &str) -> Result<Vec<u8>> {
        let path = format!("/domains/{}/records.csv", seg(domain_id));
        self.config
            .send_raw(self.config.request(Method::GET, &path))
            .await
    }

    /// List domains. Rows with a pending ownership CLAIM are excluded — reach
    /// those through [`get_claim`](Self::get_claim). With no pagination params
    /// the route answers in one page capped at **1,000** domains, with
    /// `has_more` reporting any truncation. `GET /domains`
    pub async fn list(&self, params: Option<PaginationParams>) -> Result<ListResponse<Domain>> {
        let req = self
            .config
            .request(Method::GET, "/domains")
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// Update tracking/TLS/capabilities. Returns the slim `{ object, id }` ack.
    /// `PATCH /domains/:id`
    pub async fn update(&self, domain_id: &str, options: UpdateDomainOptions) -> Result<ObjectAck> {
        let path = format!("/domains/{}", seg(domain_id));
        self.config
            .send(self.config.request(Method::PATCH, &path).json(&options))
            .await
    }

    /// Trigger DNS verification. Returns the slim `{ object, id }` ack.
    /// `POST /domains/:id/verify`
    pub async fn verify(&self, domain_id: &str) -> Result<ObjectAck> {
        let path = format!("/domains/{}/verify", seg(domain_id));
        self.config
            .send(self.config.request(Method::POST, &path))
            .await
    }

    /// Claim a domain already verified elsewhere. `POST /domains/claim`
    pub async fn claim(&self, options: ClaimDomainOptions) -> Result<DomainClaim> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/domains/claim")
                    .json(&options),
            )
            .await
    }

    /// Retrieve a domain's claim record. `GET /domains/:id/claim`
    pub async fn get_claim(&self, domain_id: &str) -> Result<DomainClaim> {
        let path = format!("/domains/{}/claim", seg(domain_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// Verify a domain claim. `POST /domains/:id/claim/verify`
    pub async fn verify_claim(&self, domain_id: &str) -> Result<DomainClaim> {
        let path = format!("/domains/{}/claim/verify", seg(domain_id));
        self.config
            .send(self.config.request(Method::POST, &path))
            .await
    }

    /// Detect the domain's DNS provider and available one-click apply methods.
    /// `GET /domains/:id/dns/detect`
    pub async fn detect_dns(&self, domain_id: &str) -> Result<DnsDetection> {
        let path = format!("/domains/{}/dns/detect", seg(domain_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// Apply this domain's DNS records via the Cloudflare API, then
    /// auto-verify. `POST /domains/:id/dns/cloudflare`
    pub async fn apply_cloudflare_dns(&self, domain_id: &str, token: &str) -> Result<Value> {
        let path = format!("/domains/{}/dns/cloudflare", seg(domain_id));
        self.config
            .send(
                self.config
                    .request(Method::POST, &path)
                    .json(&json!({ "token": token })),
            )
            .await
    }

    /// Apply this domain's DNS records via the GoDaddy API, then auto-verify.
    /// `POST /domains/:id/dns/godaddy`
    pub async fn apply_godaddy_dns(
        &self,
        domain_id: &str,
        key: &str,
        secret: &str,
    ) -> Result<Value> {
        let path = format!("/domains/{}/dns/godaddy", seg(domain_id));
        self.config
            .send(
                self.config
                    .request(Method::POST, &path)
                    .json(&json!({ "key": key, "secret": secret })),
            )
            .await
    }

    /// Apply this domain's DNS records via the Namecheap API (existing
    /// records preserved), then auto-verify. Namecheap must have the calling
    /// server's IP whitelisted. `POST /domains/:id/dns/namecheap`
    pub async fn apply_namecheap_dns(
        &self,
        domain_id: &str,
        options: NamecheapDnsOptions,
    ) -> Result<Value> {
        let path = format!("/domains/{}/dns/namecheap", seg(domain_id));
        self.config
            .send(self.config.request(Method::POST, &path).json(&options))
            .await
    }

    /// Delete a domain. `DELETE /domains/:id`
    pub async fn remove(&self, domain_id: &str) -> Result<RemovedResponse> {
        let path = format!("/domains/{}", seg(domain_id));
        self.config
            .send(self.config.request(Method::DELETE, &path))
            .await
    }
}

//! HTTP core: the [`SendPing`] client, request building, and API-error
//! mapping shared by every service.

use std::fmt;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use reqwest::header::HeaderMap;
use reqwest::{Method, RequestBuilder};
use serde::de::DeserializeOwned;
use serde_json::{from_value, Value};

use crate::services::*;
use crate::types::{ApiError, Error, IdResponse, PaginationParams, Result};

/// The production SendPing API host.
pub const DEFAULT_BASE_URL: &str = "https://www.sendping.co/api";

/// Default per-request timeout, in seconds. Overridable via
/// [`SendPingBuilder::timeout`]; `0` / [`SendPingBuilder::no_timeout`]
/// disables it.
pub const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// Default number of automatic retries (up to `1 + max_retries` total
/// attempts). Overridable via [`SendPingBuilder::max_retries`]; `0` disables
/// retrying.
pub const DEFAULT_MAX_RETRIES: u32 = 2;

/// Upper bound (seconds) on any single backoff wait, whether it comes from a
/// `Retry-After` header or exponential backoff.
const MAX_BACKOFF_SECS: f64 = 30.0;

/// This crate's version (kept in sync with `Cargo.toml`).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// `User-Agent` header sent with every request.
pub const USER_AGENT: &str = concat!("sendping-rust/", env!("CARGO_PKG_VERSION"));

/// Longest `Idempotency-Key` the API accepts. The accepted range is
/// **1–255** characters measured after the server trims the value (the
/// storage column is `VARCHAR(255)`) — not 256. Anything outside it is a
/// `400 invalid_idempotency_key`.
///
/// The header is honoured by `POST /emails`, `POST /emails/batch`, and received-email reply/forward
/// (`emails.send_with_idempotency_key`, `batch.send_emails_with_idempotency_key`).
/// Every other endpoint ignores it, so a retry there creates a second
/// resource.
///
/// This crate does not check the length itself — the server is the
/// authority. The constant is exported so the rule is discoverable.
pub const IDEMPOTENCY_KEY_MAX_LEN: usize = 255;

/// Shared request configuration handed to every service (cheap `Arc` clone).
pub(crate) struct Config {
    api_key: String,
    base_url: String,
    client: reqwest::Client,
    /// Max automatic retries on 429/503 (see [`Config::execute`]).
    max_retries: u32,
}

impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("api_key", &"mb_***redacted***")
            .field("base_url", &self.base_url)
            .finish()
    }
}

impl Config {
    /// Start a request against `path` (leading slash) with auth + UA set.
    pub(crate) fn request(&self, method: Method, path: &str) -> RequestBuilder {
        self.client
            .request(method, format!("{}{}", self.base_url, path))
            .bearer_auth(&self.api_key)
            .header(reqwest::header::USER_AGENT, USER_AGENT)
    }

    /// The single request chokepoint: send `req`, and on HTTP `429`/`503`
    /// retry up to `max_retries` times, honoring `Retry-After` (else
    /// exponential backoff). Both the JSON ([`Config::send`]) and raw
    /// ([`Config::send_raw`]) paths funnel through here, so both inherit the
    /// configured timeout (carried by the [`reqwest::Client`]) and retry
    /// policy. Returns the final response status and fully-read body.
    ///
    /// Only eligible `429` and `503` responses retry. Partial work stops retries;
    /// writes need a pre-processing rejection or a supported operation key.
    /// Other `5xx`, network errors and timeouts are never retried.
    async fn execute(&self, req: RequestBuilder) -> Result<(reqwest::StatusCode, Vec<u8>)> {
        let descriptor = req.try_clone().and_then(|r| r.build().ok());
        // Buffer the request so it can be rebuilt per attempt. `try_clone`
        // yields a fresh builder for the in-memory bodies this SDK sends
        // (`.json(..)`); a non-cloneable streaming body returns `None`, in
        // which case we make a single attempt and cannot retry.
        let mut next = Some(req);
        let mut attempt: u32 = 0;
        loop {
            let current = next
                .take()
                .expect("request builder is present at the start of each attempt");
            // Pre-clone for a possible retry before `send` consumes `current`.
            let spare = current.try_clone();

            let resp = current.send().await?;
            let status = resp.status();
            let code = status.as_u16();
            let retryable = code == 429 || code == 503;
            let wait = parse_retry_after(resp.headers()).unwrap_or_else(|| backoff_delay(attempt));
            // Read/drop the response before retrying. Partial or reserved work
            // is a terminal result even when its HTTP status is normally retryable.
            let bytes = resp.bytes().await?.to_vec();
            if !retryable
                || attempt >= self.max_retries
                || spare.is_none()
                || !retry_allowed(code, &bytes, descriptor.as_ref())
            {
                return Ok((status, bytes));
            }
            tokio::time::sleep(wait).await;
            next = spare; // guaranteed `Some` here (checked above)
            attempt += 1;
        }
    }

    /// Execute a request and decode the JSON response; non-2xx statuses are
    /// mapped to [`Error::Api`] parsed from the standard error body.
    pub(crate) async fn send<T: DeserializeOwned>(&self, req: RequestBuilder) -> Result<T> {
        let (status, bytes) = self.execute(req).await?;
        if !status.is_success() {
            return Err(api_error(status.as_u16(), &bytes));
        }
        serde_json::from_slice(&bytes).map_err(Error::Json)
    }

    /// Execute a request whose success response streams raw bytes (received
    /// attachment / RFC822 downloads). Errors are still JSON and are mapped
    /// like [`Config::send`].
    pub(crate) async fn send_raw(&self, req: RequestBuilder) -> Result<Vec<u8>> {
        let (status, bytes) = self.execute(req).await?;
        if !status.is_success() {
            return Err(api_error(status.as_u16(), &bytes));
        }
        Ok(bytes)
    }
}

fn retry_allowed(status: u16, raw: &[u8], request: Option<&reqwest::Request>) -> bool {
    let body: Value = serde_json::from_slice(raw).unwrap_or(Value::Null);
    if body["id"].as_str().is_some_and(|id| !id.is_empty())
        || body["sent_count"].as_f64().is_some_and(|count| count > 0.0)
        || body["sent"]
            .as_array()
            .is_some_and(|items| !items.is_empty())
        || body["reserved"]
            .as_array()
            .is_some_and(|items| !items.is_empty())
        || body["name"] == "batch_incomplete"
    {
        return false;
    }
    let Some(req) = request else {
        return false;
    };
    if status != 503 || req.method() == Method::GET || req.method() == Method::HEAD {
        return true;
    }
    if matches!(
        body["name"].as_str(),
        Some(
            "service_unavailable"
                | "sending_service_unavailable"
                | "sending_configuration_unavailable"
                | "contacts_busy"
                | "contacts_timeout"
        )
    ) {
        return true;
    }
    let path = req.url().path();
    let parts: Vec<_> = path.rsplit('/').collect();
    let send_path = path.ends_with("/emails")
        || path.ends_with("/emails/batch")
        || (parts.len() >= 4
            && matches!(parts[0], "reply" | "forward")
            && !parts[1].is_empty()
            && parts[2] == "receiving"
            && parts[3] == "emails");
    req.method() == Method::POST
        && send_path
        && req
            .headers()
            .get("Idempotency-Key")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|key| !key.trim().is_empty())
}

/// Parse a `Retry-After` header into a wait duration, capped at
/// [`MAX_BACKOFF_SECS`]. Accepts an integer/decimal number of seconds
/// (negative treated as `0`) or an HTTP-date; returns `None` when the header
/// is absent or unparseable.
fn parse_retry_after(headers: &HeaderMap) -> Option<Duration> {
    let raw = headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim();

    // Numeric seconds (integer or decimal).
    if let Ok(secs) = raw.parse::<f64>() {
        if secs.is_finite() {
            return Some(Duration::from_secs_f64(secs.clamp(0.0, MAX_BACKOFF_SECS)));
        }
    }

    // HTTP-date: wait until that instant (never negative, capped).
    if let Ok(when) = httpdate::parse_http_date(raw) {
        let wait = when
            .duration_since(SystemTime::now())
            .unwrap_or(Duration::ZERO);
        return Some(wait.min(Duration::from_secs_f64(MAX_BACKOFF_SECS)));
    }

    None
}

/// Exponential backoff for retry `attempt` (0-based): `min(30s, 0.5s * 2^attempt)`.
fn backoff_delay(attempt: u32) -> Duration {
    let secs = (0.5 * 2f64.powi(attempt as i32)).min(MAX_BACKOFF_SECS);
    Duration::from_secs_f64(secs)
}

/// Parse the standard `{ statusCode, name, message }` error body, falling
/// back to the HTTP status when the body is absent or malformed.
///
/// Some errors are a superset of the envelope; the additive `limit`,
/// `reputation` and `sent`/`sent_count` fields are parsed here too, and the
/// raw body is retained so extras this version does not model stay reachable.
fn api_error(status: u16, body: &[u8]) -> Error {
    let parsed: Option<Value> = serde_json::from_slice(body).ok();
    // Read field by field: an additive field in a shape this SDK version does
    // not expect must never cost the caller the envelope itself.
    let obj = parsed.as_ref().and_then(Value::as_object);
    let field = |key: &str| obj.and_then(|o| o.get(key));
    /// Decode one additive field, yielding `None` when it is absent or has a
    /// shape this version does not understand.
    fn detail<T: DeserializeOwned>(v: Option<&Value>) -> Option<T> {
        v.cloned().and_then(|v| from_value(v).ok())
    }

    let sent: Vec<IdResponse> = detail(field("sent")).unwrap_or_default();
    let sent_count = field("sent_count")
        .and_then(Value::as_u64)
        .map(|n| n as u32)
        .unwrap_or(sent.len() as u32);

    Error::Api(Box::new(ApiError {
        status_code: status,
        name: field("name")
            .and_then(Value::as_str)
            .unwrap_or("application_error")
            .to_owned(),
        message: field("message")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("Request failed with status {status}")),
        limit: detail(field("limit")),
        reputation: detail(field("reputation")),
        sent,
        sent_count,
        body: parsed,
    }))
}

/// Percent-encode a single URL path segment (RFC 3986 unreserved characters
/// pass through) so an id like `user@example.com` — or a hostile one like
/// `../api-keys` — can never traverse the URL path and hit a different
/// endpoint.
pub(crate) fn seg(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Turn optional pagination params into query pairs (empty when `None`).
pub(crate) fn page_query(params: Option<&PaginationParams>) -> Vec<(&'static str, String)> {
    params.map(PaginationParams::to_query).unwrap_or_default()
}

/// The SendPing API client. One field per resource:
///
/// ```no_run
/// use sendping::SendPing;
///
/// let sendping = SendPing::new("mb_xxxxxxxxx");
/// // sendping.emails, sendping.domains, sendping.contacts, …
/// ```
#[derive(Clone, Debug)]
pub struct SendPing {
    pub emails: EmailsSvc,
    pub batch: BatchSvc,
    pub domains: DomainsSvc,
    pub audiences: AudiencesSvc,
    pub contacts: ContactsSvc,
    pub contact_properties: ContactPropertiesSvc,
    pub campaigns: CampaignsSvc,
    pub segments: SegmentsSvc,
    pub topics: TopicsSvc,
    pub templates: TemplatesSvc,
    pub automations: AutomationsSvc,
    pub webhooks: WebhooksSvc,
    pub logs: LogsSvc,
    pub events: EventsSvc,
    pub api_keys: ApiKeysSvc,
    pub polls: PollsSvc,
}

impl SendPing {
    /// Create a client against the production API (`https://www.sendping.co/api`)
    /// with the default 30s timeout and up to 2 retries.
    pub fn new(api_key: impl Into<String>) -> Self {
        Self::builder(api_key).build()
    }

    /// Point the client at a different host (a proxy, a staging environment,
    /// or a local test stub). A trailing `/` on `base_url` is trimmed. Keeps
    /// the default timeout and retry policy.
    pub fn with_base_url(api_key: impl Into<String>, base_url: impl Into<String>) -> Self {
        Self::builder(api_key).base_url(base_url).build()
    }

    /// Full control: bring your own [`reqwest::Client`] (timeouts, proxies,
    /// connection pools). The supplied client's own timeout applies; the
    /// builder's `timeout` is not imposed on a user-supplied client. The
    /// default retry policy still applies — use [`SendPing::builder`] to
    /// change it.
    pub fn with_client(
        api_key: impl Into<String>,
        base_url: impl Into<String>,
        client: reqwest::Client,
    ) -> Self {
        Self::builder(api_key)
            .base_url(base_url)
            .client(client)
            .build()
    }

    /// Start a [`SendPingBuilder`] to configure the base URL, request
    /// timeout, retry count, or an entirely custom [`reqwest::Client`].
    pub fn builder(api_key: impl Into<String>) -> SendPingBuilder {
        SendPingBuilder::new(api_key)
    }
}

/// Builder for a [`SendPing`] client. Configures the base URL, the
/// per-request timeout (default 30s), the automatic-retry count (default 2),
/// and optionally a bring-your-own [`reqwest::Client`].
pub struct SendPingBuilder {
    api_key: String,
    base_url: String,
    timeout: Option<Duration>,
    max_retries: u32,
    client: Option<reqwest::Client>,
}

impl fmt::Debug for SendPingBuilder {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SendPingBuilder")
            .field("api_key", &"mb_***redacted***")
            .field("base_url", &self.base_url)
            .field("timeout", &self.timeout)
            .field("max_retries", &self.max_retries)
            .field("client", &self.client.is_some())
            .finish()
    }
}

impl SendPingBuilder {
    fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            base_url: DEFAULT_BASE_URL.to_owned(),
            timeout: Some(Duration::from_secs(DEFAULT_TIMEOUT_SECS)),
            max_retries: DEFAULT_MAX_RETRIES,
            client: None,
        }
    }

    /// Override the API host. A trailing `/` is trimmed at build time.
    pub fn base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }

    /// Set the per-request timeout applied to every call (JSON and raw). A
    /// zero duration disables it (equivalent to [`Self::no_timeout`]). Ignored
    /// when a client is supplied via [`Self::client`].
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = if timeout.is_zero() {
            None
        } else {
            Some(timeout)
        };
        self
    }

    /// Disable the request timeout entirely.
    pub fn no_timeout(mut self) -> Self {
        self.timeout = None;
        self
    }

    /// Set the maximum number of automatic retries on HTTP `429`/`503`
    /// (`0` disables retrying; total attempts are `1 + max_retries`).
    pub fn max_retries(mut self, max_retries: u32) -> Self {
        self.max_retries = max_retries;
        self
    }

    /// Escape hatch: use a fully custom [`reqwest::Client`]. Its own timeout,
    /// proxy, and pool settings apply as-is; the builder's [`Self::timeout`]
    /// is not imposed on it.
    pub fn client(mut self, client: reqwest::Client) -> Self {
        self.client = Some(client);
        self
    }

    /// Build the [`SendPing`] client.
    pub fn build(self) -> SendPing {
        let client = self.client.unwrap_or_else(|| {
            let mut builder =
                reqwest::Client::builder().redirect(reqwest::redirect::Policy::none());
            if let Some(timeout) = self.timeout {
                builder = builder.timeout(timeout);
            }
            builder.build().expect("failed to build reqwest client")
        });

        let config = Arc::new(Config {
            api_key: self.api_key,
            base_url: self.base_url.trim_end_matches('/').to_owned(),
            client,
            max_retries: self.max_retries,
        });
        SendPing {
            emails: EmailsSvc::new(Arc::clone(&config)),
            batch: BatchSvc::new(Arc::clone(&config)),
            domains: DomainsSvc::new(Arc::clone(&config)),
            audiences: AudiencesSvc::new(Arc::clone(&config)),
            contacts: ContactsSvc::new(Arc::clone(&config)),
            contact_properties: ContactPropertiesSvc::new(Arc::clone(&config)),
            campaigns: CampaignsSvc::new(Arc::clone(&config)),
            segments: SegmentsSvc::new(Arc::clone(&config)),
            topics: TopicsSvc::new(Arc::clone(&config)),
            templates: TemplatesSvc::new(Arc::clone(&config)),
            automations: AutomationsSvc::new(Arc::clone(&config)),
            webhooks: WebhooksSvc::new(Arc::clone(&config)),
            logs: LogsSvc::new(Arc::clone(&config)),
            events: EventsSvc::new(Arc::clone(&config)),
            api_keys: ApiKeysSvc::new(Arc::clone(&config)),
            polls: PollsSvc::new(config),
        }
    }
}

#[cfg(test)]
#[path = "recovery_tests.rs"]
mod recovery_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seg_passes_unreserved_and_encodes_the_rest() {
        assert_eq!(seg("em_abc123"), "em_abc123");
        assert_eq!(seg("user@example.com"), "user%40example.com");
        assert_eq!(seg("../api-keys"), "..%2Fapi-keys");
        assert_eq!(seg("a b"), "a%20b");
    }

    /// Grab the `ApiError` out of an `Error`, failing the test otherwise.
    fn expect_api(e: Error) -> ApiError {
        match e {
            Error::Api(api) => *api,
            other => panic!("expected Api error, got {other:?}"),
        }
    }

    #[test]
    fn api_error_parses_standard_body_and_falls_back() {
        let api = expect_api(api_error(
            422,
            br#"{"statusCode":422,"name":"validation_error","message":"domain is required"}"#,
        ));
        assert_eq!(api.status_code, 422);
        assert_eq!(api.name, "validation_error");
        assert_eq!(api.message, "domain is required");
        // An ordinary error carries none of the additive fields.
        assert!(api.limit.is_none());
        assert!(api.reputation.is_none());
        assert!(api.sent.is_empty());
        assert_eq!(api.sent_count, 0);

        let api = expect_api(api_error(500, b"not json"));
        assert_eq!(api.status_code, 500);
        assert_eq!(api.name, "application_error");
        assert!(api.body.is_none(), "a non-JSON body has nothing to retain");
    }

    /// A plan/quota rejection is a superset of the envelope: without the
    /// `limit` object a caller cannot tell WHICH quota was hit.
    #[test]
    fn api_error_parses_the_plan_limit_object() {
        let api = expect_api(api_error(
            429,
            br#"{"statusCode":429,"name":"daily_quota_exceeded","message":"Daily send limit reached.",
                 "limit":{"kind":"emails_daily","used":100,"limit":100,"requested":3,"remaining":0,
                          "period":"24h","plan":{"id":"free","name":"Free"},
                          "next_plan":{"id":"pro","name":"Pro","amount":1400,"currency":"USD",
                                       "monthly_emails":50000,"daily_emails":2000,"domains":10,
                                       "contacts":10000,"ai_credits":100,"automation_runs":10000},
                          "credits":{"balance":0,"needed":1,"purchasable":true,"unit":1000,
                                     "amount_per_unit_cents":100}}}"#,
        ));
        let limit = api.limit.expect("limit object on a quota error");
        assert_eq!(limit.kind, "emails_daily");
        assert_eq!((limit.used, limit.limit), (100, 100));
        assert_eq!(limit.requested, Some(3));
        assert_eq!(limit.remaining, Some(0));
        assert_eq!(limit.period.as_deref(), Some("24h"));
        assert_eq!(limit.plan.id, "free");
        let next = limit.next_plan.expect("next_plan when one fits");
        assert_eq!((next.id.as_str(), next.amount), ("pro", 1400));
        let credits = limit.credits.expect("credits on an email-quota kind");
        assert!(credits.purchasable);
        assert_eq!(credits.unit, 1000);
        assert!(api.reputation.is_none());
    }

    /// `next_plan` is JSON null when only Enterprise fits — that must read as
    /// `None`, not a zero-priced upgrade.
    #[test]
    fn api_error_plan_limit_handles_null_next_plan() {
        let api = expect_api(api_error(
            402,
            br#"{"statusCode":402,"name":"plan_limit_reached","message":"Domain limit reached.",
                 "limit":{"kind":"domains","used":1,"limit":1,"requested":2,"remaining":0,
                          "plan":{"id":"free","name":"Free"},"next_plan":null}}"#,
        ));
        let limit = api.limit.expect("limit object on a plan error");
        assert_eq!(limit.kind, "domains");
        assert!(limit.next_plan.is_none());
        // Not an email-quota kind: no credits block, no rolling window.
        assert!(limit.credits.is_none());
        assert!(limit.period.is_none());
    }

    #[test]
    fn api_error_parses_the_reputation_object() {
        let api = expect_api(api_error(
            429,
            br#"{"statusCode":429,"name":"reputation_limit_exceeded","message":"Warm-up capacity reached.",
                 "reputation":{"retryable":true,"scope":"domain","status":"warming",
                               "scope_key":"example.com","hourly_limit":50,"daily_limit":500,
                               "hourly_used":50,"daily_used":120,
                               "retry_at":"2026-08-08T10:00:00.000Z",
                               "support_email":"support@sendping.co"}}"#,
        ));
        let rep = api.reputation.expect("reputation object on a gate error");
        assert!(rep.retryable);
        assert_eq!(rep.scope, "domain");
        assert_eq!(rep.scope_key.as_deref(), Some("example.com"));
        assert_eq!(rep.hourly_limit, Some(50));
        assert_eq!(rep.daily_used, Some(120));
        assert!(rep.retry_at.is_some());
        assert!(api.limit.is_none());
    }

    /// A batch that dies part way through names the emails that DID go out.
    #[test]
    fn api_error_parses_partial_batch_sent() {
        let api = expect_api(api_error(
            429,
            br#"{"statusCode":429,"name":"daily_quota_exceeded","message":"Daily send limit reached.",
                 "limit":{"kind":"emails_daily","used":100,"limit":100,
                          "plan":{"id":"free","name":"Free"}},
                 "sent":[{"id":"em_1"},{"id":"em_2"}],"sent_count":2}"#,
        ));
        assert_eq!(api.sent_count, 2);
        let ids: Vec<&str> = api.sent.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["em_1", "em_2"]);
        assert_eq!(api.limit.expect("limit").kind, "emails_daily");
    }

    /// `sent_count` is derived from `sent` when the server omits it, so it can
    /// always be trusted.
    #[test]
    fn api_error_derives_sent_count_when_absent() {
        let api = expect_api(api_error(
            422,
            br#"{"statusCode":422,"name":"validation_error","message":"bad item",
                 "sent":[{"id":"em_1"}]}"#,
        ));
        assert_eq!(api.sent_count, 1);
    }

    /// Fields this version does not model stay reachable through `body`.
    #[test]
    fn api_error_retains_the_raw_body() {
        let api = expect_api(api_error(
            404,
            br#"{"statusCode":404,"name":"not_found","message":"Email not found.","future_field":"kept"}"#,
        ));
        let body = api.body.expect("JSON body retained");
        assert_eq!(body["future_field"], "kept");
    }

    /// An additive field in a shape this version does not expect must cost the
    /// caller that field only — never the envelope, never the other extras.
    #[test]
    fn api_error_unexpected_extra_shape_keeps_the_envelope() {
        let api = expect_api(api_error(
            422,
            br#"{"statusCode":422,"name":"validation_error","message":"bad item",
                 "limit":"not-an-object","sent":[{"id":"em_1"}]}"#,
        ));
        assert_eq!(api.status_code, 422);
        assert_eq!(api.name, "validation_error");
        assert_eq!(api.message, "bad item");
        assert!(api.limit.is_none(), "an unparseable limit reads as absent");
        assert_eq!(api.sent_count, 1, "a bad `limit` must not drop `sent`");
    }

    #[test]
    fn backoff_is_exponential_and_capped_at_30s() {
        assert_eq!(backoff_delay(0), Duration::from_millis(500));
        assert_eq!(backoff_delay(1), Duration::from_secs(1));
        assert_eq!(backoff_delay(2), Duration::from_secs(2));
        assert_eq!(backoff_delay(3), Duration::from_secs(4));
        // 0.5 * 2^20 far exceeds the cap → clamped to 30s.
        assert_eq!(backoff_delay(20), Duration::from_secs(30));
    }

    #[test]
    fn retry_after_parses_seconds_and_dates_with_cap() {
        use reqwest::header::{HeaderMap, HeaderValue, RETRY_AFTER};

        let parse = |v: &str| {
            let mut h = HeaderMap::new();
            h.insert(RETRY_AFTER, HeaderValue::from_str(v).unwrap());
            parse_retry_after(&h)
        };

        // Integer / decimal seconds.
        assert_eq!(parse("5"), Some(Duration::from_secs(5)));
        assert_eq!(parse("0.5"), Some(Duration::from_millis(500)));
        // Negative is treated as 0; oversized is capped at 30s.
        assert_eq!(parse("-3"), Some(Duration::ZERO));
        assert_eq!(parse("120"), Some(Duration::from_secs(30)));
        // Unparseable / absent → None (falls back to exponential backoff).
        assert_eq!(parse("soon"), None);
        assert_eq!(parse_retry_after(&HeaderMap::new()), None);

        // HTTP-date in the past → no wait.
        let past = httpdate::fmt_http_date(std::time::UNIX_EPOCH + Duration::from_secs(1));
        assert_eq!(parse(&past), Some(Duration::ZERO));

        // HTTP-date far in the future → capped at 30s.
        let future = httpdate::fmt_http_date(SystemTime::now() + Duration::from_secs(600));
        assert_eq!(parse(&future), Some(Duration::from_secs(30)));
    }
}

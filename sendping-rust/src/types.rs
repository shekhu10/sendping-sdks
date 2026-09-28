//! Shared primitives: the crate error type, pagination, and the common
//! response envelopes used across every resource.

use std::fmt;

use serde::Deserialize;
use serde_json::Value;

/// Convenience alias — every service method returns `Result<T, sendping::Error>`.
pub type Result<T> = std::result::Result<T, Error>;

/// A plan identified by id and display name.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PlanRef {
    pub id: String,
    pub name: String,
}

/// The cheapest plan that would clear a limit, with its allowances. `None` on
/// [`PlanLimitDetail::next_plan`] when only Enterprise fits.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PlanUpgrade {
    pub id: String,
    pub name: String,
    /// Price in the currency's minor unit (e.g. cents).
    pub amount: i64,
    pub currency: String,
    pub monthly_emails: i64,
    pub daily_emails: i64,
    pub domains: i64,
    pub contacts: i64,
    pub ai_credits: i64,
    pub automation_runs: i64,
}

/// Topping up with prepaid send credits instead of upgrading. Present only for
/// the email-quota kinds.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct LimitCredits {
    pub balance: i64,
    pub needed: i64,
    pub purchasable: bool,
    /// How many emails one credit pack buys.
    pub unit: i64,
    /// Price of one pack, in cents.
    pub amount_per_unit_cents: i64,
}

/// The additive `limit` object on plan and quota rejections —
/// `plan_limit_reached`, `daily_quota_exceeded`, `monthly_quota_exceeded`,
/// `contact_limit_reached`, `ai_credits_exceeded` and
/// `automation_quota_exceeded`. It says WHICH allowance ran out, how much of
/// it was used, and what would clear it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PlanLimitDetail {
    /// Which allowance ran out: `emails_daily`, `emails_monthly`, `domains`,
    /// `automation_runs`, `ai_credits`, `contacts` or `campaign_preflight`.
    /// Treat it as an open string — new kinds may appear without an SDK release.
    pub kind: String,
    pub used: i64,
    pub limit: i64,
    /// How much the rejected call asked for.
    pub requested: Option<i64>,
    pub remaining: Option<i64>,
    /// Rolling window the limit is measured over: `"24h"` or `"30d"`. `None`
    /// for kinds that are not windowed (e.g. `domains`).
    pub period: Option<String>,
    pub plan: PlanRef,
    /// The cheapest plan that would fit, or `None` when only Enterprise does.
    pub next_plan: Option<PlanUpgrade>,
    /// The top-up option, present only for email-quota kinds.
    pub credits: Option<LimitCredits>,
}

/// The additive `reputation` object on reputation-gate errors
/// (`reputation_paused`, `reputation_limit_exceeded`, and the platform-wide
/// `sending_service_unavailable`). Everything beyond `retryable` and `scope`
/// is optional.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ReputationDetail {
    /// Whether waiting and retrying can succeed (a warm-up capacity ceiling)
    /// rather than the send being blocked outright.
    pub retryable: bool,
    /// What was gated: `"tenant"`, `"domain"` or `"platform"`.
    pub scope: String,
    /// The internal reputation state, when reported.
    pub status: Option<String>,
    /// Identifies the gated entity (e.g. the domain).
    pub scope_key: Option<String>,
    pub hourly_limit: Option<i64>,
    pub daily_limit: Option<i64>,
    pub hourly_used: Option<i64>,
    pub daily_used: Option<i64>,
    /// ISO 8601 timestamp for when sending may resume.
    pub retry_at: Option<String>,
    pub support_email: Option<String>,
}

/// A non-2xx API response, parsed from the standard SendPing error envelope
/// `{ statusCode, name, message }`.
///
/// Branch on [`name`](Self::name) together with
/// [`status_code`](Self::status_code), never on [`message`](Self::message):
/// message text is scrubbed of provider identifiers server-side and is not a
/// stable contract, and some handlers return a status that differs from the
/// name's usual one.
///
/// Some errors are a SUPERSET of the envelope, and those extras are parsed
/// too — each is absent on an ordinary error:
///
/// * [`limit`](Self::limit) — plan/quota rejections say which allowance was hit.
/// * [`reputation`](Self::reputation) — reputation gates say what was paused
///   or throttled.
/// * [`sent`](Self::sent) / [`sent_count`](Self::sent_count) — a
///   `POST /emails/batch` that failed part way through (with or without an
///   `Idempotency-Key`) names the emails that DID go out, so a
///   retry does not send them twice.
#[derive(Debug, Clone, Default)]
pub struct ApiError {
    /// Mirrors the HTTP status; falls back to it when the body is unparseable.
    pub status_code: u16,
    /// Machine-readable reason, e.g. `validation_error`. Falls back to
    /// `application_error` when the body carries no name.
    pub name: String,
    pub message: String,
    /// Set on plan/quota errors, else `None`.
    pub limit: Option<PlanLimitDetail>,
    /// Set on reputation-gate errors, else `None`.
    pub reputation: Option<ReputationDetail>,
    /// Emails already delivered before a batch failed part way through. Empty
    /// on every other error.
    pub sent: Vec<IdResponse>,
    /// How many emails went out before a mid-batch failure. Falls back to
    /// `sent.len()` when the server omits the count, so it can always be
    /// trusted; `0` when nothing was sent.
    pub sent_count: u32,
    /// The whole parsed error body, so fields this SDK version does not model
    /// yet stay reachable. `None` when the response was not JSON.
    pub body: Option<Value>,
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let ApiError {
            status_code,
            name,
            message,
            ..
        } = self;
        write!(f, "SendPing API error {status_code} ({name}): {message}")
    }
}

impl ApiError {
    /// Original logical email for an unsuccessful or unconfirmed send.
    pub fn id(&self) -> Option<&str> {
        self.body.as_ref()?.get("id")?.as_str()
    }
    /// Reserved prefix, including sends whose provider outcome is uncertain.
    pub fn reserved(&self) -> Option<Vec<IdResponse>> {
        serde_json::from_value(self.body.as_ref()?.get("reserved")?.clone()).ok()
    }
    /// Number of items never attempted, not the number lacking delivery confirmation.
    pub fn unsent_count(&self) -> Option<u64> {
        self.body.as_ref()?.get("unsent_count")?.as_u64()
    }
}

impl std::error::Error for ApiError {}

/// The unified SDK error.
#[derive(Debug)]
pub enum Error {
    /// The API answered with a non-2xx status. See [`ApiError`] — it carries
    /// the envelope plus the additive `limit` / `reputation` / `sent` fields.
    /// Boxed so `Result<T, Error>` stays cheap to return.
    Api(Box<ApiError>),
    /// A transport-level failure (connection, TLS, timeout, body read).
    Http(reqwest::Error),
    /// The response body could not be decoded as the expected JSON shape.
    Json(serde_json::Error),
}

impl Error {
    /// The [`ApiError`] behind an [`Error::Api`], or `None` for transport and
    /// decode failures.
    ///
    /// ```
    /// # fn handle(err: sendping::Error) {
    /// if let Some(api) = err.api() {
    ///     if let Some(limit) = &api.limit {
    ///         println!("hit the {} cap: {}/{}", limit.kind, limit.used, limit.limit);
    ///     }
    /// }
    /// # }
    /// ```
    pub fn api(&self) -> Option<&ApiError> {
        match self {
            Error::Api(e) => Some(e),
            _ => None,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Api(e) => write!(f, "{e}"),
            Error::Http(e) => write!(f, "HTTP transport error: {e}"),
            Error::Json(e) => write!(f, "failed to decode response JSON: {e}"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Http(e) => Some(e),
            Error::Json(e) => Some(e),
            Error::Api(_) => None,
        }
    }
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        Error::Http(e)
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Json(e)
    }
}

/// Slim acknowledgement `{ object, id }` returned by several create/update
/// routes (e.g. `templates.create`, `domains.verify`).
#[derive(Debug, Clone, Deserialize)]
pub struct ObjectAck {
    pub object: String,
    pub id: String,
}

/// Minimal `{ id }` acknowledgement returned by several routes
/// (e.g. `campaigns.create`, `contacts.add_to_segment`).
#[derive(Debug, Clone, Deserialize)]
pub struct IdResponse {
    pub id: String,
}

/// The standard `{ object: 'list', has_more, data }` envelope returned by
/// every `list` endpoint.
///
/// [`has_more`](Self::has_more) is the only trustworthy end-of-collection
/// signal. No list endpoint returns an unbounded collection: a supplied
/// `limit` caps the page at that size, and omitting `limit` where the endpoint
/// allows it caps the page at **1,000** rows. Keep paging with
/// [`PaginationParams::with_after`] while `has_more` is `true`.
#[derive(Debug, Clone, Deserialize)]
pub struct ListResponse<T> {
    pub object: String,
    /// `true` when the collection continues past this page — including when an
    /// unpaginated call was truncated at the 1,000-row ceiling.
    #[serde(default)]
    pub has_more: bool,
    pub data: Vec<T>,
}

/// The standard `{ object, id, deleted: true }` envelope returned by
/// `remove` endpoints.
#[derive(Debug, Clone, Deserialize)]
pub struct RemovedResponse {
    pub object: String,
    pub id: String,
    pub deleted: bool,
}

/// Cursor pagination accepted by most `list` methods, appended as
/// `?limit=&after=&before=`.
///
/// ```
/// use sendping::PaginationParams;
/// let page = PaginationParams::new().with_limit(25).with_after("em_123");
/// ```
#[derive(Debug, Clone, Default)]
pub struct PaginationParams {
    /// Page size. Must be **1–100**; anything outside that range is a
    /// `422 validation_error`. Omitted, some endpoints default to 20 and the
    /// rest answer in one page capped at 1,000 rows (see [`ListResponse`]).
    pub limit: Option<u32>,
    /// Cursor: id of the last item on the previous page.
    pub after: Option<String>,
    /// Cursor: id of the first item on the next page.
    pub before: Option<String>,
}

impl PaginationParams {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }

    pub fn with_after(mut self, after: impl Into<String>) -> Self {
        self.after = Some(after.into());
        self
    }

    pub fn with_before(mut self, before: impl Into<String>) -> Self {
        self.before = Some(before.into());
        self
    }

    pub(crate) fn to_query(&self) -> Vec<(&'static str, String)> {
        let mut q = Vec::new();
        if let Some(limit) = self.limit {
            q.push(("limit", limit.to_string()));
        }
        if let Some(after) = &self.after {
            q.push(("after", after.clone()));
        }
        if let Some(before) = &self.before {
            q.push(("before", before.clone()));
        }
        q
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pagination_to_query_orders_and_skips_unset() {
        let q = PaginationParams::new()
            .with_limit(10)
            .with_after("a")
            .to_query();
        assert_eq!(
            q,
            vec![("limit", "10".to_string()), ("after", "a".to_string())]
        );
        assert!(PaginationParams::new().to_query().is_empty());
    }
}

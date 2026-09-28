//! `sendping.api_keys` — read-only listing of your API keys.
//!
//! Keys are created, re-scoped and revoked only from a signed-in dashboard
//! session; the API answers `403 dashboard_only` to any api-key-authenticated
//! caller on those routes, so this crate deliberately offers `list` and
//! nothing else. See [`ApiKeysSvc`].

use std::sync::Arc;

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::client::{page_query, Config};
use crate::types::{ListResponse, PaginationParams, Result};

/// What an API key may do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiKeyPermission {
    FullAccess,
    SendingAccess,
}

/// An API key. `id` is a string-encoded integer on the wire — always treat it
/// as a string.
#[derive(Debug, Clone, Deserialize)]
pub struct ApiKey {
    pub id: String,
    /// Omitted on list rows.
    pub object: Option<String>,
    pub name: String,
    /// Non-secret 8-character display prefix (e.g. `mb_ab12`); `None` for
    /// legacy keys. The full secret is shown once, in the dashboard, when the
    /// key is created.
    pub token: Option<String>,
    /// Derived from the key's scopes.
    pub permission: ApiKeyPermission,
    /// Set when the key is scoped to exactly one sending domain (legacy).
    pub domain_id: Option<String>,
    /// Domains the key is scoped to; `None` when unscoped.
    pub domain_ids: Option<Vec<String>>,
    pub created_at: String,
    /// Last time the key authenticated a request; `None` if never used.
    pub last_used_at: Option<String>,
}

/// `sendping.api_keys` — the one read-only service on the client: `list` and
/// nothing else.
///
/// Minting a key, changing its permission or domain scoping, and revoking it
/// are dashboard-only operations. `POST /api-keys`, `PATCH /api-keys/:id` and
/// `DELETE /api-keys/:id` answer `403 dashboard_only` to any caller
/// authenticating with an API key, whatever its permission — and every call
/// made through this crate authenticates with a key — so there is deliberately
/// no method here for those routes.
///
/// That boundary is the point: a key that leaks cannot mint itself a
/// replacement, promote itself to [`ApiKeyPermission::FullAccess`], add a
/// domain to its own scope, or revoke the keys you would have used to shut it
/// down. Containment stays a human action in the dashboard.
///
/// [`list`](ApiKeysSvc::list) is still yours to use: it returns each key's
/// non-secret display prefix, permission, domain scoping and `last_used_at`,
/// which is enough to audit what is live and notice a key being used when it
/// should not be. Revoke it in the dashboard.
///
/// The absence is enforced by the compiler — this does not build:
///
/// ```compile_fail
/// # async fn run(sendping: sendping::SendPing) {
/// sendping.api_keys.create("CI").await;
/// # }
/// ```
#[derive(Clone, Debug)]
pub struct ApiKeysSvc {
    config: Arc<Config>,
}

impl ApiKeysSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// List API keys (non-secret prefixes only; revoked keys excluded). With
    /// no pagination params the route answers in one page capped at **1,000**
    /// keys, with `has_more` reporting any truncation. `GET /api-keys`
    pub async fn list(&self, params: Option<PaginationParams>) -> Result<ListResponse<ApiKey>> {
        let req = self
            .config
            .request(Method::GET, "/api-keys")
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }
}

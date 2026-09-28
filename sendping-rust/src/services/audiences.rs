//! `sendping.audiences` — audiences (including the per-domain contact
//! pools of the domain-first model) and Google-Sheet imports.

use std::sync::Arc;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::client::{page_query, seg, Config};
use crate::types::{ListResponse, PaginationParams, RemovedResponse, Result};

/// An audience. When `domain` is set this audience is a sending domain's
/// contact POOL (domain-first model: one pool per domain, lazily created);
/// `None` on plain user-created audiences.
#[derive(Debug, Clone, Deserialize)]
pub struct Audience {
    pub object: String,
    pub id: String,
    pub name: String,
    pub domain: Option<String>,
    pub created_at: Option<String>,
}

/// Options for `audiences.import_sheet` — import contacts from a link-shared
/// Google Sheet. Header columns become contact properties (usable as
/// `{{merge_tags}}`); rows land in a fresh segment.
#[derive(Debug, Clone, Serialize)]
pub struct ImportSheetOptions {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_name: Option<String>,
}

impl ImportSheetOptions {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            segment_name: None,
        }
    }

    pub fn with_segment_name(mut self, segment_name: impl Into<String>) -> Self {
        self.segment_name = Some(segment_name.into());
        self
    }
}

/// Result of a Google-Sheet import.
#[derive(Debug, Clone, Deserialize)]
pub struct SheetImportResponse {
    pub object: String,
    pub imported: u64,
    pub updated: u64,
    pub skipped: u64,
    pub total: u64,
    pub segment_id: String,
    pub segment_name: String,
    pub segment_added: u64,
    #[serde(default)]
    pub variables: Vec<String>,
}

/// `sendping.audiences`.
#[derive(Clone, Debug)]
pub struct AudiencesSvc {
    config: Arc<Config>,
}

impl AudiencesSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// Create an audience. `POST /audiences`
    pub async fn create(&self, name: &str) -> Result<Audience> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/audiences")
                    .json(&json!({ "name": name })),
            )
            .await
    }

    /// Retrieve an audience. `GET /audiences/:id`
    pub async fn get(&self, audience_id: &str) -> Result<Audience> {
        let path = format!("/audiences/{}", seg(audience_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// List audiences. `GET /audiences`
    pub async fn list(&self, params: Option<PaginationParams>) -> Result<ListResponse<Audience>> {
        let req = self
            .config
            .request(Method::GET, "/audiences")
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// Import contacts from a link-shared Google Sheet.
    /// `POST /audiences/:id/contacts/import-sheet`
    pub async fn import_sheet(
        &self,
        audience_id: &str,
        options: ImportSheetOptions,
    ) -> Result<SheetImportResponse> {
        let path = format!("/audiences/{}/contacts/import-sheet", seg(audience_id));
        self.config
            .send(self.config.request(Method::POST, &path).json(&options))
            .await
    }

    /// Rename an audience. `PATCH /audiences/:id`
    pub async fn update(&self, audience_id: &str, name: &str) -> Result<Audience> {
        let path = format!("/audiences/{}", seg(audience_id));
        self.config
            .send(
                self.config
                    .request(Method::PATCH, &path)
                    .json(&json!({ "name": name })),
            )
            .await
    }

    /// Delete an audience. `DELETE /audiences/:id`
    pub async fn remove(&self, audience_id: &str) -> Result<RemovedResponse> {
        let path = format!("/audiences/{}", seg(audience_id));
        self.config
            .send(self.config.request(Method::DELETE, &path))
            .await
    }
}

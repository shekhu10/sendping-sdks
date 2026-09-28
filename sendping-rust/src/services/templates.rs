//! `sendping.templates` — reusable email templates with draft/publish
//! versioning, aliases, and typed `{{ variables }}`.

use std::sync::Arc;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::client::{page_query, seg, Config};
use crate::types::{ListResponse, ObjectAck, PaginationParams, RemovedResponse, Result};

/// The type of a template variable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TemplateVariableType {
    String,
    Number,
}

/// A template variable definition as returned by the API. The registry
/// carries only the declaration — there is no per-variable id or timestamp.
#[derive(Debug, Clone, Deserialize)]
pub struct TemplateVariable {
    pub key: String,
    #[serde(rename = "type")]
    pub variable_type: TemplateVariableType,
    /// String or number fallback.
    pub fallback_value: Option<Value>,
}

/// A template.
#[derive(Debug, Clone, Deserialize)]
pub struct Template {
    pub object: String,
    pub id: String,
    pub name: String,
    pub subject: Option<String>,
    pub from: Option<String>,
    pub reply_to: Option<String>,
    pub html: Option<String>,
    pub text: Option<String>,
    pub status: Option<String>,
    /// Stable handle usable anywhere an id is accepted.
    pub alias: Option<String>,
    /// When the template was last published (`None` while only a draft exists).
    pub published_at: Option<String>,
    /// True when the draft has edits not yet published (retrieve only).
    pub has_unpublished_versions: Option<bool>,
    pub current_version_id: Option<String>,
    pub variables: Option<Vec<TemplateVariable>>,
    pub created_at: String,
    pub updated_at: String,
}

/// A row of `templates.list()` — a SMALLER shape than [`Template`], with no
/// `object` key and no `from`/`reply_to`/`text`/`variables`. Use
/// `templates.get(id)` for the full record.
#[derive(Debug, Clone, Deserialize)]
pub struct TemplateListItem {
    pub id: String,
    pub name: String,
    pub subject: Option<String>,
    pub html: Option<String>,
    /// `draft` | `published`.
    pub status: Option<String>,
    pub published_at: Option<String>,
    /// Stable handle usable anywhere an id is accepted.
    pub alias: Option<String>,
    /// True when the draft has edits not yet published.
    pub has_unpublished_versions: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
}

/// A template variable definition accepted on create/update.
#[derive(Debug, Clone, Serialize)]
pub struct TemplateVariableInput {
    pub key: String,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub variable_type: Option<TemplateVariableType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_value: Option<Value>,
}

impl TemplateVariableInput {
    pub fn new(key: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            variable_type: None,
            fallback_value: None,
        }
    }

    pub fn with_type(mut self, variable_type: TemplateVariableType) -> Self {
        self.variable_type = Some(variable_type);
        self
    }

    /// String or number fallback used when a send omits the variable.
    pub fn with_fallback_value(mut self, fallback_value: impl Into<Value>) -> Self {
        self.fallback_value = Some(fallback_value.into());
        self
    }
}

/// Options for `templates.create` (`POST /templates`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct CreateTemplateOptions {
    pub name: String,
    /// Optional stable handle for sending by alias.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variables: Option<Vec<TemplateVariableInput>>,
}

impl CreateTemplateOptions {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            ..Default::default()
        }
    }

    pub fn with_alias(mut self, alias: impl Into<String>) -> Self {
        self.alias = Some(alias.into());
        self
    }

    pub fn with_subject(mut self, subject: impl Into<String>) -> Self {
        self.subject = Some(subject.into());
        self
    }

    pub fn with_from(mut self, from: impl Into<String>) -> Self {
        self.from = Some(from.into());
        self
    }

    pub fn with_reply_to(mut self, reply_to: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.reply_to = Some(reply_to.into_iter().map(Into::into).collect());
        self
    }

    pub fn with_html(mut self, html: impl Into<String>) -> Self {
        self.html = Some(html.into());
        self
    }

    pub fn with_text(mut self, text: impl Into<String>) -> Self {
        self.text = Some(text.into());
        self
    }

    pub fn with_variable(mut self, variable: TemplateVariableInput) -> Self {
        self.variables.get_or_insert_with(Vec::new).push(variable);
        self
    }
}

/// Options for `templates.update` (`PATCH /templates/:id`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateTemplateOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// `Some(None)` serializes as `null` (clears the alias).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<Option<String>>,
    /// `Some(None)` serializes as `null` (clears the subject).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<Option<String>>,
    /// `Some(None)` serializes as `null` (clears the from address).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<Option<String>>,
    /// `Some(None)` serializes as `null` (clears the reply-to addresses).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<Option<Vec<String>>>,
    /// `Some(None)` serializes as `null` (clears the HTML body).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html: Option<Option<String>>,
    /// `Some(None)` serializes as `null` (clears the text body).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variables: Option<Vec<TemplateVariableInput>>,
}

impl UpdateTemplateOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    pub fn with_alias(mut self, alias: impl Into<String>) -> Self {
        self.alias = Some(Some(alias.into()));
        self
    }

    /// Clear the alias (serializes `alias: null`).
    pub fn clear_alias(mut self) -> Self {
        self.alias = Some(None);
        self
    }

    pub fn with_subject(mut self, subject: impl Into<String>) -> Self {
        self.subject = Some(Some(subject.into()));
        self
    }

    /// Clear the subject (serializes `subject: null`).
    pub fn clear_subject(mut self) -> Self {
        self.subject = Some(None);
        self
    }

    pub fn with_from(mut self, from: impl Into<String>) -> Self {
        self.from = Some(Some(from.into()));
        self
    }

    /// Clear the from address (serializes `from: null`).
    pub fn clear_from(mut self) -> Self {
        self.from = Some(None);
        self
    }

    pub fn with_reply_to(mut self, reply_to: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.reply_to = Some(Some(reply_to.into_iter().map(Into::into).collect()));
        self
    }

    /// Clear the reply-to addresses (serializes `reply_to: null`).
    pub fn clear_reply_to(mut self) -> Self {
        self.reply_to = Some(None);
        self
    }

    pub fn with_html(mut self, html: impl Into<String>) -> Self {
        self.html = Some(Some(html.into()));
        self
    }

    /// Clear the HTML body (serializes `html: null`).
    pub fn clear_html(mut self) -> Self {
        self.html = Some(None);
        self
    }

    pub fn with_text(mut self, text: impl Into<String>) -> Self {
        self.text = Some(Some(text.into()));
        self
    }

    /// Clear the text body (serializes `text: null`).
    pub fn clear_text(mut self) -> Self {
        self.text = Some(None);
        self
    }

    pub fn with_variable(mut self, variable: TemplateVariableInput) -> Self {
        self.variables.get_or_insert_with(Vec::new).push(variable);
        self
    }
}

/// Options for `templates.duplicate`.
#[derive(Debug, Clone, Default, Serialize)]
pub struct DuplicateTemplateOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
}

impl DuplicateTemplateOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    pub fn with_alias(mut self, alias: impl Into<String>) -> Self {
        self.alias = Some(alias.into());
        self
    }
}

/// `sendping.templates`.
#[derive(Clone, Debug)]
pub struct TemplatesSvc {
    config: Arc<Config>,
}

impl TemplatesSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// Create a template. Returns the slim `{ object: 'template', id }` ack.
    /// `POST /templates`
    pub async fn create(&self, options: CreateTemplateOptions) -> Result<ObjectAck> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/templates")
                    .json(&options),
            )
            .await
    }

    /// Retrieve a template. `template_id` may be the template UUID **or** its
    /// `alias`. `GET /templates/:id`
    pub async fn get(&self, template_id: &str) -> Result<Template> {
        let path = format!("/templates/{}", seg(template_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// List templates — trimmed [`TemplateListItem`] rows. Unlike domains /
    /// topics / API keys this route always applies the page limit (default
    /// 20). `GET /templates`
    pub async fn list(
        &self,
        params: Option<PaginationParams>,
    ) -> Result<ListResponse<TemplateListItem>> {
        let req = self
            .config
            .request(Method::GET, "/templates")
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// Update a template (edits the draft). Returns the slim ack.
    /// `PATCH /templates/:id`
    pub async fn update(
        &self,
        template_id: &str,
        options: UpdateTemplateOptions,
    ) -> Result<ObjectAck> {
        let path = format!("/templates/{}", seg(template_id));
        self.config
            .send(self.config.request(Method::PATCH, &path).json(&options))
            .await
    }

    /// Duplicate a template. `POST /templates/:id/duplicate`
    pub async fn duplicate(
        &self,
        template_id: &str,
        options: Option<DuplicateTemplateOptions>,
    ) -> Result<ObjectAck> {
        let path = format!("/templates/{}/duplicate", seg(template_id));
        self.config
            .send(
                self.config
                    .request(Method::POST, &path)
                    .json(&options.unwrap_or_default()),
            )
            .await
    }

    /// Publish a template (make its latest draft live).
    /// `POST /templates/:id/publish`
    pub async fn publish(&self, template_id: &str) -> Result<ObjectAck> {
        let path = format!("/templates/{}/publish", seg(template_id));
        self.config
            .send(self.config.request(Method::POST, &path))
            .await
    }

    /// Delete a template. `DELETE /templates/:id`
    pub async fn remove(&self, template_id: &str) -> Result<RemovedResponse> {
        let path = format!("/templates/{}", seg(template_id));
        self.config
            .send(self.config.request(Method::DELETE, &path))
            .await
    }
}

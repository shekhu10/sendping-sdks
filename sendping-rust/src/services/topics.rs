//! `sendping.topics` — DOMAIN-REQUIRED subscription topics (e.g. "Product
//! updates"). A topic belongs to a sending domain; names are reusable across
//! domains. Contacts opt in/out per topic via `contacts.update_topics`.

use std::sync::Arc;

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::client::{seg, Config};
use crate::types::{ListResponse, RemovedResponse, Result};

/// A contact's stance on a topic (also the topic's default).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionState {
    OptIn,
    OptOut,
}

/// Whether a topic is shown on public preference pages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TopicVisibility {
    Public,
    Private,
}

/// A topic.
#[derive(Debug, Clone, Deserialize)]
pub struct Topic {
    pub object: String,
    pub id: String,
    pub audience_id: String,
    pub name: String,
    pub description: Option<String>,
    pub default_subscription: SubscriptionState,
    pub visibility: TopicVisibility,
    pub created_at: String,
}

/// Options for `topics.create` (`POST /topics`).
#[derive(Debug, Clone, Serialize)]
pub struct CreateTopicOptions {
    /// REQUIRED. The sending domain this topic belongs to (one of your
    /// domains — replaces the retired `audience_id`).
    pub domain: String,
    pub name: String,
    pub default_subscription: SubscriptionState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<TopicVisibility>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

impl CreateTopicOptions {
    pub fn new(
        domain: impl Into<String>,
        name: impl Into<String>,
        default_subscription: SubscriptionState,
    ) -> Self {
        Self {
            domain: domain.into(),
            name: name.into(),
            default_subscription,
            visibility: None,
            description: None,
        }
    }

    pub fn with_visibility(mut self, visibility: TopicVisibility) -> Self {
        self.visibility = Some(visibility);
        self
    }

    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }
}

/// Options for `topics.update` (`PATCH /topics/:id`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateTopicOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// `Some(None)` serializes as `null` (clears the description).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<TopicVisibility>,
}

impl UpdateTopicOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(Some(description.into()));
        self
    }

    /// Clear the description (serializes `description: null`).
    pub fn clear_description(mut self) -> Self {
        self.description = Some(None);
        self
    }

    pub fn with_visibility(mut self, visibility: TopicVisibility) -> Self {
        self.visibility = Some(visibility);
        self
    }
}

/// Params for `topics.list` — domain-scoped (`domain` is REQUIRED).
#[derive(Debug, Clone)]
pub struct ListTopicsParams {
    /// REQUIRED. The sending domain whose topics to list.
    pub domain: String,
    pub limit: Option<u32>,
    pub after: Option<String>,
    pub before: Option<String>,
}

impl ListTopicsParams {
    pub fn new(domain: impl Into<String>) -> Self {
        Self {
            domain: domain.into(),
            limit: None,
            after: None,
            before: None,
        }
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
}

/// `sendping.topics`.
#[derive(Clone, Debug)]
pub struct TopicsSvc {
    config: Arc<Config>,
}

impl TopicsSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// Create a topic on a sending domain (`domain` required). `POST /topics`
    pub async fn create(&self, options: CreateTopicOptions) -> Result<Topic> {
        self.config
            .send(self.config.request(Method::POST, "/topics").json(&options))
            .await
    }

    /// Retrieve a topic. `GET /topics/:id`
    pub async fn get(&self, topic_id: &str) -> Result<Topic> {
        let path = format!("/topics/{}", seg(topic_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// List a domain's topics (`domain` required). `GET /topics?domain=`
    pub async fn list(&self, params: ListTopicsParams) -> Result<ListResponse<Topic>> {
        let mut query: Vec<(&str, String)> = vec![("domain", params.domain.clone())];
        if let Some(limit) = params.limit {
            query.push(("limit", limit.to_string()));
        }
        if let Some(after) = &params.after {
            query.push(("after", after.clone()));
        }
        if let Some(before) = &params.before {
            query.push(("before", before.clone()));
        }
        self.config
            .send(self.config.request(Method::GET, "/topics").query(&query))
            .await
    }

    /// Update a topic. `PATCH /topics/:id`
    pub async fn update(&self, topic_id: &str, options: UpdateTopicOptions) -> Result<Topic> {
        let path = format!("/topics/{}", seg(topic_id));
        self.config
            .send(self.config.request(Method::PATCH, &path).json(&options))
            .await
    }

    /// Delete a topic. `DELETE /topics/:id`
    pub async fn remove(&self, topic_id: &str) -> Result<RemovedResponse> {
        let path = format!("/topics/{}", seg(topic_id));
        self.config
            .send(self.config.request(Method::DELETE, &path))
            .await
    }
}

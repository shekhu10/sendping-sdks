//! `sendping.contact_properties` — registered custom contact fields
//! (usable as `{{merge_tags}}`). `key`/`type` are immutable after create;
//! only the fallback value can change.

use std::sync::Arc;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::client::{page_query, seg, Config};
use crate::types::{ListResponse, ObjectAck, PaginationParams, RemovedResponse, Result};

/// The type of a contact property (the backend supports string | number).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContactPropertyType {
    String,
    Number,
}

/// A registered contact property.
#[derive(Debug, Clone, Deserialize)]
pub struct ContactProperty {
    pub object: String,
    pub id: String,
    /// Canonical merge-tag key.
    pub key: String,
    #[serde(rename = "type")]
    pub property_type: ContactPropertyType,
    /// String or number fallback used when a contact has no value.
    pub fallback_value: Option<Value>,
    pub created_at: Option<String>,
}

/// Options for `contact_properties.create` (`POST /contact-properties`).
#[derive(Debug, Clone, Serialize)]
pub struct CreateContactPropertyOptions {
    /// Canonical merge-tag key (the API also accepts `name` as an alias;
    /// this SDK always sends `key`).
    pub key: String,
    #[serde(rename = "type")]
    pub property_type: ContactPropertyType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_value: Option<Value>,
}

impl CreateContactPropertyOptions {
    pub fn new(key: impl Into<String>, property_type: ContactPropertyType) -> Self {
        Self {
            key: key.into(),
            property_type,
            fallback_value: None,
        }
    }

    /// String or number fallback.
    pub fn with_fallback_value(mut self, fallback_value: impl Into<Value>) -> Self {
        self.fallback_value = Some(fallback_value.into());
        self
    }
}

/// Options for `contact_properties.update` — only `fallback_value` is
/// mutable (`key`/`type` are immutable).
#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateContactPropertyOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_value: Option<Value>,
}

impl UpdateContactPropertyOptions {
    pub fn new() -> Self {
        Self::default()
    }

    /// String or number fallback (`Value::Null` clears it).
    pub fn with_fallback_value(mut self, fallback_value: impl Into<Value>) -> Self {
        self.fallback_value = Some(fallback_value.into());
        self
    }
}

/// `sendping.contact_properties`.
#[derive(Clone, Debug)]
pub struct ContactPropertiesSvc {
    config: Arc<Config>,
}

impl ContactPropertiesSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// Register a property. Returns the slim `{ object, id }` ack.
    /// `POST /contact-properties`
    pub async fn create(&self, options: CreateContactPropertyOptions) -> Result<ObjectAck> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/contact-properties")
                    .json(&options),
            )
            .await
    }

    /// Retrieve a property. `GET /contact-properties/:id`
    pub async fn get(&self, property_id: &str) -> Result<ContactProperty> {
        let path = format!("/contact-properties/{}", seg(property_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// List properties. `GET /contact-properties`
    pub async fn list(
        &self,
        params: Option<PaginationParams>,
    ) -> Result<ListResponse<ContactProperty>> {
        let req = self
            .config
            .request(Method::GET, "/contact-properties")
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// Update a property's fallback value. Returns the slim ack.
    /// `PATCH /contact-properties/:id`
    pub async fn update(
        &self,
        property_id: &str,
        options: UpdateContactPropertyOptions,
    ) -> Result<ObjectAck> {
        let path = format!("/contact-properties/{}", seg(property_id));
        self.config
            .send(self.config.request(Method::PATCH, &path).json(&options))
            .await
    }

    /// Delete a property. `DELETE /contact-properties/:id`
    pub async fn remove(&self, property_id: &str) -> Result<RemovedResponse> {
        let path = format!("/contact-properties/{}", seg(property_id));
        self.config
            .send(self.config.request(Method::DELETE, &path))
            .await
    }
}

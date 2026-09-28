//! `sendping.events` — custom events that automations trigger on.
//! `domain` is REQUIRED on `events.send`: only automations belonging to that
//! domain are triggered, so the same event name (e.g. `user.created`) across
//! several products can never double-fire.

use std::collections::HashMap;
use std::sync::Arc;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::client::{page_query, seg, Config};
use crate::types::{ListResponse, PaginationParams, RemovedResponse, Result};

/// A field type in a custom-event schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventFieldType {
    String,
    Number,
    Boolean,
    Date,
}

/// Options for `events.send` (`POST /events/send`).
///
/// Identify the contact by `contact_id` OR `email` (one of the two).
/// Contacts auto-created by this event land in the domain's own contact
/// pool, with unsubscribe state separate per domain.
#[derive(Debug, Clone, Default, Serialize)]
pub struct SendEventOptions {
    /// The custom event name automations can trigger on.
    pub event: String,
    /// REQUIRED. The sending domain this event belongs to (one of your
    /// verified domains).
    pub domain: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Arbitrary event payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Map<String, Value>>,
}

impl SendEventOptions {
    pub fn new(event: impl Into<String>, domain: impl Into<String>) -> Self {
        Self {
            event: event.into(),
            domain: domain.into(),
            ..Default::default()
        }
    }

    pub fn with_contact_id(mut self, contact_id: impl Into<String>) -> Self {
        self.contact_id = Some(contact_id.into());
        self
    }

    pub fn with_email(mut self, email: impl Into<String>) -> Self {
        self.email = Some(email.into());
        self
    }

    pub fn with_payload(mut self, payload: Map<String, Value>) -> Self {
        self.payload = Some(payload);
        self
    }

    pub fn with_payload_entry(mut self, key: impl Into<String>, value: impl Into<Value>) -> Self {
        self.payload
            .get_or_insert_with(Map::new)
            .insert(key.into(), value.into());
        self
    }
}

/// Response of `events.send`.
#[derive(Debug, Clone, Deserialize)]
pub struct SendEventResponse {
    pub object: String,
    pub id: String,
    /// The event name that was ingested.
    pub event: Option<String>,
    /// The resolved contact id the event was attributed to.
    pub contact_id: Option<String>,
    /// Number of automations the event enrolled the contact into.
    pub enrolled: Option<u64>,
}

/// Options for `events.create` — a custom-event definition
/// (name + optional payload schema).
#[derive(Debug, Clone, Serialize)]
pub struct CreateEventOptions {
    /// The custom event name (cannot start with the reserved
    /// `sendping:` prefix).
    pub name: String,
    /// Optional flat key → type schema.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<HashMap<String, EventFieldType>>,
}

impl CreateEventOptions {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            schema: None,
        }
    }

    pub fn with_schema_field(mut self, key: impl Into<String>, field_type: EventFieldType) -> Self {
        self.schema
            .get_or_insert_with(HashMap::new)
            .insert(key.into(), field_type);
        self
    }
}

/// Options for `events.update` (`PATCH /events/:id`). Only the schema is
/// mutable; the event name cannot change.
#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateEventOptions {
    /// `Some(Some(..))` replaces the schema; `Some(None)` serializes as
    /// `null` and clears it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<Option<HashMap<String, EventFieldType>>>,
}

impl UpdateEventOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_schema_field(mut self, key: impl Into<String>, field_type: EventFieldType) -> Self {
        self.schema
            .get_or_insert_with(|| Some(HashMap::new()))
            .get_or_insert_with(HashMap::new)
            .insert(key.into(), field_type);
        self
    }

    /// Drop the payload schema (serializes `schema: null`).
    pub fn clear_schema(mut self) -> Self {
        self.schema = Some(None);
        self
    }
}

/// A custom-event definition.
#[derive(Debug, Clone, Deserialize)]
pub struct EventDefinition {
    pub object: String,
    pub id: String,
    pub name: String,
    pub schema: Option<HashMap<String, String>>,
    pub created_at: String,
    pub updated_at: String,
}

/// `sendping.events`.
#[derive(Clone, Debug)]
pub struct EventsSvc {
    config: Arc<Config>,
}

impl EventsSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// Send a custom event that automations can trigger on (`domain`
    /// required). `POST /events/send`
    pub async fn send(&self, options: SendEventOptions) -> Result<SendEventResponse> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/events/send")
                    .json(&options),
            )
            .await
    }

    /// Like [`send`](Self::send), with an `Idempotency-Key` header.
    ///
    /// **The API ignores the header here.** Only send, batch, reply, and
    /// forward implement idempotency, so a retry of this call
    /// ingests the event a second time. De-duplicate on your side instead.
    #[deprecated(
        since = "2.0.0",
        note = "POST /events/send does not honour Idempotency-Key — the header is ignored and a retry re-ingests the event. Use `send` and de-duplicate on your side."
    )]
    pub async fn send_with_idempotency_key(
        &self,
        options: SendEventOptions,
        idempotency_key: &str,
    ) -> Result<SendEventResponse> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/events/send")
                    .header("Idempotency-Key", idempotency_key)
                    .json(&options),
            )
            .await
    }

    /// Create a custom-event definition. `POST /events`
    ///
    /// There is deliberately no `create_with_idempotency_key`: this endpoint
    /// does not honour `Idempotency-Key` either — only send, batch, reply, and
    /// forward do. A duplicate event name is already rejected
    /// with a `422 validation_error`, so a retry is safe without one.
    pub async fn create(&self, options: CreateEventOptions) -> Result<EventDefinition> {
        self.config
            .send(self.config.request(Method::POST, "/events").json(&options))
            .await
    }

    /// List custom-event definitions. `GET /events`
    pub async fn list(
        &self,
        params: Option<PaginationParams>,
    ) -> Result<ListResponse<EventDefinition>> {
        let req = self
            .config
            .request(Method::GET, "/events")
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// Update a definition's payload schema. The event NAME is immutable
    /// (automations reference it) — passing `name` is a 422. Pass
    /// [`UpdateEventOptions::clear_schema`] to drop the schema entirely.
    /// `PATCH /events/:id`
    pub async fn update(
        &self,
        event_id: &str,
        options: UpdateEventOptions,
    ) -> Result<EventDefinition> {
        let path = format!("/events/{}", seg(event_id));
        self.config
            .send(self.config.request(Method::PATCH, &path).json(&options))
            .await
    }

    /// Delete a custom-event definition. `DELETE /events/:id`
    pub async fn remove(&self, event_id: &str) -> Result<RemovedResponse> {
        let path = format!("/events/{}", seg(event_id));
        self.config
            .send(self.config.request(Method::DELETE, &path))
            .await
    }
}

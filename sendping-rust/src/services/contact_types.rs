//! Option, lookup, and response types for the `contacts` service.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::services::topics::SubscriptionState;

/// A contact.
#[derive(Debug, Clone, Deserialize)]
pub struct Contact {
    pub object: String,
    pub id: String,
    pub email: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub unsubscribed: bool,
    /// Custom contact properties (own values merged over registered fallbacks).
    pub properties: Option<HashMap<String, Value>>,
    pub created_at: Option<String>,
}

/// Options for `contacts.create`. Pass `domain` (flat `/contacts` API —
/// REQUIRED there) OR `audience_id` (nested API) to pick the pool.
#[derive(Debug, Clone, Default, Serialize)]
pub struct CreateContactOptions {
    /// The sending domain whose contact pool the contact lands in
    /// (domain-first model). REQUIRED whenever `audience_id` is omitted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    /// Target a specific audience via `/audiences/:id/contacts` instead of
    /// `domain`. Never serialized — routing only.
    #[serde(skip_serializing)]
    pub audience_id: Option<String>,
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsubscribed: Option<bool>,
    /// Custom contact property values keyed by the property key
    /// (string or number values).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<HashMap<String, Value>>,
}

impl CreateContactOptions {
    pub fn new(email: impl Into<String>) -> Self {
        Self {
            email: email.into(),
            ..Default::default()
        }
    }

    pub fn with_domain(mut self, domain: impl Into<String>) -> Self {
        self.domain = Some(domain.into());
        self
    }

    pub fn with_audience_id(mut self, audience_id: impl Into<String>) -> Self {
        self.audience_id = Some(audience_id.into());
        self
    }

    pub fn with_first_name(mut self, first_name: impl Into<String>) -> Self {
        self.first_name = Some(first_name.into());
        self
    }

    pub fn with_last_name(mut self, last_name: impl Into<String>) -> Self {
        self.last_name = Some(last_name.into());
        self
    }

    pub fn with_unsubscribed(mut self, unsubscribed: bool) -> Self {
        self.unsubscribed = Some(unsubscribed);
        self
    }

    pub fn with_property(mut self, key: impl Into<String>, value: impl Into<Value>) -> Self {
        self.properties
            .get_or_insert_with(HashMap::new)
            .insert(key.into(), value.into());
        self
    }
}

/// Options for `contacts.update`. `id` may be a contact id (exact) or an
/// EMAIL — on the flat API pass `domain` when it's an email (disambiguates
/// across pools).
#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateContactOptions {
    /// Contact id OR email. Never serialized — routing only.
    #[serde(skip_serializing)]
    pub id: String,
    /// Disambiguates an EMAIL `id` across domains (flat API only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    /// Audience the contact belongs to; omit for the flat `/contacts/:id`
    /// API. Never serialized — routing only.
    #[serde(skip_serializing)]
    pub audience_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsubscribed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<HashMap<String, Value>>,
}

impl UpdateContactOptions {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            ..Default::default()
        }
    }

    pub fn with_domain(mut self, domain: impl Into<String>) -> Self {
        self.domain = Some(domain.into());
        self
    }

    pub fn with_audience_id(mut self, audience_id: impl Into<String>) -> Self {
        self.audience_id = Some(audience_id.into());
        self
    }

    pub fn with_first_name(mut self, first_name: impl Into<String>) -> Self {
        self.first_name = Some(first_name.into());
        self
    }

    pub fn with_last_name(mut self, last_name: impl Into<String>) -> Self {
        self.last_name = Some(last_name.into());
        self
    }

    pub fn with_unsubscribed(mut self, unsubscribed: bool) -> Self {
        self.unsubscribed = Some(unsubscribed);
        self
    }

    pub fn with_property(mut self, key: impl Into<String>, value: impl Into<Value>) -> Self {
        self.properties
            .get_or_insert_with(HashMap::new)
            .insert(key.into(), value.into());
        self
    }
}

/// Identifies a contact for `get`/`remove`: by contact id (exact) or by
/// EMAIL + `domain` (an email can exist in several domains' pools; omitted
/// domain ⇒ the oldest match anywhere). `audience_id` routes through the
/// nested API instead.
#[derive(Debug, Clone, Default)]
pub struct ContactLookup {
    pub id: String,
    pub domain: Option<String>,
    pub audience_id: Option<String>,
}

impl ContactLookup {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            ..Default::default()
        }
    }

    pub fn with_domain(mut self, domain: impl Into<String>) -> Self {
        self.domain = Some(domain.into());
        self
    }

    pub fn with_audience_id(mut self, audience_id: impl Into<String>) -> Self {
        self.audience_id = Some(audience_id.into());
        self
    }
}

/// A single contact in a bulk import (no audience — it's on the call).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ContactInput {
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsubscribed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<HashMap<String, Value>>,
}

impl ContactInput {
    pub fn new(email: impl Into<String>) -> Self {
        Self {
            email: email.into(),
            ..Default::default()
        }
    }

    pub fn with_first_name(mut self, first_name: impl Into<String>) -> Self {
        self.first_name = Some(first_name.into());
        self
    }

    pub fn with_last_name(mut self, last_name: impl Into<String>) -> Self {
        self.last_name = Some(last_name.into());
        self
    }

    pub fn with_unsubscribed(mut self, unsubscribed: bool) -> Self {
        self.unsubscribed = Some(unsubscribed);
        self
    }

    pub fn with_property(mut self, key: impl Into<String>, value: impl Into<Value>) -> Self {
        self.properties
            .get_or_insert_with(HashMap::new)
            .insert(key.into(), value.into());
        self
    }
}

/// What to do when an imported email already exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnConflict {
    /// Update the existing contact (default server behavior).
    Upsert,
    /// Leave existing contacts untouched.
    Skip,
}

impl OnConflict {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            OnConflict::Upsert => "upsert",
            OnConflict::Skip => "skip",
        }
    }
}

/// Options for the CSV import. Inline CSV is capped at 5 MB / 10,000 rows —
/// for bigger files mint a direct upload with
/// [`ContactsSvc::create_import_upload`](crate::services::contacts::ContactsSvc::create_import_upload)
/// and import by `storage_key`.
#[derive(Debug, Clone, Default)]
pub struct ImportCsvOptions {
    pub on_conflict: Option<OnConflict>,
    /// Default (`None`/`Some(true)`): every non-builtin CSV column is
    /// auto-registered as a custom property. `Some(false)` = strict mode
    /// (unregistered columns are dropped and reported).
    pub create_properties: Option<bool>,
    /// Also add every imported email to this segment. It must be one of your
    /// segments AND belong to the target audience.
    pub segment_id: Option<String>,
    /// File name recorded on the archived source file (default
    /// `contacts.csv`).
    pub file_name: Option<String>,
}

impl ImportCsvOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_on_conflict(mut self, on_conflict: OnConflict) -> Self {
        self.on_conflict = Some(on_conflict);
        self
    }

    pub fn with_create_properties(mut self, create_properties: bool) -> Self {
        self.create_properties = Some(create_properties);
        self
    }

    /// Add every imported email to this segment as well.
    pub fn with_segment_id(mut self, segment_id: impl Into<String>) -> Self {
        self.segment_id = Some(segment_id.into());
        self
    }

    pub fn with_file_name(mut self, file_name: impl Into<String>) -> Self {
        self.file_name = Some(file_name.into());
        self
    }
}

/// Result of a batch / CSV contact import. The `imported`/`updated`/
/// `skipped`/`total` counters are always present; the remaining fields are
/// returned by the CSV import only.
#[derive(Debug, Clone, Deserialize)]
pub struct ImportContactsResponse {
    pub object: String,
    /// Newly inserted.
    pub imported: u64,
    /// Existing contacts updated.
    pub updated: u64,
    /// Rows dropped: missing/invalid email OR untouched under `skip`.
    pub skipped: u64,
    /// Distinct contacts processed.
    pub total: u64,
    /// CSV import only: rows without a usable email.
    pub invalid_rows: Option<u64>,
    /// CSV import only: rows dropped because the plan's contact cap was hit.
    pub limit_skipped: Option<u64>,
    /// CSV import only: rows skipped by the importer itself.
    pub system_skipped: Option<u64>,
    /// CSV import only: header columns that were not imported.
    pub ignored_columns: Option<Vec<String>>,
    /// CSV import only: the archived source file.
    pub source_file: Option<Value>,
    /// CSV import only: contact-cap accounting for this import.
    pub contact_limit: Option<Value>,
    /// CSV import only, and only when `segment_id` was supplied.
    pub segment_added: Option<u64>,
}

/// Presigned direct-to-S3 upload slot for a large contact CSV
/// (`POST /audiences/:id/contacts/import/upload`). `upload_url` is a bearer
/// credential — PUT the file to it and never log it.
#[derive(Debug, Clone, Deserialize)]
pub struct ContactImportUpload {
    pub object: String,
    /// Feed this to
    /// [`ContactsSvc::import_from_storage_key`](crate::services::contacts::ContactsSvc::import_from_storage_key)
    /// once the upload finishes.
    pub storage_key: String,
    pub upload_url: String,
    pub content_type: String,
    /// Seconds the presigned URL stays valid.
    pub expires_in: u64,
    /// Upload size ceiling in bytes (256 MB).
    pub max_bytes: u64,
}

/// Cursor paging + filters for listing contacts. On the flat `/contacts`
/// API, `domain` is REQUIRED (names the pool).
#[derive(Debug, Clone, Default)]
pub struct ListContactsParams {
    pub domain: Option<String>,
    pub audience_id: Option<String>,
    pub limit: Option<u32>,
    pub after: Option<String>,
    pub before: Option<String>,
    /// Restrict to members of this segment (works with or without audience).
    pub segment_id: Option<String>,
}

impl ListContactsParams {
    pub fn new() -> Self {
        Self::default()
    }

    /// List a sending domain's contact pool (the flat, domain-first API).
    pub fn for_domain(domain: impl Into<String>) -> Self {
        Self {
            domain: Some(domain.into()),
            ..Default::default()
        }
    }

    /// List a specific audience via the nested API instead of `domain`.
    pub fn for_audience(audience_id: impl Into<String>) -> Self {
        Self {
            audience_id: Some(audience_id.into()),
            ..Default::default()
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

    pub fn with_segment_id(mut self, segment_id: impl Into<String>) -> Self {
        self.segment_id = Some(segment_id.into());
        self
    }
}

/// `{ object: 'contact', id, deleted }` returned by `contacts.remove`.
#[derive(Debug, Clone, Deserialize)]
pub struct DeletedContactResponse {
    pub object: String,
    /// The deleted contact's id.
    pub id: String,
    pub deleted: bool,
}

/// A segment reference as returned by `contacts.list_segments()` — the route
/// returns only `id`/`name`/`created_at`, not the full
/// [`Segment`](crate::services::segments::Segment).
#[derive(Debug, Clone, Deserialize)]
pub struct ContactSegmentRef {
    pub id: String,
    pub name: String,
    pub created_at: Option<String>,
}

/// `{ id, audienceId, deleted }` returned by `contacts.remove_from_segment`.
#[derive(Debug, Clone, Deserialize)]
pub struct RemovedFromSegmentResponse {
    pub id: String,
    #[serde(rename = "audienceId")]
    pub audience_id: String,
    pub deleted: bool,
}

/// One topic subscription of a contact.
#[derive(Debug, Clone, Deserialize)]
pub struct ContactTopicSubscription {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub subscription: SubscriptionState,
}

/// `{ object: 'list', has_more, data }` returned by `contacts.get_topics`.
#[derive(Debug, Clone, Deserialize)]
pub struct ContactTopics {
    pub object: String,
    /// Whether another page exists. `get_topics` without `PaginationParams`
    /// skips the page limit but is still capped at 1,000 rows, and this flag
    /// reports that truncation — never assume a single call was exhaustive.
    #[serde(default)]
    pub has_more: bool,
    pub data: Vec<ContactTopicSubscription>,
}

/// One topic subscription change for `contacts.update_topics`.
#[derive(Debug, Clone, Serialize)]
pub struct TopicSubscriptionUpdate {
    pub id: String,
    pub subscription: SubscriptionState,
}

/// Options for `contacts.update_topics` (`PATCH /contacts/:id/topics`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateContactTopicsOptions {
    pub topics: Vec<TopicSubscriptionUpdate>,
}

impl UpdateContactTopicsOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_topic(mut self, id: impl Into<String>, subscription: SubscriptionState) -> Self {
        self.topics.push(TopicSubscriptionUpdate {
            id: id.into(),
            subscription,
        });
        self
    }
}

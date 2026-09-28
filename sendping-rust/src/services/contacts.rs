//! `sendping.contacts` — DOMAIN-FIRST contacts: each verified sending
//! domain owns its own contact pool (the same address on two domains is two
//! records with separate consent). The flat `/contacts` API requires
//! `domain`; the nested `/audiences/:id/contacts` API derives the pool from
//! the path. Also covers bulk/batch/CSV imports, segment membership, and
//! per-contact topic subscriptions. Types live in [`super::contact_types`].

use std::sync::Arc;

use reqwest::Method;
use serde_json::json;

use crate::client::{page_query, seg, Config};
use crate::services::contact_types::{
    Contact, ContactImportUpload, ContactInput, ContactLookup, ContactSegmentRef, ContactTopics,
    CreateContactOptions, DeletedContactResponse, ImportContactsResponse, ImportCsvOptions,
    ListContactsParams, OnConflict, RemovedFromSegmentResponse, UpdateContactOptions,
    UpdateContactTopicsOptions,
};
use crate::types::{Error, IdResponse, ListResponse, ObjectAck, PaginationParams, Result};

/// `sendping.contacts`.
#[derive(Clone, Debug)]
pub struct ContactsSvc {
    config: Arc<Config>,
}

impl ContactsSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// Create a contact. Returns the slim `{ object: 'contact', id }` ack.
    /// `POST /contacts` (flat, `domain` required) or
    /// `POST /audiences/:id/contacts` (nested).
    pub async fn create(&self, options: CreateContactOptions) -> Result<ObjectAck> {
        let mut body = serde_json::to_value(&options).map_err(Error::Json)?;
        if let Some(audience_id) = &options.audience_id {
            // The nested route derives its pool from the path; only the flat
            // route takes `domain` in the body.
            if let Some(obj) = body.as_object_mut() {
                obj.remove("domain");
            }
            let path = format!("/audiences/{}/contacts", seg(audience_id));
            self.config
                .send(self.config.request(Method::POST, &path).json(&body))
                .await
        } else {
            self.config
                .send(self.config.request(Method::POST, "/contacts").json(&body))
                .await
        }
    }

    /// Retrieve a contact by id (exact) or email (+ `domain` to pick the
    /// pool). `GET /contacts/:id` or `GET /audiences/:id/contacts/:id`
    pub async fn get(&self, lookup: ContactLookup) -> Result<Contact> {
        let id = seg(&lookup.id);
        if let Some(audience_id) = &lookup.audience_id {
            let path = format!("/audiences/{}/contacts/{}", seg(audience_id), id);
            return self
                .config
                .send(self.config.request(Method::GET, &path))
                .await;
        }
        let mut req = self.config.request(Method::GET, &format!("/contacts/{id}"));
        if let Some(domain) = &lookup.domain {
            req = req.query(&[("domain", domain.as_str())]);
        }
        self.config.send(req).await
    }

    /// List contacts. Domain-first: `domain` is required on the flat
    /// `/contacts` list. `GET /contacts` or `GET /audiences/:id/contacts`
    pub async fn list(&self, params: ListContactsParams) -> Result<ListResponse<Contact>> {
        let mut query: Vec<(&str, String)> = Vec::new();
        if params.audience_id.is_none() {
            if let Some(domain) = &params.domain {
                query.push(("domain", domain.clone()));
            }
        }
        if let Some(limit) = params.limit {
            query.push(("limit", limit.to_string()));
        }
        if let Some(after) = &params.after {
            query.push(("after", after.clone()));
        }
        if let Some(before) = &params.before {
            query.push(("before", before.clone()));
        }
        if let Some(segment_id) = &params.segment_id {
            query.push(("segment_id", segment_id.clone()));
        }
        let path = match &params.audience_id {
            Some(audience_id) => format!("/audiences/{}/contacts", seg(audience_id)),
            None => "/contacts".to_owned(),
        };
        self.config
            .send(self.config.request(Method::GET, &path).query(&query))
            .await
    }

    /// Bulk-import contacts into a DOMAIN's contact pool (upserts by email;
    /// max 10,000 per call). `POST /contacts/batch`
    ///
    /// The domain-first counterpart of [`batch`](Self::batch), which targets one
    /// audience. Prefer either over a [`create`](Self::create) loop for many
    /// contacts: one batch takes the account's contact-limit lock once, where a
    /// create loop takes it per contact.
    pub async fn batch_in_domain(
        &self,
        domain: &str,
        contacts: Vec<ContactInput>,
        on_conflict: Option<OnConflict>,
    ) -> Result<ImportContactsResponse> {
        let mut req = self.config.request(Method::POST, "/contacts/batch");
        if let Some(oc) = on_conflict {
            req = req.query(&[("on_conflict", oc.as_str())]);
        }
        // Only the flat route takes `domain`, and it takes it in the body —
        // exactly as `POST /contacts` does.
        self.config
            .send(req.json(&json!({ "contacts": contacts, "domain": domain })))
            .await
    }

    /// Bulk-import contacts into one AUDIENCE (upserts by email; max 10,000 per
    /// call). `POST /audiences/:id/contacts/batch`
    ///
    /// See [`batch_in_domain`](Self::batch_in_domain) for the domain-first door.
    pub async fn batch(
        &self,
        audience_id: &str,
        contacts: Vec<ContactInput>,
        on_conflict: Option<OnConflict>,
    ) -> Result<ImportContactsResponse> {
        let path = format!("/audiences/{}/contacts/batch", seg(audience_id));
        let mut req = self.config.request(Method::POST, &path);
        if let Some(oc) = on_conflict {
            req = req.query(&[("on_conflict", oc.as_str())]);
        }
        self.config
            .send(req.json(&json!({ "contacts": contacts })))
            .await
    }

    /// Bulk-import contacts from inline CSV text (header row optional;
    /// upserts by email). Inline CSV is capped at 5 MB and 10,000 rows —
    /// beyond that use [`create_import_upload`](Self::create_import_upload) +
    /// [`import_from_storage_key`](Self::import_from_storage_key).
    /// `POST /audiences/:id/contacts/import`
    pub async fn import(
        &self,
        audience_id: &str,
        csv: &str,
        options: ImportCsvOptions,
    ) -> Result<ImportContactsResponse> {
        let mut body = json!({ "csv": csv });
        if let Some(file_name) = &options.file_name {
            body["file_name"] = json!(file_name);
        }
        self.import_body(audience_id, body, &options).await
    }

    /// Mint a presigned direct-to-S3 upload slot for a large contact CSV (up
    /// to 256 MB). PUT the file to `upload_url`, then pass the returned
    /// `storage_key` to [`import_from_storage_key`](Self::import_from_storage_key).
    /// `POST /audiences/:id/contacts/import/upload`
    pub async fn create_import_upload(
        &self,
        audience_id: &str,
        filename: &str,
        size: u64,
    ) -> Result<ContactImportUpload> {
        let path = format!("/audiences/{}/contacts/import/upload", seg(audience_id));
        self.config
            .send(
                self.config
                    .request(Method::POST, &path)
                    .json(&json!({ "filename": filename, "size": size })),
            )
            .await
    }

    /// Import a CSV that was already uploaded via
    /// [`create_import_upload`](Self::create_import_upload). Unlike the inline
    /// path this never fails on the contact cap — the overflow is reported as
    /// `limit_skipped`. `POST /audiences/:id/contacts/import`
    pub async fn import_from_storage_key(
        &self,
        audience_id: &str,
        storage_key: &str,
        options: ImportCsvOptions,
    ) -> Result<ImportContactsResponse> {
        self.import_body(audience_id, json!({ "storage_key": storage_key }), &options)
            .await
    }

    /// Shared transport for both CSV import modes: the query string carries
    /// `on_conflict` / `create_properties` / `segment_id`.
    async fn import_body(
        &self,
        audience_id: &str,
        body: serde_json::Value,
        options: &ImportCsvOptions,
    ) -> Result<ImportContactsResponse> {
        let path = format!("/audiences/{}/contacts/import", seg(audience_id));
        let mut query: Vec<(&str, String)> = Vec::new();
        if let Some(oc) = options.on_conflict {
            query.push(("on_conflict", oc.as_str().to_owned()));
        }
        if options.create_properties == Some(false) {
            query.push(("create_properties", "false".to_owned()));
        }
        if let Some(segment_id) = &options.segment_id {
            query.push(("segment_id", segment_id.clone()));
        }
        self.config
            .send(
                self.config
                    .request(Method::POST, &path)
                    .query(&query)
                    .json(&body),
            )
            .await
    }

    /// Update a contact. Returns the slim `{ object: 'contact', id }` ack.
    /// `PATCH /contacts/:id` or `PATCH /audiences/:id/contacts/:id`
    pub async fn update(&self, options: UpdateContactOptions) -> Result<ObjectAck> {
        let mut body = serde_json::to_value(&options).map_err(Error::Json)?;
        let id = seg(&options.id);
        if let Some(audience_id) = &options.audience_id {
            // The nested route derives its pool from the path.
            if let Some(obj) = body.as_object_mut() {
                obj.remove("domain");
            }
            let path = format!("/audiences/{}/contacts/{}", seg(audience_id), id);
            self.config
                .send(self.config.request(Method::PATCH, &path).json(&body))
                .await
        } else {
            self.config
                .send(
                    self.config
                        .request(Method::PATCH, &format!("/contacts/{id}"))
                        .json(&body),
                )
                .await
        }
    }

    /// Delete a contact. `DELETE /contacts/:id` or
    /// `DELETE /audiences/:id/contacts/:id`
    pub async fn remove(&self, lookup: ContactLookup) -> Result<DeletedContactResponse> {
        let id = seg(&lookup.id);
        if let Some(audience_id) = &lookup.audience_id {
            let path = format!("/audiences/{}/contacts/{}", seg(audience_id), id);
            return self
                .config
                .send(self.config.request(Method::DELETE, &path))
                .await;
        }
        let mut req = self
            .config
            .request(Method::DELETE, &format!("/contacts/{id}"));
        if let Some(domain) = &lookup.domain {
            req = req.query(&[("domain", domain.as_str())]);
        }
        self.config.send(req).await
    }

    /// Add a contact to a segment. Returns `{ id }` (the segment id).
    /// `POST /contacts/:id/segments/:segment_id`
    pub async fn add_to_segment(&self, contact_id: &str, segment_id: &str) -> Result<IdResponse> {
        let path = format!("/contacts/{}/segments/{}", seg(contact_id), seg(segment_id));
        self.config
            .send(self.config.request(Method::POST, &path))
            .await
    }

    /// Remove a contact from a segment.
    /// `DELETE /contacts/:id/segments/:segment_id`
    pub async fn remove_from_segment(
        &self,
        contact_id: &str,
        segment_id: &str,
    ) -> Result<RemovedFromSegmentResponse> {
        let path = format!("/contacts/{}/segments/{}", seg(contact_id), seg(segment_id));
        self.config
            .send(self.config.request(Method::DELETE, &path))
            .await
    }

    /// List the segments a contact belongs to. Rows are the reduced
    /// [`ContactSegmentRef`] shape (`id`/`name`/`created_at`), not the full
    /// segment — use `segments.get(id)` for that. `GET /contacts/:id/segments`
    pub async fn list_segments(
        &self,
        contact_id: &str,
        params: Option<PaginationParams>,
    ) -> Result<ListResponse<ContactSegmentRef>> {
        let path = format!("/contacts/{}/segments", seg(contact_id));
        let req = self
            .config
            .request(Method::GET, &path)
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// Get a contact's topic subscriptions. Passing `None` skips the page
    /// limit — the route then answers in one page capped at **1,000** topics,
    /// with `has_more` reporting any truncation.
    /// `GET /contacts/:id/topics`
    pub async fn get_topics(
        &self,
        contact_id: &str,
        params: Option<PaginationParams>,
    ) -> Result<ContactTopics> {
        let path = format!("/contacts/{}/topics", seg(contact_id));
        let req = self
            .config
            .request(Method::GET, &path)
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// Update a contact's topic subscriptions. Returns `{ id }` (the contact
    /// id). `PATCH /contacts/:id/topics`
    pub async fn update_topics(
        &self,
        contact_id: &str,
        options: UpdateContactTopicsOptions,
    ) -> Result<IdResponse> {
        let path = format!("/contacts/{}/topics", seg(contact_id));
        self.config
            .send(self.config.request(Method::PATCH, &path).json(&options))
            .await
    }
}

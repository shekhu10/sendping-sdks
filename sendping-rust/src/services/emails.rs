//! `sendping.emails` — sending, listing, scheduling, attachments, and
//! inbound (received) email; plus `sendping.batch` for batch sends.
//! Option/response types live in [`super::email_types`].

use std::sync::Arc;

use reqwest::Method;
use serde_json::json;

use crate::client::{page_query, seg, Config};
use crate::services::email_types::{
    AttachmentMeta, BatchEmailOptions, CreateEmailResponse, Email, EmailSource,
    ForwardReceivedEmailOptions, ReceivedAttachment, ReceivedEmail, ReceivingAddressStats,
    ReplyReceivedEmailOptions, SendEmailBatchResponse, SendEmailOptions, SentEmailListItem,
};
use crate::types::{ListResponse, ObjectAck, PaginationParams, RemovedResponse, Result};

/// The `outbox` mailbox folder for [`ListEmailsParams::with_folder`].
///
/// `folder` accepts exactly [`FOLDER_OUTBOX`], [`FOLDER_SENT`],
/// [`FOLDER_SCHEDULED`], and [`FOLDER_FAILED`] — any other value is a
/// `422 validation_error`.
pub const FOLDER_OUTBOX: &str = "outbox";

/// The `sent` mailbox folder — see [`FOLDER_OUTBOX`] for the legal set.
pub const FOLDER_SENT: &str = "sent";

/// The `scheduled` mailbox folder — see [`FOLDER_OUTBOX`] for the legal set.
pub const FOLDER_SCHEDULED: &str = "scheduled";

/// The `failed` mailbox folder — see [`FOLDER_OUTBOX`] for the legal set.
pub const FOLDER_FAILED: &str = "failed";

/// Params for `emails.list_filtered`: cursor pagination plus optional
/// server-side source filters.
#[derive(Debug, Clone, Default)]
pub struct ListEmailsParams {
    pub limit: Option<u32>,
    pub after: Option<String>,
    pub before: Option<String>,
    /// Only emails sent by this campaign. Takes precedence over
    /// `automation_id`/`source`.
    pub campaign_id: Option<String>,
    /// Only emails sent by this automation.
    pub automation_id: Option<String>,
    /// `individual` restricts to one-off sends (no campaign/automation),
    /// `api` narrows to API-key sends (including mail from before the send
    /// origin was recorded), and `dashboard` narrows to dashboard-composed
    /// mail (composer, inbox replies/forwards).
    pub source: Option<String>,
    /// Only emails sent from this sending domain (domain id). Composes with
    /// the source filters.
    pub domain_id: Option<String>,
    /// Only emails whose latest state matches, e.g. `delivered`, `bounced`,
    /// `opened`. Matched case-insensitively against the same value reads
    /// expose as `last_event`.
    pub status: Option<String>,
    /// Free-text search across recipients, subject, and sender.
    pub search: Option<String>,
    /// Mailbox folder: [`FOLDER_OUTBOX`], [`FOLDER_SENT`],
    /// [`FOLDER_SCHEDULED`], or [`FOLDER_FAILED`]. Any other value is a
    /// `422 validation_error`.
    pub folder: Option<String>,
}

impl ListEmailsParams {
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

    pub fn with_campaign_id(mut self, campaign_id: impl Into<String>) -> Self {
        self.campaign_id = Some(campaign_id.into());
        self
    }

    pub fn with_automation_id(mut self, automation_id: impl Into<String>) -> Self {
        self.automation_id = Some(automation_id.into());
        self
    }

    pub fn with_source(mut self, source: impl Into<String>) -> Self {
        self.source = Some(source.into());
        self
    }

    pub fn with_domain_id(mut self, domain_id: impl Into<String>) -> Self {
        self.domain_id = Some(domain_id.into());
        self
    }

    /// Only emails whose latest state matches (e.g. `delivered`, `bounced`).
    pub fn with_status(mut self, status: impl Into<String>) -> Self {
        self.status = Some(status.into());
        self
    }

    /// Free-text search across recipients, subject, and sender.
    pub fn with_search(mut self, search: impl Into<String>) -> Self {
        self.search = Some(search.into());
        self
    }

    /// Mailbox folder: [`FOLDER_OUTBOX`], [`FOLDER_SENT`],
    /// [`FOLDER_SCHEDULED`], or [`FOLDER_FAILED`]. Any other value is a
    /// `422 validation_error`.
    pub fn with_folder(mut self, folder: impl Into<String>) -> Self {
        self.folder = Some(folder.into());
        self
    }

    fn to_query(&self) -> Vec<(&'static str, String)> {
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
        if let Some(campaign_id) = &self.campaign_id {
            q.push(("campaign_id", campaign_id.clone()));
        }
        if let Some(automation_id) = &self.automation_id {
            q.push(("automation_id", automation_id.clone()));
        }
        if let Some(source) = &self.source {
            q.push(("source", source.clone()));
        }
        if let Some(domain_id) = &self.domain_id {
            q.push(("domain_id", domain_id.clone()));
        }
        if let Some(status) = &self.status {
            q.push(("status", status.clone()));
        }
        if let Some(search) = &self.search {
            q.push(("search", search.clone()));
        }
        if let Some(folder) = &self.folder {
            q.push(("folder", folder.clone()));
        }
        q
    }
}

/// Params for `emails.receiving.list_filtered`: cursor pagination plus an
/// optional `received_for` filter.
#[derive(Debug, Clone, Default)]
pub struct ListReceivedEmailsParams {
    pub limit: Option<u32>,
    pub after: Option<String>,
    pub before: Option<String>,
    /// Only messages received for this address (matches the `received_for`
    /// recipients).
    pub received_for: Option<String>,
}

impl ListReceivedEmailsParams {
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

    pub fn with_received_for(mut self, received_for: impl Into<String>) -> Self {
        self.received_for = Some(received_for.into());
        self
    }

    fn to_query(&self) -> Vec<(&'static str, String)> {
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
        if let Some(received_for) = &self.received_for {
            q.push(("received_for", received_for.clone()));
        }
        q
    }
}

/// Inbound (received) email — accessed as `sendping.emails.receiving`.
#[derive(Clone, Debug)]
pub struct ReceivingSvc {
    config: Arc<Config>,
}

impl ReceivingSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// List received emails. For the `received_for` filter use
    /// [`list_filtered`](Self::list_filtered). `GET /emails/receiving`
    pub async fn list(
        &self,
        params: Option<PaginationParams>,
    ) -> Result<ListResponse<ReceivedEmail>> {
        let req = self
            .config
            .request(Method::GET, "/emails/receiving")
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// List received emails with an optional `received_for` filter (only
    /// messages received for that address). `GET /emails/receiving`
    pub async fn list_filtered(
        &self,
        params: Option<ListReceivedEmailsParams>,
    ) -> Result<ListResponse<ReceivedEmail>> {
        let query = params.as_ref().map(|p| p.to_query()).unwrap_or_default();
        let req = self
            .config
            .request(Method::GET, "/emails/receiving")
            .query(&query);
        self.config.send(req).await
    }

    /// Retrieve a received email. `GET /emails/receiving/:id`
    pub async fn get(&self, email_id: &str) -> Result<ReceivedEmail> {
        let path = format!("/emails/receiving/{}", seg(email_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// Per-address inbound stats for every receiving address on your domains.
    /// Not paginated. `GET /emails/receiving/addresses`
    pub async fn list_addresses(&self) -> Result<ListResponse<ReceivingAddressStats>> {
        self.config
            .send(
                self.config
                    .request(Method::GET, "/emails/receiving/addresses"),
            )
            .await
    }

    /// List a received email's attachments. Pass `params` to page; with no
    /// `limit` and no `after` cursor the route answers in one page capped at
    /// **1,000** rows, with `has_more` reporting any truncation.
    /// `GET /emails/receiving/:id/attachments`
    pub async fn list_attachments(
        &self,
        email_id: &str,
        params: Option<PaginationParams>,
    ) -> Result<ListResponse<ReceivedAttachment>> {
        let path = format!("/emails/receiving/{}/attachments", seg(email_id));
        let req = self
            .config
            .request(Method::GET, &path)
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// Download one attachment as raw bytes (the route streams the binary
    /// file, not JSON). `GET /emails/receiving/:id/attachments/:attachment_id`
    pub async fn get_attachment(&self, email_id: &str, attachment_id: &str) -> Result<Vec<u8>> {
        let path = format!(
            "/emails/receiving/{}/attachments/{}",
            seg(email_id),
            seg(attachment_id)
        );
        self.config
            .send_raw(self.config.request(Method::GET, &path))
            .await
    }

    /// Download the original RFC822/MIME message as raw bytes.
    /// `GET /emails/receiving/:id/raw`
    pub async fn get_raw(&self, email_id: &str) -> Result<Vec<u8>> {
        let path = format!("/emails/receiving/{}/raw", seg(email_id));
        self.config
            .send_raw(self.config.request(Method::GET, &path))
            .await
    }

    /// Forward a received email. `POST /emails/receiving/:id/forward`
    pub async fn forward(
        &self,
        email_id: &str,
        options: ForwardReceivedEmailOptions,
    ) -> Result<CreateEmailResponse> {
        self.forward_inner(email_id, options, None).await
    }

    /// Forward with a stable operation key; reuse it for retries of the same payload.
    pub async fn forward_with_idempotency_key(
        &self,
        email_id: &str,
        options: ForwardReceivedEmailOptions,
        key: &str,
    ) -> Result<CreateEmailResponse> {
        self.forward_inner(email_id, options, Some(key)).await
    }

    async fn forward_inner(
        &self,
        email_id: &str,
        options: ForwardReceivedEmailOptions,
        key: Option<&str>,
    ) -> Result<CreateEmailResponse> {
        let path = format!("/emails/receiving/{}/forward", seg(email_id));
        let mut req = self.config.request(Method::POST, &path).json(&options);
        if let Some(key) = key {
            req = req.header("Idempotency-Key", key);
        }
        self.config.send(req).await
    }

    /// Reply to a received email's sender, threaded into the same conversation
    /// (In-Reply-To; subject defaults to `Re: …`). `POST /emails/receiving/:id/reply`
    pub async fn reply(
        &self,
        email_id: &str,
        options: ReplyReceivedEmailOptions,
    ) -> Result<CreateEmailResponse> {
        self.reply_inner(email_id, options, None).await
    }

    /// Reply with a stable operation key; reuse it for retries of the same payload.
    pub async fn reply_with_idempotency_key(
        &self,
        email_id: &str,
        options: ReplyReceivedEmailOptions,
        key: &str,
    ) -> Result<CreateEmailResponse> {
        self.reply_inner(email_id, options, Some(key)).await
    }

    async fn reply_inner(
        &self,
        email_id: &str,
        options: ReplyReceivedEmailOptions,
        key: Option<&str>,
    ) -> Result<CreateEmailResponse> {
        let path = format!("/emails/receiving/{}/reply", seg(email_id));
        let mut req = self.config.request(Method::POST, &path).json(&options);
        if let Some(key) = key {
            req = req.header("Idempotency-Key", key);
        }
        self.config.send(req).await
    }

    /// Delete a received email. `DELETE /emails/receiving/:id`
    pub async fn remove(&self, email_id: &str) -> Result<RemovedResponse> {
        let path = format!("/emails/receiving/{}", seg(email_id));
        self.config
            .send(self.config.request(Method::DELETE, &path))
            .await
    }
}

/// `sendping.emails`.
#[derive(Clone, Debug)]
pub struct EmailsSvc {
    config: Arc<Config>,
    /// Inbound email sub-resource.
    pub receiving: ReceivingSvc,
}

impl EmailsSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self {
            receiving: ReceivingSvc::new(Arc::clone(&config)),
            config,
        }
    }

    /// Send a single email. `POST /emails`
    pub async fn send(&self, email: SendEmailOptions) -> Result<CreateEmailResponse> {
        self.config
            .send(self.config.request(Method::POST, "/emails").json(&email))
            .await
    }

    /// Like [`send`](Self::send), with an `Idempotency-Key` header so the
    /// create can be retried safely.
    ///
    /// The key must be **1–255 characters** after trimming; outside that range
    /// the API answers `400 invalid_idempotency_key`. Reusing a key with a
    /// different payload is `409 invalid_idempotent_request`; reusing it while
    /// the first request is still in flight is `409
    /// concurrent_idempotent_requests`; reusing it after completion replays
    /// the stored status and body.
    ///
    /// `POST /emails`, `POST /emails/batch`, and received-email reply/forward honour the header — every
    /// other endpoint ignores it.
    pub async fn send_with_idempotency_key(
        &self,
        email: SendEmailOptions,
        idempotency_key: &str,
    ) -> Result<CreateEmailResponse> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/emails")
                    .header("Idempotency-Key", idempotency_key)
                    .json(&email),
            )
            .await
    }

    /// Send up to 100 emails in one request (alias of `sendping.batch.send`).
    /// `POST /emails/batch`
    #[deprecated(
        since = "1.2.0",
        note = "use `sendping.batch.send_emails` — batch items reject `attachments` and `scheduled_at`, which `BatchEmailOptions` enforces at compile time"
    )]
    pub async fn batch(&self, emails: Vec<SendEmailOptions>) -> Result<SendEmailBatchResponse> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/emails/batch")
                    .json(&emails),
            )
            .await
    }

    /// List sent emails — trimmed [`SentEmailListItem`] rows. For the
    /// `campaign_id`/`automation_id`/`source`/`domain_id` filters use
    /// [`list_filtered`](Self::list_filtered). `GET /emails`
    pub async fn list(
        &self,
        params: Option<PaginationParams>,
    ) -> Result<ListResponse<SentEmailListItem>> {
        let req = self
            .config
            .request(Method::GET, "/emails")
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// List sent emails with optional `campaign_id`/`automation_id`/`source`/
    /// `domain_id` filters. `GET /emails`
    pub async fn list_filtered(
        &self,
        params: Option<ListEmailsParams>,
    ) -> Result<ListResponse<SentEmailListItem>> {
        let query = params.as_ref().map(|p| p.to_query()).unwrap_or_default();
        let req = self.config.request(Method::GET, "/emails").query(&query);
        self.config.send(req).await
    }

    /// Aggregate send metrics grouped by origin (campaign / automation /
    /// one-off `api` / one-off `individual`). Not paginated.
    /// `GET /emails/sources`
    pub async fn sources(&self) -> Result<ListResponse<EmailSource>> {
        self.config
            .send(self.config.request(Method::GET, "/emails/sources"))
            .await
    }

    /// Retrieve a sent email and its events. `GET /emails/:id`
    pub async fn get(&self, email_id: &str) -> Result<Email> {
        let path = format!("/emails/{}", seg(email_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// List a sent email's attachments. `GET /emails/:id/attachments`
    pub async fn list_attachments(&self, email_id: &str) -> Result<ListResponse<AttachmentMeta>> {
        let path = format!("/emails/{}/attachments", seg(email_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// Retrieve one attachment of a sent email — metadata only. Sent
    /// attachment bytes are not re-hosted, so `download_url` / `expires_at`
    /// are always `None`. `GET /emails/:id/attachments/:attachment_id`
    pub async fn get_attachment(
        &self,
        email_id: &str,
        attachment_id: &str,
    ) -> Result<AttachmentMeta> {
        let path = format!(
            "/emails/{}/attachments/{}",
            seg(email_id),
            seg(attachment_id)
        );
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// Reschedule a scheduled email. `PATCH /emails/:id`
    pub async fn update(&self, email_id: &str, scheduled_at: &str) -> Result<ObjectAck> {
        let path = format!("/emails/{}", seg(email_id));
        self.config
            .send(
                self.config
                    .request(Method::PATCH, &path)
                    .json(&json!({ "scheduled_at": scheduled_at })),
            )
            .await
    }

    /// Cancel a scheduled email. `POST /emails/:id/cancel`
    pub async fn cancel(&self, email_id: &str) -> Result<ObjectAck> {
        let path = format!("/emails/{}/cancel", seg(email_id));
        self.config
            .send(self.config.request(Method::POST, &path))
            .await
    }
}

/// Batch send — `sendping.batch.send(vec![...])`.
#[derive(Clone, Debug)]
pub struct BatchSvc {
    config: Arc<Config>,
}

impl BatchSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// Send up to 100 emails in one request. `POST /emails/batch`
    #[deprecated(
        since = "1.2.0",
        note = "use `send_emails` — batch items reject `attachments` and `scheduled_at`, which `BatchEmailOptions` enforces at compile time"
    )]
    pub async fn send(&self, emails: Vec<SendEmailOptions>) -> Result<SendEmailBatchResponse> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/emails/batch")
                    .json(&emails),
            )
            .await
    }

    /// Like [`send`](Self::send), with an `Idempotency-Key` header.
    #[deprecated(
        since = "1.2.0",
        note = "use `send_emails_with_idempotency_key` — batch items reject `attachments` and `scheduled_at`, which `BatchEmailOptions` enforces at compile time"
    )]
    pub async fn send_with_idempotency_key(
        &self,
        emails: Vec<SendEmailOptions>,
        idempotency_key: &str,
    ) -> Result<SendEmailBatchResponse> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/emails/batch")
                    .header("Idempotency-Key", idempotency_key)
                    .json(&emails),
            )
            .await
    }

    /// Send up to 100 emails in one request. Batch items reject `attachments`
    /// and `scheduled_at` — send those individually via `emails.send`.
    /// `POST /emails/batch`
    pub async fn send_emails(
        &self,
        emails: Vec<BatchEmailOptions>,
    ) -> Result<SendEmailBatchResponse> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/emails/batch")
                    .json(&emails),
            )
            .await
    }

    /// Like [`send_emails`](Self::send_emails), with an `Idempotency-Key`
    /// header so the batch can be retried safely. The key must be **1–255
    /// characters** after trimming (see
    /// [`EmailsSvc::send_with_idempotency_key`]).
    ///
    /// If the batch fails partway AND a key was supplied, the error body also
    /// carries `sent` / `sent_count`, and that combined body is what a replay
    /// of the same key returns.
    pub async fn send_emails_with_idempotency_key(
        &self,
        emails: Vec<BatchEmailOptions>,
        idempotency_key: &str,
    ) -> Result<SendEmailBatchResponse> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/emails/batch")
                    .header("Idempotency-Key", idempotency_key)
                    .json(&emails),
            )
            .await
    }
}

//! `sendping.campaigns` — DOMAIN-REQUIRED bulk sends to a domain's contact
//! pool (optionally scoped to a segment and/or gated by a topic), with A/B
//! tests, follow-ups, and recurrence. Types live in
//! [`super::campaign_types`].

use std::sync::Arc;

use reqwest::Method;
use serde_json::json;

use crate::client::{page_query, seg, Config};
use crate::services::campaign_types::{
    Campaign, CampaignAbResult, CampaignEngagement, CampaignListItem, CampaignStats,
    CreateCampaignOptions, SendCampaignOptions, UpdateCampaignOptions,
};
use crate::types::{IdResponse, ListResponse, PaginationParams, RemovedResponse, Result};

/// `sendping.campaigns`.
#[derive(Clone, Debug)]
pub struct CampaignsSvc {
    config: Arc<Config>,
}

impl CampaignsSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// Create a campaign (`domain` required). Returns `{ id }`.
    /// `POST /campaigns`
    pub async fn create(&self, options: CreateCampaignOptions) -> Result<IdResponse> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/campaigns")
                    .json(&options),
            )
            .await
    }

    /// Retrieve a campaign (includes statistics). `GET /campaigns/:id`
    pub async fn get(&self, campaign_id: &str) -> Result<Campaign> {
        let path = format!("/campaigns/{}", seg(campaign_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// List campaigns — trimmed [`CampaignListItem`] rows, with no bodies,
    /// follow-ups, recurrence or statistics. Use [`get`](Self::get) for those.
    /// `GET /campaigns`
    pub async fn list(
        &self,
        params: Option<PaginationParams>,
    ) -> Result<ListResponse<CampaignListItem>> {
        let req = self
            .config
            .request(Method::GET, "/campaigns")
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// Update a draft campaign. Returns `{ id }`. `PATCH /campaigns/:id`
    pub async fn update(
        &self,
        campaign_id: &str,
        options: UpdateCampaignOptions,
    ) -> Result<IdResponse> {
        let path = format!("/campaigns/{}", seg(campaign_id));
        self.config
            .send(self.config.request(Method::PATCH, &path).json(&options))
            .await
    }

    /// Send now, or schedule with `scheduled_at`. For the optional
    /// `schedule_timezone` use [`send_with_options`](Self::send_with_options).
    /// `POST /campaigns/:id/send`
    pub async fn send(&self, campaign_id: &str, scheduled_at: Option<&str>) -> Result<IdResponse> {
        let path = format!("/campaigns/{}/send", seg(campaign_id));
        let body = match scheduled_at {
            Some(at) => json!({ "scheduled_at": at }),
            None => json!({}),
        };
        self.config
            .send(self.config.request(Method::POST, &path).json(&body))
            .await
    }

    /// Send now, or schedule with [`SendCampaignOptions`] — `scheduled_at`
    /// plus an optional `schedule_timezone` (IANA name, persisted onto the
    /// campaign so daily batching evaluates batch-days in that zone).
    /// `POST /campaigns/:id/send`
    pub async fn send_with_options(
        &self,
        campaign_id: &str,
        options: SendCampaignOptions,
    ) -> Result<IdResponse> {
        let path = format!("/campaigns/{}/send", seg(campaign_id));
        self.config
            .send(self.config.request(Method::POST, &path).json(&options))
            .await
    }

    /// Stop a campaign's remaining work. `POST /campaigns/:id/cancel`
    ///
    /// Accepted only on `scheduled`, `recurring`, `paused` and `queued`; any
    /// other status is a `validation_error`. Which status you get back depends
    /// on how far the send got:
    /// - `scheduled` / `recurring` / `paused` → back to `draft`, editable and
    ///   re-sendable; the pending job is dropped, and for a recurring template
    ///   that also stops the recurrence.
    /// - `queued` (already fanning out) → `canceled`, which is TERMINAL. Part
    ///   of the audience has already been mailed, so it is deliberately not
    ///   re-sendable; copies already handed to the mail service cannot be
    ///   recalled. What stops is every remaining recipient — for a staggered
    ///   campaign, every future batch-day.
    ///
    /// Read the returned [`Campaign::status`] to see which happened.
    pub async fn cancel(&self, campaign_id: &str) -> Result<Campaign> {
        let path = format!("/campaigns/{}/cancel", seg(campaign_id));
        self.config
            .send(self.config.request(Method::POST, &path))
            .await
    }

    /// Per-campaign analytics (counts, engagement rates, top links).
    /// `GET /campaigns/:id/stats`
    pub async fn stats(&self, campaign_id: &str) -> Result<CampaignStats> {
        let path = format!("/campaigns/{}/stats", seg(campaign_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// Per-recipient engagement (who opened / clicked / replied). Each list is
    /// capped at 500 rows; this route is not paginated.
    /// `GET /campaigns/:id/engagement`
    pub async fn engagement(&self, campaign_id: &str) -> Result<CampaignEngagement> {
        let path = format!("/campaigns/{}/engagement", seg(campaign_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// A/B winner evaluation for an A/B campaign. Answers
    /// `422 validation_error` when the campaign is not an A/B test.
    /// `GET /campaigns/:id/ab`
    pub async fn ab(&self, campaign_id: &str) -> Result<CampaignAbResult> {
        let path = format!("/campaigns/{}/ab", seg(campaign_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// Delete a campaign. `DELETE /campaigns/:id`
    pub async fn remove(&self, campaign_id: &str) -> Result<RemovedResponse> {
        let path = format!("/campaigns/{}", seg(campaign_id));
        self.config
            .send(self.config.request(Method::DELETE, &path))
            .await
    }
}

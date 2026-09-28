//! `sendping.polls` — read-only results of the in-email poll widget.

use std::sync::Arc;

use reqwest::Method;
use serde::Deserialize;

use crate::client::{page_query, seg, Config};
use crate::types::{ListResponse, PaginationParams, Result};

/// One row of `polls.list()` — an email that has in-email poll responses.
#[derive(Debug, Clone, Deserialize)]
pub struct Poll {
    pub object: String,
    /// The email the poll was sent on.
    pub email_id: String,
    pub subject: Option<String>,
    pub responses: u64,
    pub distinct_answers: u64,
    pub last_response_at: Option<String>,
}

/// A single answer's tally within a poll result.
#[derive(Debug, Clone, Deserialize)]
pub struct PollAnswer {
    pub answer: String,
    pub count: u64,
    /// Share of all responses, 0–100, one decimal.
    pub pct: f64,
}

/// `polls.get(email_id)` — the aggregated answer breakdown for one email.
#[derive(Debug, Clone, Deserialize)]
pub struct PollResult {
    pub object: String,
    pub email_id: String,
    pub total: u64,
    pub unique_respondents: u64,
    /// Most-voted answer first.
    pub answers: Vec<PollAnswer>,
}

/// `sendping.polls`.
#[derive(Clone, Debug)]
pub struct PollsSvc {
    config: Arc<Config>,
}

impl PollsSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// One summary row per email that has poll responses. `GET /polls`
    pub async fn list(&self, params: Option<PaginationParams>) -> Result<ListResponse<Poll>> {
        let req = self
            .config
            .request(Method::GET, "/polls")
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// The aggregated answer breakdown for one email. `GET /polls/:email_id`
    pub async fn get(&self, email_id: &str) -> Result<PollResult> {
        let path = format!("/polls/{}", seg(email_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }
}

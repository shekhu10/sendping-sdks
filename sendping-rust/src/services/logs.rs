//! `sendping.logs` — read-only API request logs.

use std::sync::Arc;

use reqwest::Method;
use serde::Deserialize;
use serde_json::Value;

use crate::client::{seg, Config};
use crate::types::{ListResponse, Result};

/// One API request log entry.
#[derive(Debug, Clone, Deserialize)]
pub struct LogEntry {
    pub object: String,
    pub id: String,
    pub endpoint: Option<String>,
    pub method: String,
    pub response_status: u16,
    pub user_agent: Option<String>,
    pub created_at: String,
    /// Present only on retrieve (`GET /logs/:id`).
    pub request_body: Option<Value>,
    /// Present only on retrieve (`GET /logs/:id`).
    pub response_body: Option<Value>,
}

/// Params for `logs.list`: cursor pagination plus optional server-side
/// `method`/`status` filters.
#[derive(Debug, Clone, Default)]
pub struct ListLogsParams {
    pub limit: Option<u32>,
    pub after: Option<String>,
    pub before: Option<String>,
    /// Filter to an exact HTTP method, e.g. `POST`.
    pub method: Option<String>,
    /// Filter to an exact response status, e.g. `200` or `429`.
    pub status: Option<u16>,
}

impl ListLogsParams {
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

    pub fn with_method(mut self, method: impl Into<String>) -> Self {
        self.method = Some(method.into());
        self
    }

    pub fn with_status(mut self, status: u16) -> Self {
        self.status = Some(status);
        self
    }
}

/// `sendping.logs`.
#[derive(Clone, Debug)]
pub struct LogsSvc {
    config: Arc<Config>,
}

impl LogsSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// List API request logs (cursor-paginated, optional filters).
    /// `GET /logs`
    pub async fn list(&self, params: Option<ListLogsParams>) -> Result<ListResponse<LogEntry>> {
        let mut query: Vec<(&str, String)> = Vec::new();
        if let Some(params) = &params {
            if let Some(limit) = params.limit {
                query.push(("limit", limit.to_string()));
            }
            if let Some(after) = &params.after {
                query.push(("after", after.clone()));
            }
            if let Some(before) = &params.before {
                query.push(("before", before.clone()));
            }
            if let Some(method) = &params.method {
                query.push(("method", method.clone()));
            }
            if let Some(status) = params.status {
                query.push(("status", status.to_string()));
            }
        }
        self.config
            .send(self.config.request(Method::GET, "/logs").query(&query))
            .await
    }

    /// Retrieve a log entry (includes request/response bodies).
    /// `GET /logs/:id`
    pub async fn get(&self, log_id: &str) -> Result<LogEntry> {
        let path = format!("/logs/{}", seg(log_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }
}

//! `sendping.automations` — multi-step automations triggered by events.
//! Every automation belongs to one of your sending domains (`domain` is
//! REQUIRED on create); only `events.send` calls naming the same `domain`
//! trigger it, so the same event name across products can never double-fire.

use std::sync::Arc;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::client::{page_query, seg, Config};
use crate::types::{ListResponse, PaginationParams, RemovedResponse, Result};

/// A step in an automation's graph.
#[derive(Debug, Clone, Deserialize)]
pub struct AutomationStep {
    /// Absent on the synthesized trigger step.
    pub id: Option<String>,
    pub key: String,
    #[serde(rename = "type")]
    pub step_type: String,
    pub position: Option<u32>,
    #[serde(default)]
    pub config: Value,
}

/// A typed edge between two step keys.
#[derive(Debug, Clone, Deserialize)]
pub struct AutomationConnection {
    pub from: String,
    pub to: String,
    #[serde(rename = "type")]
    pub connection_type: String,
}

/// Enrollment counts (retrieve only).
#[derive(Debug, Clone, Deserialize)]
pub struct AutomationEnrollments {
    pub active: u64,
    pub completed: u64,
}

/// An automation.
#[derive(Debug, Clone, Deserialize)]
pub struct Automation {
    pub object: String,
    pub id: String,
    pub audience_id: String,
    pub name: String,
    /// The event that starts a run.
    pub trigger: String,
    /// The sending domain this automation belongs to. `None` on pre-domain
    /// rows (treated as the account's single domain when exactly one exists).
    pub domain: Option<String>,
    /// `enabled` | `disabled`.
    pub status: String,
    /// Schedule of a `sendping:schedule` automation; `None` on every other
    /// trigger.
    pub trigger_config: Option<AutomationScheduleInfo>,
    /// Key of the synthetic trigger step, referenced by `connections[].from`.
    pub trigger_key: Option<String>,
    /// Omitted entirely by `automations.list()`.
    pub steps: Option<Vec<AutomationStep>>,
    /// Omitted entirely by `automations.list()`.
    pub connections: Option<Vec<AutomationConnection>>,
    /// Included only on retrieve.
    pub enrollments: Option<AutomationEnrollments>,
    /// Present only on the "Create with AI" response.
    pub ai: Option<AutomationAiInfo>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// The stored schedule of a `sendping:schedule` automation.
#[derive(Debug, Clone, Deserialize)]
pub struct AutomationScheduleInfo {
    /// Canonical ISO-8601 UTC instant the automation fires.
    pub at: Option<String>,
    /// IANA timezone the schedule was picked in.
    pub timezone: Option<String>,
}

/// What a "Create with AI" call added.
#[derive(Debug, Clone, Deserialize)]
pub struct AutomationAiInfo {
    #[serde(default)]
    pub added_steps: u64,
    /// `workflow` (built the whole graph) | `append` (extended it).
    pub mode: Option<String>,
}

/// An inline step supplied on create; `key` lets connections reference it.
#[derive(Debug, Clone, Serialize)]
pub struct AutomationStepInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(rename = "type")]
    pub step_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<Value>,
}

impl AutomationStepInput {
    pub fn new(step_type: impl Into<String>) -> Self {
        Self {
            key: None,
            step_type: step_type.into(),
            config: None,
        }
    }

    pub fn with_key(mut self, key: impl Into<String>) -> Self {
        self.key = Some(key.into());
        self
    }

    pub fn with_config(mut self, config: Value) -> Self {
        self.config = Some(config);
        self
    }
}

/// A typed edge between step keys supplied on create/update.
#[derive(Debug, Clone, Serialize)]
pub struct ConnectionInput {
    pub from: String,
    pub to: String,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub connection_type: Option<String>,
}

impl ConnectionInput {
    pub fn new(from: impl Into<String>, to: impl Into<String>) -> Self {
        Self {
            from: from.into(),
            to: to.into(),
            connection_type: None,
        }
    }

    pub fn with_type(mut self, connection_type: impl Into<String>) -> Self {
        self.connection_type = Some(connection_type.into());
        self
    }
}

/// Config for the `sendping:schedule` trigger: the automation fires ONCE
/// at `at`, enrolling every contact of its domain's pool. Required with that
/// trigger; not accepted on any other.
#[derive(Debug, Clone, Serialize)]
pub struct AutomationTriggerConfig {
    /// ISO 8601 instant the automation fires (future, at most 366 days ahead).
    pub at: String,
    /// IANA timezone the schedule was picked in (e.g. `America/New_York`).
    pub timezone: String,
}

impl AutomationTriggerConfig {
    pub fn new(at: impl Into<String>, timezone: impl Into<String>) -> Self {
        Self {
            at: at.into(),
            timezone: timezone.into(),
        }
    }
}

/// Options for `automations.create` (`POST /automations`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct CreateAutomationOptions {
    pub name: String,
    /// REQUIRED. The sending domain this automation belongs to. Only
    /// `events.send` calls with the same `domain` trigger it.
    pub domain: String,
    /// The event that starts a run: `contact.created`, the built-in scheduled
    /// trigger `sendping:schedule` (requires `trigger_config`), an
    /// engagement event (`email.opened` / `email.clicked` / `email.replied`
    /// / `email.bounced` / `email.delivered`), or any custom event name you
    /// send via `events.send`. Usually supplied as a `steps[0]` trigger step
    /// instead.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<String>,
    /// Schedule for the `sendping:schedule` trigger (`{at, timezone}`).
    /// Required with that trigger; not accepted on any other.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_config: Option<AutomationTriggerConfig>,
    /// Initial status: `enabled` | `disabled` (default `disabled`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Optional inline step graph.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<AutomationStepInput>>,
    /// Optional typed edges between step keys.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connections: Option<Vec<ConnectionInput>>,
}

impl CreateAutomationOptions {
    pub fn new(name: impl Into<String>, domain: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            domain: domain.into(),
            ..Default::default()
        }
    }

    pub fn with_trigger(mut self, trigger: impl Into<String>) -> Self {
        self.trigger = Some(trigger.into());
        self
    }

    /// Schedule for the `sendping:schedule` trigger (`{at, timezone}`).
    pub fn with_trigger_config(mut self, trigger_config: AutomationTriggerConfig) -> Self {
        self.trigger_config = Some(trigger_config);
        self
    }

    pub fn with_status(mut self, status: impl Into<String>) -> Self {
        self.status = Some(status.into());
        self
    }

    pub fn with_step(mut self, step: AutomationStepInput) -> Self {
        self.steps.get_or_insert_with(Vec::new).push(step);
        self
    }

    pub fn with_connection(mut self, connection: ConnectionInput) -> Self {
        self.connections
            .get_or_insert_with(Vec::new)
            .push(connection);
        self
    }
}

/// Options for `automations.update` (`PATCH /automations/:id`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateAutomationOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// `enabled` | `disabled`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Re-point at another of your domains (disabled automations only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    /// Change the triggering event (disabled automations only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<String>,
    /// Rename the synthetic trigger step's key (only meaningful alongside
    /// `trigger`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_key: Option<String>,
    /// Update the `sendping:schedule` trigger's schedule (`{at, timezone}`).
    /// Only valid on automations with that trigger, and only while disabled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_config: Option<AutomationTriggerConfig>,
    /// Replace the edge set (disabled automations only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connections: Option<Vec<ConnectionInput>>,
}

impl UpdateAutomationOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    pub fn with_status(mut self, status: impl Into<String>) -> Self {
        self.status = Some(status.into());
        self
    }

    pub fn with_domain(mut self, domain: impl Into<String>) -> Self {
        self.domain = Some(domain.into());
        self
    }

    /// Change the triggering event (the automation must be disabled).
    pub fn with_trigger(mut self, trigger: impl Into<String>) -> Self {
        self.trigger = Some(trigger.into());
        self
    }

    /// Rename the synthetic trigger step's key.
    pub fn with_trigger_key(mut self, trigger_key: impl Into<String>) -> Self {
        self.trigger_key = Some(trigger_key.into());
        self
    }

    /// Update the `sendping:schedule` trigger's schedule (`{at, timezone}`).
    pub fn with_trigger_config(mut self, trigger_config: AutomationTriggerConfig) -> Self {
        self.trigger_config = Some(trigger_config);
        self
    }

    pub fn with_connections(mut self, connections: Vec<ConnectionInput>) -> Self {
        self.connections = Some(connections);
        self
    }
}

/// Params for `automations.runs`: cursor pagination plus an optional
/// run-status filter.
#[derive(Debug, Clone, Default)]
pub struct ListAutomationRunsParams {
    pub limit: Option<u32>,
    pub after: Option<String>,
    pub before: Option<String>,
    /// Keep only runs in these statuses (`running`, `completed`, `failed`,
    /// `skipped`). Sent as a comma-separated list and applied BEFORE paging.
    pub status: Option<Vec<String>>,
}

impl ListAutomationRunsParams {
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

    /// Keep only runs in these statuses.
    pub fn with_status(mut self, status: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.status = Some(status.into_iter().map(Into::into).collect());
        self
    }

    pub(crate) fn to_query(&self) -> Vec<(&'static str, String)> {
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
        if let Some(status) = &self.status {
            if !status.is_empty() {
                q.push(("status", status.join(",")));
            }
        }
        q
    }
}

/// Where a "Create with AI" call should splice the generated steps in.
/// Supplying it switches the call to APPEND mode; omitting it means WORKFLOW
/// mode, which requires the automation to have no steps yet.
#[derive(Debug, Clone, Serialize)]
pub struct AutomationAiAttach {
    /// The trigger key or an existing step key to attach after.
    pub from: String,
    /// `default` | `condition_met` | `condition_not_met` | `event_received` |
    /// `timeout`.
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub attach_type: Option<String>,
    /// Insert before this existing step key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
}

impl AutomationAiAttach {
    pub fn new(from: impl Into<String>) -> Self {
        Self {
            from: from.into(),
            attach_type: None,
            before: None,
        }
    }

    pub fn with_type(mut self, attach_type: impl Into<String>) -> Self {
        self.attach_type = Some(attach_type.into());
        self
    }

    pub fn with_before(mut self, before: impl Into<String>) -> Self {
        self.before = Some(before.into());
        self
    }
}

/// Options for `automations.create_with_ai` (`POST /automations/:id/ai`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct AutomationAiOptions {
    /// What the automation should do. Max 2000 characters.
    pub prompt: String,
    /// Templates the model may reference (first 10 kept).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template_ids: Option<Vec<String>>,
    /// Event names the model may wait on (first 10 kept).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<Vec<String>>,
    /// Present ⇒ append mode; absent ⇒ workflow mode.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attach: Option<AutomationAiAttach>,
}

impl AutomationAiOptions {
    pub fn new(prompt: impl Into<String>) -> Self {
        Self {
            prompt: prompt.into(),
            ..Default::default()
        }
    }

    pub fn with_template_ids(
        mut self,
        template_ids: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        self.template_ids = Some(template_ids.into_iter().map(Into::into).collect());
        self
    }

    pub fn with_events(mut self, events: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.events = Some(events.into_iter().map(Into::into).collect());
        self
    }

    /// Switch to append mode, splicing the generated steps in at `attach`.
    pub fn with_attach(mut self, attach: AutomationAiAttach) -> Self {
        self.attach = Some(attach);
        self
    }
}

/// Options for `automations.add_step` (`POST /automations/:id/steps`).
#[derive(Debug, Clone, Serialize)]
pub struct AddAutomationStepOptions {
    #[serde(rename = "type")]
    pub step_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
}

impl AddAutomationStepOptions {
    pub fn new(step_type: impl Into<String>) -> Self {
        Self {
            step_type: step_type.into(),
            config: None,
            key: None,
        }
    }

    pub fn with_config(mut self, config: Value) -> Self {
        self.config = Some(config);
        self
    }

    pub fn with_key(mut self, key: impl Into<String>) -> Self {
        self.key = Some(key.into());
        self
    }
}

/// Options for `automations.update_step`
/// (`PATCH /automations/:id/steps/:step_id`).
///
/// `type` is REQUIRED — the route runs the same validator as `add_step`, which
/// rejects a body without one as `422 validation_error` ("type must be one
/// of: …"). A step is therefore replaced type-and-config together, never
/// config alone: always resend the step's current type, even when only
/// `config` is changing.
///
/// The graph `key` and `position` are NOT updatable here: the route forwards
/// only `type` and `config` to storage, deliberately, so connections that
/// reference the step keep working. Delete and re-add the step to change its
/// key.
#[derive(Debug, Clone, Serialize)]
pub struct UpdateAutomationStepOptions {
    #[serde(rename = "type")]
    pub step_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<Value>,
}

impl UpdateAutomationStepOptions {
    /// `step_type` is the type the step should have AFTER the update — resend
    /// its current type when you are only changing `config`.
    pub fn new(step_type: impl Into<String>) -> Self {
        Self {
            step_type: step_type.into(),
            config: None,
        }
    }

    pub fn with_type(mut self, step_type: impl Into<String>) -> Self {
        self.step_type = step_type.into();
        self
    }

    pub fn with_config(mut self, config: Value) -> Self {
        self.config = Some(config);
        self
    }
}

/// `{ id, deleted }` returned by `automations.delete_step`.
#[derive(Debug, Clone, Deserialize)]
pub struct DeletedStepResponse {
    pub id: String,
    pub deleted: bool,
}

/// One executed step within a run trace.
#[derive(Debug, Clone, Deserialize)]
pub struct AutomationRunStep {
    pub key: String,
    #[serde(rename = "type")]
    pub step_type: String,
    /// `completed` | `failed` | `skipped`.
    pub status: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub output: Option<Value>,
    pub error: Option<String>,
}

/// A single enrollment (run) of a contact through an automation.
#[derive(Debug, Clone, Deserialize)]
pub struct AutomationRun {
    pub object: String,
    pub id: String,
    pub contact_id: String,
    /// Email of the contact the run is for; `None` if that contact was deleted.
    pub contact_email: Option<String>,
    /// `running` | `completed` | `failed` | `skipped`.
    pub status: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: Option<String>,
    /// Present on retrieve only.
    pub automation_id: Option<String>,
    pub steps: Option<Vec<AutomationRunStep>>,
    pub error: Option<String>,
}

/// `sendping.automations`.
#[derive(Clone, Debug)]
pub struct AutomationsSvc {
    config: Arc<Config>,
}

impl AutomationsSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// Create an automation (`domain` required). `POST /automations`
    pub async fn create(&self, options: CreateAutomationOptions) -> Result<Automation> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/automations")
                    .json(&options),
            )
            .await
    }

    /// Retrieve an automation (includes enrollments). `GET /automations/:id`
    pub async fn get(&self, automation_id: &str) -> Result<Automation> {
        let path = format!("/automations/{}", seg(automation_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// List automations. `GET /automations`
    pub async fn list(&self, params: Option<PaginationParams>) -> Result<ListResponse<Automation>> {
        let req = self
            .config
            .request(Method::GET, "/automations")
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// Update an automation. `PATCH /automations/:id`
    pub async fn update(
        &self,
        automation_id: &str,
        options: UpdateAutomationOptions,
    ) -> Result<Automation> {
        let path = format!("/automations/{}", seg(automation_id));
        self.config
            .send(self.config.request(Method::PATCH, &path).json(&options))
            .await
    }

    /// Rebuild (or extend) the step graph with "Create with AI". Omit
    /// `attach` to generate a whole workflow — that mode requires the
    /// automation to have no steps yet. The automation must be disabled, and
    /// the route is limited to 20 requests / 60s per account.
    /// `POST /automations/:id/ai`
    pub async fn create_with_ai(
        &self,
        automation_id: &str,
        options: AutomationAiOptions,
    ) -> Result<Automation> {
        let path = format!("/automations/{}/ai", seg(automation_id));
        self.config
            .send(self.config.request(Method::POST, &path).json(&options))
            .await
    }

    /// Append a step; returns the created step. The automation must be
    /// disabled. `POST /automations/:id/steps`
    pub async fn add_step(
        &self,
        automation_id: &str,
        options: AddAutomationStepOptions,
    ) -> Result<AutomationStep> {
        let path = format!("/automations/{}/steps", seg(automation_id));
        self.config
            .send(self.config.request(Method::POST, &path).json(&options))
            .await
    }

    /// Update a step's type and config; returns the updated step. The
    /// automation must be disabled, and `type` is required even when only the
    /// config changes (see [`UpdateAutomationStepOptions`]). The step's graph
    /// key and position are stable and cannot be changed here.
    /// `PATCH /automations/:id/steps/:step_id`
    pub async fn update_step(
        &self,
        automation_id: &str,
        step_id: &str,
        options: UpdateAutomationStepOptions,
    ) -> Result<AutomationStep> {
        let path = format!("/automations/{}/steps/{}", seg(automation_id), seg(step_id));
        self.config
            .send(self.config.request(Method::PATCH, &path).json(&options))
            .await
    }

    /// Delete a step. The automation must be disabled.
    /// `DELETE /automations/:id/steps/:step_id`
    pub async fn delete_step(
        &self,
        automation_id: &str,
        step_id: &str,
    ) -> Result<DeletedStepResponse> {
        let path = format!("/automations/{}/steps/{}", seg(automation_id), seg(step_id));
        self.config
            .send(self.config.request(Method::DELETE, &path))
            .await
    }

    /// List an automation's runs. For the `status` filter use
    /// [`runs_filtered`](Self::runs_filtered). `GET /automations/:id/runs`
    pub async fn runs(
        &self,
        automation_id: &str,
        params: Option<PaginationParams>,
    ) -> Result<ListResponse<AutomationRun>> {
        let path = format!("/automations/{}/runs", seg(automation_id));
        let req = self
            .config
            .request(Method::GET, &path)
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// List an automation's runs, optionally keeping only certain statuses.
    /// `GET /automations/:id/runs`
    pub async fn runs_filtered(
        &self,
        automation_id: &str,
        params: Option<ListAutomationRunsParams>,
    ) -> Result<ListResponse<AutomationRun>> {
        let path = format!("/automations/{}/runs", seg(automation_id));
        let query = params.as_ref().map(|p| p.to_query()).unwrap_or_default();
        let req = self.config.request(Method::GET, &path).query(&query);
        self.config.send(req).await
    }

    /// Retrieve a single run trace. `GET /automations/:id/runs/:run_id`
    pub async fn get_run(&self, automation_id: &str, run_id: &str) -> Result<AutomationRun> {
        let path = format!("/automations/{}/runs/{}", seg(automation_id), seg(run_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// Stop an automation — prevents new runs; in-progress runs finish.
    /// `POST /automations/:id/stop`
    pub async fn stop(&self, automation_id: &str) -> Result<Automation> {
        let path = format!("/automations/{}/stop", seg(automation_id));
        self.config
            .send(self.config.request(Method::POST, &path))
            .await
    }

    /// Delete an automation. `DELETE /automations/:id`
    pub async fn remove(&self, automation_id: &str) -> Result<RemovedResponse> {
        let path = format!("/automations/{}", seg(automation_id));
        self.config
            .send(self.config.request(Method::DELETE, &path))
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_status_filter_is_sent_as_one_comma_joined_param() {
        let q = ListAutomationRunsParams::new()
            .with_limit(50)
            .with_status(["running", "failed"])
            .to_query();
        assert_eq!(
            q,
            vec![
                ("limit", "50".to_string()),
                ("status", "running,failed".to_string()),
            ]
        );
        // An empty status list must not emit a blank filter.
        let q = ListAutomationRunsParams::new()
            .with_status(Vec::<String>::new())
            .to_query();
        assert!(q.is_empty(), "got: {q:?}");
    }

    #[test]
    fn run_decodes_with_null_started_at_and_created_at() {
        // A queued run has not started, and the trace fields are absent on
        // list rows — neither may be a hard decode failure.
        let run: AutomationRun = serde_json::from_str(
            r#"{"object":"automation_run","id":"run_1","contact_id":"con_1",
                "contact_email":null,"status":"running","started_at":null,
                "completed_at":null,"created_at":null}"#,
        )
        .expect("run should decode");
        assert!(run.started_at.is_none());
        assert!(run.steps.is_none());
    }

    #[test]
    fn automation_decodes_trigger_config_and_omitted_steps() {
        // `GET /automations` omits `steps`/`connections` entirely.
        let automation: Automation = serde_json::from_str(
            r#"{"object":"automation","id":"aut_1","audience_id":"aud_1","name":"Nudge",
                "trigger":"sendping:schedule","domain":"example.com","status":"disabled",
                "trigger_config":{"at":"2026-09-01T09:00:00.000Z","timezone":"America/New_York"},
                "trigger_key":"trigger","created_at":null,"updated_at":null}"#,
        )
        .expect("automation should decode");
        assert!(automation.steps.is_none());
        let schedule = automation.trigger_config.expect("schedule present");
        assert_eq!(schedule.timezone.as_deref(), Some("America/New_York"));
    }
}

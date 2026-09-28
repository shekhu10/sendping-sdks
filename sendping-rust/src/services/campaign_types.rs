//! Option and response types for the `campaigns` service.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Recurrence cadence of a recurring campaign.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CampaignRecurrence {
    Daily,
    Weekly,
    Monthly,
}

/// The metric that decides an A/B winner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AbMetric {
    Open,
    Click,
    Reply,
}

/// Engagement condition for a follow-up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FollowupCondition {
    Opened,
    Clicked,
    NotOpened,
    NotClicked,
    Replied,
    NotReplied,
}

/// How the unsubscribe list applies to a campaign.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UnsubscribePolicy {
    /// Any opt-out blocks (default).
    Account,
    /// Only this sending domain's + account-wide opt-outs block.
    Domain,
    /// Opt-outs skipped; bounced/complained addresses ALWAYS excluded.
    Ignore,
}

/// A/B-test configuration accepted on create/update. When enabled, supply at
/// least one variant-B field.
#[derive(Debug, Clone, Default, Serialize)]
pub struct CampaignAbTestOptions {
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject_b: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html_b: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_b: Option<String>,
    /// Percentage (1-100) of the audience used to pick the winner (default 20).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_pct: Option<u8>,
    /// Winner metric (default `open`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metric: Option<AbMetric>,
    /// Hours (1-168) to run the test before evaluating and sending the winner.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eval_hours: Option<u16>,
}

impl CampaignAbTestOptions {
    pub fn enabled() -> Self {
        Self {
            enabled: true,
            ..Default::default()
        }
    }

    pub fn with_subject_b(mut self, subject_b: impl Into<String>) -> Self {
        self.subject_b = Some(subject_b.into());
        self
    }

    pub fn with_html_b(mut self, html_b: impl Into<String>) -> Self {
        self.html_b = Some(html_b.into());
        self
    }

    pub fn with_text_b(mut self, text_b: impl Into<String>) -> Self {
        self.text_b = Some(text_b.into());
        self
    }

    pub fn with_test_pct(mut self, test_pct: u8) -> Self {
        self.test_pct = Some(test_pct);
        self
    }

    pub fn with_metric(mut self, metric: AbMetric) -> Self {
        self.metric = Some(metric);
        self
    }

    pub fn with_eval_hours(mut self, eval_hours: u16) -> Self {
        self.eval_hours = Some(eval_hours);
        self
    }
}

/// A/B config + decision as returned on retrieve
/// (`{ enabled: false }` when not an A/B campaign). On LIST rows only
/// `enabled`/`metric`/`status`/`winner` are present.
#[derive(Debug, Clone, Deserialize)]
pub struct CampaignAbTestInfo {
    pub enabled: bool,
    pub subject_b: Option<String>,
    pub html_b: Option<String>,
    pub text_b: Option<String>,
    pub test_pct: Option<u8>,
    pub metric: Option<AbMetric>,
    /// Hours the test runs before the winner is picked.
    pub eval_hours: Option<u16>,
    pub status: Option<String>,
    pub winner: Option<String>,
}

/// An engagement follow-up accepted on create (max 5): sent `delay` after
/// the campaign finishes to recipients matching `condition`, threaded as a
/// reply to the original email.
#[derive(Debug, Clone, Serialize)]
pub struct CampaignFollowup {
    pub condition: FollowupCondition,
    /// Natural-language duration, e.g. `5 hours` or `4 days` (max 30 days).
    pub delay: String,
    /// Defaults to `Re: <campaign subject>` (keeps the thread).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    pub html: String,
}

impl CampaignFollowup {
    pub fn new(
        condition: FollowupCondition,
        delay: impl Into<String>,
        html: impl Into<String>,
    ) -> Self {
        Self {
            condition,
            delay: delay.into(),
            subject: None,
            html: html.into(),
        }
    }

    pub fn with_subject(mut self, subject: impl Into<String>) -> Self {
        self.subject = Some(subject.into());
        self
    }
}

/// A follow-up as returned on retrieve.
#[derive(Debug, Clone, Deserialize)]
pub struct CampaignFollowupInfo {
    pub id: String,
    pub condition: String,
    pub delay: String,
    pub subject: Option<String>,
    /// The follow-up body.
    pub html: Option<String>,
    pub status: String,
    pub run_at: Option<String>,
    #[serde(default)]
    pub sent_count: u64,
    pub created_at: Option<String>,
}

/// Recurrence cadence as returned on retrieve. `interval` is `None` on a
/// campaign whose recurrence was cleared.
#[derive(Debug, Clone, Deserialize)]
pub struct RecurrenceInfo {
    pub interval: Option<CampaignRecurrence>,
    #[serde(default)]
    pub every: u32,
}

/// A campaign.
#[derive(Debug, Clone, Deserialize)]
pub struct Campaign {
    pub object: String,
    pub id: String,
    pub name: Option<String>,
    pub audience_id: String,
    /// Segment target (`None` ⇒ whole audience).
    pub segment_id: Option<String>,
    /// Topic gate (`None` ⇒ no gating).
    pub topic_id: Option<String>,
    pub from: Option<String>,
    pub subject: Option<String>,
    pub html: Option<String>,
    pub text: Option<String>,
    pub reply_to: Option<String>,
    pub preview_text: Option<String>,
    /// `draft`, `queued` (the wire name for an in-flight `sending`),
    /// `scheduled`, `recurring`, `paused`, `canceled`, `sent`, `failed`.
    /// `canceled` is terminal — a `queued` campaign stopped part-way; unlike a
    /// canceled `scheduled` one (which returns to `draft`) it is not re-sendable.
    pub status: String,
    pub scheduled_at: Option<String>,
    /// IANA timezone the schedule + daily batching are evaluated in.
    pub schedule_timezone: Option<String>,
    /// Max recipients fanned out per batch-day.
    pub daily_batch_size: Option<u32>,
    pub sent_at: Option<String>,
    pub created_at: Option<String>,
    /// Why the last send attempt failed, when it did.
    pub failure_reason: Option<String>,
    pub ab_test: Option<CampaignAbTestInfo>,
    /// Engagement follow-ups (retrieve only).
    pub followups: Option<Vec<CampaignFollowupInfo>>,
    /// Generated mailing-list To address (retrieve only).
    pub list_address: Option<String>,
    /// How the unsubscribe list applied to this campaign (retrieve only).
    pub unsubscribe_policy: Option<UnsubscribePolicy>,
    /// Recurrence cadence (`None` ⇒ one-off).
    pub recurrence: Option<RecurrenceInfo>,
    /// Set on auto-generated occurrences of a recurring campaign.
    pub parent_campaign_id: Option<String>,
    /// Engagement counts — included only on retrieve.
    pub statistics: Option<Value>,
}

/// A row of `campaigns.list()` — a SMALLER shape than [`Campaign`], with no
/// bodies (`html`/`text`), no `from`/`topic_id`/`reply_to`/`preview_text`, no
/// schedule detail, follow-ups, recurrence or statistics. Use
/// `campaigns.get(id)` for the full record.
#[derive(Debug, Clone, Deserialize)]
pub struct CampaignListItem {
    pub object: String,
    pub id: String,
    pub name: Option<String>,
    /// Included so a list view can render it without a per-row fetch.
    pub subject: Option<String>,
    pub audience_id: String,
    /// Segment target (`None` ⇒ whole audience).
    pub segment_id: Option<String>,
    /// `draft`, `queued`, `scheduled`, `recurring`, `paused`, `canceled`,
    /// `sent`, `failed`. `canceled` is terminal.
    pub status: String,
    /// Lightweight A/B marker — `enabled` plus metric/status/winner when
    /// enabled. Full A/B detail is on `campaigns.get` / `campaigns.ab`.
    pub ab_test: Option<CampaignAbTestInfo>,
    pub created_at: Option<String>,
    pub scheduled_at: Option<String>,
    pub sent_at: Option<String>,
    /// Why the last send attempt failed, when it did.
    pub failure_reason: Option<String>,
}

/// Options for `campaigns.create` (`POST /campaigns`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct CreateCampaignOptions {
    /// REQUIRED. The sending domain whose contact pool this campaign targets
    /// (replaces the retired `audience_id`). Orthogonal to `from`, which may
    /// be a different verified domain.
    pub domain: String,
    pub from: String,
    pub subject: String,
    /// HTML body. Ordinary links become tracked redirects at send time — so do
    /// URLs in the `text` body. Your stored campaign is never modified.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Target a segment (subset of the pool) instead of everyone.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<String>,
    /// Gate recipients by a topic subscription.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic_id: Option<String>,
    /// Make this a recurring campaign.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<CampaignRecurrence>,
    /// Periods between recurring sends (1-365, default 1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurrence_every: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ab_test: Option<CampaignAbTestOptions>,
    /// Engagement follow-ups (max 5).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub followups: Option<Vec<CampaignFollowup>>,
    /// Show a generated mailing-list address as the visible To (delivery
    /// stays individual).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_to: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsubscribe_policy: Option<UnsubscribePolicy>,
    /// Send immediately on create (or schedule when `scheduled_at` is given).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub send: Option<bool>,
    /// ISO 8601 (or natural-language) schedule used when `send` is true.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_at: Option<String>,
    /// IANA timezone the schedule + daily batching are evaluated in (e.g.
    /// `America/New_York`). Defaults to the account timezone, then UTC.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule_timezone: Option<String>,
    /// Max recipients fanned out per batch-day (1-100000). Omitted ⇒ send to
    /// everyone at once.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_batch_size: Option<u32>,
}

impl CreateCampaignOptions {
    pub fn new(
        domain: impl Into<String>,
        from: impl Into<String>,
        subject: impl Into<String>,
    ) -> Self {
        Self {
            domain: domain.into(),
            from: from.into(),
            subject: subject.into(),
            ..Default::default()
        }
    }

    pub fn with_html(mut self, html: impl Into<String>) -> Self {
        self.html = Some(html.into());
        self
    }

    pub fn with_text(mut self, text: impl Into<String>) -> Self {
        self.text = Some(text.into());
        self
    }

    pub fn with_reply_to(mut self, reply_to: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.reply_to = Some(reply_to.into_iter().map(Into::into).collect());
        self
    }

    pub fn with_preview_text(mut self, preview_text: impl Into<String>) -> Self {
        self.preview_text = Some(preview_text.into());
        self
    }

    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    pub fn with_segment_id(mut self, segment_id: impl Into<String>) -> Self {
        self.segment_id = Some(segment_id.into());
        self
    }

    pub fn with_topic_id(mut self, topic_id: impl Into<String>) -> Self {
        self.topic_id = Some(topic_id.into());
        self
    }

    pub fn with_recurrence(mut self, recurrence: CampaignRecurrence) -> Self {
        self.recurrence = Some(recurrence);
        self
    }

    pub fn with_recurrence_every(mut self, every: u16) -> Self {
        self.recurrence_every = Some(every);
        self
    }

    pub fn with_ab_test(mut self, ab_test: CampaignAbTestOptions) -> Self {
        self.ab_test = Some(ab_test);
        self
    }

    pub fn with_followup(mut self, followup: CampaignFollowup) -> Self {
        self.followups.get_or_insert_with(Vec::new).push(followup);
        self
    }

    pub fn with_list_to(mut self, list_to: bool) -> Self {
        self.list_to = Some(list_to);
        self
    }

    pub fn with_unsubscribe_policy(mut self, policy: UnsubscribePolicy) -> Self {
        self.unsubscribe_policy = Some(policy);
        self
    }

    pub fn with_send(mut self, send: bool) -> Self {
        self.send = Some(send);
        self
    }

    pub fn with_scheduled_at(mut self, scheduled_at: impl Into<String>) -> Self {
        self.scheduled_at = Some(scheduled_at.into());
        self
    }

    /// IANA timezone the schedule + daily batching are evaluated in.
    pub fn with_schedule_timezone(mut self, timezone: impl Into<String>) -> Self {
        self.schedule_timezone = Some(timezone.into());
        self
    }

    /// Max recipients fanned out per batch-day (1-100000).
    pub fn with_daily_batch_size(mut self, size: u32) -> Self {
        self.daily_batch_size = Some(size);
        self
    }
}

/// Options for `campaigns.update` (`PATCH /campaigns/:id`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateCampaignOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_text: Option<String>,
    /// Re-point the campaign at another of your domains' contact pools
    /// (draft campaigns only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    /// Re-target a segment; `Some(None)` serializes as `null` (clears it).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<Option<String>>,
    /// Re-target a topic gate; `Some(None)` serializes as `null` (clears it).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic_id: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<CampaignRecurrence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurrence_every: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ab_test: Option<CampaignAbTestOptions>,
    /// Replace the pending engagement follow-ups (max 5); an empty vec clears
    /// them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub followups: Option<Vec<CampaignFollowup>>,
    /// Show a generated mailing-list address as the visible To (`false`
    /// clears it). Delivery stays individual.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_to: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsubscribe_policy: Option<UnsubscribePolicy>,
    /// IANA timezone the schedule + daily batching are evaluated in;
    /// `Some(None)` serializes as `null` (clears back to the account
    /// timezone, then UTC).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule_timezone: Option<Option<String>>,
    /// Max recipients fanned out per batch-day (1-100000); `Some(None)`
    /// serializes as `null` (clears — send to everyone at once).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_batch_size: Option<Option<u32>>,
}

impl UpdateCampaignOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    pub fn with_from(mut self, from: impl Into<String>) -> Self {
        self.from = Some(from.into());
        self
    }

    pub fn with_subject(mut self, subject: impl Into<String>) -> Self {
        self.subject = Some(subject.into());
        self
    }

    pub fn with_html(mut self, html: impl Into<String>) -> Self {
        self.html = Some(html.into());
        self
    }

    pub fn with_text(mut self, text: impl Into<String>) -> Self {
        self.text = Some(text.into());
        self
    }

    pub fn with_reply_to(mut self, reply_to: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.reply_to = Some(reply_to.into_iter().map(Into::into).collect());
        self
    }

    pub fn with_preview_text(mut self, preview_text: impl Into<String>) -> Self {
        self.preview_text = Some(preview_text.into());
        self
    }

    pub fn with_domain(mut self, domain: impl Into<String>) -> Self {
        self.domain = Some(domain.into());
        self
    }

    pub fn with_segment_id(mut self, segment_id: impl Into<String>) -> Self {
        self.segment_id = Some(Some(segment_id.into()));
        self
    }

    /// Clear the segment target (serializes `segment_id: null`).
    pub fn clear_segment(mut self) -> Self {
        self.segment_id = Some(None);
        self
    }

    pub fn with_topic_id(mut self, topic_id: impl Into<String>) -> Self {
        self.topic_id = Some(Some(topic_id.into()));
        self
    }

    /// Clear the topic gate (serializes `topic_id: null`).
    pub fn clear_topic(mut self) -> Self {
        self.topic_id = Some(None);
        self
    }

    pub fn with_recurrence(mut self, recurrence: CampaignRecurrence) -> Self {
        self.recurrence = Some(recurrence);
        self
    }

    pub fn with_recurrence_every(mut self, every: u16) -> Self {
        self.recurrence_every = Some(every);
        self
    }

    pub fn with_ab_test(mut self, ab_test: CampaignAbTestOptions) -> Self {
        self.ab_test = Some(ab_test);
        self
    }

    /// Append a follow-up to the replacement set ([] via `with_followups` to
    /// clear).
    pub fn with_followup(mut self, followup: CampaignFollowup) -> Self {
        self.followups.get_or_insert_with(Vec::new).push(followup);
        self
    }

    /// Replace the pending follow-ups wholesale (an empty vec clears them).
    pub fn with_followups(mut self, followups: Vec<CampaignFollowup>) -> Self {
        self.followups = Some(followups);
        self
    }

    pub fn with_list_to(mut self, list_to: bool) -> Self {
        self.list_to = Some(list_to);
        self
    }

    pub fn with_unsubscribe_policy(mut self, policy: UnsubscribePolicy) -> Self {
        self.unsubscribe_policy = Some(policy);
        self
    }

    /// IANA timezone the schedule + daily batching are evaluated in.
    pub fn with_schedule_timezone(mut self, timezone: impl Into<String>) -> Self {
        self.schedule_timezone = Some(Some(timezone.into()));
        self
    }

    /// Clear the schedule timezone (serializes `schedule_timezone: null`).
    pub fn clear_schedule_timezone(mut self) -> Self {
        self.schedule_timezone = Some(None);
        self
    }

    /// Max recipients fanned out per batch-day (1-100000).
    pub fn with_daily_batch_size(mut self, size: u32) -> Self {
        self.daily_batch_size = Some(Some(size));
        self
    }

    /// Clear daily batching (serializes `daily_batch_size: null`).
    pub fn clear_daily_batch_size(mut self) -> Self {
        self.daily_batch_size = Some(None);
        self
    }
}

/// Options for `campaigns.send` (`POST /campaigns/:id/send`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SendCampaignOptions {
    /// ISO 8601 (or natural-language) schedule; omitted ⇒ send now.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_at: Option<String>,
    /// IANA timezone persisted onto the campaign so daily batching evaluates
    /// batch-days in that zone.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule_timezone: Option<String>,
}

impl SendCampaignOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_scheduled_at(mut self, scheduled_at: impl Into<String>) -> Self {
        self.scheduled_at = Some(scheduled_at.into());
        self
    }

    pub fn with_schedule_timezone(mut self, timezone: impl Into<String>) -> Self {
        self.schedule_timezone = Some(timezone.into());
        self
    }
}

/// Per-campaign analytics (`GET /campaigns/:id/stats`).
#[derive(Debug, Clone, Deserialize)]
pub struct CampaignStats {
    pub object: String,
    pub campaign_id: String,
    #[serde(default)]
    pub links: Vec<Value>,
    /// Remaining engagement counters/rates (open shape).
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// A/B winner evaluation (`GET /campaigns/:id/ab`).
///
/// The statistical fields the API spreads in here are camelCase on the wire
/// (`zScore`, `pValue`) and stay that way in [`extra`](Self::extra).
#[derive(Debug, Clone, Deserialize)]
pub struct CampaignAbResult {
    pub object: String,
    pub campaign_id: String,
    pub metric: AbMetric,
    /// Remaining evaluation details (open shape): `a`, `b`, `winner`,
    /// `fallback`, `lift`, `zScore`, `pValue`, `confidence`, `reason`.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// One recipient who opened a campaign email.
#[derive(Debug, Clone, Deserialize)]
pub struct CampaignOpen {
    pub email: String,
    pub contact_id: Option<String>,
    pub opened_at: Option<String>,
    #[serde(default)]
    pub open_count: u64,
}

/// One recipient who clicked a link in a campaign email.
#[derive(Debug, Clone, Deserialize)]
pub struct CampaignClick {
    pub email: String,
    pub contact_id: Option<String>,
    pub clicked_at: Option<String>,
    #[serde(default)]
    pub click_count: u64,
}

/// One reply received to a campaign email.
#[derive(Debug, Clone, Deserialize)]
pub struct CampaignReply {
    pub email: String,
    pub contact_id: Option<String>,
    pub replied_at: Option<String>,
    pub received_email_id: String,
    pub subject: Option<String>,
    /// First 300 characters of the reply text.
    pub preview: Option<String>,
    /// AI reply intent, e.g. `interested`.
    pub category: Option<String>,
    pub received_at: Option<String>,
}

/// Per-recipient engagement for one campaign
/// (`GET /campaigns/:id/engagement`). Each list is capped at 500 rows and
/// this route is NOT paginated.
#[derive(Debug, Clone, Deserialize)]
pub struct CampaignEngagement {
    pub object: String,
    pub campaign_id: String,
    #[serde(default)]
    pub opened: Vec<CampaignOpen>,
    #[serde(default)]
    pub clicked: Vec<CampaignClick>,
    #[serde(default)]
    pub replied: Vec<CampaignReply>,
}

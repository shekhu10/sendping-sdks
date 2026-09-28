using System.Text.Json;
using System.Text.Json.Serialization;

namespace SendPing;

/// <summary>
/// A/B-test config accepted on campaign create/update. When <see cref="Enabled"/>,
/// supply at least one variant-B field (SubjectB, HtmlB or TextB).
/// </summary>
public class CampaignAbTest
{
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    [JsonPropertyName("subject_b")]
    public string? SubjectB { get; set; }

    [JsonPropertyName("html_b")]
    public string? HtmlB { get; set; }

    [JsonPropertyName("text_b")]
    public string? TextB { get; set; }

    /// <summary>Percentage (1-100) of the audience used to pick the winner. Defaults to 20.</summary>
    [JsonPropertyName("test_pct")]
    public int? TestPct { get; set; }

    /// <summary>Winner metric: <c>open</c> | <c>click</c> | <c>reply</c>. Defaults to <c>open</c>.</summary>
    [JsonPropertyName("metric")]
    public string? Metric { get; set; }

    /// <summary>Hours (1-168) to run the test before evaluating and sending the winner.</summary>
    [JsonPropertyName("eval_hours")]
    public int? EvalHours { get; set; }
}

/// <summary>A/B config + decision echoed back on retrieve.</summary>
public class CampaignAbInfo
{
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    [JsonPropertyName("subject_b")]
    public string? SubjectB { get; set; }

    [JsonPropertyName("html_b")]
    public string? HtmlB { get; set; }

    [JsonPropertyName("text_b")]
    public string? TextB { get; set; }

    [JsonPropertyName("test_pct")]
    public int? TestPct { get; set; }

    /// <summary><c>open</c> | <c>click</c> | <c>reply</c>.</summary>
    [JsonPropertyName("metric")]
    public string? Metric { get; set; }

    /// <summary>Hours the test ran before evaluating the winner.</summary>
    [JsonPropertyName("eval_hours")]
    public int? EvalHours { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("winner")]
    public string? Winner { get; set; }
}

/// <summary>
/// An engagement follow-up accepted on campaign create: sent <see cref="Delay"/>
/// after the campaign finishes to recipients matching <see cref="Condition"/>,
/// threaded as a reply to the original email.
/// </summary>
public class CampaignFollowup
{
    /// <summary><c>opened</c> | <c>clicked</c> | <c>not_opened</c> | <c>not_clicked</c> | <c>replied</c> | <c>not_replied</c>.</summary>
    [JsonPropertyName("condition")]
    public string Condition { get; set; } = null!;

    /// <summary>Natural-language duration, e.g. <c>5 hours</c> or <c>4 days</c> (max 30 days).</summary>
    [JsonPropertyName("delay")]
    public string Delay { get; set; } = null!;

    /// <summary>Defaults to <c>Re: &lt;campaign subject&gt;</c> (keeps the thread).</summary>
    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    [JsonPropertyName("html")]
    public string HtmlBody { get; set; } = null!;
}

/// <summary>A follow-up as echoed back on campaign retrieve.</summary>
public class CampaignFollowupInfo
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("condition")]
    public string Condition { get; set; } = null!;

    [JsonPropertyName("delay")]
    public string Delay { get; set; } = null!;

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("run_at")]
    public string? RunAt { get; set; }

    [JsonPropertyName("sent_count")]
    public int SentCount { get; set; }
}

/// <summary>Recurrence cadence of a recurring campaign.</summary>
public class CampaignRecurrenceInfo
{
    /// <summary><c>daily</c> | <c>weekly</c> | <c>monthly</c>.</summary>
    [JsonPropertyName("interval")]
    public string Interval { get; set; } = null!;

    [JsonPropertyName("every")]
    public int Every { get; set; }
}

/// <summary>A campaign — a bulk send to a domain's contact pool (or a segment of it).</summary>
public class Campaign
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "campaign";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("audience_id")]
    public string AudienceId { get; set; } = null!;

    /// <summary>Segment target (null ⇒ whole audience).</summary>
    [JsonPropertyName("segment_id")]
    public string? SegmentId { get; set; }

    /// <summary>Topic gate (null ⇒ no gating).</summary>
    [JsonPropertyName("topic_id")]
    public string? TopicId { get; set; }

    [JsonPropertyName("from")]
    public string? From { get; set; }

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    [JsonPropertyName("html")]
    public string? HtmlBody { get; set; }

    [JsonPropertyName("text")]
    public string? TextBody { get; set; }

    [JsonPropertyName("reply_to")]
    public string? ReplyTo { get; set; }

    [JsonPropertyName("preview_text")]
    public string? PreviewText { get; set; }

    /// <summary>
    /// <c>draft</c>, <c>scheduled</c>, <c>recurring</c>, <c>queued</c> (fanning
    /// out now), <c>paused</c> (reputation gate), <c>canceled</c>, <c>sent</c> or
    /// <c>failed</c>. <c>canceled</c> is terminal — a <c>queued</c> campaign that
    /// was stopped part-way; it cannot be re-sent.
    /// </summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = null!;

    [JsonPropertyName("scheduled_at")]
    public string? ScheduledAt { get; set; }

    [JsonPropertyName("sent_at")]
    public string? SentAt { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;

    /// <summary>A/B config + decision. <c>Enabled = false</c> when not an A/B campaign.</summary>
    [JsonPropertyName("ab_test")]
    public CampaignAbInfo? AbTest { get; set; }

    /// <summary>Engagement follow-ups (retrieve only).</summary>
    [JsonPropertyName("followups")]
    public List<CampaignFollowupInfo>? Followups { get; set; }

    /// <summary>Generated mailing-list To address (retrieve only; null unless list_to was set).</summary>
    [JsonPropertyName("list_address")]
    public string? ListAddress { get; set; }

    /// <summary>How the unsubscribe list applied: <c>account</c> | <c>domain</c> | <c>ignore</c> (retrieve only).</summary>
    [JsonPropertyName("unsubscribe_policy")]
    public string? UnsubscribePolicy { get; set; }

    /// <summary>Recurrence cadence (null ⇒ one-off).</summary>
    [JsonPropertyName("recurrence")]
    public CampaignRecurrenceInfo? Recurrence { get; set; }

    /// <summary>Set on auto-generated occurrences of a recurring campaign.</summary>
    [JsonPropertyName("parent_campaign_id")]
    public string? ParentCampaignId { get; set; }

    /// <summary>IANA zone the schedule and daily batching are evaluated in.</summary>
    [JsonPropertyName("schedule_timezone")]
    public string? ScheduleTimezone { get; set; }

    /// <summary>Max recipients fanned out per batch-day; null ⇒ everyone at once.</summary>
    [JsonPropertyName("daily_batch_size")]
    public int? DailyBatchSize { get; set; }

    /// <summary>Why the campaign failed or was paused; null otherwise.</summary>
    [JsonPropertyName("failure_reason")]
    public string? FailureReason { get; set; }

    /// <summary>Engagement counts — included only on retrieve (GET /campaigns/:id).</summary>
    [JsonPropertyName("statistics")]
    public JsonElement? Statistics { get; set; }
}

/// <summary>
/// One row of CampaignListAsync (GET /campaigns). The list serializer is
/// deliberately narrower than the full <see cref="Campaign"/>: no bodies, no
/// <c>from</c>/<c>topic_id</c>/<c>reply_to</c>/<c>preview_text</c>, no schedule
/// detail, follow-ups, recurrence or statistics. Use CampaignRetrieveAsync for
/// those.
/// </summary>
public class CampaignListItem
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "campaign";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>Included so a list view can render it without a per-row fetch.</summary>
    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    [JsonPropertyName("audience_id")]
    public string AudienceId { get; set; } = null!;

    /// <summary>Segment target; null ⇒ the whole audience.</summary>
    [JsonPropertyName("segment_id")]
    public string? SegmentId { get; set; }

    /// <summary>
    /// <c>draft</c>, <c>scheduled</c>, <c>recurring</c>, <c>queued</c>,
    /// <c>paused</c>, <c>canceled</c>, <c>sent</c> or <c>failed</c>.
    /// <c>canceled</c> is terminal and not re-sendable.
    /// </summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = null!;

    /// <summary>
    /// Lightweight A/B marker — <c>enabled</c> plus metric/status/winner when
    /// enabled. Full A/B detail is on CampaignRetrieveAsync / CampaignAbAsync.
    /// </summary>
    [JsonPropertyName("ab_test")]
    public CampaignAbInfo? AbTest { get; set; }

    [JsonPropertyName("created_at")]
    public string? CreatedAt { get; set; }

    [JsonPropertyName("scheduled_at")]
    public string? ScheduledAt { get; set; }

    [JsonPropertyName("sent_at")]
    public string? SentAt { get; set; }

    /// <summary>Why the campaign failed or was paused; null otherwise.</summary>
    [JsonPropertyName("failure_reason")]
    public string? FailureReason { get; set; }
}

/// <summary>Payload for creating a campaign (POST /campaigns). <see cref="Domain"/> is REQUIRED.</summary>
public class CampaignCreateOptions
{
    /// <summary>
    /// REQUIRED. The sending domain whose contact pool this campaign targets
    /// (e.g. <c>yourdomain.com</c> — one of your domains). Orthogonal to
    /// <see cref="From"/>: the from address may be a different verified domain.
    /// </summary>
    [JsonPropertyName("domain")]
    public string Domain { get; set; } = null!;

    [JsonPropertyName("from")]
    public string From { get; set; } = null!;

    [JsonPropertyName("subject")]
    public string Subject { get; set; } = null!;

    /// <summary>HTML body. Ordinary links become tracked redirects at send time —
    /// so do URLs in the <c>text</c> body. Your stored campaign is never modified.</summary>
    [JsonPropertyName("html")]
    public string? HtmlBody { get; set; }

    [JsonPropertyName("text")]
    public string? TextBody { get; set; }

    [JsonPropertyName("reply_to")]
    public EmailAddressList? ReplyTo { get; set; }

    [JsonPropertyName("preview_text")]
    public string? PreviewText { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>Target a segment (subset of the audience) instead of everyone.</summary>
    [JsonPropertyName("segment_id")]
    public string? SegmentId { get; set; }

    /// <summary>Gate recipients by a topic subscription.</summary>
    [JsonPropertyName("topic_id")]
    public string? TopicId { get; set; }

    /// <summary>Make this a recurring campaign: <c>daily</c> | <c>weekly</c> | <c>monthly</c>.</summary>
    [JsonPropertyName("recurrence")]
    public string? Recurrence { get; set; }

    /// <summary>Number of periods between recurring sends (1-365). Defaults to 1.</summary>
    [JsonPropertyName("recurrence_every")]
    public int? RecurrenceEvery { get; set; }

    /// <summary>A/B-test configuration.</summary>
    [JsonPropertyName("ab_test")]
    public CampaignAbTest? AbTest { get; set; }

    /// <summary>Engagement follow-ups (max 5).</summary>
    [JsonPropertyName("followups")]
    public List<CampaignFollowup>? Followups { get; set; }

    /// <summary>Show a generated mailing-list address as the visible To. Delivery stays individual.</summary>
    [JsonPropertyName("list_to")]
    public bool? ListTo { get; set; }

    /// <summary>
    /// How the unsubscribe list applies: <c>account</c> (default), <c>domain</c>,
    /// or <c>ignore</c> (bounced/complained addresses are ALWAYS excluded).
    /// </summary>
    [JsonPropertyName("unsubscribe_policy")]
    public string? UnsubscribePolicy { get; set; }

    /// <summary>Send immediately on create (or schedule it when <see cref="ScheduledAt"/> is given).</summary>
    [JsonPropertyName("send")]
    public bool? Send { get; set; }

    /// <summary>ISO 8601 (or natural-language) schedule used when <see cref="Send"/> is true.</summary>
    [JsonPropertyName("scheduled_at")]
    public string? ScheduledAt { get; set; }

    /// <summary>
    /// IANA timezone the schedule + daily batching are evaluated in (e.g.
    /// <c>America/New_York</c>). Defaults to the account timezone, then UTC.
    /// </summary>
    [JsonPropertyName("schedule_timezone")]
    public string? ScheduleTimezone { get; set; }

    /// <summary>Max recipients fanned out per batch-day (1-100000). Omitted ⇒ everyone at once.</summary>
    [JsonPropertyName("daily_batch_size")]
    public int? DailyBatchSize { get; set; }
}

/// <summary>
/// Payload for updating a draft campaign (PATCH /campaigns/:id). Note: null
/// properties are omitted from the request; clearing segment_id/topic_id (the
/// API accepts explicit null) is not expressible through this class.
/// </summary>
public class CampaignUpdateOptions
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("from")]
    public string? From { get; set; }

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    [JsonPropertyName("html")]
    public string? HtmlBody { get; set; }

    [JsonPropertyName("text")]
    public string? TextBody { get; set; }

    [JsonPropertyName("reply_to")]
    public EmailAddressList? ReplyTo { get; set; }

    [JsonPropertyName("preview_text")]
    public string? PreviewText { get; set; }

    /// <summary>Re-point the campaign at another of your domains' contact pools (draft campaigns only).</summary>
    [JsonPropertyName("domain")]
    public string? Domain { get; set; }

    [JsonPropertyName("segment_id")]
    public string? SegmentId { get; set; }

    [JsonPropertyName("topic_id")]
    public string? TopicId { get; set; }

    /// <summary><c>daily</c> | <c>weekly</c> | <c>monthly</c>.</summary>
    [JsonPropertyName("recurrence")]
    public string? Recurrence { get; set; }

    [JsonPropertyName("recurrence_every")]
    public int? RecurrenceEvery { get; set; }

    [JsonPropertyName("ab_test")]
    public CampaignAbTest? AbTest { get; set; }

    /// <summary>Replace the pending engagement follow-ups (max 5); an empty list clears them.</summary>
    [JsonPropertyName("followups")]
    public List<CampaignFollowup>? Followups { get; set; }

    /// <summary>Enable (<c>true</c>) or clear (<c>false</c>) the generated mailing-list To address.</summary>
    [JsonPropertyName("list_to")]
    public bool? ListTo { get; set; }

    /// <summary>
    /// How the unsubscribe list applies: <c>account</c> (default), <c>domain</c>,
    /// or <c>ignore</c> (bounced/complained addresses are ALWAYS excluded).
    /// </summary>
    [JsonPropertyName("unsubscribe_policy")]
    public string? UnsubscribePolicy { get; set; }

    /// <summary>
    /// IANA timezone the schedule + daily batching are evaluated in (e.g.
    /// <c>America/New_York</c>). Null is omitted from the request (clearing back
    /// to the account timezone requires an explicit JSON null, which this class
    /// does not express — see the class remarks).
    /// </summary>
    [JsonPropertyName("schedule_timezone")]
    public string? ScheduleTimezone { get; set; }

    /// <summary>Max recipients fanned out per batch-day (1-100000).</summary>
    [JsonPropertyName("daily_batch_size")]
    public int? DailyBatchSize { get; set; }
}

/// <summary>
/// Options for sending (or scheduling) a campaign (POST /campaigns/:id/send).
/// </summary>
public class CampaignSendOptions
{
    /// <summary>ISO 8601 (or natural-language) schedule; null sends immediately.</summary>
    [JsonPropertyName("scheduled_at")]
    public string? ScheduledAt { get; set; }

    /// <summary>
    /// IANA timezone (e.g. <c>America/New_York</c>) persisted onto the campaign
    /// so daily batching evaluates batch-days in that zone.
    /// </summary>
    [JsonPropertyName("schedule_timezone")]
    public string? ScheduleTimezone { get; set; }
}

/// <summary>Per-campaign analytics (GET /campaigns/:id/stats).</summary>
public class CampaignStats
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "campaign_stats";

    [JsonPropertyName("campaign_id")]
    public string CampaignId { get; set; } = null!;

    [JsonPropertyName("links")]
    public List<JsonElement>? Links { get; set; }

    /// <summary>Counts and engagement rates not modeled explicitly.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }
}

/// <summary>One recipient who opened a campaign email.</summary>
public class CampaignOpenEngagement
{
    [JsonPropertyName("email")]
    public string Email { get; set; } = null!;

    [JsonPropertyName("contact_id")]
    public string? ContactId { get; set; }

    [JsonPropertyName("opened_at")]
    public string? OpenedAt { get; set; }

    [JsonPropertyName("open_count")]
    public int OpenCount { get; set; }
}

/// <summary>One recipient who clicked a link in a campaign email.</summary>
public class CampaignClickEngagement
{
    [JsonPropertyName("email")]
    public string Email { get; set; } = null!;

    [JsonPropertyName("contact_id")]
    public string? ContactId { get; set; }

    [JsonPropertyName("clicked_at")]
    public string? ClickedAt { get; set; }

    [JsonPropertyName("click_count")]
    public int ClickCount { get; set; }
}

/// <summary>One reply received to a campaign email.</summary>
public class CampaignReplyEngagement
{
    [JsonPropertyName("email")]
    public string Email { get; set; } = null!;

    [JsonPropertyName("contact_id")]
    public string? ContactId { get; set; }

    [JsonPropertyName("replied_at")]
    public string? RepliedAt { get; set; }

    /// <summary>Id of the inbound message — pass it to ReceivedEmailRetrieveAsync.</summary>
    [JsonPropertyName("received_email_id")]
    public string? ReceivedEmailId { get; set; }

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    /// <summary>First 300 characters of the reply text.</summary>
    [JsonPropertyName("preview")]
    public string? Preview { get; set; }

    /// <summary>AI reply intent: <c>interested</c> | <c>neutral</c> | <c>not_interested</c>.</summary>
    [JsonPropertyName("category")]
    public string? Category { get; set; }

    [JsonPropertyName("received_at")]
    public string? ReceivedAt { get; set; }
}

/// <summary>
/// Per-recipient engagement for a campaign (GET /campaigns/:id/engagement).
/// Not paginated — each list is capped at 500 rows server-side.
/// </summary>
public class CampaignEngagement
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "campaign_engagement";

    [JsonPropertyName("campaign_id")]
    public string CampaignId { get; set; } = null!;

    [JsonPropertyName("opened")]
    public List<CampaignOpenEngagement> Opened { get; set; } = new();

    [JsonPropertyName("clicked")]
    public List<CampaignClickEngagement> Clicked { get; set; } = new();

    [JsonPropertyName("replied")]
    public List<CampaignReplyEngagement> Replied { get; set; } = new();
}

/// <summary>A/B winner evaluation (GET /campaigns/:id/ab).</summary>
public class CampaignAbResult
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "campaign_ab";

    [JsonPropertyName("campaign_id")]
    public string CampaignId { get; set; } = null!;

    /// <summary><c>open</c> | <c>click</c> | <c>reply</c>.</summary>
    [JsonPropertyName("metric")]
    public string Metric { get; set; } = null!;

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }
}

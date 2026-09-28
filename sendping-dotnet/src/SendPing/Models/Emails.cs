using System.Text.Json.Serialization;

namespace SendPing;

/// <summary>An email attachment. Provide <see cref="Content"/> (base64) OR <see cref="Path"/> (hosted URL).</summary>
public class EmailAttachment
{
    [JsonPropertyName("filename")]
    public string Filename { get; set; } = null!;

    /// <summary>Base64-encoded file content. Provide <c>Content</c> OR <c>Path</c>.</summary>
    [JsonPropertyName("content")]
    public string? Content { get; set; }

    /// <summary>A hosted URL to fetch the file from. Provide <c>Content</c> OR <c>Path</c>.</summary>
    [JsonPropertyName("path")]
    public string? Path { get; set; }

    [JsonPropertyName("content_type")]
    public string? ContentType { get; set; }

    /// <summary>Content-ID for inline/related parts (renders as <c>cid:</c> references).</summary>
    [JsonPropertyName("content_id")]
    public string? ContentId { get; set; }
}

/// <summary>Nested template reference on send. Provide <c>Id</c> OR <c>Alias</c>.</summary>
public class TemplateReference
{
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    [JsonPropertyName("alias")]
    public string? Alias { get; set; }

    [JsonPropertyName("variables")]
    public Dictionary<string, object?>? Variables { get; set; }
}

/// <summary>Payload for sending a single email (POST /emails) or one entry of a batch send.</summary>
public class EmailMessage
{
    [JsonPropertyName("from")]
    public string From { get; set; } = null!;

    [JsonPropertyName("to")]
    public EmailAddressList To { get; set; } = new();

    [JsonPropertyName("subject")]
    public string Subject { get; set; } = null!;

    [JsonPropertyName("cc")]
    public EmailAddressList? Cc { get; set; }

    [JsonPropertyName("bcc")]
    public EmailAddressList? Bcc { get; set; }

    [JsonPropertyName("reply_to")]
    public EmailAddressList? ReplyTo { get; set; }

    /// <summary>
    /// HTML body. Write ordinary links — every destination becomes a tracked
    /// redirect at send time (when the sending domain has click tracking on):
    /// <c>&lt;a href&gt;</c> targets, markdown-style <c>[text](url)</c> links, and
    /// bare URLs or domains (<c>https://…</c>, <c>www.…</c>, <c>acme.com</c>) in
    /// the body text. Link text is preserved and opt-out links are never wrapped.
    /// The content you send is stored and returned UNCHANGED — only the copy
    /// delivered to the recipient carries the tracking URL.
    /// </summary>
    [JsonPropertyName("html")]
    public string? HtmlBody { get; set; }

    /// <summary>
    /// Plain-text body (the <c>text/plain</c> alternative). URLs in it are
    /// rewritten to tracked redirects at send time under the same rule as
    /// <c>html</c>, so a click counts whichever alternative the recipient's mail
    /// client renders. Omit to derive it from <c>html</c>; pass <c>""</c> to send
    /// no text part.
    /// </summary>
    [JsonPropertyName("text")]
    public string? TextBody { get; set; }

    /// <summary>Inbox preview text (preheader). Max 150 characters.</summary>
    [JsonPropertyName("preview_text")]
    public string? PreviewText { get; set; }

    [JsonPropertyName("headers")]
    public Dictionary<string, string>? Headers { get; set; }

    [JsonPropertyName("attachments")]
    public List<EmailAttachment>? Attachments { get; set; }

    /// <summary>ISO 8601 timestamp to schedule the send.</summary>
    [JsonPropertyName("scheduled_at")]
    public string? ScheduledAt { get; set; }

    /// <summary>Drop recipients unsubscribed from this topic (topic gating).</summary>
    [JsonPropertyName("topic_id")]
    public string? TopicId { get; set; }

    /// <summary>Send using a saved template; its subject/html/text fill any omitted field.</summary>
    [JsonPropertyName("template_id")]
    public string? TemplateId { get; set; }

    /// <summary>Nested template reference. Provide <c>Template</c> OR <c>HtmlBody</c>/<c>TextBody</c>, not both.</summary>
    [JsonPropertyName("template")]
    public TemplateReference? Template { get; set; }

    /// <summary>Values for the template's <c>{{ placeholder }}</c> variables.</summary>
    [JsonPropertyName("variables")]
    public Dictionary<string, object?>? Variables { get; set; }
}

/// <summary>
/// A single email in a batch send (POST /emails/batch). Identical to
/// <see cref="EmailMessage"/> minus <c>Attachments</c> and <c>ScheduledAt</c> —
/// the batch endpoint rejects both per item; send those individually via
/// <c>EmailSendAsync</c>.
/// </summary>
public class BatchEmailMessage
{
    [JsonPropertyName("from")]
    public string From { get; set; } = null!;

    [JsonPropertyName("to")]
    public EmailAddressList To { get; set; } = new();

    [JsonPropertyName("subject")]
    public string Subject { get; set; } = null!;

    [JsonPropertyName("cc")]
    public EmailAddressList? Cc { get; set; }

    [JsonPropertyName("bcc")]
    public EmailAddressList? Bcc { get; set; }

    [JsonPropertyName("reply_to")]
    public EmailAddressList? ReplyTo { get; set; }

    /// <summary>
    /// HTML body. Write ordinary links — every destination becomes a tracked
    /// redirect at send time (when the sending domain has click tracking on):
    /// <c>&lt;a href&gt;</c> targets, markdown-style <c>[text](url)</c> links, and
    /// bare URLs or domains (<c>https://…</c>, <c>www.…</c>, <c>acme.com</c>) in
    /// the body text. Link text is preserved and opt-out links are never wrapped.
    /// The content you send is stored and returned UNCHANGED — only the copy
    /// delivered to the recipient carries the tracking URL.
    /// </summary>
    [JsonPropertyName("html")]
    public string? HtmlBody { get; set; }

    /// <summary>
    /// Plain-text body (the <c>text/plain</c> alternative). URLs in it are
    /// rewritten to tracked redirects at send time under the same rule as
    /// <c>html</c>, so a click counts whichever alternative the recipient's mail
    /// client renders. Omit to derive it from <c>html</c>; pass <c>""</c> to send
    /// no text part.
    /// </summary>
    [JsonPropertyName("text")]
    public string? TextBody { get; set; }

    /// <summary>Inbox preview text (preheader). Max 150 characters.</summary>
    [JsonPropertyName("preview_text")]
    public string? PreviewText { get; set; }

    [JsonPropertyName("headers")]
    public Dictionary<string, string>? Headers { get; set; }

    /// <summary>Drop recipients unsubscribed from this topic (topic gating).</summary>
    [JsonPropertyName("topic_id")]
    public string? TopicId { get; set; }

    /// <summary>Send using a saved template; its subject/html/text fill any omitted field.</summary>
    [JsonPropertyName("template_id")]
    public string? TemplateId { get; set; }

    /// <summary>Nested template reference. Provide <c>Template</c> OR <c>HtmlBody</c>/<c>TextBody</c>, not both.</summary>
    [JsonPropertyName("template")]
    public TemplateReference? Template { get; set; }

    /// <summary>Values for the template's <c>{{ placeholder }}</c> variables.</summary>
    [JsonPropertyName("variables")]
    public Dictionary<string, object?>? Variables { get; set; }
}

/// <summary>
/// The legal values of the <c>folder</c> filter on GET /emails. The API
/// rejects any other value with a 422 <c>validation_error</c>.
/// </summary>
public static class EmailFolders
{
    public const string Outbox = "outbox";
    public const string Sent = "sent";
    public const string Scheduled = "scheduled";
    public const string Failed = "failed";
}

/// <summary>
/// Options for listing sent emails (GET /emails): cursor pagination plus
/// optional server-side <c>campaign_id</c> / <c>automation_id</c> /
/// <c>source</c> / <c>domain_id</c> / <c>status</c> / <c>search</c> filters.
/// </summary>
public class EmailListOptions
{
    /// <summary>Page size (most endpoints cap at 100).</summary>
    public int? Limit { get; set; }

    /// <summary>Cursor: id of the last item on the previous page.</summary>
    public string? After { get; set; }

    /// <summary>Cursor: id of the first item on the next page.</summary>
    public string? Before { get; set; }

    /// <summary>Only emails sent by this campaign (takes precedence over the other source filters).</summary>
    public string? CampaignId { get; set; }

    /// <summary>Only emails sent by this automation.</summary>
    public string? AutomationId { get; set; }

    /// <summary>
    /// <c>individual</c> restricts to all one-off sends (no campaign/automation),
    /// <c>api</c> to one-off sends made with an API key (including mail predating
    /// origin tracking), <c>dashboard</c> to mail composed in the dashboard
    /// (composer, inbox replies/forwards). Ignored when <see cref="CampaignId"/>
    /// or <see cref="AutomationId"/> is supplied.
    /// </summary>
    public string? Source { get; set; }

    /// <summary>Only emails sent from this sending domain (domain id); composes with the source filters.</summary>
    public string? DomainId { get; set; }

    /// <summary>
    /// Only emails whose latest state matches, case-insensitively — the same
    /// value reads expose as <c>last_event</c> (e.g. <c>delivered</c>,
    /// <c>bounced</c>, <c>scheduled</c>, <c>failed</c>).
    /// </summary>
    public string? Status { get; set; }

    /// <summary>Substring match over recipients, subject and sender.</summary>
    public string? Search { get; set; }

    /// <summary>
    /// Mailbox folder — one of the <see cref="EmailFolders"/> constants
    /// (<c>outbox</c>, <c>sent</c>, <c>scheduled</c>, <c>failed</c>); any other
    /// value is rejected with a 422 <c>validation_error</c>.
    /// </summary>
    public string? Folder { get; set; }
}

/// <summary>Response of a send: <c>{ id }</c>.</summary>
public class EmailCreated
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;
}

/// <summary>
/// The full answer to a batch send (POST /emails/batch).
/// </summary>
/// <remarks>
/// <para>
/// The API serves a batch one of two ways, chosen by its SIZE alone — and both
/// are success, so branch on <see cref="Queued"/>, never on "no exception was
/// thrown":
/// </para>
/// <list type="bullet">
///   <item><description><b>1–40 emails</b> are sent while the request is open
///   (HTTP 200, <see cref="Queued"/> false). Every id in <see cref="Data"/> has
///   already been handed to the mail service.</description></item>
///   <item><description><b>41–100 emails</b> are accepted, written as due-now
///   sends and delivered in the background (HTTP 202, <see cref="Queued"/> true,
///   <see cref="QueuedCount"/> = <c>Data.Count</c>). The ids are real email ids
///   from that moment — <c>EmailRetrieveAsync(id)</c> works — but they start at
///   <c>scheduled</c> and NOTHING has been transmitted yet.</description></item>
/// </list>
/// <para>
/// A batch carrying a <c>@test.sendping.co</c> simulator recipient stays inline at
/// any size.
/// </para>
/// </remarks>
public class BatchSendResponse
{
    /// <summary>One <c>{ id }</c> per email, in request order.</summary>
    [JsonPropertyName("data")]
    public List<EmailCreated> Data { get; set; } = new();

    /// <summary>
    /// True only on the queued (202) path. The API omits the field entirely on
    /// an inline 200, which decodes as false.
    /// </summary>
    [JsonPropertyName("queued")]
    public bool Queued { get; set; }

    /// <summary>
    /// How many emails were enqueued — always <c>Data.Count</c>. Null on the
    /// inline path, where the API sends no such field.
    /// </summary>
    [JsonPropertyName("queued_count")]
    public int? QueuedCount { get; set; }
}

/// <summary>One entry of a sent email's event timeline.</summary>
public class EmailEvent
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = null!;

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;
}

/// <summary>A sent email with its full detail and event timeline (GET /emails/:id).</summary>
public class Email
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "email";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    /// <summary>Provider message id; null until the send is accepted.</summary>
    [JsonPropertyName("message_id")]
    public string? MessageId { get; set; }

    [JsonPropertyName("from")]
    public string From { get; set; } = null!;

    [JsonPropertyName("to")]
    public List<string> To { get; set; } = new();

    /// <summary>Id of the sending domain the message went out on; null for legacy rows.</summary>
    [JsonPropertyName("domain_id")]
    public string? DomainId { get; set; }

    [JsonPropertyName("cc")]
    public List<string>? Cc { get; set; }

    [JsonPropertyName("bcc")]
    public List<string>? Bcc { get; set; }

    [JsonPropertyName("reply_to")]
    public List<string>? ReplyTo { get; set; }

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    [JsonPropertyName("html")]
    public string? HtmlBody { get; set; }

    [JsonPropertyName("text")]
    public string? TextBody { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("last_event")]
    public string? LastEvent { get; set; }

    /// <summary>Plain-language failure reason; non-null only when the send failed.</summary>
    [JsonPropertyName("error")]
    public string? Error { get; set; }

    [JsonPropertyName("scheduled_at")]
    public string? ScheduledAt { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;

    [JsonPropertyName("events")]
    public List<EmailEvent>? Events { get; set; }
}

/// <summary>
/// Lightweight row returned by EmailListAsync (GET /emails). The list endpoint
/// trims the full <see cref="Email"/>: no status/html/text/events, and
/// unset cc/bcc/reply_to come back as null (not []). Use EmailRetrieveAsync
/// for the full email with its event timeline.
/// </summary>
public class SentEmailListItem
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "email";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("message_id")]
    public string? MessageId { get; set; }

    [JsonPropertyName("from")]
    public string From { get; set; } = null!;

    [JsonPropertyName("to")]
    public List<string> To { get; set; } = new();

    [JsonPropertyName("cc")]
    public List<string>? Cc { get; set; }

    [JsonPropertyName("bcc")]
    public List<string>? Bcc { get; set; }

    [JsonPropertyName("reply_to")]
    public List<string>? ReplyTo { get; set; }

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    /// <summary>Latest recorded event/state, e.g. <c>sent</c>, <c>delivered</c>, <c>bounced</c>.</summary>
    [JsonPropertyName("last_event")]
    public string? LastEvent { get; set; }

    [JsonPropertyName("scheduled_at")]
    public string? ScheduledAt { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;

    /// <summary>Id of the sending domain the message went out on; null for legacy rows.</summary>
    [JsonPropertyName("domain_id")]
    public string? DomainId { get; set; }

    /// <summary>Set when the send originated from a campaign (follow-ups included).</summary>
    [JsonPropertyName("campaign_id")]
    public string? CampaignId { get; set; }

    /// <summary>Set when the send originated from an automation step.</summary>
    [JsonPropertyName("automation_id")]
    public string? AutomationId { get; set; }
}

/// <summary>
/// One row of EmailListSourcesAsync (GET /emails/sources) — send counters
/// rolled up per origin. Not paginated; <c>has_more</c> is always false.
/// </summary>
public class EmailSource
{
    /// <summary>
    /// <c>campaign</c> | <c>automation</c> | <c>api</c> (one-off API-key sends,
    /// including mail predating origin tracking) | <c>individual</c>
    /// (dashboard-composed one-offs).
    /// </summary>
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = null!;

    /// <summary>Campaign/automation id; null on the <c>api</c> and <c>individual</c> roll-up rows.</summary>
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    /// <summary>Null on the <c>api</c> and <c>individual</c> roll-up rows.</summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>Only populated for <c>campaign</c> rows.</summary>
    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    /// <summary>Only populated for <c>campaign</c> rows.</summary>
    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("total")]
    public int Total { get; set; }

    [JsonPropertyName("sent")]
    public int Sent { get; set; }

    [JsonPropertyName("delivered")]
    public int Delivered { get; set; }

    [JsonPropertyName("opened")]
    public int Opened { get; set; }

    [JsonPropertyName("clicked")]
    public int Clicked { get; set; }

    [JsonPropertyName("replied")]
    public int Replied { get; set; }

    [JsonPropertyName("failed")]
    public int Failed { get; set; }

    [JsonPropertyName("last_sent_at")]
    public string? LastSentAt { get; set; }
}

/// <summary>Metadata for an attachment of a SENT email (GET /emails/:id/attachments).</summary>
public class AttachmentMeta
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "attachment";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("filename")]
    public string? Filename { get; set; }

    [JsonPropertyName("content_type")]
    public string? ContentType { get; set; }

    [JsonPropertyName("content_disposition")]
    public string? ContentDisposition { get; set; }

    [JsonPropertyName("content_id")]
    public string? ContentId { get; set; }

    [JsonPropertyName("size")]
    public long? Size { get; set; }

    [JsonPropertyName("download_url")]
    public string? DownloadUrl { get; set; }

    [JsonPropertyName("expires_at")]
    public string? ExpiresAt { get; set; }
}

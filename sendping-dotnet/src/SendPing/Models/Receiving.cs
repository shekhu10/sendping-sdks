using System.Text.Json;
using System.Text.Json.Serialization;

namespace SendPing;

/// <summary>An attachment of a RECEIVED (inbound) email.</summary>
public class ReceivedAttachment
{
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    [JsonPropertyName("filename")]
    public string? Filename { get; set; }

    [JsonPropertyName("content_type")]
    public string? ContentType { get; set; }

    /// <summary>
    /// Decoded size in bytes, or <c>null</c> when the ingest recorded none. The
    /// standalone list route (<c>GET /emails/receiving/:id/attachments</c>)
    /// really does send <c>null</c> here for a legacy row, so this is nullable —
    /// the embedded copy on <see cref="ReceivedEmail.Attachments"/> substitutes 0.
    /// </summary>
    [JsonPropertyName("size")]
    public long? Size { get; set; }

    [JsonPropertyName("content_id")]
    public string? ContentId { get; set; }

    [JsonPropertyName("content_disposition")]
    public string? ContentDisposition { get; set; }

    [JsonPropertyName("downloadable")]
    public bool Downloadable { get; set; }

    [JsonPropertyName("download_url")]
    public string? DownloadUrl { get; set; }

    [JsonPropertyName("expires_at")]
    public string? ExpiresAt { get; set; }

    /// <summary>Backward-compatible relative-path alias.</summary>
    [JsonPropertyName("url")]
    public string? Url { get; set; }
}

/// <summary>Pre-signed pointer to the original RFC822/MIME message of a received email.</summary>
public class ReceivedEmailRaw
{
    [JsonPropertyName("download_url")]
    public string DownloadUrl { get; set; } = null!;

    /// <summary>
    /// Not sent by the API today — the raw pointer carries only
    /// <see cref="DownloadUrl"/>. Nullable so the type does not promise a value
    /// that never arrives.
    /// </summary>
    [JsonPropertyName("expires_at")]
    public string? ExpiresAt { get; set; }
}

/// <summary>An inbound email (GET /emails/receiving/:id).</summary>
public class ReceivedEmail
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "received_email";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("from")]
    public string From { get; set; } = null!;

    [JsonPropertyName("to")]
    public List<string> To { get; set; } = new();

    /// <summary>Id of the receiving domain the message arrived on; null for legacy rows.</summary>
    [JsonPropertyName("domain_id")]
    public string? DomainId { get; set; }

    [JsonPropertyName("cc")]
    public List<string>? Cc { get; set; }

    [JsonPropertyName("bcc")]
    public List<string>? Bcc { get; set; }

    [JsonPropertyName("received_for")]
    public List<string>? ReceivedFor { get; set; }

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    [JsonPropertyName("html")]
    public string? HtmlBody { get; set; }

    [JsonPropertyName("text")]
    public string? TextBody { get; set; }

    /// <summary>Parsed message headers as a name → value map.</summary>
    [JsonPropertyName("headers")]
    public Dictionary<string, string>? Headers { get; set; }

    [JsonPropertyName("message_id")]
    public string? MessageId { get; set; }

    /// <summary>AI reply intent (replies only): <c>interested</c> | <c>neutral</c> | <c>not_interested</c>.</summary>
    [JsonPropertyName("category")]
    public string? Category { get; set; }

    /// <summary>The sent email this message replied to, when the reply was recognised.</summary>
    [JsonPropertyName("reply_to_email_id")]
    public string? ReplyToEmailId { get; set; }

    [JsonPropertyName("spf")]
    public string? Spf { get; set; }

    [JsonPropertyName("verdicts")]
    public Dictionary<string, JsonElement>? Verdicts { get; set; }

    [JsonPropertyName("attachments")]
    public List<ReceivedAttachment>? Attachments { get; set; }

    [JsonPropertyName("raw_available")]
    public bool RawAvailable { get; set; }

    [JsonPropertyName("raw")]
    public ReceivedEmailRaw? Raw { get; set; }

    [JsonPropertyName("raw_url")]
    public string? RawUrl { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;
}

/// <summary>Payload for forwarding a received email (POST /emails/receiving/:id/forward).</summary>
public class ReceivedEmailForwardOptions
{
    /// <summary>A verified sending address to forward from (required by the backend).</summary>
    [JsonPropertyName("from")]
    public string From { get; set; } = null!;

    [JsonPropertyName("to")]
    public EmailAddressList To { get; set; } = new();

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }
}

/// <summary>
/// Options for listing received emails (GET /emails/receiving): cursor
/// pagination plus an optional <c>received_for</c> filter.
/// </summary>
public class ReceivedEmailListOptions
{
    /// <summary>Page size (most endpoints cap at 100).</summary>
    public int? Limit { get; set; }

    /// <summary>Cursor: id of the last item on the previous page.</summary>
    public string? After { get; set; }

    /// <summary>Cursor: id of the first item on the next page.</summary>
    public string? Before { get; set; }

    /// <summary>Only messages received for this address (matches the <c>received_for</c> recipients).</summary>
    public string? ReceivedFor { get; set; }
}

/// <summary>
/// Inbound counters for one receiving address (GET /emails/receiving/addresses).
/// Not paginated; sorted by <see cref="LastReceivedAt"/> descending.
/// </summary>
public class ReceivingAddressStats
{
    [JsonPropertyName("address")]
    public string Address { get; set; } = null!;

    [JsonPropertyName("total")]
    public int Total { get; set; }

    /// <summary>How many of them were recognised as replies to a sent email.</summary>
    [JsonPropertyName("replies")]
    public int Replies { get; set; }

    /// <summary>How many replies the AI classifier categorised as <c>interested</c>.</summary>
    [JsonPropertyName("interested")]
    public int Interested { get; set; }

    [JsonPropertyName("last_received_at")]
    public string? LastReceivedAt { get; set; }
}

/// <summary>
/// Payload for replying to a received email's sender, threaded into the same
/// conversation (POST /emails/receiving/:id/reply). Subject defaults to <c>Re: …</c>.
/// </summary>
public class ReceivedEmailReplyOptions
{
    [JsonPropertyName("from")]
    public string From { get; set; } = null!;

    [JsonPropertyName("html")]
    public string? HtmlBody { get; set; }

    [JsonPropertyName("text")]
    public string? TextBody { get; set; }

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }
}

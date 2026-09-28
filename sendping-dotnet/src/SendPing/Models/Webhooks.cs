using System.Text.Json;
using System.Text.Json.Serialization;

namespace SendPing;

/// <summary>A webhook endpoint subscription.</summary>
public class Webhook
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "webhook";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("endpoint")]
    public string Endpoint { get; set; } = null!;

    [JsonPropertyName("events")]
    public List<string> Events { get; set; } = new();

    [JsonPropertyName("status")]
    public string Status { get; set; } = null!;

    /// <summary>Whether a signing secret is set. (The secret itself is returned ONLY on create + rotate.)</summary>
    [JsonPropertyName("has_secret")]
    public bool? HasSecret { get; set; }

    /// <summary>Timestamp of the last delivery attempt (null until first delivery).</summary>
    [JsonPropertyName("last_delivery_at")]
    public string? LastDeliveryAt { get; set; }

    /// <summary>HTTP status of the last delivery attempt (null until first delivery).</summary>
    [JsonPropertyName("last_delivery_status")]
    public int? LastDeliveryStatus { get; set; }

    /// <summary>Consecutive delivery failure count.</summary>
    [JsonPropertyName("failure_count")]
    public int? FailureCount { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;
}

/// <summary>Payload for creating a webhook (POST /webhooks).</summary>
public class WebhookCreateOptions
{
    [JsonPropertyName("endpoint")]
    public string Endpoint { get; set; } = null!;

    [JsonPropertyName("events")]
    public List<string> Events { get; set; } = new();

    /// <summary>Optional caller-supplied signing secret. When omitted, SendPing generates one (returned once).</summary>
    [JsonPropertyName("secret")]
    public string? Secret { get; set; }
}

/// <summary>Payload for updating a webhook (PATCH /webhooks/:id).</summary>
public class WebhookUpdateOptions
{
    [JsonPropertyName("endpoint")]
    public string? Endpoint { get; set; }

    [JsonPropertyName("events")]
    public List<string>? Events { get; set; }

    /// <summary><c>enabled</c> | <c>disabled</c>.</summary>
    [JsonPropertyName("status")]
    public string? Status { get; set; }
}

/// <summary>
/// Response of webhook create/rotate. <see cref="SigningSecret"/> is the
/// plaintext secret, shown ONCE — store it now.
/// </summary>
public class WebhookCreated
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "webhook";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("signing_secret")]
    public string SigningSecret { get; set; } = null!;
}

/// <summary>
/// Result of a synchronous test delivery (POST /webhooks/:id/test).
/// A failed delivery is still HTTP 200 — branch on <see cref="Ok"/>, never on
/// the fact that the call returned without throwing.
/// </summary>
public class WebhookTestResult
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "webhook_test";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    /// <summary>
    /// Whether your endpoint accepted the test delivery. THIS is the outcome —
    /// the request itself succeeds either way.
    /// </summary>
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    /// <summary>The endpoint's HTTP status, when it responded at all.</summary>
    [JsonPropertyName("status")]
    public int? Status { get; set; }

    /// <summary>
    /// Why the delivery failed when <see cref="Ok"/> is false, e.g.
    /// <c>lookup_failed</c> or <c>webhook missing or disabled</c>.
    /// </summary>
    [JsonPropertyName("error")]
    public string? Error { get; set; }

    /// <summary>Any result field newer than this SDK version.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }
}

/// <summary>Outcome of verifying a webhook delivery signature.</summary>
public class VerifyWebhookResult
{
    /// <summary>True when the signature matches and (when checked) the timestamp is fresh.</summary>
    public bool Valid { get; set; }

    /// <summary>
    /// A machine reason when <see cref="Valid"/> is false: <c>missing_headers</c>,
    /// <c>missing_secret</c>, <c>invalid_timestamp</c>,
    /// <c>timestamp_out_of_tolerance</c>, or <c>no_match</c>.
    /// </summary>
    public string? Reason { get; set; }
}

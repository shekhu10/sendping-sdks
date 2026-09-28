using System.Text.Json.Serialization;

namespace SendPing;

/// <summary>
/// Payload for sending a custom event that automations can trigger on
/// (POST /events/send). <see cref="Domain"/> is REQUIRED.
/// </summary>
public class EventSendOptions
{
    /// <summary>The custom event name automations can trigger on. (<see cref="Name"/> is accepted as an alias.)</summary>
    [JsonPropertyName("event")]
    public string? Event { get; set; }

    /// <summary>Alias for <see cref="Event"/>.</summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>
    /// REQUIRED. The sending domain this event belongs to (e.g.
    /// <c>yourdomain.com</c> — one of your verified domains). Only automations
    /// belonging to that domain are triggered, so the same event name across
    /// several products can never double-fire. Contacts auto-created by this
    /// event land in the domain's own contact pool.
    /// </summary>
    [JsonPropertyName("domain")]
    public string Domain { get; set; } = null!;

    /// <summary>Identify the contact by id. Provide <c>ContactId</c> OR <c>Email</c>.</summary>
    [JsonPropertyName("contact_id")]
    public string? ContactId { get; set; }

    /// <summary>Identify the contact by email. Provide <c>ContactId</c> OR <c>Email</c>.</summary>
    [JsonPropertyName("email")]
    public string? Email { get; set; }

    /// <summary>Arbitrary event payload. (<see cref="Data"/> is accepted as an alias.)</summary>
    [JsonPropertyName("payload")]
    public Dictionary<string, object?>? Payload { get; set; }

    /// <summary>Alias for <see cref="Payload"/>.</summary>
    [JsonPropertyName("data")]
    public Dictionary<string, object?>? Data { get; set; }
}

/// <summary>Response of EventSendAsync.</summary>
public class EventSendResponse
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "event";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    /// <summary>The event name that was ingested.</summary>
    [JsonPropertyName("event")]
    public string? Event { get; set; }

    /// <summary>The resolved contact id the event was attributed to.</summary>
    [JsonPropertyName("contact_id")]
    public string? ContactId { get; set; }

    /// <summary>Number of automations the event enrolled the contact into.</summary>
    [JsonPropertyName("enrolled")]
    public int? Enrolled { get; set; }
}

/// <summary>Payload for creating a custom-event definition (POST /events).</summary>
public class EventCreateOptions
{
    /// <summary>The custom event name (cannot start with the reserved <c>sendping:</c> prefix).</summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    /// <summary>Optional flat key→type schema; types: <c>string</c> | <c>number</c> | <c>boolean</c> | <c>date</c>.</summary>
    [JsonPropertyName("schema")]
    public Dictionary<string, string>? Schema { get; set; }
}

/// <summary>A custom-event definition.</summary>
public class EventDefinition
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "event";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    [JsonPropertyName("schema")]
    public Dictionary<string, string>? Schema { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;

    [JsonPropertyName("updated_at")]
    public string? UpdatedAt { get; set; }
}

using System.Text.Json.Serialization;

namespace SendPing;

/// <summary>A subscription topic (e.g. "Product updates") on a sending domain.</summary>
public class Topic
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "topic";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("audience_id")]
    public string AudienceId { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    /// <summary><c>opt_in</c> | <c>opt_out</c>.</summary>
    [JsonPropertyName("default_subscription")]
    public string DefaultSubscription { get; set; } = null!;

    /// <summary><c>public</c> | <c>private</c>.</summary>
    [JsonPropertyName("visibility")]
    public string Visibility { get; set; } = null!;

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;
}

/// <summary>Payload for creating a topic (POST /topics). <see cref="Domain"/> is REQUIRED.</summary>
public class TopicCreateOptions
{
    /// <summary>
    /// REQUIRED. The sending domain this topic belongs to (e.g.
    /// <c>yourdomain.com</c>). Topic names are reusable across domains.
    /// </summary>
    [JsonPropertyName("domain")]
    public string Domain { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    /// <summary><c>opt_in</c> | <c>opt_out</c>. Required.</summary>
    [JsonPropertyName("default_subscription")]
    public string DefaultSubscription { get; set; } = null!;

    /// <summary><c>public</c> | <c>private</c>.</summary>
    [JsonPropertyName("visibility")]
    public string? Visibility { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }
}

/// <summary>Payload for updating a topic (PATCH /topics/:id).</summary>
public class TopicUpdateOptions
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>
    /// Clearable: <c>Patch.Clear&lt;string&gt;()</c> removes the description
    /// server-side — see <see cref="Patch{T}"/>.
    /// </summary>
    [JsonPropertyName("description")]
    public Patch<string>? Description { get; set; }

    /// <summary><c>public</c> | <c>private</c>.</summary>
    [JsonPropertyName("visibility")]
    public string? Visibility { get; set; }
}

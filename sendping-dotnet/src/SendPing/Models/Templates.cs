using System.Text.Json;
using System.Text.Json.Serialization;

namespace SendPing;

/// <summary>
/// A template variable definition as returned by the API. The registry carries
/// only the declaration — there is no per-variable id or timestamp, so those
/// are deliberately absent here rather than declared and always null.
/// </summary>
public class TemplateVariable
{
    [JsonPropertyName("key")]
    public string Key { get; set; } = null!;

    /// <summary><c>string</c> | <c>number</c>.</summary>
    [JsonPropertyName("type")]
    public string Type { get; set; } = null!;

    /// <summary>String, number or null.</summary>
    [JsonPropertyName("fallback_value")]
    public JsonElement? FallbackValue { get; set; }
}

/// <summary>A template variable definition accepted on create/update.</summary>
public class TemplateVariableInput
{
    [JsonPropertyName("key")]
    public string Key { get; set; } = null!;

    /// <summary><c>string</c> | <c>number</c>.</summary>
    [JsonPropertyName("type")]
    public string? Type { get; set; }

    /// <summary>String or number.</summary>
    [JsonPropertyName("fallback_value")]
    public object? FallbackValue { get; set; }
}

/// <summary>A saved email template.</summary>
public class Template
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "template";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    [JsonPropertyName("from")]
    public string? From { get; set; }

    [JsonPropertyName("reply_to")]
    public string? ReplyTo { get; set; }

    [JsonPropertyName("html")]
    public string? HtmlBody { get; set; }

    [JsonPropertyName("text")]
    public string? TextBody { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    /// <summary>Stable handle usable anywhere an id is accepted.</summary>
    [JsonPropertyName("alias")]
    public string? Alias { get; set; }

    /// <summary>When the template was last published (null while only a draft exists).</summary>
    [JsonPropertyName("published_at")]
    public string? PublishedAt { get; set; }

    /// <summary>True when the draft has edits not yet published (retrieve only).</summary>
    [JsonPropertyName("has_unpublished_versions")]
    public bool? HasUnpublishedVersions { get; set; }

    [JsonPropertyName("current_version_id")]
    public string? CurrentVersionId { get; set; }

    [JsonPropertyName("variables")]
    public List<TemplateVariable>? Variables { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;

    [JsonPropertyName("updated_at")]
    public string? UpdatedAt { get; set; }
}

/// <summary>
/// One row of TemplateListAsync (GET /templates). Narrower than the full
/// <see cref="Template"/>: this route sends no <c>object</c>, <c>from</c>,
/// <c>reply_to</c>, <c>text</c>, <c>current_version_id</c> or
/// <c>variables</c>. Use TemplateRetrieveAsync for those.
/// </summary>
public class TemplateListItem
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    /// <summary>Included so a list view can render a preview without a per-row fetch.</summary>
    [JsonPropertyName("html")]
    public string? HtmlBody { get; set; }

    /// <summary><c>draft</c> | <c>published</c>.</summary>
    [JsonPropertyName("status")]
    public string? Status { get; set; }

    /// <summary>When the template was last published; null while only a draft exists.</summary>
    [JsonPropertyName("published_at")]
    public string? PublishedAt { get; set; }

    /// <summary>Stable handle usable anywhere an id is accepted.</summary>
    [JsonPropertyName("alias")]
    public string? Alias { get; set; }

    /// <summary>True when the draft has edits not yet published.</summary>
    [JsonPropertyName("has_unpublished_versions")]
    public bool? HasUnpublishedVersions { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;

    [JsonPropertyName("updated_at")]
    public string? UpdatedAt { get; set; }
}

/// <summary>Payload for creating a template (POST /templates).</summary>
public class TemplateCreateOptions
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    /// <summary>Optional stable handle for sending by alias.</summary>
    [JsonPropertyName("alias")]
    public string? Alias { get; set; }

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    [JsonPropertyName("from")]
    public string? From { get; set; }

    [JsonPropertyName("reply_to")]
    public EmailAddressList? ReplyTo { get; set; }

    [JsonPropertyName("html")]
    public string? HtmlBody { get; set; }

    [JsonPropertyName("text")]
    public string? TextBody { get; set; }

    [JsonPropertyName("variables")]
    public List<TemplateVariableInput>? Variables { get; set; }
}

/// <summary>Payload for updating a template (PATCH /templates/:id).</summary>
public class TemplateUpdateOptions
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>
    /// Optional stable handle for sending by alias. Clearable:
    /// <c>Patch.Clear&lt;string&gt;()</c> removes it, a bare string sets it,
    /// and leaving it null keeps the stored value.
    /// </summary>
    [JsonPropertyName("alias")]
    public Patch<string>? Alias { get; set; }

    /// <summary>Clearable — see <see cref="Patch{T}"/>.</summary>
    [JsonPropertyName("subject")]
    public Patch<string>? Subject { get; set; }

    /// <summary>Clearable — see <see cref="Patch{T}"/>.</summary>
    [JsonPropertyName("from")]
    public Patch<string>? From { get; set; }

    /// <summary>Clearable — see <see cref="Patch{T}"/>.</summary>
    [JsonPropertyName("reply_to")]
    public Patch<EmailAddressList>? ReplyTo { get; set; }

    /// <summary>Clearable — see <see cref="Patch{T}"/>.</summary>
    [JsonPropertyName("html")]
    public Patch<string>? HtmlBody { get; set; }

    /// <summary>Clearable — see <see cref="Patch{T}"/>.</summary>
    [JsonPropertyName("text")]
    public Patch<string>? TextBody { get; set; }

    [JsonPropertyName("variables")]
    public List<TemplateVariableInput>? Variables { get; set; }
}

/// <summary>Payload for TemplateDuplicateAsync (POST /templates/:id/duplicate).</summary>
public class TemplateDuplicateOptions
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("alias")]
    public string? Alias { get; set; }
}

using System.Text.Json.Serialization;

namespace SendPing;

/// <summary>A single custom-property predicate. <see cref="Value"/> is required for eq/contains.</summary>
public class PropertyFilter
{
    [JsonPropertyName("key")]
    public string Key { get; set; } = null!;

    /// <summary><c>eq</c> | <c>contains</c> | <c>exists</c>.</summary>
    [JsonPropertyName("operator")]
    public string Operator { get; set; } = null!;

    /// <summary>String, number or null.</summary>
    [JsonPropertyName("value")]
    public object? Value { get; set; }
}

/// <summary>
/// A campaign-engagement predicate on a segment: contacts who did (or did not)
/// open/click a specific campaign.
/// </summary>
public class SegmentEngagementFilter
{
    /// <summary><c>opened</c> | <c>not_opened</c> | <c>clicked</c> | <c>not_clicked</c>.</summary>
    [JsonPropertyName("event")]
    public string Event { get; set; } = null!;

    /// <summary>Required whenever <see cref="Event"/> is set.</summary>
    [JsonPropertyName("campaign_id")]
    public string CampaignId { get; set; } = null!;
}

/// <summary>
/// The RESPONSE-side filter carried on a <see cref="Segment"/>: subscription
/// status + email substring + property predicates + an optional
/// campaign-engagement predicate. <see cref="Status"/> is always present and
/// <see cref="PropertyFilters"/> is always an array. Use
/// <see cref="SegmentFilterOptions"/> to create or update a segment.
/// </summary>
public class SegmentFilter
{
    /// <summary>
    /// <c>all</c> | <c>subscribed</c> | <c>unsubscribed</c> | <c>members_only</c>
    /// (<c>members_only</c> matches only explicitly added members).
    /// </summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = "all";

    [JsonPropertyName("email_contains")]
    public string? EmailContains { get; set; }

    [JsonPropertyName("property_filters")]
    public List<PropertyFilter> PropertyFilters { get; set; } = new();

    /// <summary>Campaign-engagement predicate; null ⇒ no engagement filtering.</summary>
    [JsonPropertyName("engagement")]
    public SegmentEngagementFilter? Engagement { get; set; }
}

/// <summary>
/// The REQUEST-side filter for SegmentCreateAsync and SegmentUpdateAsync.
/// Every property is optional; the two replaceable predicates are three-state
/// (omit = unchanged, value = replace, clear = remove).
/// </summary>
public class SegmentFilterOptions
{
    /// <summary>
    /// <c>all</c> | <c>subscribed</c> | <c>unsubscribed</c> | <c>members_only</c>.
    /// </summary>
    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("email_contains")]
    public string? EmailContains { get; set; }

    /// <summary>
    /// Replaces the property predicates wholesale. An EMPTY list clears them;
    /// null leaves them unchanged.
    /// </summary>
    [JsonPropertyName("property_filters")]
    public List<PropertyFilter>? PropertyFilters { get; set; }

    /// <summary>
    /// Campaign-engagement predicate. Clearable:
    /// <c>Patch.Clear&lt;SegmentEngagementFilter&gt;()</c> removes it — see
    /// <see cref="Patch{T}"/>.
    /// </summary>
    [JsonPropertyName("engagement")]
    public Patch<SegmentEngagementFilter>? Engagement { get; set; }
}

/// <summary>A saved segment of a domain's contact pool.</summary>
public class Segment
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "segment";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("audience_id")]
    public string AudienceId { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    [JsonPropertyName("filter")]
    public SegmentFilter Filter { get; set; } = new();

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;

    [JsonPropertyName("updated_at")]
    public string? UpdatedAt { get; set; }
}

/// <summary>
/// A contact as returned by SegmentListContactsAsync (GET /segments/:id/contacts).
/// This endpoint returns a REDUCED shape — no <c>object</c> discriminator and no
/// <c>properties</c> map. Use ContactRetrieveAsync for the full
/// <see cref="Contact"/>.
/// </summary>
public class SegmentContact
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("email")]
    public string Email { get; set; } = null!;

    [JsonPropertyName("first_name")]
    public string? FirstName { get; set; }

    [JsonPropertyName("last_name")]
    public string? LastName { get; set; }

    [JsonPropertyName("unsubscribed")]
    public bool Unsubscribed { get; set; }

    [JsonPropertyName("created_at")]
    public string? CreatedAt { get; set; }
}

/// <summary>
/// A segment a contact belongs to (GET /contacts/:id/segments). Carries only
/// id/name/created_at — NOT the full <see cref="Segment"/> object; call
/// SegmentRetrieveAsync for the filter.
/// </summary>
public class ContactSegmentRef
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    [JsonPropertyName("created_at")]
    public string? CreatedAt { get; set; }
}

/// <summary>
/// Payload for creating a segment (POST /segments). <see cref="Domain"/> is
/// REQUIRED: segment names are unique WITHIN a domain but freely reusable
/// across domains; every domain also carries an auto-created "General"
/// (all contacts) segment.
/// </summary>
public class SegmentCreateOptions
{
    /// <summary>REQUIRED. The sending domain this segment belongs to (e.g. <c>yourdomain.com</c>).</summary>
    [JsonPropertyName("domain")]
    public string Domain { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    [JsonPropertyName("filter")]
    public SegmentFilterOptions? Filter { get; set; }
}

/// <summary>Payload for updating a segment (PATCH /segments/:id).</summary>
public class SegmentUpdateOptions
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("filter")]
    public SegmentFilterOptions? Filter { get; set; }
}

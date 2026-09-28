using System.Text.Json;
using System.Text.Json.Serialization;

namespace SendPing;

/// <summary>An audience. Domain-first model: each sending domain has one contact POOL audience.</summary>
public class Audience
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "audience";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    /// <summary>
    /// Set when this audience is a sending domain's contact POOL (one pool per
    /// domain, lazily created). Null on plain user-created audiences.
    /// </summary>
    [JsonPropertyName("domain")]
    public string? Domain { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;
}

/// <summary>Result of a Google-Sheet import (POST /audiences/:id/contacts/import-sheet).</summary>
public class SheetImportResult
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "sheet_import";

    [JsonPropertyName("imported")]
    public int Imported { get; set; }

    [JsonPropertyName("updated")]
    public int Updated { get; set; }

    [JsonPropertyName("skipped")]
    public int Skipped { get; set; }

    [JsonPropertyName("total")]
    public int Total { get; set; }

    [JsonPropertyName("segment_id")]
    public string SegmentId { get; set; } = null!;

    [JsonPropertyName("segment_name")]
    public string SegmentName { get; set; } = null!;

    [JsonPropertyName("segment_added")]
    public int SegmentAdded { get; set; }

    [JsonPropertyName("variables")]
    public List<string> Variables { get; set; } = new();
}

/// <summary>A contact.</summary>
public class Contact
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "contact";

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

    /// <summary>Custom contact properties (own values merged over registered fallbacks).</summary>
    [JsonPropertyName("properties")]
    public Dictionary<string, JsonElement>? Properties { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;
}

/// <summary>
/// Payload for creating a contact. DOMAIN-FIRST: set <see cref="Domain"/> to
/// create in that sending domain's contact pool via the flat /contacts API
/// (REQUIRED there), or <see cref="AudienceId"/> to target a specific audience
/// via the nested API. The same address on two domains is two records with
/// separate consent.
/// </summary>
public class ContactCreateOptions
{
    /// <summary>
    /// The sending domain whose contact pool the contact lands in (e.g.
    /// <c>yourdomain.com</c>). REQUIRED whenever <see cref="AudienceId"/> is omitted.
    /// </summary>
    [JsonIgnore]
    public string? Domain { get; set; }

    /// <summary>Target a specific audience via the nested /audiences/:id/contacts API instead of <see cref="Domain"/>.</summary>
    [JsonIgnore]
    public string? AudienceId { get; set; }

    [JsonPropertyName("email")]
    public string Email { get; set; } = null!;

    [JsonPropertyName("first_name")]
    public string? FirstName { get; set; }

    [JsonPropertyName("last_name")]
    public string? LastName { get; set; }

    [JsonPropertyName("unsubscribed")]
    public bool? Unsubscribed { get; set; }

    /// <summary>Custom contact property values (string or number) keyed by the property key.</summary>
    [JsonPropertyName("properties")]
    public Dictionary<string, object?>? Properties { get; set; }
}

/// <summary>
/// Payload for updating a contact. <see cref="Id"/> is a contact id OR email.
/// On the flat API, set <see cref="Domain"/> when Id is an EMAIL
/// (disambiguates across pools). Set <see cref="AudienceId"/> to use the
/// nested audience API instead.
/// </summary>
public class ContactUpdateOptions
{
    /// <summary>Contact id OR email.</summary>
    [JsonIgnore]
    public string Id { get; set; } = null!;

    /// <summary>Disambiguates an EMAIL Id across domains (a contact id is exact and needs no domain).</summary>
    [JsonIgnore]
    public string? Domain { get; set; }

    /// <summary>Audience the contact belongs to. Omit for the flat /contacts/:id API.</summary>
    [JsonIgnore]
    public string? AudienceId { get; set; }

    [JsonPropertyName("first_name")]
    public string? FirstName { get; set; }

    [JsonPropertyName("last_name")]
    public string? LastName { get; set; }

    [JsonPropertyName("unsubscribed")]
    public bool? Unsubscribed { get; set; }

    [JsonPropertyName("properties")]
    public Dictionary<string, object?>? Properties { get; set; }
}

/// <summary>A single contact in a bulk import (the audience is on the call).</summary>
public class ContactInput
{
    [JsonPropertyName("email")]
    public string Email { get; set; } = null!;

    [JsonPropertyName("first_name")]
    public string? FirstName { get; set; }

    [JsonPropertyName("last_name")]
    public string? LastName { get; set; }

    [JsonPropertyName("unsubscribed")]
    public bool? Unsubscribed { get; set; }

    [JsonPropertyName("properties")]
    public Dictionary<string, object?>? Properties { get; set; }
}

/// <summary>Result of a batch / CSV contact import.</summary>
public class ImportContactsResponse
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "contact_import";

    /// <summary>Newly inserted.</summary>
    [JsonPropertyName("imported")]
    public int Imported { get; set; }

    /// <summary>Existing contacts updated.</summary>
    [JsonPropertyName("updated")]
    public int Updated { get; set; }

    /// <summary>Rows dropped: missing/invalid email OR left untouched under on_conflict 'skip'.</summary>
    [JsonPropertyName("skipped")]
    public int Skipped { get; set; }

    /// <summary>Distinct contacts processed.</summary>
    [JsonPropertyName("total")]
    public int Total { get; set; }

    /// <summary>CSV import only: rows without a usable email.</summary>
    [JsonPropertyName("invalid_rows")]
    public int? InvalidRows { get; set; }

    /// <summary>CSV import only: rows dropped because the plan's contact cap was reached.</summary>
    [JsonPropertyName("limit_skipped")]
    public int? LimitSkipped { get; set; }

    /// <summary>CSV import only: rows the importer itself rejected (suppressed/system addresses).</summary>
    [JsonPropertyName("system_skipped")]
    public int? SystemSkipped { get; set; }

    /// <summary>CSV import only: header columns that were not imported.</summary>
    [JsonPropertyName("ignored_columns")]
    public List<string>? IgnoredColumns { get; set; }

    /// <summary>CSV import only: emails added to <c>segment_id</c> when one was supplied.</summary>
    [JsonPropertyName("segment_added")]
    public int? SegmentAdded { get; set; }

    /// <summary>CSV import only: the archived source file (<c>file_name</c>, <c>storage_key</c>, <c>archived</c>).</summary>
    [JsonPropertyName("source_file")]
    public JsonElement? SourceFile { get; set; }

    /// <summary>CSV import only: plan/contact-cap accounting for the import.</summary>
    [JsonPropertyName("contact_limit")]
    public JsonElement? ContactLimit { get; set; }
}

/// <summary>
/// A presigned direct-to-storage slot for a large contact CSV
/// (POST /audiences/:id/contacts/import/upload). PUT the file to
/// <see cref="UploadUrl"/> with <c>Content-Type: </c><see cref="ContentType"/>,
/// then pass <see cref="StorageKey"/> to ContactImportStorageKeyAsync.
/// </summary>
public class ContactImportUpload
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "contact_import_upload";

    /// <summary>Hand this back to the import endpoint once the upload finished.</summary>
    [JsonPropertyName("storage_key")]
    public string StorageKey { get; set; } = null!;

    /// <summary>A bearer credential in URL form — never log it.</summary>
    [JsonPropertyName("upload_url")]
    public string UploadUrl { get; set; } = null!;

    /// <summary>The Content-Type the presigned URL was signed for.</summary>
    [JsonPropertyName("content_type")]
    public string? ContentType { get; set; }

    /// <summary>Seconds until <see cref="UploadUrl"/> expires.</summary>
    [JsonPropertyName("expires_in")]
    public int ExpiresIn { get; set; }

    /// <summary>Upload size ceiling in bytes (256 MB).</summary>
    [JsonPropertyName("max_bytes")]
    public long MaxBytes { get; set; }
}

/// <summary>Options for listing contacts (limit ≤ 100).</summary>
public class ContactListOptions : PaginationOptions
{
    /// <summary>
    /// The sending domain whose contact pool to list (domain-first model).
    /// REQUIRED on the flat /contacts API (whenever <see cref="AudienceId"/> is omitted).
    /// </summary>
    public string? Domain { get; set; }

    /// <summary>List a specific audience via the nested /audiences/:id/contacts API instead of <see cref="Domain"/>.</summary>
    public string? AudienceId { get; set; }

    /// <summary>Restrict to members of this segment (works with or without AudienceId).</summary>
    public string? SegmentId { get; set; }
}

/// <summary>Delete acknowledgement for a contact: <c>{ object: 'contact', id, deleted }</c>.</summary>
public class ContactDeleted
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "contact";

    /// <summary>The deleted contact's id.</summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    /// <summary>The deleted contact's id.</summary>
    [Obsolete("The API returns the id under `id`, never `contact`. Use Id instead; this alias will be removed in 2.0.")]
    [JsonIgnore]
    public string Contact => Id;

    [JsonPropertyName("deleted")]
    public bool Deleted { get; set; }
}

/// <summary>Acknowledgement of removing a contact from a segment.</summary>
public class SegmentMembershipRemoved
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("audienceId")]
    public string? AudienceId { get; set; }

    [JsonPropertyName("deleted")]
    public bool Deleted { get; set; }
}

/// <summary>One topic subscription state of a contact.</summary>
public class ContactTopicSubscription
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    /// <summary><c>opt_in</c> | <c>opt_out</c>.</summary>
    [JsonPropertyName("subscription")]
    public string Subscription { get; set; } = null!;
}

/// <summary>A contact's topic subscriptions (GET /contacts/:id/topics).</summary>
public class ContactTopics
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "list";

    /// <summary>
    /// Whether another page exists. True when a supplied
    /// <see cref="PaginationOptions"/> sliced the result, and also when an
    /// unpaginated call hit the route's 1,000-row ceiling.
    /// </summary>
    [JsonPropertyName("has_more")]
    public bool HasMore { get; set; }

    [JsonPropertyName("data")]
    public List<ContactTopicSubscription> Data { get; set; } = new();
}

/// <summary>One topic setting in a topics update.</summary>
public class ContactTopicSetting
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    /// <summary><c>opt_in</c> | <c>opt_out</c>.</summary>
    [JsonPropertyName("subscription")]
    public string Subscription { get; set; } = null!;
}

/// <summary>Payload for PATCH /contacts/:id/topics.</summary>
public class ContactTopicsUpdateOptions
{
    [JsonPropertyName("topics")]
    public List<ContactTopicSetting> Topics { get; set; } = new();
}

/// <summary>A registered custom contact property (merge tag).</summary>
public class ContactProperty
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "contact_property";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("key")]
    public string Key { get; set; } = null!;

    /// <summary><c>string</c> | <c>number</c>.</summary>
    [JsonPropertyName("type")]
    public string Type { get; set; } = null!;

    /// <summary>String, number or null.</summary>
    [JsonPropertyName("fallback_value")]
    public JsonElement? FallbackValue { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;
}

/// <summary>Payload for registering a custom contact property (POST /contact-properties).</summary>
public class ContactPropertyCreateOptions
{
    /// <summary>Canonical merge-tag key. <see cref="Name"/> is accepted as an alias.</summary>
    [JsonPropertyName("key")]
    public string? Key { get; set; }

    /// <summary>Alias for <see cref="Key"/>.</summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary><c>string</c> | <c>number</c>. Required.</summary>
    [JsonPropertyName("type")]
    public string Type { get; set; } = null!;

    /// <summary>Default merge value when a contact has none (string or number).</summary>
    [JsonPropertyName("fallback_value")]
    public object? FallbackValue { get; set; }
}

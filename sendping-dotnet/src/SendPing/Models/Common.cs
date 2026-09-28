using System.Text.Json.Serialization;

namespace SendPing;

/// <summary>Slim acknowledgement returned by several create/update routes: <c>{ object, id }</c>.</summary>
public class ObjectRef
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = null!;

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;
}

/// <summary>A bare <c>{ id }</c> acknowledgement.</summary>
public class IdResponse
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;
}

/// <summary>Standard list envelope: <c>{ object: 'list', has_more, data }</c>.</summary>
public class ListResponse<T>
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "list";

    [JsonPropertyName("has_more")]
    public bool HasMore { get; set; }

    [JsonPropertyName("data")]
    public List<T> Data { get; set; } = new();
}

/// <summary>Standard delete acknowledgement: <c>{ object, id, deleted: true }</c>.</summary>
public class RemovedResponse
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = null!;

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("deleted")]
    public bool Deleted { get; set; }
}

/// <summary>Cursor pagination accepted by most List methods (limit / after / before).</summary>
public class PaginationOptions
{
    /// <summary>Page size (most endpoints cap at 100).</summary>
    public int? Limit { get; set; }

    /// <summary>Cursor: id of the last item on the previous page.</summary>
    public string? After { get; set; }

    /// <summary>Cursor: id of the first item on the next page.</summary>
    public string? Before { get; set; }
}

/// <summary>
/// A list of email addresses with implicit conversions from a single string or
/// a string array, so <c>To = "user@example.com"</c> just works.
/// Serializes as a JSON array.
/// </summary>
public class EmailAddressList : List<string>
{
    public EmailAddressList() { }

    public EmailAddressList(IEnumerable<string> addresses) : base(addresses) { }

    public static implicit operator EmailAddressList(string address) => new() { address };

    public static implicit operator EmailAddressList(string[] addresses) => new(addresses);
}

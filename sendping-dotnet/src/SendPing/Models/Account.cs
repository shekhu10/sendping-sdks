using System.Text.Json;
using System.Text.Json.Serialization;

namespace SendPing;

// ---- API keys ----

/// <summary>An API key as returned by ApiKeyListAsync (GET /api-keys).</summary>
public class ApiKey
{
    /// <summary><c>api_key</c>; omitted (null) on list rows.</summary>
    [JsonPropertyName("object")]
    public string? Object { get; set; }

    /// <summary>String-encoded integer id.</summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    /// <summary>
    /// Non-secret display prefix of the key — its first 8 characters, e.g.
    /// <c>mb_ab12</c>; null for legacy keys with no stored prefix. (There is no
    /// <c>mb_live_</c> prefix — every key starts with <c>mb_</c>.) The full
    /// secret is shown once, in the dashboard, at the moment the key is created.
    /// </summary>
    [JsonPropertyName("token")]
    public string? Token { get; set; }

    /// <summary><c>full_access</c> | <c>sending_access</c> (derived from the key's scopes).</summary>
    [JsonPropertyName("permission")]
    public string Permission { get; set; } = null!;

    /// <summary>Set when the key is scoped to exactly one sending domain (legacy).</summary>
    [JsonPropertyName("domain_id")]
    public string? DomainId { get; set; }

    /// <summary>Domains the key is scoped to; null when unscoped.</summary>
    [JsonPropertyName("domain_ids")]
    public List<string>? DomainIds { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;

    /// <summary>Last time the key authenticated a request; null if never used.</summary>
    [JsonPropertyName("last_used_at")]
    public string? LastUsedAt { get; set; }
}

// There are deliberately no create/update option types here: minting,
// re-scoping and revoking a key happen in the SendPing dashboard, under a
// signed-in session, so no key can change its own standing or anyone else's.

// ---- Logs ----

/// <summary>An API request log entry.</summary>
public class LogEntry
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "log";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("endpoint")]
    public string? Endpoint { get; set; }

    [JsonPropertyName("method")]
    public string Method { get; set; } = null!;

    [JsonPropertyName("response_status")]
    public int ResponseStatus { get; set; }

    [JsonPropertyName("user_agent")]
    public string? UserAgent { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;

    /// <summary>Present only on retrieve (GET /logs/:id).</summary>
    [JsonPropertyName("request_body")]
    public JsonElement? RequestBody { get; set; }

    /// <summary>Present only on retrieve (GET /logs/:id).</summary>
    [JsonPropertyName("response_body")]
    public JsonElement? ResponseBody { get; set; }
}

/// <summary>Options for LogListAsync: cursor pagination plus method/status filters (server-side).</summary>
public class LogListOptions : PaginationOptions
{
    /// <summary>Filter to an exact HTTP method, e.g. <c>POST</c>.</summary>
    public string? Method { get; set; }

    /// <summary>Filter to an exact response status, e.g. 200 or 429.</summary>
    public int? Status { get; set; }
}

// ---- Polls ----

/// <summary>One row of PollListAsync — an email that has in-email poll responses.</summary>
public class Poll
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "poll";

    /// <summary>The email the poll was sent on.</summary>
    [JsonPropertyName("email_id")]
    public string EmailId { get; set; } = null!;

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    [JsonPropertyName("responses")]
    public int Responses { get; set; }

    [JsonPropertyName("distinct_answers")]
    public int DistinctAnswers { get; set; }

    [JsonPropertyName("last_response_at")]
    public string? LastResponseAt { get; set; }
}

/// <summary>A single answer's tally within a poll result.</summary>
public class PollAnswer
{
    [JsonPropertyName("answer")]
    public string Answer { get; set; } = null!;

    [JsonPropertyName("count")]
    public int Count { get; set; }

    /// <summary>Share of all responses, 0–100, one decimal.</summary>
    [JsonPropertyName("pct")]
    public double Pct { get; set; }
}

/// <summary>The aggregated answer breakdown for one email (GET /polls/:emailId).</summary>
public class PollResult
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "poll_result";

    [JsonPropertyName("email_id")]
    public string EmailId { get; set; } = null!;

    [JsonPropertyName("total")]
    public int Total { get; set; }

    [JsonPropertyName("unique_respondents")]
    public int UniqueRespondents { get; set; }

    /// <summary>Most-voted answer first.</summary>
    [JsonPropertyName("answers")]
    public List<PollAnswer> Answers { get; set; } = new();
}

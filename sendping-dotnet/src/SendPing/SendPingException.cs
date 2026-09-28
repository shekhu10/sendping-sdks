using System.Text.Json;
using System.Text.Json.Serialization;

namespace SendPing;

/// <summary>
/// Thrown when the SendPing API returns a non-2xx response (or the response
/// cannot be reached/parsed). Carries the API error shape:
/// <c>{ statusCode, name, message }</c>.
/// </summary>
/// <remarks>
/// Some errors are a superset of that envelope. The additive fields are surfaced
/// as typed properties, and are <c>null</c> on an ordinary error:
/// <list type="bullet">
///   <item><see cref="Limit"/> — plan/quota rejections (<c>plan_limit_reached</c>,
///   <c>daily_quota_exceeded</c>, <c>monthly_quota_exceeded</c>,
///   <c>contact_limit_reached</c>, <c>ai_credits_exceeded</c>,
///   <c>automation_quota_exceeded</c>) say WHICH cap was hit.</item>
///   <item><see cref="Reputation"/> — reputation gates (<c>reputation_paused</c>,
///   <c>reputation_limit_exceeded</c>).</item>
///   <item><see cref="Sent"/> / <see cref="SentCount"/> — a
///   <c>POST /emails/batch</c> that failed part way through, naming the emails
///   that DID go out.</item>
/// </list>
/// Anything else the body carried stays reachable through <see cref="Extra"/>.
/// Branch on <see cref="Name"/> together with <see cref="StatusCode"/>, never on
/// <see cref="Exception.Message"/> — message text is scrubbed server-side and is
/// not a stable contract.
/// </remarks>
public class SendPingException : Exception
{
    /// <summary>HTTP status code of the failed response (0 for network errors).</summary>
    public int StatusCode { get; }

    /// <summary>Machine-readable error name, e.g. <c>validation_error</c> or <c>not_found</c>.</summary>
    public string Name { get; }

    /// <summary>
    /// Every field the error body carried beyond <c>statusCode</c>, <c>name</c>
    /// and <c>message</c>, unparsed. Empty when the response was not a JSON
    /// object. Use it to read fields newer than this SDK version.
    /// </summary>
    public IReadOnlyDictionary<string, JsonElement> Extra { get; }

    /// <summary>
    /// The plan/quota cap this request hit, or <c>null</c> when the error is not
    /// a limit error. Tells you WHICH quota ran out (<c>Kind</c>), how much of it
    /// was used, and the cheapest plan that would fit.
    /// </summary>
    public PlanLimitDetail? Limit { get; }

    /// <summary>
    /// The reputation-gate detail on <c>reputation_paused</c> /
    /// <c>reputation_limit_exceeded</c>, else <c>null</c>.
    /// </summary>
    public ReputationDetail? Reputation { get; }

    /// <summary>
    /// The emails that were already sent before a batch failed part way through
    /// (<c>POST /emails/batch</c> with an <c>Idempotency-Key</c>), else
    /// <c>null</c>. Do NOT resend these.
    /// </summary>
    public IReadOnlyList<EmailCreated>? Sent { get; }

    /// <summary>
    /// How many emails went out before a batch failed part way through, else
    /// <c>null</c>. Falls back to <see cref="Sent"/>'s length when the body
    /// carried the list but not the count.
    /// </summary>
    public int? SentCount { get; }

    /// <summary>Original logical email for a failed or unconfirmed send. Inspect before resending.</summary>
    public string? Id { get; }
    /// <summary>Reserved batch prefix, including unconfirmed provider handoffs.</summary>
    public IReadOnlyList<EmailCreated>? Reserved { get; }
    /// <summary>Items never attempted; does not count unconfirmed reserved items.</summary>
    public int? UnsentCount { get; }

    public SendPingException(int statusCode, string name, string message)
        : this(statusCode, name, message, (IReadOnlyDictionary<string, JsonElement>?)null)
    {
    }

    public SendPingException(int statusCode, string name, string message, Exception innerException)
        : base(message, innerException)
    {
        StatusCode = statusCode;
        Name = name;
        Extra = EmptyExtra;
    }

    /// <param name="statusCode">HTTP status of the failed response.</param>
    /// <param name="name">The error body's machine-readable <c>name</c>.</param>
    /// <param name="message">The error body's <c>message</c>.</param>
    /// <param name="extra">
    /// The additive fields of the parsed error body (everything except
    /// <c>statusCode</c> / <c>name</c> / <c>message</c>), or <c>null</c> when the
    /// response was not a JSON object.
    /// </param>
    public SendPingException(int statusCode, string name, string message, IReadOnlyDictionary<string, JsonElement>? extra)
        : base(message)
    {
        StatusCode = statusCode;
        Name = name;
        Extra = extra ?? EmptyExtra;

        Limit = Read<PlanLimitDetail>(Extra, "limit");
        Reputation = Read<ReputationDetail>(Extra, "reputation");
        Sent = Read<List<EmailCreated>>(Extra, "sent");
        SentCount = ReadSentCount(Extra, Sent);
        Id = Read<string>(Extra, "id");
        Reserved = Read<List<EmailCreated>>(Extra, "reserved");
        UnsentCount = Extra.TryGetValue("unsent_count", out var count) && count.ValueKind == JsonValueKind.Number && count.TryGetInt32(out var value) ? value : null;
    }

    private static readonly IReadOnlyDictionary<string, JsonElement> EmptyExtra =
        new Dictionary<string, JsonElement>();

    /// <summary>
    /// Deserialize one additive field, tolerating a shape this SDK version does
    /// not know: a field we cannot parse becomes <c>null</c> rather than costing
    /// the caller the whole exception. The raw value is still in <see cref="Extra"/>.
    /// </summary>
    private static T? Read<T>(IReadOnlyDictionary<string, JsonElement> extra, string key) where T : class
    {
        if (!extra.TryGetValue(key, out var element) || element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }
        try
        {
            return element.Deserialize<T>(SendPingJson.Options);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static int? ReadSentCount(IReadOnlyDictionary<string, JsonElement> extra, IReadOnlyList<EmailCreated>? sent)
    {
        if (extra.TryGetValue("sent_count", out var element)
            && element.ValueKind == JsonValueKind.Number
            && element.TryGetInt32(out var count))
        {
            return count;
        }
        return sent?.Count;
    }
}

/// <summary>
/// The plan/quota cap attached to a limit rejection (see
/// <see cref="SendPingException.Limit"/>).
/// </summary>
public class PlanLimitDetail
{
    /// <summary>
    /// Which cap was hit: <c>emails_daily</c>, <c>emails_monthly</c>,
    /// <c>domains</c>, <c>automation_runs</c>, <c>ai_credits</c>,
    /// <c>contacts</c> or <c>campaign_preflight</c>. Treat it as an open set.
    /// </summary>
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = null!;

    /// <summary>How much of the allowance is already consumed.</summary>
    [JsonPropertyName("used")]
    public long Used { get; set; }

    /// <summary>The allowance itself.</summary>
    [JsonPropertyName("limit")]
    public long Limit { get; set; }

    /// <summary>How much this request asked for.</summary>
    [JsonPropertyName("requested")]
    public long? Requested { get; set; }

    /// <summary>What is left of the allowance.</summary>
    [JsonPropertyName("remaining")]
    public long? Remaining { get; set; }

    /// <summary>Rolling window the cap is measured over: <c>24h</c> or <c>30d</c>.</summary>
    [JsonPropertyName("period")]
    public string? Period { get; set; }

    /// <summary>The plan the account is on.</summary>
    [JsonPropertyName("plan")]
    public PlanRef? Plan { get; set; }

    /// <summary>The cheapest plan that would fit, or <c>null</c> when only Enterprise does.</summary>
    [JsonPropertyName("next_plan")]
    public NextPlanRef? NextPlan { get; set; }

    /// <summary>Top-up credits — present only for the email-quota kinds.</summary>
    [JsonPropertyName("credits")]
    public PlanLimitCredits? Credits { get; set; }
}

/// <summary>The account's current plan, as named on a limit error.</summary>
public class PlanRef
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;
}

/// <summary>The cheapest plan that would clear the cap, with its allowances.</summary>
public class NextPlanRef : PlanRef
{
    /// <summary>Price in the minor unit of <see cref="Currency"/> (e.g. cents).</summary>
    [JsonPropertyName("amount")]
    public int Amount { get; set; }

    [JsonPropertyName("currency")]
    public string Currency { get; set; } = null!;

    [JsonPropertyName("monthly_emails")]
    public long MonthlyEmails { get; set; }

    [JsonPropertyName("daily_emails")]
    public long DailyEmails { get; set; }

    [JsonPropertyName("domains")]
    public long Domains { get; set; }

    [JsonPropertyName("contacts")]
    public long Contacts { get; set; }

    [JsonPropertyName("ai_credits")]
    public long AiCredits { get; set; }

    [JsonPropertyName("automation_runs")]
    public long AutomationRuns { get; set; }
}

/// <summary>Top-up credit balance offered alongside an email-quota rejection.</summary>
public class PlanLimitCredits
{
    [JsonPropertyName("balance")]
    public long Balance { get; set; }

    [JsonPropertyName("needed")]
    public long Needed { get; set; }

    [JsonPropertyName("purchasable")]
    public bool Purchasable { get; set; }

    /// <summary>Credits sold per unit (e.g. 1000 emails).</summary>
    [JsonPropertyName("unit")]
    public long Unit { get; set; }

    [JsonPropertyName("amount_per_unit_cents")]
    public int AmountPerUnitCents { get; set; }
}

/// <summary>
/// The reputation-gate detail attached to <c>reputation_paused</c> /
/// <c>reputation_limit_exceeded</c> (see <see cref="SendPingException.Reputation"/>).
/// </summary>
public class ReputationDetail
{
    /// <summary>Whether waiting and retrying can succeed.</summary>
    [JsonPropertyName("retryable")]
    public bool Retryable { get; set; }

    /// <summary>What the gate applies to: <c>tenant</c>, <c>domain</c> or <c>platform</c>.</summary>
    [JsonPropertyName("scope")]
    public string? Scope { get; set; }

    /// <summary>The reputation status that triggered the gate.</summary>
    [JsonPropertyName("status")]
    public string? Status { get; set; }

    /// <summary>The specific tenant/domain the scope refers to.</summary>
    [JsonPropertyName("scope_key")]
    public string? ScopeKey { get; set; }

    [JsonPropertyName("hourly_limit")]
    public long? HourlyLimit { get; set; }

    [JsonPropertyName("daily_limit")]
    public long? DailyLimit { get; set; }

    [JsonPropertyName("hourly_used")]
    public long? HourlyUsed { get; set; }

    [JsonPropertyName("daily_used")]
    public long? DailyUsed { get; set; }

    /// <summary>When sending may resume.</summary>
    [JsonPropertyName("retry_at")]
    public string? RetryAt { get; set; }

    [JsonPropertyName("support_email")]
    public string? SupportEmail { get; set; }

    /// <summary>Any reputation field newer than this SDK version.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }
}

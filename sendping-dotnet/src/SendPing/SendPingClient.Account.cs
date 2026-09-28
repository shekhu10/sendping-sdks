using System.Globalization;

namespace SendPing;

public partial class SendPingClient
{
    // ---- API keys ----
    //
    // Listing is the whole surface: creating, re-scoping and revoking a key are
    // dashboard-only operations (see ISendPing.Account.cs).

    public Task<ListResponse<ApiKey>> ApiKeyListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<ApiKey>>(HttpMethod.Get, "/api-keys" + Paginate(pagination), null, null, cancellationToken);

    // ---- Logs ----

    public Task<ListResponse<LogEntry>> LogListAsync(LogListOptions? options = null, CancellationToken cancellationToken = default)
    {
        var query = Query(
            ("limit", options?.Limit?.ToString(CultureInfo.InvariantCulture)),
            ("after", options?.After),
            ("before", options?.Before),
            ("method", options?.Method),
            ("status", options?.Status?.ToString(CultureInfo.InvariantCulture)));
        return RequestAsync<ListResponse<LogEntry>>(HttpMethod.Get, "/logs" + query, null, null, cancellationToken);
    }

    public Task<LogEntry> LogRetrieveAsync(string logId, CancellationToken cancellationToken = default)
        => RequestAsync<LogEntry>(HttpMethod.Get, $"/logs/{E(logId)}", null, null, cancellationToken);

    // ---- Polls ----

    public Task<ListResponse<Poll>> PollListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<Poll>>(HttpMethod.Get, "/polls" + Paginate(pagination), null, null, cancellationToken);

    public Task<PollResult> PollRetrieveAsync(string emailId, CancellationToken cancellationToken = default)
        => RequestAsync<PollResult>(HttpMethod.Get, $"/polls/{E(emailId)}", null, null, cancellationToken);
}

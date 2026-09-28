namespace SendPing;

public partial interface ISendPing
{
    // ---- API keys (read-only by design) ----
    //
    // Keys are minted, re-scoped and revoked in the SendPing dashboard, and
    // only there: those routes accept a signed-in dashboard session, never an
    // API key. This SDK therefore exposes listing and nothing else, so a leaked
    // key cannot mint itself a replacement, widen its own permission or revoke
    // the keys around it.

    /// <summary>
    /// List API keys (non-secret display prefixes only; revoked keys excluded).
    /// Omitting <paramref name="pagination"/> asks for the whole inventory in one
    /// response, but the route still caps it at 1,000 rows and reports the
    /// truncation through <c>HasMore</c> — keep walking with <c>After</c> while
    /// that is true rather than assuming a single page is complete.
    /// GET /api-keys
    /// </summary>
    Task<ListResponse<ApiKey>> ApiKeyListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    // ---- Logs ----

    /// <summary>
    /// List API request logs. Cursor-paginated with optional server-side
    /// method/status filters. GET /logs
    /// </summary>
    Task<ListResponse<LogEntry>> LogListAsync(LogListOptions? options = null, CancellationToken cancellationToken = default);

    /// <summary>Retrieve a log entry with request/response bodies. GET /logs/:id</summary>
    Task<LogEntry> LogRetrieveAsync(string logId, CancellationToken cancellationToken = default);

    // ---- Polls (read-only results of the in-email poll widget) ----

    /// <summary>One summary row per email that has poll responses. GET /polls</summary>
    Task<ListResponse<Poll>> PollListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    /// <summary>The aggregated answer breakdown for one email. GET /polls/:emailId</summary>
    Task<PollResult> PollRetrieveAsync(string emailId, CancellationToken cancellationToken = default);
}

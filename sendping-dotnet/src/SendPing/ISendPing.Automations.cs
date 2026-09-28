namespace SendPing;

public partial interface ISendPing
{
    // ---- Automations (domain-first) ----

    /// <summary>Create an automation. <c>options.Domain</c> is REQUIRED. POST /automations</summary>
    Task<Automation> AutomationCreateAsync(AutomationCreateOptions options, CancellationToken cancellationToken = default);

    /// <summary>Retrieve an automation with its step graph. GET /automations/:id</summary>
    Task<Automation> AutomationRetrieveAsync(string automationId, CancellationToken cancellationToken = default);

    /// <summary>List automations. GET /automations</summary>
    Task<ListResponse<Automation>> AutomationListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    /// <summary>Update an automation (name / status / domain / connections). PATCH /automations/:id</summary>
    Task<Automation> AutomationUpdateAsync(string automationId, AutomationUpdateOptions options, CancellationToken cancellationToken = default);

    /// <summary>
    /// Append a step to an automation. The automation must be DISABLED.
    /// POST /automations/:id/steps
    /// </summary>
    Task<AutomationStep> AutomationAddStepAsync(string automationId, AutomationAddStepOptions options, CancellationToken cancellationToken = default);

    /// <summary>
    /// Replace an existing step's type and config. The automation must be
    /// DISABLED. <c>options.Type</c> is REQUIRED even when only the config is
    /// changing — the update is a wholesale replace, not a merge. The step's
    /// graph key is fixed at creation and cannot be changed here.
    /// PATCH /automations/:id/steps/:stepId
    /// </summary>
    Task<AutomationStep> AutomationUpdateStepAsync(string automationId, string stepId, AutomationUpdateStepOptions options, CancellationToken cancellationToken = default);

    /// <summary>Delete a step from an automation. DELETE /automations/:id/steps/:stepId</summary>
    Task<AutomationStepDeleted> AutomationDeleteStepAsync(string automationId, string stepId, CancellationToken cancellationToken = default);

    /// <summary>List an automation's runs. GET /automations/:id/runs</summary>
    Task<ListResponse<AutomationRun>> AutomationListRunsAsync(string automationId, PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// List an automation's runs, optionally filtered to a set of statuses.
    /// GET /automations/:id/runs
    /// </summary>
    Task<ListResponse<AutomationRun>> AutomationListRunsAsync(string automationId, AutomationRunListOptions options, CancellationToken cancellationToken = default);

    /// <summary>
    /// Generate (or extend) an automation's step graph from a prompt. The
    /// automation must be stopped; without <c>options.Attach</c> it must also
    /// have no steps yet. Rate-limited to 20 requests / 60s per account and
    /// consumes AI credits. POST /automations/:id/ai
    /// </summary>
    Task<AutomationAiResult> AutomationCreateWithAiAsync(string automationId, AutomationAiOptions options, CancellationToken cancellationToken = default);

    /// <summary>Retrieve a single automation run with its step trace. GET /automations/:id/runs/:runId</summary>
    Task<AutomationRun> AutomationRetrieveRunAsync(string automationId, string runId, CancellationToken cancellationToken = default);

    /// <summary>Stop an automation — prevents new runs; in-progress runs finish. POST /automations/:id/stop</summary>
    Task<Automation> AutomationStopAsync(string automationId, CancellationToken cancellationToken = default);

    /// <summary>Delete an automation. DELETE /automations/:id</summary>
    Task<RemovedResponse> AutomationDeleteAsync(string automationId, CancellationToken cancellationToken = default);

    // ---- Events (automation custom events) ----

    /// <summary>
    /// Send a custom event that automations can trigger on. <c>options.Domain</c>
    /// is REQUIRED — only automations belonging to that domain are triggered.
    /// POST /events/send
    /// </summary>
    /// <param name="options">The event to ingest.</param>
    /// <param name="idempotencyKey">
    /// Sent as <c>Idempotency-Key</c>, but the API honours that header on
    /// <c>POST /emails</c>, <c>POST /emails/batch</c>, and received-email reply/forward ONLY — it is ignored
    /// here, so a retry ingests a SECOND event and can enroll the contact
    /// twice. De-duplicate on your side instead. The 1–255 length rule
    /// (<see cref="SendPingClient.MaxIdempotencyKeyLength"/>) is enforced by
    /// the server, not by this client.
    /// </param>
    /// <param name="cancellationToken">Token to cancel the request.</param>
    Task<EventSendResponse> EventSendAsync(EventSendOptions options, string? idempotencyKey = null, CancellationToken cancellationToken = default);

    /// <summary>Create a custom-event definition (name + optional payload schema). POST /events</summary>
    /// <param name="options">The definition to create.</param>
    /// <param name="idempotencyKey">
    /// Sent as <c>Idempotency-Key</c>, but the API honours that header on
    /// <c>POST /emails</c>, <c>POST /emails/batch</c>, and received-email reply/forward ONLY — it has no effect
    /// here. The 1–255 length rule
    /// (<see cref="SendPingClient.MaxIdempotencyKeyLength"/>) is enforced by
    /// the server, not by this client.
    /// </param>
    /// <param name="cancellationToken">Token to cancel the request.</param>
    Task<EventDefinition> EventCreateAsync(EventCreateOptions options, string? idempotencyKey = null, CancellationToken cancellationToken = default);

    /// <summary>List custom-event definitions. GET /events</summary>
    Task<ListResponse<EventDefinition>> EventListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Replace a custom-event definition's payload schema (pass null to clear
    /// it). The event NAME is immutable — automations reference it, so changing
    /// it is a 422; create a new event instead. PATCH /events/:id
    /// </summary>
    Task<EventDefinition> EventUpdateAsync(string eventId, IDictionary<string, string>? schema, CancellationToken cancellationToken = default);

    /// <summary>Delete a custom-event definition. DELETE /events/:id</summary>
    Task<RemovedResponse> EventDeleteAsync(string eventId, CancellationToken cancellationToken = default);

    // ---- Webhooks ----

    /// <summary>Create a webhook. The signing secret is shown ONCE, only here. POST /webhooks</summary>
    Task<WebhookCreated> WebhookCreateAsync(WebhookCreateOptions options, CancellationToken cancellationToken = default);

    /// <summary>Retrieve a webhook. GET /webhooks/:id</summary>
    Task<Webhook> WebhookRetrieveAsync(string webhookId, CancellationToken cancellationToken = default);

    /// <summary>List webhooks. GET /webhooks</summary>
    Task<ListResponse<Webhook>> WebhookListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    /// <summary>Update a webhook. PATCH /webhooks/:id</summary>
    Task<ObjectRef> WebhookUpdateAsync(string webhookId, WebhookUpdateOptions options, CancellationToken cancellationToken = default);

    /// <summary>
    /// Rotate the signing secret. The new plaintext secret is returned ONCE;
    /// the old secret stops verifying immediately. POST /webhooks/:id/rotate
    /// </summary>
    Task<WebhookCreated> WebhookRotateAsync(string webhookId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Send a synchronous test delivery and return the endpoint's live result.
    /// POST /webhooks/:id/test
    /// <para>
    /// A failed delivery is still HTTP 200, so this does NOT throw when your
    /// endpoint rejects the test — read <see cref="WebhookTestResult.Ok"/>.
    /// </para>
    /// </summary>
    Task<WebhookTestResult> WebhookTestAsync(string webhookId, CancellationToken cancellationToken = default);

    /// <summary>Delete a webhook. DELETE /webhooks/:id</summary>
    Task<RemovedResponse> WebhookDeleteAsync(string webhookId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Verify a webhook delivery's Svix-style signature against your endpoint's
    /// signing secret (HMAC-SHA256 over <c>{id}.{timestamp}.{body}</c>).
    /// <paramref name="payload"/> MUST be the exact raw request body string —
    /// do not re-serialize the parsed JSON. <paramref name="headers"/> takes the
    /// svix-id / svix-timestamp / svix-signature headers (read case-insensitively).
    /// Pure local computation — makes no HTTP request. Also available statically
    /// as <see cref="WebhookSignature.Verify(string, IReadOnlyDictionary{string, string}, string, int)"/>.
    /// </summary>
    /// <param name="payload">The exact raw request body string as received.</param>
    /// <param name="headers">The delivery's headers; svix-id / svix-timestamp / svix-signature are read case-insensitively.</param>
    /// <param name="secret">Your endpoint's signing secret (typically <c>whsec_…</c>).</param>
    /// <param name="toleranceSeconds">Max allowed clock skew in seconds (default 300). Pass 0 to skip the check.</param>
    VerifyWebhookResult WebhookVerify(string payload, IReadOnlyDictionary<string, string> headers, string secret, int toleranceSeconds = 300);
}

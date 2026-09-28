using System.Globalization;

namespace SendPing;

public partial class SendPingClient
{
    // ---- Automations ----

    public Task<Automation> AutomationCreateAsync(AutomationCreateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<Automation>(HttpMethod.Post, "/automations", options, null, cancellationToken);
    }

    public Task<Automation> AutomationRetrieveAsync(string automationId, CancellationToken cancellationToken = default)
        => RequestAsync<Automation>(HttpMethod.Get, $"/automations/{E(automationId)}", null, null, cancellationToken);

    public Task<ListResponse<Automation>> AutomationListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<Automation>>(HttpMethod.Get, "/automations" + Paginate(pagination), null, null, cancellationToken);

    public Task<Automation> AutomationUpdateAsync(string automationId, AutomationUpdateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<Automation>(HttpMethod.Patch, $"/automations/{E(automationId)}", options, null, cancellationToken);
    }

    public Task<AutomationStep> AutomationAddStepAsync(string automationId, AutomationAddStepOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<AutomationStep>(HttpMethod.Post, $"/automations/{E(automationId)}/steps", options, null, cancellationToken);
    }

    public Task<AutomationStep> AutomationUpdateStepAsync(string automationId, string stepId, AutomationUpdateStepOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<AutomationStep>(HttpMethod.Patch, $"/automations/{E(automationId)}/steps/{E(stepId)}", options, null, cancellationToken);
    }

    public Task<AutomationStepDeleted> AutomationDeleteStepAsync(string automationId, string stepId, CancellationToken cancellationToken = default)
        => RequestAsync<AutomationStepDeleted>(HttpMethod.Delete, $"/automations/{E(automationId)}/steps/{E(stepId)}", null, null, cancellationToken);

    public Task<ListResponse<AutomationRun>> AutomationListRunsAsync(string automationId, PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<AutomationRun>>(HttpMethod.Get, $"/automations/{E(automationId)}/runs" + Paginate(pagination), null, null, cancellationToken);

    public Task<ListResponse<AutomationRun>> AutomationListRunsAsync(string automationId, AutomationRunListOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        var statuses = options.Status is null ? null : string.Join(",", options.Status);
        var query = Query(
            ("limit", options.Limit?.ToString(CultureInfo.InvariantCulture)),
            ("after", options.After),
            ("before", options.Before),
            ("status", string.IsNullOrEmpty(statuses) ? null : statuses));
        return RequestAsync<ListResponse<AutomationRun>>(HttpMethod.Get, $"/automations/{E(automationId)}/runs" + query, null, null, cancellationToken);
    }

    public Task<AutomationAiResult> AutomationCreateWithAiAsync(string automationId, AutomationAiOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<AutomationAiResult>(HttpMethod.Post, $"/automations/{E(automationId)}/ai", options, null, cancellationToken);
    }

    public Task<AutomationRun> AutomationRetrieveRunAsync(string automationId, string runId, CancellationToken cancellationToken = default)
        => RequestAsync<AutomationRun>(HttpMethod.Get, $"/automations/{E(automationId)}/runs/{E(runId)}", null, null, cancellationToken);

    public Task<Automation> AutomationStopAsync(string automationId, CancellationToken cancellationToken = default)
        => RequestAsync<Automation>(HttpMethod.Post, $"/automations/{E(automationId)}/stop", null, null, cancellationToken);

    public Task<RemovedResponse> AutomationDeleteAsync(string automationId, CancellationToken cancellationToken = default)
        => RequestAsync<RemovedResponse>(HttpMethod.Delete, $"/automations/{E(automationId)}", null, null, cancellationToken);

    // ---- Events ----

    public Task<EventSendResponse> EventSendAsync(EventSendOptions options, string? idempotencyKey = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<EventSendResponse>(HttpMethod.Post, "/events/send", options, idempotencyKey, cancellationToken);
    }

    public Task<EventDefinition> EventCreateAsync(EventCreateOptions options, string? idempotencyKey = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<EventDefinition>(HttpMethod.Post, "/events", options, idempotencyKey, cancellationToken);
    }

    public Task<ListResponse<EventDefinition>> EventListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<EventDefinition>>(HttpMethod.Get, "/events" + Paginate(pagination), null, null, cancellationToken);

    public Task<EventDefinition> EventUpdateAsync(string eventId, IDictionary<string, string>? schema, CancellationToken cancellationToken = default)
    {
        // Always written, so an explicit null clears the schema.
        var body = new Dictionary<string, object?> { ["schema"] = schema };
        return RequestAsync<EventDefinition>(HttpMethod.Patch, $"/events/{E(eventId)}", body, null, cancellationToken);
    }

    public Task<RemovedResponse> EventDeleteAsync(string eventId, CancellationToken cancellationToken = default)
        => RequestAsync<RemovedResponse>(HttpMethod.Delete, $"/events/{E(eventId)}", null, null, cancellationToken);

    // ---- Webhooks ----

    public Task<WebhookCreated> WebhookCreateAsync(WebhookCreateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<WebhookCreated>(HttpMethod.Post, "/webhooks", options, null, cancellationToken);
    }

    public Task<Webhook> WebhookRetrieveAsync(string webhookId, CancellationToken cancellationToken = default)
        => RequestAsync<Webhook>(HttpMethod.Get, $"/webhooks/{E(webhookId)}", null, null, cancellationToken);

    public Task<ListResponse<Webhook>> WebhookListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<Webhook>>(HttpMethod.Get, "/webhooks" + Paginate(pagination), null, null, cancellationToken);

    public Task<ObjectRef> WebhookUpdateAsync(string webhookId, WebhookUpdateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<ObjectRef>(HttpMethod.Patch, $"/webhooks/{E(webhookId)}", options, null, cancellationToken);
    }

    public Task<WebhookCreated> WebhookRotateAsync(string webhookId, CancellationToken cancellationToken = default)
        => RequestAsync<WebhookCreated>(HttpMethod.Post, $"/webhooks/{E(webhookId)}/rotate", null, null, cancellationToken);

    public Task<WebhookTestResult> WebhookTestAsync(string webhookId, CancellationToken cancellationToken = default)
        => RequestAsync<WebhookTestResult>(HttpMethod.Post, $"/webhooks/{E(webhookId)}/test", null, null, cancellationToken);

    public Task<RemovedResponse> WebhookDeleteAsync(string webhookId, CancellationToken cancellationToken = default)
        => RequestAsync<RemovedResponse>(HttpMethod.Delete, $"/webhooks/{E(webhookId)}", null, null, cancellationToken);

    public VerifyWebhookResult WebhookVerify(string payload, IReadOnlyDictionary<string, string> headers, string secret, int toleranceSeconds = 300)
        => WebhookSignature.Verify(payload, headers, secret, toleranceSeconds);
}

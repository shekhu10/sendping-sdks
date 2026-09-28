using System.Globalization;

namespace SendPing;

public partial class SendPingClient
{
    // ---- Emails ----

    public async Task<EmailCreated> EmailSendAsync(EmailMessage message, string? idempotencyKey = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(message);
        return await RequestAsync<EmailCreated>(HttpMethod.Post, "/emails", message, idempotencyKey, cancellationToken).ConfigureAwait(false);
    }

    [Obsolete("Use the BatchEmailMessage overload — batch items reject attachments and scheduled_at (send those individually via EmailSendAsync), which BatchEmailMessage enforces at compile time.")]
    public async Task<List<EmailCreated>> EmailBatchAsync(IEnumerable<EmailMessage> messages, string? idempotencyKey = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(messages);
        var payload = messages as IList<EmailMessage> ?? messages.ToList();
        var response = await RequestAsync<BatchSendResponse>(HttpMethod.Post, "/emails/batch", payload, idempotencyKey, cancellationToken).ConfigureAwait(false);
        return response.Data;
    }

    public async Task<List<EmailCreated>> EmailBatchAsync(IEnumerable<BatchEmailMessage> messages, string? idempotencyKey = null, CancellationToken cancellationToken = default)
        => (await EmailBatchSendAsync(messages, idempotencyKey, cancellationToken).ConfigureAwait(false)).Data;

    public Task<BatchSendResponse> EmailBatchSendAsync(IEnumerable<BatchEmailMessage> messages, string? idempotencyKey = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(messages);
        var payload = messages as IList<BatchEmailMessage> ?? messages.ToList();
        return RequestAsync<BatchSendResponse>(HttpMethod.Post, "/emails/batch", payload, idempotencyKey, cancellationToken);
    }

    public Task<ListResponse<SentEmailListItem>> EmailListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<SentEmailListItem>>(HttpMethod.Get, "/emails" + Paginate(pagination), null, null, cancellationToken);

    public Task<ListResponse<SentEmailListItem>> EmailListAsync(EmailListOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        var query = Query(
            ("limit", options.Limit?.ToString(CultureInfo.InvariantCulture)),
            ("after", options.After),
            ("before", options.Before),
            ("campaign_id", options.CampaignId),
            ("automation_id", options.AutomationId),
            ("source", options.Source),
            ("domain_id", options.DomainId),
            ("status", options.Status),
            ("search", options.Search),
            ("folder", options.Folder));
        return RequestAsync<ListResponse<SentEmailListItem>>(HttpMethod.Get, "/emails" + query, null, null, cancellationToken);
    }

    public Task<ListResponse<EmailSource>> EmailListSourcesAsync(CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<EmailSource>>(HttpMethod.Get, "/emails/sources", null, null, cancellationToken);

    public Task<Email> EmailRetrieveAsync(string emailId, CancellationToken cancellationToken = default)
        => RequestAsync<Email>(HttpMethod.Get, $"/emails/{E(emailId)}", null, null, cancellationToken);

    public Task<ListResponse<AttachmentMeta>> EmailListAttachmentsAsync(string emailId, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<AttachmentMeta>>(HttpMethod.Get, $"/emails/{E(emailId)}/attachments", null, null, cancellationToken);

    public Task<AttachmentMeta> EmailRetrieveAttachmentAsync(string emailId, string attachmentId, CancellationToken cancellationToken = default)
        => RequestAsync<AttachmentMeta>(HttpMethod.Get, $"/emails/{E(emailId)}/attachments/{E(attachmentId)}", null, null, cancellationToken);

    public Task<ObjectRef> EmailUpdateAsync(string emailId, string scheduledAt, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(scheduledAt);
        var body = new Dictionary<string, string> { ["scheduled_at"] = scheduledAt };
        return RequestAsync<ObjectRef>(HttpMethod.Patch, $"/emails/{E(emailId)}", body, null, cancellationToken);
    }

    public Task<ObjectRef> EmailCancelAsync(string emailId, CancellationToken cancellationToken = default)
        => RequestAsync<ObjectRef>(HttpMethod.Post, $"/emails/{E(emailId)}/cancel", null, null, cancellationToken);

    // ---- Received (inbound) emails ----

    public Task<ListResponse<ReceivedEmail>> ReceivedEmailListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<ReceivedEmail>>(HttpMethod.Get, "/emails/receiving" + Paginate(pagination), null, null, cancellationToken);

    public Task<ListResponse<ReceivedEmail>> ReceivedEmailListAsync(ReceivedEmailListOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        var query = Query(
            ("limit", options.Limit?.ToString(CultureInfo.InvariantCulture)),
            ("after", options.After),
            ("before", options.Before),
            ("received_for", options.ReceivedFor));
        return RequestAsync<ListResponse<ReceivedEmail>>(HttpMethod.Get, "/emails/receiving" + query, null, null, cancellationToken);
    }

    public Task<ListResponse<ReceivingAddressStats>> ReceivedEmailListAddressesAsync(CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<ReceivingAddressStats>>(HttpMethod.Get, "/emails/receiving/addresses", null, null, cancellationToken);

    public Task<ReceivedEmail> ReceivedEmailRetrieveAsync(string receivedEmailId, CancellationToken cancellationToken = default)
        => RequestAsync<ReceivedEmail>(HttpMethod.Get, $"/emails/receiving/{E(receivedEmailId)}", null, null, cancellationToken);

    public Task<ListResponse<ReceivedAttachment>> ReceivedEmailListAttachmentsAsync(string receivedEmailId, PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<ReceivedAttachment>>(HttpMethod.Get, $"/emails/receiving/{E(receivedEmailId)}/attachments" + Paginate(pagination), null, null, cancellationToken);

    public Task<byte[]> ReceivedEmailGetAttachmentAsync(string receivedEmailId, string attachmentId, CancellationToken cancellationToken = default)
        => RequestBytesAsync(HttpMethod.Get, $"/emails/receiving/{E(receivedEmailId)}/attachments/{E(attachmentId)}", cancellationToken);

    public Task<byte[]> ReceivedEmailGetRawAsync(string receivedEmailId, CancellationToken cancellationToken = default)
        => RequestBytesAsync(HttpMethod.Get, $"/emails/receiving/{E(receivedEmailId)}/raw", cancellationToken);

    public Task<EmailCreated> ReceivedEmailForwardAsync(string receivedEmailId, ReceivedEmailForwardOptions options, CancellationToken cancellationToken = default)
        => ReceivedEmailForwardWithIdempotencyKeyAsync(receivedEmailId, options, null, cancellationToken);

    public Task<EmailCreated> ReceivedEmailForwardWithIdempotencyKeyAsync(string receivedEmailId, ReceivedEmailForwardOptions options, string? idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<EmailCreated>(HttpMethod.Post, $"/emails/receiving/{E(receivedEmailId)}/forward", options, idempotencyKey, cancellationToken);
    }

    public Task<EmailCreated> ReceivedEmailReplyAsync(string receivedEmailId, ReceivedEmailReplyOptions options, CancellationToken cancellationToken = default)
        => ReceivedEmailReplyWithIdempotencyKeyAsync(receivedEmailId, options, null, cancellationToken);

    public Task<EmailCreated> ReceivedEmailReplyWithIdempotencyKeyAsync(string receivedEmailId, ReceivedEmailReplyOptions options, string? idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<EmailCreated>(HttpMethod.Post, $"/emails/receiving/{E(receivedEmailId)}/reply", options, idempotencyKey, cancellationToken);
    }

    public Task<RemovedResponse> ReceivedEmailDeleteAsync(string receivedEmailId, CancellationToken cancellationToken = default)
        => RequestAsync<RemovedResponse>(HttpMethod.Delete, $"/emails/receiving/{E(receivedEmailId)}", null, null, cancellationToken);
}

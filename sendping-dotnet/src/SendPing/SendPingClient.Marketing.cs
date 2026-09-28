namespace SendPing;

public partial class SendPingClient
{
    // ---- Campaigns ----

    public Task<IdResponse> CampaignCreateAsync(CampaignCreateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<IdResponse>(HttpMethod.Post, "/campaigns", options, null, cancellationToken);
    }

    public Task<Campaign> CampaignRetrieveAsync(string campaignId, CancellationToken cancellationToken = default)
        => RequestAsync<Campaign>(HttpMethod.Get, $"/campaigns/{E(campaignId)}", null, null, cancellationToken);

    public Task<ListResponse<CampaignListItem>> CampaignListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<CampaignListItem>>(HttpMethod.Get, "/campaigns" + Paginate(pagination), null, null, cancellationToken);

    public Task<IdResponse> CampaignUpdateAsync(string campaignId, CampaignUpdateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<IdResponse>(HttpMethod.Patch, $"/campaigns/{E(campaignId)}", options, null, cancellationToken);
    }

    public Task<IdResponse> CampaignSendAsync(string campaignId, string? scheduledAt = null, CancellationToken cancellationToken = default)
    {
        var body = new Dictionary<string, string>();
        if (scheduledAt is not null) body["scheduled_at"] = scheduledAt;
        return RequestAsync<IdResponse>(HttpMethod.Post, $"/campaigns/{E(campaignId)}/send", body, null, cancellationToken);
    }

    public Task<IdResponse> CampaignSendAsync(string campaignId, CampaignSendOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<IdResponse>(HttpMethod.Post, $"/campaigns/{E(campaignId)}/send", options, null, cancellationToken);
    }

    public Task<Campaign> CampaignCancelAsync(string campaignId, CancellationToken cancellationToken = default)
        => RequestAsync<Campaign>(HttpMethod.Post, $"/campaigns/{E(campaignId)}/cancel", null, null, cancellationToken);

    public Task<CampaignStats> CampaignRetrieveStatsAsync(string campaignId, CancellationToken cancellationToken = default)
        => RequestAsync<CampaignStats>(HttpMethod.Get, $"/campaigns/{E(campaignId)}/stats", null, null, cancellationToken);

    public Task<CampaignEngagement> CampaignRetrieveEngagementAsync(string campaignId, CancellationToken cancellationToken = default)
        => RequestAsync<CampaignEngagement>(HttpMethod.Get, $"/campaigns/{E(campaignId)}/engagement", null, null, cancellationToken);

    public Task<CampaignAbResult> CampaignRetrieveAbResultAsync(string campaignId, CancellationToken cancellationToken = default)
        => RequestAsync<CampaignAbResult>(HttpMethod.Get, $"/campaigns/{E(campaignId)}/ab", null, null, cancellationToken);

    public Task<RemovedResponse> CampaignDeleteAsync(string campaignId, CancellationToken cancellationToken = default)
        => RequestAsync<RemovedResponse>(HttpMethod.Delete, $"/campaigns/{E(campaignId)}", null, null, cancellationToken);

    // ---- Segments ----

    public Task<Segment> SegmentCreateAsync(SegmentCreateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<Segment>(HttpMethod.Post, "/segments", options, null, cancellationToken);
    }

    public Task<Segment> SegmentRetrieveAsync(string segmentId, CancellationToken cancellationToken = default)
        => RequestAsync<Segment>(HttpMethod.Get, $"/segments/{E(segmentId)}", null, null, cancellationToken);

    public Task<ListResponse<Segment>> SegmentListAsync(string domain, PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(domain);
        var query = Query(
            ("domain", domain),
            ("limit", pagination?.Limit?.ToString(System.Globalization.CultureInfo.InvariantCulture)),
            ("after", pagination?.After),
            ("before", pagination?.Before));
        return RequestAsync<ListResponse<Segment>>(HttpMethod.Get, "/segments" + query, null, null, cancellationToken);
    }

    public Task<ListResponse<SegmentContact>> SegmentListContactsAsync(string segmentId, PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<SegmentContact>>(HttpMethod.Get, $"/segments/{E(segmentId)}/contacts" + Paginate(pagination), null, null, cancellationToken);

    public Task<Segment> SegmentUpdateAsync(string segmentId, SegmentUpdateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<Segment>(HttpMethod.Patch, $"/segments/{E(segmentId)}", options, null, cancellationToken);
    }

    public Task<RemovedResponse> SegmentDeleteAsync(string segmentId, CancellationToken cancellationToken = default)
        => RequestAsync<RemovedResponse>(HttpMethod.Delete, $"/segments/{E(segmentId)}", null, null, cancellationToken);

    // ---- Topics ----

    public Task<Topic> TopicCreateAsync(TopicCreateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<Topic>(HttpMethod.Post, "/topics", options, null, cancellationToken);
    }

    public Task<Topic> TopicRetrieveAsync(string topicId, CancellationToken cancellationToken = default)
        => RequestAsync<Topic>(HttpMethod.Get, $"/topics/{E(topicId)}", null, null, cancellationToken);

    public Task<ListResponse<Topic>> TopicListAsync(string domain, PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(domain);
        var query = Query(
            ("domain", domain),
            ("limit", pagination?.Limit?.ToString(System.Globalization.CultureInfo.InvariantCulture)),
            ("after", pagination?.After),
            ("before", pagination?.Before));
        return RequestAsync<ListResponse<Topic>>(HttpMethod.Get, "/topics" + query, null, null, cancellationToken);
    }

    public Task<Topic> TopicUpdateAsync(string topicId, TopicUpdateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<Topic>(HttpMethod.Patch, $"/topics/{E(topicId)}", options, null, cancellationToken);
    }

    public Task<RemovedResponse> TopicDeleteAsync(string topicId, CancellationToken cancellationToken = default)
        => RequestAsync<RemovedResponse>(HttpMethod.Delete, $"/topics/{E(topicId)}", null, null, cancellationToken);

    // ---- Templates ----

    public Task<ObjectRef> TemplateCreateAsync(TemplateCreateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<ObjectRef>(HttpMethod.Post, "/templates", options, null, cancellationToken);
    }

    public Task<Template> TemplateRetrieveAsync(string templateId, CancellationToken cancellationToken = default)
        => RequestAsync<Template>(HttpMethod.Get, $"/templates/{E(templateId)}", null, null, cancellationToken);

    public Task<ListResponse<TemplateListItem>> TemplateListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<TemplateListItem>>(HttpMethod.Get, "/templates" + Paginate(pagination), null, null, cancellationToken);

    public Task<ObjectRef> TemplateUpdateAsync(string templateId, TemplateUpdateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<ObjectRef>(HttpMethod.Patch, $"/templates/{E(templateId)}", options, null, cancellationToken);
    }

    public Task<ObjectRef> TemplateDuplicateAsync(string templateId, TemplateDuplicateOptions? options = null, CancellationToken cancellationToken = default)
        => RequestAsync<ObjectRef>(HttpMethod.Post, $"/templates/{E(templateId)}/duplicate", options ?? new TemplateDuplicateOptions(), null, cancellationToken);

    public Task<ObjectRef> TemplatePublishAsync(string templateId, CancellationToken cancellationToken = default)
        => RequestAsync<ObjectRef>(HttpMethod.Post, $"/templates/{E(templateId)}/publish", null, null, cancellationToken);

    public Task<RemovedResponse> TemplateDeleteAsync(string templateId, CancellationToken cancellationToken = default)
        => RequestAsync<RemovedResponse>(HttpMethod.Delete, $"/templates/{E(templateId)}", null, null, cancellationToken);
}

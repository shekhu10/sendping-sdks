namespace SendPing;

public partial interface ISendPing
{
    // ---- Campaigns (domain-first) ----

    /// <summary>Create a campaign. <c>options.Domain</c> is REQUIRED (names the contact pool it targets). POST /campaigns</summary>
    Task<IdResponse> CampaignCreateAsync(CampaignCreateOptions options, CancellationToken cancellationToken = default);

    /// <summary>Retrieve a campaign (includes statistics/followups/list_address). GET /campaigns/:id</summary>
    Task<Campaign> CampaignRetrieveAsync(string campaignId, CancellationToken cancellationToken = default);

    /// <summary>
    /// List campaigns. Rows are the trimmed <see cref="CampaignListItem"/> — no
    /// bodies, follow-ups, recurrence or statistics; use
    /// <see cref="CampaignRetrieveAsync"/> for those. GET /campaigns
    /// </summary>
    Task<ListResponse<CampaignListItem>> CampaignListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    /// <summary>Update a draft campaign. PATCH /campaigns/:id</summary>
    Task<IdResponse> CampaignUpdateAsync(string campaignId, CampaignUpdateOptions options, CancellationToken cancellationToken = default);

    /// <summary>Send a campaign now, or schedule it with <paramref name="scheduledAt"/>. POST /campaigns/:id/send</summary>
    /// <param name="campaignId">Id of the campaign to send.</param>
    /// <param name="scheduledAt">ISO 8601 (or natural-language) schedule; null sends immediately.</param>
    /// <param name="cancellationToken">Token to cancel the request.</param>
    Task<IdResponse> CampaignSendAsync(string campaignId, string? scheduledAt = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Send (or schedule) a campaign with <see cref="CampaignSendOptions"/> —
    /// <c>scheduled_at</c> plus an optional IANA <c>schedule_timezone</c>,
    /// persisted onto the campaign so daily batching evaluates batch-days in
    /// that zone. POST /campaigns/:id/send
    /// </summary>
    Task<IdResponse> CampaignSendAsync(string campaignId, CampaignSendOptions options, CancellationToken cancellationToken = default);

    /// <summary>
    /// Stop a campaign before it finishes fanning out. Accepted only on
    /// <c>scheduled</c>, <c>recurring</c>, <c>paused</c> and <c>queued</c>; any
    /// other status is a 422. POST /campaigns/:id/cancel
    /// <para>
    /// The resulting status depends on how far the send got, so read
    /// <see cref="Campaign.Status"/> rather than assuming:
    /// </para>
    /// <list type="bullet">
    ///   <item><description><c>scheduled</c> / <c>recurring</c> / <c>paused</c> →
    ///   back to <c>draft</c>: nothing was mailed, so it can be edited and
    ///   re-sent.</description></item>
    ///   <item><description><c>queued</c> (already fanning out) →
    ///   <c>canceled</c>, which is TERMINAL. Part of the audience has been
    ///   mailed and those copies cannot be recalled; what this stops is every
    ///   remaining recipient (for a staggered campaign, every future batch-day).
    ///   A canceled campaign can NOT be re-sent.</description></item>
    /// </list>
    /// </summary>
    Task<Campaign> CampaignCancelAsync(string campaignId, CancellationToken cancellationToken = default);

    /// <summary>Per-campaign analytics (counts, engagement rates, top links). GET /campaigns/:id/stats</summary>
    Task<CampaignStats> CampaignRetrieveStatsAsync(string campaignId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Per-recipient engagement (who opened / clicked / replied). Not paginated —
    /// each list is capped at 500 rows. GET /campaigns/:id/engagement
    /// </summary>
    Task<CampaignEngagement> CampaignRetrieveEngagementAsync(string campaignId, CancellationToken cancellationToken = default);

    /// <summary>A/B winner evaluation for an A/B campaign. GET /campaigns/:id/ab</summary>
    Task<CampaignAbResult> CampaignRetrieveAbResultAsync(string campaignId, CancellationToken cancellationToken = default);

    /// <summary>Delete a campaign. DELETE /campaigns/:id</summary>
    Task<RemovedResponse> CampaignDeleteAsync(string campaignId, CancellationToken cancellationToken = default);

    // ---- Segments (domain-first) ----

    /// <summary>
    /// Create a segment on a sending domain. <c>options.Domain</c> is REQUIRED;
    /// segment names are unique within a domain. POST /segments
    /// </summary>
    Task<Segment> SegmentCreateAsync(SegmentCreateOptions options, CancellationToken cancellationToken = default);

    /// <summary>Retrieve a segment. GET /segments/:id</summary>
    Task<Segment> SegmentRetrieveAsync(string segmentId, CancellationToken cancellationToken = default);

    /// <summary>
    /// List a domain's segments (<paramref name="domain"/> is REQUIRED; includes
    /// its auto-created "General" segment). GET /segments?domain=…
    /// </summary>
    Task<ListResponse<Segment>> SegmentListAsync(string domain, PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Preview the contacts a segment currently resolves to (filter matches plus
    /// explicit members). Rows are the REDUCED <see cref="SegmentContact"/> shape.
    /// With no pagination options the API answers in one response, capped at
    /// 1,000 rows with <c>HasMore</c> reporting the truncation — page with
    /// <c>After</c> for a larger segment. GET /segments/:id/contacts
    /// </summary>
    Task<ListResponse<SegmentContact>> SegmentListContactsAsync(string segmentId, PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    /// <summary>Update a segment. PATCH /segments/:id</summary>
    Task<Segment> SegmentUpdateAsync(string segmentId, SegmentUpdateOptions options, CancellationToken cancellationToken = default);

    /// <summary>Delete a segment. DELETE /segments/:id</summary>
    Task<RemovedResponse> SegmentDeleteAsync(string segmentId, CancellationToken cancellationToken = default);

    // ---- Topics (domain-first) ----

    /// <summary>Create a topic on a sending domain. <c>options.Domain</c> is REQUIRED. POST /topics</summary>
    Task<Topic> TopicCreateAsync(TopicCreateOptions options, CancellationToken cancellationToken = default);

    /// <summary>Retrieve a topic. GET /topics/:id</summary>
    Task<Topic> TopicRetrieveAsync(string topicId, CancellationToken cancellationToken = default);

    /// <summary>List a domain's topics (<paramref name="domain"/> is REQUIRED). GET /topics?domain=…</summary>
    Task<ListResponse<Topic>> TopicListAsync(string domain, PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    /// <summary>Update a topic. PATCH /topics/:id</summary>
    Task<Topic> TopicUpdateAsync(string topicId, TopicUpdateOptions options, CancellationToken cancellationToken = default);

    /// <summary>Delete a topic. DELETE /topics/:id</summary>
    Task<RemovedResponse> TopicDeleteAsync(string topicId, CancellationToken cancellationToken = default);

    // ---- Templates ----

    /// <summary>Create a template. POST /templates</summary>
    Task<ObjectRef> TemplateCreateAsync(TemplateCreateOptions options, CancellationToken cancellationToken = default);

    /// <summary>Retrieve a template. GET /templates/:id</summary>
    Task<Template> TemplateRetrieveAsync(string templateId, CancellationToken cancellationToken = default);

    /// <summary>
    /// List templates. Rows are the trimmed <see cref="TemplateListItem"/> — no
    /// <c>from</c>/<c>reply_to</c>/<c>text</c>/<c>variables</c>; use
    /// <see cref="TemplateRetrieveAsync"/> for those. GET /templates
    /// </summary>
    Task<ListResponse<TemplateListItem>> TemplateListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    /// <summary>Update a template (creates a new draft version). PATCH /templates/:id</summary>
    Task<ObjectRef> TemplateUpdateAsync(string templateId, TemplateUpdateOptions options, CancellationToken cancellationToken = default);

    /// <summary>Duplicate a template. POST /templates/:id/duplicate</summary>
    Task<ObjectRef> TemplateDuplicateAsync(string templateId, TemplateDuplicateOptions? options = null, CancellationToken cancellationToken = default);

    /// <summary>Publish a template (make its latest draft live). POST /templates/:id/publish</summary>
    Task<ObjectRef> TemplatePublishAsync(string templateId, CancellationToken cancellationToken = default);

    /// <summary>Delete a template. DELETE /templates/:id</summary>
    Task<RemovedResponse> TemplateDeleteAsync(string templateId, CancellationToken cancellationToken = default);
}

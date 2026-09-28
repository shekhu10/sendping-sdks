using System.Net;
using System.Reflection;
using System.Text.Json;
using Xunit;

namespace SendPing.Tests;

public class SendPingClientTests
{
    private static (ISendPing Client, StubHttpMessageHandler Stub) CreateClient(string responseBody = "{}", HttpStatusCode status = HttpStatusCode.OK)
    {
        var stub = new StubHttpMessageHandler { ResponseBody = responseBody, StatusCode = status };
        var client = SendPingClient.Create("mb_test_key", new SendPingClientOptions { HttpMessageHandler = stub });
        return (client, stub);
    }

    [Fact]
    public void Create_RequiresApiKey()
    {
        Assert.Throws<ArgumentException>(() => SendPingClient.Create(""));
        Assert.Throws<ArgumentException>(() => SendPingClient.Create("  "));
    }

    [Fact]
    public async Task EmailSend_PostsToEmailsWithBearerAndSnakeCaseBody()
    {
        var (client, stub) = CreateClient("""{"id":"em_123"}""");

        var created = await client.EmailSendAsync(new EmailMessage
        {
            From = "Acme <hello@acme.com>",
            To = "user@example.com",
            Subject = "Hi",
            HtmlBody = "<p>Hi</p>",
            PreviewText = "peek",
        }, idempotencyKey: "order-1");

        Assert.Equal("em_123", created.Id);
        Assert.Equal(HttpMethod.Post, stub.LastRequest.Method);
        Assert.Equal("https://www.sendping.co/api/emails", stub.LastRequest.RequestUri!.AbsoluteUri);
        Assert.Equal("Bearer", stub.LastRequest.Headers.Authorization!.Scheme);
        Assert.Equal("mb_test_key", stub.LastRequest.Headers.Authorization!.Parameter);
        Assert.Contains("order-1", stub.LastRequest.Headers.GetValues("Idempotency-Key"));

        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        Assert.Equal("Acme <hello@acme.com>", body.RootElement.GetProperty("from").GetString());
        Assert.Equal("user@example.com", body.RootElement.GetProperty("to")[0].GetString());
        Assert.Equal("<p>Hi</p>", body.RootElement.GetProperty("html").GetString());
        Assert.Equal("peek", body.RootElement.GetProperty("preview_text").GetString());
        // Null members are omitted.
        Assert.False(body.RootElement.TryGetProperty("text", out _));
    }

    [Fact]
    public async Task EverySendCarriesANonEmptyUserAgent()
    {
        // A missing/blank User-Agent is a hard 403 validation_error on every
        // gated route, so the header must ride on every request.
        var (client, stub) = CreateClient("""{"object":"list","has_more":false,"data":[]}""");

        await client.DomainListAsync();

        var userAgent = stub.LastRequest.Headers.GetValues("User-Agent").Single();
        Assert.False(string.IsNullOrWhiteSpace(userAgent));
        Assert.Equal($"sendping-dotnet/{SendPingClient.Version}", userAgent);
    }

    [Fact]
    public async Task IdempotencyKey_IsSentVerbatimAndBoundedByTheServer()
    {
        var (client, stub) = CreateClient("""{"id":"em_123"}""");
        var message = new EmailMessage { From = "a@b.com", To = "user@example.com", Subject = "Hi" };

        // 255 is the documented maximum (api_idempotency.key is VARCHAR(255)).
        Assert.Equal(255, SendPingClient.MaxIdempotencyKeyLength);
        await client.EmailSendAsync(message, idempotencyKey: new string('k', 255));
        Assert.Contains(new string('k', 255), stub.LastRequest.Headers.GetValues("Idempotency-Key"));

        // Out-of-range keys are the SERVER's to reject (400 invalid_idempotency_key):
        // this client neither trims nor length-checks, so the values go out as given.
        // Every SendPing SDK behaves the same way.
        await client.EmailSendAsync(message, idempotencyKey: new string('k', 256));
        Assert.Contains(new string('k', 256), stub.LastRequest.Headers.GetValues("Idempotency-Key"));

        await client.EmailSendAsync(message, idempotencyKey: "  order-1  ");
        Assert.Contains("  order-1  ", stub.LastRequest.Headers.GetValues("Idempotency-Key"));

        Assert.Equal(3, stub.Requests.Count);
    }

    [Fact]
    public async Task IdempotencyKey_NullOrEmpty_SendsNoHeader()
    {
        var (client, stub) = CreateClient("""{"id":"em_123"}""");
        var message = new EmailMessage { From = "a@b.com", To = "user@example.com", Subject = "Hi" };

        await client.EmailSendAsync(message);
        Assert.False(stub.LastRequest.Headers.Contains("Idempotency-Key"));

        await client.EmailSendAsync(message, idempotencyKey: "");
        Assert.False(stub.LastRequest.Headers.Contains("Idempotency-Key"));
    }

    [Fact]
    public async Task EmailList_BuildsStatusAndSearchFilters()
    {
        var (client, stub) = CreateClient("""{"object":"list","has_more":false,"data":[]}""");

        await client.EmailListAsync(new EmailListOptions
        {
            Limit = 50,
            Status = "bounced",
            Search = "invoice #7",
            DomainId = "dom_1",
        });

        Assert.Equal(
            "https://www.sendping.co/api/emails?limit=50&domain_id=dom_1&status=bounced&search=invoice%20%237",
            stub.LastRequest.RequestUri!.AbsoluteUri);
    }

    [Fact]
    public async Task EmailList_BuildsTheFolderFilter()
    {
        var (client, stub) = CreateClient("""{"object":"list","has_more":false,"data":[]}""");

        // The server accepts exactly the EmailFolders values and 422s anything else.
        await client.EmailListAsync(new EmailListOptions { Folder = EmailFolders.Scheduled });

        Assert.Equal(
            "https://www.sendping.co/api/emails?folder=scheduled",
            stub.LastRequest.RequestUri!.AbsoluteUri);
    }

    [Fact]
    public async Task EmailList_MapsOriginAndDomainColumns()
    {
        var (client, _) = CreateClient("""
            {"object":"list","has_more":false,"data":[{"id":"em_1","object":"email","from":"a@b.com",
             "to":["x@y.com"],"domain_id":"dom_1","campaign_id":"cmp_1","automation_id":null,
             "last_event":"delivered","created_at":"2026-08-08T10:00:00.000Z"}]}
            """);

        var list = await client.EmailListAsync();

        var row = Assert.Single(list.Data);
        Assert.Equal("dom_1", row.DomainId);
        Assert.Equal("cmp_1", row.CampaignId);
        Assert.Null(row.AutomationId);
    }

    [Fact]
    public async Task EmailListSources_HitsTheUnpaginatedRollup()
    {
        var (client, stub) = CreateClient("""
            {"object":"list","has_more":false,"data":[{"kind":"campaign","id":"cmp_1","name":"Launch",
             "subject":"Hi","status":"sent","total":10,"sent":10,"delivered":9,"opened":4,"clicked":1,
             "replied":0,"failed":0,"last_sent_at":"2026-08-08T10:00:00.000Z"}]}
            """);

        var sources = await client.EmailListSourcesAsync();

        Assert.Equal("https://www.sendping.co/api/emails/sources", stub.LastRequest.RequestUri!.AbsoluteUri);
        Assert.Equal("campaign", sources.Data[0].Kind);
        Assert.Equal(9, sources.Data[0].Delivered);
    }

    [Fact]
    public async Task ReceivedEmailListAddresses_HitsTheAddressesRoute()
    {
        var (client, stub) = CreateClient("""
            {"object":"list","has_more":false,"data":[{"address":"hi@x.com","total":12,"replies":3,
             "interested":1,"last_received_at":"2026-08-08T10:00:00.000Z"}]}
            """);

        var addresses = await client.ReceivedEmailListAddressesAsync();

        Assert.Equal("https://www.sendping.co/api/emails/receiving/addresses", stub.LastRequest.RequestUri!.AbsoluteUri);
        Assert.Equal(3, addresses.Data[0].Replies);
    }

    [Fact]
    public async Task ContactDelete_ReadsTheIdField()
    {
        // The API answers { object, id, deleted } — never a `contact` key.
        var (client, _) = CreateClient("""{"object":"contact","id":"con_1","deleted":true}""");

        var deleted = await client.ContactDeleteAsync("con_1");

        Assert.Equal("con_1", deleted.Id);
        Assert.True(deleted.Deleted);
    }

    [Fact]
    public async Task ApiKeyList_GetsTheKeyInventory()
    {
        var (client, stub) = CreateClient("""{"object":"list","has_more":false,"data":[{"id":"42","name":"CI","token":"mb_ab12","permission":"sending_access","created_at":"2026-01-01T00:00:00Z"}]}""");

        var keys = await client.ApiKeyListAsync(new PaginationOptions { Limit = 5 });

        Assert.Equal(HttpMethod.Get, stub.LastRequest.Method);
        Assert.Equal("https://www.sendping.co/api/api-keys?limit=5", stub.LastRequest.RequestUri!.AbsoluteUri);
        // `token` is only the display prefix — the full secret never leaves the dashboard.
        Assert.Equal("mb_ab12", keys.Data[0].Token);
    }

    [Fact]
    public void ApiKeys_AreListOnly_LifecycleIsDashboardOnly()
    {
        // Creating, re-scoping and revoking a key require a signed-in dashboard
        // session, so the SDK offers no method for them: a leaked key cannot
        // mint itself a replacement, widen its permission, or revoke other keys.
        // The option/response types for those calls are gone too, which C#
        // enforces at compile time — this guards the public surface itself.
        // Both types are swept: SendPingClient is public with a public
        // constructor, so a write method added there would be callable even if
        // it never reached ISendPing.
        foreach (var surface in new[] { typeof(ISendPing), typeof(SendPingClient) })
        {
            var apiKeyMethods = surface.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly)
                .Select(m => m.Name)
                .Where(n => n.StartsWith("ApiKey", StringComparison.Ordinal))
                .Distinct()
                .OrderBy(n => n, StringComparer.Ordinal)
                .ToArray();

            Assert.Equal(new[] { "ApiKeyListAsync" }, apiKeyMethods);
        }
    }

    [Fact]
    public async Task EventUpdate_PatchesAndCanClearTheSchema()
    {
        var (client, stub) = CreateClient("""{"object":"event","id":"evt_1","name":"signup","schema":null,"created_at":"2026-01-01T00:00:00Z"}""");

        await client.EventUpdateAsync("evt_1", null);

        Assert.Equal(HttpMethod.Patch, stub.LastRequest.Method);
        Assert.Equal("https://www.sendping.co/api/events/evt_1", stub.LastRequest.RequestUri!.AbsoluteUri);
        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        Assert.Equal(JsonValueKind.Null, body.RootElement.GetProperty("schema").ValueKind);
        // The name is immutable — it must never be sent.
        Assert.False(body.RootElement.TryGetProperty("name", out _));
    }

    [Fact]
    public async Task AutomationListRuns_JoinsStatusFilterWithCommas()
    {
        var (client, stub) = CreateClient("""{"object":"list","has_more":false,"data":[]}""");

        await client.AutomationListRunsAsync("auto_1", new AutomationRunListOptions
        {
            Limit = 25,
            Status = new[] { "failed", "running" },
        });

        Assert.Equal(
            "https://www.sendping.co/api/automations/auto_1/runs?limit=25&status=failed%2Crunning",
            stub.LastRequest.RequestUri!.AbsoluteUri);
    }

    [Fact]
    public void AutomationUpdateStep_OptionsExposeNoKey_TheGraphKeyIsCreateOnly()
    {
        // PATCH /automations/:id/steps/:stepId forwards only `type` and `config`
        // to storage so connection edges that reference the step keep working.
        // A `key` sent on PATCH is silently dropped and the 200 response echoes
        // the STORED key back, which reads as a re-key that never happened —
        // so the update payload must not offer the member at all. Both surfaces
        // are swept: SendPingClient is public with a public constructor, so a
        // stale signature there would be callable even if ISendPing is clean.
        foreach (var surface in new[] { typeof(ISendPing), typeof(SendPingClient) })
        {
            var optionsType = surface
                .GetMethod(nameof(ISendPing.AutomationUpdateStepAsync))!
                .GetParameters()[2]
                .ParameterType;

            Assert.Null(optionsType.GetProperty("Key"));
            Assert.NotNull(optionsType.GetProperty("Type"));
            Assert.NotNull(optionsType.GetProperty("Config"));
        }

        // The append payload keeps it: POST is the only place a key is honoured.
        Assert.NotNull(typeof(AutomationAddStepOptions).GetProperty("Key"));
    }

    [Fact]
    public async Task AutomationUpdateStep_SendsTypeAlongsideConfig()
    {
        // The route runs the same validator as POST: a body without a `type` is
        // coerced to "" and rejected as 422 validation_error before config is
        // read. The update is a wholesale replace, never a merge, so the
        // current type rides along even when only the config is changing.
        var (client, stub) = CreateClient("""{"id":"step_1","key":"welcome","type":"delay","position":0,"config":{"duration":"2 days"}}""");

        await client.AutomationUpdateStepAsync("auto_1", "step_1", new AutomationUpdateStepOptions
        {
            Type = "delay",
            Config = new Dictionary<string, object?> { ["duration"] = "2 days" },
        });

        Assert.Equal(HttpMethod.Patch, stub.LastRequest.Method);
        Assert.Equal("https://www.sendping.co/api/automations/auto_1/steps/step_1", stub.LastRequest.RequestUri!.AbsoluteUri);
        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        Assert.Equal("delay", body.RootElement.GetProperty("type").GetString());
        Assert.Equal("2 days", body.RootElement.GetProperty("config").GetProperty("duration").GetString());
        Assert.False(body.RootElement.TryGetProperty("key", out _));
    }

    [Fact]
    public async Task DomainMxCheck_PassesTheNameQuery()
    {
        var (client, stub) = CreateClient("""{"has_mx":true,"ours":false,"records":[{"exchange":"mx.example.com","priority":10}]}""");

        var result = await client.DomainMxCheckAsync("example.com");

        Assert.Equal("https://www.sendping.co/api/domains/mx-check?name=example.com", stub.LastRequest.RequestUri!.AbsoluteUri);
        Assert.True(result.HasMx);
        Assert.False(result.Ours);
        Assert.Equal(10, result.Records[0].Priority);
    }

    [Fact]
    public async Task DomainRetrieveRecordsCsv_ReturnsRawText()
    {
        var stub = new StubHttpMessageHandler
        {
            ResponseBody = "Type,Host,Full name,Value,Priority,TTL,Purpose,Status\r\nTXT,@,example.com,v=spf1,,Auto,SPF,verified\r\n",
        };
        var client = SendPingClient.Create("mb_test_key", new SendPingClientOptions { HttpMessageHandler = stub });

        var csv = await client.DomainRetrieveRecordsCsvAsync("dom_1");

        Assert.Equal("https://www.sendping.co/api/domains/dom_1/records.csv", stub.LastRequest.RequestUri!.AbsoluteUri);
        Assert.StartsWith("Type,Host,Full name,Value,Priority,TTL,Purpose,Status", csv);
    }

    [Fact]
    public async Task SegmentListContacts_PaginatesAndParsesTheReducedShape()
    {
        var (client, stub) = CreateClient("""
            {"object":"list","has_more":true,"data":[{"id":"con_1","email":"a@b.com","first_name":"Ada",
             "last_name":null,"created_at":"2026-01-01T00:00:00Z","unsubscribed":false}]}
            """);

        var contacts = await client.SegmentListContactsAsync("seg_1", new PaginationOptions { Limit = 1 });

        Assert.Equal("https://www.sendping.co/api/segments/seg_1/contacts?limit=1", stub.LastRequest.RequestUri!.AbsoluteUri);
        Assert.True(contacts.HasMore);
        Assert.Equal("Ada", contacts.Data[0].FirstName);
    }

    [Fact]
    public async Task CampaignRetrieveEngagement_ParsesThePerRecipientLists()
    {
        var (client, stub) = CreateClient("""
            {"object":"campaign_engagement","campaign_id":"cmp_1",
             "opened":[{"email":"a@b.com","contact_id":"con_1","opened_at":"2026-08-08T10:00:00.000Z","open_count":2}],
             "clicked":[],
             "replied":[{"email":"c@d.com","contact_id":null,"replied_at":null,"received_email_id":"rec_1",
                         "subject":"Re: Hi","preview":"sure","category":"interested","received_at":"2026-08-08T11:00:00.000Z"}]}
            """);

        var engagement = await client.CampaignRetrieveEngagementAsync("cmp_1");

        Assert.Equal("https://www.sendping.co/api/campaigns/cmp_1/engagement", stub.LastRequest.RequestUri!.AbsoluteUri);
        Assert.Equal(2, engagement.Opened[0].OpenCount);
        Assert.Empty(engagement.Clicked);
        Assert.Equal("rec_1", engagement.Replied[0].ReceivedEmailId);
    }

    [Fact]
    public async Task SegmentCreate_SerializesTheEngagementFilter()
    {
        var (client, stub) = CreateClient("""{"object":"segment","id":"seg_1","audience_id":"aud_1","name":"Openers","created_at":"2026-01-01T00:00:00Z"}""");

        await client.SegmentCreateAsync(new SegmentCreateOptions
        {
            Domain = "acme.com",
            Name = "Openers",
            Filter = new SegmentFilterOptions
            {
                Status = "members_only",
                Engagement = new SegmentEngagementFilter { Event = "opened", CampaignId = "cmp_1" },
            },
        });

        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        var filter = body.RootElement.GetProperty("filter");
        Assert.Equal("members_only", filter.GetProperty("status").GetString());
        Assert.Equal("opened", filter.GetProperty("engagement").GetProperty("event").GetString());
        Assert.Equal("cmp_1", filter.GetProperty("engagement").GetProperty("campaign_id").GetString());
    }

    [Fact]
    public async Task EmailBatch_UnwrapsDataEnvelope()
    {
        var (client, stub) = CreateClient("""{"data":[{"id":"em_1"},{"id":"em_2"}]}""");

        var results = await client.EmailBatchAsync(new[]
        {
            new BatchEmailMessage { From = "a@b.com", To = "x@y.com", Subject = "1" },
            new BatchEmailMessage { From = "a@b.com", To = "z@y.com", Subject = "2" },
        });

        Assert.Equal("https://www.sendping.co/api/emails/batch", stub.LastRequest.RequestUri!.AbsoluteUri);
        Assert.Equal(2, results.Count);
        Assert.Equal("em_2", results[1].Id);
        // The batch body is a bare JSON array.
        Assert.StartsWith("[", stub.LastRequestBody!.TrimStart());
    }

    /// <summary>
    /// A batch of 41-100 is accepted and delivered in the BACKGROUND: HTTP 202
    /// with `queued: true`, so the ids exist but nothing has been transmitted.
    /// Dropping those fields left a caller unable to tell that apart from an
    /// inline send.
    /// </summary>
    [Fact]
    public async Task EmailBatchSend_SurfacesTheQueuedPath()
    {
        var stub = new StubHttpMessageHandler();
        stub.ScriptedResponses.Enqueue((HttpStatusCode.Accepted,
            """{"data":[{"id":"em_1"},{"id":"em_2"}],"queued":true,"queued_count":2}""", null));
        var client = SendPingClient.Create("mb_test_key", new SendPingClientOptions { HttpMessageHandler = stub });

        var response = await client.EmailBatchSendAsync(new[]
        {
            new BatchEmailMessage { From = "a@acme.com", To = "delivered@test.sendping.co", Subject = "1" },
            new BatchEmailMessage { From = "a@acme.com", To = "delivered@test.sendping.co", Subject = "2" },
        });

        Assert.Equal("https://www.sendping.co/api/emails/batch", stub.LastRequest.RequestUri!.AbsoluteUri);
        Assert.True(response.Queued);
        Assert.Equal(2, response.QueuedCount);
        Assert.Equal(new[] { "em_1", "em_2" }, response.Data.Select(e => e.Id));
        // The batch body is still a bare JSON array.
        Assert.StartsWith("[", stub.LastRequestBody!.TrimStart());
    }

    [Fact]
    public async Task EmailBatchSend_InlinePathReportsNotQueued()
    {
        // An inline 200 omits `queued`/`queued_count` entirely.
        var (client, _) = CreateClient("""{"data":[{"id":"em_1"}]}""");

        var response = await client.EmailBatchSendAsync(new[]
        {
            new BatchEmailMessage { From = "a@acme.com", To = "delivered@test.sendping.co", Subject = "1" },
        });

        Assert.False(response.Queued);
        Assert.Null(response.QueuedCount);
        Assert.Equal("em_1", Assert.Single(response.Data).Id);
    }

    /// <summary>
    /// GET /emails/receiving/:id/attachments sends `size: null` when the ingest
    /// recorded no size (lib/inbound/read.ts toReceivedAttachmentItem). A
    /// non-nullable long made System.Text.Json throw, so the whole list call
    /// failed as `invalid_response` and no row reached the caller.
    /// </summary>
    [Fact]
    public async Task ReceivedEmailListAttachments_AcceptsANullSize()
    {
        var (client, _) = CreateClient("""
            {"object":"list","has_more":false,"data":[
              {"object":"attachment","id":"0","filename":"note.txt","size":null,
               "content_type":"text/plain","content_disposition":"attachment",
               "content_id":null,"downloadable":false}]}
            """);

        var attachments = await client.ReceivedEmailListAttachmentsAsync("rec_1");

        var row = Assert.Single(attachments.Data);
        Assert.Null(row.Size);
        Assert.Equal("note.txt", row.Filename);
        Assert.False(row.Downloadable);
    }

    [Fact]
    public async Task NonSuccess_ThrowsSendPingExceptionWithParsedErrorShape()
    {
        var (client, _) = CreateClient(
            """{"statusCode":422,"name":"validation_error","message":"domain is required"}""",
            HttpStatusCode.UnprocessableEntity);

        var ex = await Assert.ThrowsAsync<SendPingException>(
            () => client.SegmentCreateAsync(new SegmentCreateOptions { Domain = null!, Name = "x" }));

        Assert.Equal(422, ex.StatusCode);
        Assert.Equal("validation_error", ex.Name);
        Assert.Equal("domain is required", ex.Message);
        // An ordinary error carries none of the additive fields.
        Assert.Null(ex.Limit);
        Assert.Null(ex.Reputation);
        Assert.Null(ex.Sent);
        Assert.Null(ex.SentCount);
        Assert.Empty(ex.Extra);
    }

    [Fact]
    public async Task NonSuccess_WithNonJsonBody_FallsBackToHttpStatus()
    {
        var (client, _) = CreateClient("gateway timeout", HttpStatusCode.BadGateway);

        var ex = await Assert.ThrowsAsync<SendPingException>(() => client.EmailRetrieveAsync("em_1"));

        Assert.Equal(502, ex.StatusCode);
        Assert.Equal("application_error", ex.Name);
        Assert.Empty(ex.Extra);
    }

    [Fact]
    public async Task QuotaError_ExposesWhichQuotaWasHit()
    {
        var (client, _) = CreateClient(
            """
            {"statusCode":429,"name":"daily_quota_exceeded","message":"Daily send quota reached.",
             "limit":{"kind":"emails_daily","used":100,"limit":100,"requested":3,"remaining":0,
                      "period":"24h","plan":{"id":"free","name":"Free"},
                      "next_plan":{"id":"pro","name":"Pro","amount":1400,"currency":"USD",
                                   "monthly_emails":50000,"daily_emails":5000,"domains":10,
                                   "contacts":10000,"ai_credits":100,"automation_runs":10000},
                      "credits":{"balance":0,"needed":1,"purchasable":true,
                                 "unit":1000,"amount_per_unit_cents":100}}}
            """,
            HttpStatusCode.TooManyRequests);

        var ex = await Assert.ThrowsAsync<SendPingException>(() => client.EmailRetrieveAsync("em_1"));

        Assert.Equal(429, ex.StatusCode);
        Assert.Equal("daily_quota_exceeded", ex.Name);
        Assert.NotNull(ex.Limit);
        Assert.Equal("emails_daily", ex.Limit!.Kind);
        Assert.Equal(100, ex.Limit.Used);
        Assert.Equal(100, ex.Limit.Limit);
        Assert.Equal(3, ex.Limit.Requested);
        Assert.Equal(0, ex.Limit.Remaining);
        Assert.Equal("24h", ex.Limit.Period);
        Assert.Equal("free", ex.Limit.Plan!.Id);
        Assert.Equal("Pro", ex.Limit.NextPlan!.Name);
        Assert.Equal(1400, ex.Limit.NextPlan.Amount);
        Assert.Equal(50000, ex.Limit.NextPlan.MonthlyEmails);
        Assert.True(ex.Limit.Credits!.Purchasable);
        Assert.Equal(1000, ex.Limit.Credits.Unit);
        // The unparsed body is still reachable for anything newer than this SDK.
        Assert.True(ex.Extra.ContainsKey("limit"));
        // Not a reputation or partial-batch error.
        Assert.Null(ex.Reputation);
        Assert.Null(ex.Sent);
    }

    [Fact]
    public async Task ReputationError_ExposesTheGateDetail()
    {
        var (client, _) = CreateClient(
            """
            {"statusCode":429,"name":"reputation_limit_exceeded","message":"Sending is rate limited.",
             "reputation":{"retryable":true,"scope":"domain","status":"warming","scope_key":"acme.com",
                           "hourly_limit":50,"daily_limit":200,"hourly_used":50,"daily_used":120,
                           "retry_at":"2026-08-08T12:00:00.000Z","support_email":"support@sendping.co"}}
            """,
            HttpStatusCode.TooManyRequests);

        var ex = await Assert.ThrowsAsync<SendPingException>(() => client.EmailRetrieveAsync("em_1"));

        Assert.Equal("reputation_limit_exceeded", ex.Name);
        Assert.NotNull(ex.Reputation);
        Assert.True(ex.Reputation!.Retryable);
        Assert.Equal("domain", ex.Reputation.Scope);
        Assert.Equal("acme.com", ex.Reputation.ScopeKey);
        Assert.Equal(50, ex.Reputation.HourlyLimit);
        Assert.Equal(120, ex.Reputation.DailyUsed);
        Assert.Equal("2026-08-08T12:00:00.000Z", ex.Reputation.RetryAt);
        Assert.Null(ex.Limit);
    }

    [Fact]
    public async Task PartialBatchFailure_NamesTheEmailsThatWereSent()
    {
        var (client, _) = CreateClient(
            """
            {"statusCode":429,"name":"daily_quota_exceeded","message":"Daily send quota reached.",
             "limit":{"kind":"emails_daily","used":100,"limit":100,"plan":{"id":"free","name":"Free"}},
             "sent":[{"id":"em_1"},{"id":"em_2"}],"sent_count":2}
            """,
            HttpStatusCode.TooManyRequests);

        var ex = await Assert.ThrowsAsync<SendPingException>(() => client.EmailBatchAsync(
            new[] { new BatchEmailMessage { From = "a@acme.com", To = "b@example.com", Subject = "Hi" } },
            idempotencyKey: "batch-1"));

        Assert.Equal(2, ex.SentCount);
        Assert.NotNull(ex.Sent);
        Assert.Equal(new[] { "em_1", "em_2" }, ex.Sent!.Select(e => e.Id));
        Assert.Equal("emails_daily", ex.Limit!.Kind);
    }

    [Fact]
    public async Task PartialBatchFailure_WithoutSentCount_FallsBackToTheSentList()
    {
        var (client, _) = CreateClient(
            """{"statusCode":429,"name":"monthly_quota_exceeded","message":"…","sent":[{"id":"em_1"}]}""",
            HttpStatusCode.TooManyRequests);

        var ex = await Assert.ThrowsAsync<SendPingException>(() => client.EmailRetrieveAsync("em_1"));

        Assert.Equal(1, ex.SentCount);
    }

    [Fact]
    public async Task AdditiveFields_WithAnUnknownShape_DoNotCostTheCallerTheError()
    {
        // A `limit` this SDK version cannot parse must not swallow the envelope.
        var (client, _) = CreateClient(
            """{"statusCode":402,"name":"plan_limit_reached","message":"Domain cap reached.","limit":"soon"}""",
            HttpStatusCode.PaymentRequired);

        var ex = await Assert.ThrowsAsync<SendPingException>(() => client.EmailRetrieveAsync("em_1"));

        Assert.Equal(402, ex.StatusCode);
        Assert.Equal("plan_limit_reached", ex.Name);
        Assert.Null(ex.Limit);
        Assert.Equal("soon", ex.Extra["limit"].GetString());
    }

    [Fact]
    public async Task WebhookTest_FailedDeliveryIsStill200AndReadsFromOk()
    {
        var (client, stub) = CreateClient(
            """{"object":"webhook_test","id":"wh_1","ok":false,"error":"lookup_failed"}""");

        var result = await client.WebhookTestAsync("wh_1");

        Assert.Equal("https://www.sendping.co/api/webhooks/wh_1/test", stub.LastRequest.RequestUri!.AbsoluteUri);
        Assert.False(result.Ok);
        Assert.Equal("lookup_failed", result.Error);
        Assert.Null(result.Status);
    }

    [Fact]
    public async Task WebhookTest_SuccessfulDeliveryCarriesTheEndpointStatus()
    {
        var (client, _) = CreateClient("""{"object":"webhook_test","id":"wh_1","ok":true,"status":200}""");

        var result = await client.WebhookTestAsync("wh_1");

        Assert.True(result.Ok);
        Assert.Equal(200, result.Status);
        Assert.Null(result.Error);
    }

    [Fact]
    public async Task ContactBatchInDomain_UsesFlatBulkDoorAndSendsDomainInBody()
    {
        // The domain-first bulk door. One batch takes the account's contact-limit
        // lock once, where a create-per-contact loop takes it per contact.
        var (client, stub) = CreateClient("""{"object":"contact_import","imported":2,"updated":0,"skipped":0,"total":2}""");

        var result = await client.ContactBatchInDomainAsync(
            "acme.com",
            new[] { new ContactInput { Email = "a@b.com" }, new ContactInput { Email = "c@d.com" } },
            "skip");

        Assert.Equal(2, result.Imported);
        Assert.Equal("https://www.sendping.co/api/contacts/batch?on_conflict=skip", stub.LastRequest.RequestUri!.AbsoluteUri);

        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        Assert.Equal("acme.com", body.RootElement.GetProperty("domain").GetString());
        Assert.Equal(2, body.RootElement.GetProperty("contacts").GetArrayLength());
    }

    [Fact]
    public async Task ContactBatch_NestedRoute_TargetsAudienceAndOmitsDomain()
    {
        var (client, stub) = CreateClient("""{"object":"contact_import","imported":1,"updated":0,"skipped":0,"total":1}""");

        await client.ContactBatchAsync("aud_1", new[] { new ContactInput { Email = "a@b.com" } });

        Assert.Equal("https://www.sendping.co/api/audiences/aud_1/contacts/batch", stub.LastRequest.RequestUri!.AbsoluteUri);
        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        Assert.False(body.RootElement.TryGetProperty("domain", out _));
    }

    [Fact]
    public async Task ContactCreate_FlatRoute_IncludesDomainInBody()
    {
        var (client, stub) = CreateClient("""{"object":"contact","id":"con_1"}""");

        var created = await client.ContactCreateAsync(new ContactCreateOptions
        {
            Domain = "acme.com",
            Email = "user@example.com",
            FirstName = "Ada",
        });

        Assert.Equal("con_1", created.Id);
        Assert.Equal("https://www.sendping.co/api/contacts", stub.LastRequest.RequestUri!.AbsoluteUri);

        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        Assert.Equal("acme.com", body.RootElement.GetProperty("domain").GetString());
        Assert.Equal("Ada", body.RootElement.GetProperty("first_name").GetString());
    }

    [Fact]
    public async Task ContactCreate_NestedRoute_TargetsAudienceAndOmitsDomain()
    {
        var (client, stub) = CreateClient("""{"object":"contact","id":"con_1"}""");

        await client.ContactCreateAsync(new ContactCreateOptions
        {
            AudienceId = "aud_9",
            Email = "user@example.com",
        });

        Assert.Equal("https://www.sendping.co/api/audiences/aud_9/contacts", stub.LastRequest.RequestUri!.AbsoluteUri);
        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        Assert.False(body.RootElement.TryGetProperty("domain", out _));
        Assert.False(body.RootElement.TryGetProperty("audience_id", out _));
    }

    [Fact]
    public async Task ContactRetrieve_ByEmailWithDomain_AppendsQueryAndEscapes()
    {
        var (client, stub) = CreateClient("""{"object":"contact","id":"con_1","email":"a@b.com","unsubscribed":false,"created_at":"2026-01-01T00:00:00Z"}""");

        await client.ContactRetrieveAsync("user@example.com", domain: "acme.com");

        Assert.Equal(
            "https://www.sendping.co/api/contacts/user%40example.com?domain=acme.com",
            stub.LastRequest.RequestUri!.AbsoluteUri);
    }

    [Fact]
    public async Task ReceivedEmailListAttachments_Paginates()
    {
        var (client, stub) = CreateClient("""{"object":"list","has_more":true,"data":[]}""");

        await client.ReceivedEmailListAttachmentsAsync("rec_1", new PaginationOptions { Limit = 2, After = "0" });

        Assert.Equal(
            "https://www.sendping.co/api/emails/receiving/rec_1/attachments?limit=2&after=0",
            stub.LastRequest.RequestUri!.AbsoluteUri);
    }

    [Fact]
    public async Task ContactImport_ForwardsSegmentIdAndFileName()
    {
        var (client, stub) = CreateClient("""{"object":"contact_import","imported":2,"updated":0,"skipped":0,"total":2,"segment_added":2}""");

        var res = await client.ContactImportAsync(
            "aud_1", "email\na@b.com\nc@d.com\n", segmentId: "seg_7", fileName: "leads.csv");

        Assert.Equal(
            "https://www.sendping.co/api/audiences/aud_1/contacts/import?segment_id=seg_7",
            stub.LastRequest.RequestUri!.AbsoluteUri);
        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        Assert.Equal("leads.csv", body.RootElement.GetProperty("file_name").GetString());
        // segment_added is only ever populated when segment_id was sent.
        Assert.Equal(2, res.SegmentAdded);
    }

    [Fact]
    public async Task ContactImportStorageKey_ForwardsSegmentId()
    {
        var (client, stub) = CreateClient("""{"object":"contact_import","imported":1,"updated":0,"skipped":0,"total":1}""");

        await client.ContactImportStorageKeyAsync("aud_1", "key_1", onConflict: "skip", segmentId: "seg_7");

        Assert.Equal(
            "https://www.sendping.co/api/audiences/aud_1/contacts/import?on_conflict=skip&segment_id=seg_7",
            stub.LastRequest.RequestUri!.AbsoluteUri);
    }

    [Fact]
    public async Task DomainRetrieve_DecodesAwsIdentityCheckFields()
    {
        var (client, _) = CreateClient("""{"object":"domain","id":"dom_1","name":"acme.com","status":"pending","created_at":"2026-01-01T00:00:00Z","aws_last_checked_at":"2026-01-02T03:04:05.000Z","aws_check_error":"identity not found"}""");

        var domain = await client.DomainRetrieveAsync("dom_1");

        Assert.Equal("2026-01-02T03:04:05.000Z", domain.AwsLastCheckedAt);
        Assert.Equal("identity not found", domain.AwsCheckError);
    }

    [Fact]
    public async Task SegmentList_RequiresDomainQuery_AndPaginates()
    {
        var (client, stub) = CreateClient("""{"object":"list","has_more":false,"data":[]}""");

        await client.SegmentListAsync("acme.com", new PaginationOptions { Limit = 5, After = "seg_1" });

        Assert.Equal(
            "https://www.sendping.co/api/segments?domain=acme.com&limit=5&after=seg_1",
            stub.LastRequest.RequestUri!.AbsoluteUri);
    }

    [Fact]
    public async Task IdBearingPaths_AreEscapedAgainstTraversal()
    {
        var (client, stub) = CreateClient("""{"object":"email","id":"x","from":"a@b.com","to":[],"created_at":"2026-01-01T00:00:00Z"}""");

        await client.EmailRetrieveAsync("../api-keys");

        Assert.Equal("https://www.sendping.co/api/emails/..%2Fapi-keys", stub.LastRequest.RequestUri!.AbsoluteUri);
    }

    [Fact]
    public async Task ContactPropertyUpdate_SendsExplicitNullToClearFallback()
    {
        var (client, stub) = CreateClient("""{"object":"contact_property","id":"prop_1"}""");

        await client.ContactPropertyUpdateAsync("prop_1", null);

        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        Assert.Equal(JsonValueKind.Null, body.RootElement.GetProperty("fallback_value").ValueKind);
    }

    [Fact]
    public async Task EventSend_PostsDomainRequiredPayload()
    {
        var (client, stub) = CreateClient("""{"object":"event","id":"evt_1","enrolled":1}""");

        var result = await client.EventSendAsync(new EventSendOptions
        {
            Name = "signup.completed",
            Domain = "acme.com",
            Email = "user@example.com",
            Data = new Dictionary<string, object?> { ["plan"] = "pro" },
        });

        Assert.Equal("https://www.sendping.co/api/events/send", stub.LastRequest.RequestUri!.AbsoluteUri);
        Assert.Equal(1, result.Enrolled);
        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        Assert.Equal("acme.com", body.RootElement.GetProperty("domain").GetString());
        Assert.Equal("pro", body.RootElement.GetProperty("data").GetProperty("plan").GetString());
    }

    [Fact]
    public async Task LogList_BuildsMethodAndStatusFilters()
    {
        var (client, stub) = CreateClient("""{"object":"list","has_more":false,"data":[]}""");

        await client.LogListAsync(new LogListOptions { Limit = 100, Method = "POST", Status = 429 });

        Assert.Equal(
            "https://www.sendping.co/api/logs?limit=100&method=POST&status=429",
            stub.LastRequest.RequestUri!.AbsoluteUri);
    }

    [Fact]
    public async Task Retries_On429_ThenSucceeds()
    {
        var stub = new StubHttpMessageHandler();
        // First attempt rate-limited (Retry-After: 0 keeps the test fast), then 200.
        stub.ScriptedResponses.Enqueue((HttpStatusCode.TooManyRequests, """{"name":"rate_limited","message":"slow down"}""", "0"));
        stub.ScriptedResponses.Enqueue((HttpStatusCode.OK, """{"id":"em_123"}""", null));
        var client = SendPingClient.Create("mb_test_key", new SendPingClientOptions { HttpMessageHandler = stub });

        var created = await client.EmailSendAsync(new EmailMessage
        {
            From = "a@b.com",
            To = "user@example.com",
            Subject = "Hi",
        });

        Assert.Equal("em_123", created.Id);
        // Two total attempts: the 429 then the 200.
        Assert.Equal(2, stub.Requests.Count);
        Assert.Equal("Bearer", stub.Requests[0].Headers.Authorization!.Scheme);
        Assert.Equal("Bearer", stub.Requests[1].Headers.Authorization!.Scheme);
    }

    [Fact]
    public async Task Retries_ExhaustMaxRetries_ThenThrowsLastError()
    {
        var stub = new StubHttpMessageHandler
        {
            StatusCode = HttpStatusCode.ServiceUnavailable,
            ResponseBody = """{"name":"unavailable","message":"try later"}""",
        };
        // maxRetries=1 => 2 total attempts, both 503.
        var client = SendPingClient.Create("mb_test_key", new SendPingClientOptions
        {
            HttpMessageHandler = stub,
            MaxRetries = 1,
        });

        var ex = await Assert.ThrowsAsync<SendPingException>(() => client.EmailRetrieveAsync("em_1"));

        Assert.Equal(503, ex.StatusCode);
        Assert.Equal(2, stub.Requests.Count);
    }

    [Fact]
    public async Task DoesNotRetry_On500_OrWhenMaxRetriesZero()
    {
        // 500 is never retried, even with retries enabled.
        var stub500 = new StubHttpMessageHandler
        {
            StatusCode = HttpStatusCode.InternalServerError,
            ResponseBody = """{"name":"server_error","message":"boom"}""",
        };
        var client500 = SendPingClient.Create("mb_test_key", new SendPingClientOptions { HttpMessageHandler = stub500, MaxRetries = 3 });
        await Assert.ThrowsAsync<SendPingException>(() => client500.EmailRetrieveAsync("em_1"));
        Assert.Single(stub500.Requests);

        // MaxRetries=0 disables retry even for 429.
        var stub429 = new StubHttpMessageHandler
        {
            StatusCode = HttpStatusCode.TooManyRequests,
            ResponseBody = """{"name":"rate_limited","message":"slow down"}""",
        };
        var client429 = SendPingClient.Create("mb_test_key", new SendPingClientOptions { HttpMessageHandler = stub429, MaxRetries = 0 });
        await Assert.ThrowsAsync<SendPingException>(() => client429.EmailRetrieveAsync("em_1"));
        Assert.Single(stub429.Requests);
    }

    /// <summary>
    /// GET /campaigns sends a narrower row than GET /campaigns/:id — no bodies,
    /// no from/topic_id/reply_to/preview_text, no schedule detail, follow-ups,
    /// recurrence or statistics. Typing the list as <see cref="Campaign"/> would
    /// declare all of those and hand callers nulls, so it decodes as
    /// <see cref="CampaignListItem"/>, which does not carry them at all.
    /// </summary>
    [Fact]
    public async Task CampaignList_ReturnsTheTrimmedRowShape()
    {
        var (client, _) = CreateClient("""
            {"object":"list","has_more":false,"data":[{"object":"campaign","id":"cmp_1",
             "name":"Launch","subject":"Hi","audience_id":"aud_1","segment_id":null,"status":"sent",
             "ab_test":{"enabled":false},"created_at":"2026-08-08T10:00:00.000Z","scheduled_at":null,
             "sent_at":"2026-08-08T11:00:00.000Z","failure_reason":null}]}
            """);

        ListResponse<CampaignListItem> list = await client.CampaignListAsync();

        var row = Assert.Single(list.Data);
        Assert.Equal("cmp_1", row.Id);
        Assert.Equal("Hi", row.Subject);
        Assert.Equal("aud_1", row.AudienceId);
        Assert.Equal("sent", row.Status);
        Assert.Null(row.SegmentId);
        Assert.False(row.AbTest!.Enabled);
    }

    /// <summary>
    /// GET /templates omits object/from/reply_to/text/current_version_id/variables,
    /// so the rows decode as <see cref="TemplateListItem"/> rather than the full
    /// <see cref="Template"/>.
    /// </summary>
    [Fact]
    public async Task TemplateList_ReturnsTheTrimmedRowShape()
    {
        var (client, _) = CreateClient("""
            {"object":"list","has_more":false,"data":[{"id":"tpl_1","name":"Welcome","subject":"Hi",
             "html":"<p>Hi</p>","status":"published","published_at":"2026-08-08T10:00:00.000Z",
             "created_at":"2026-08-01T10:00:00.000Z","updated_at":"2026-08-08T10:00:00.000Z",
             "alias":"welcome","has_unpublished_versions":false}]}
            """);

        ListResponse<TemplateListItem> list = await client.TemplateListAsync();

        var row = Assert.Single(list.Data);
        Assert.Equal("tpl_1", row.Id);
        Assert.Equal("Welcome", row.Name);
        Assert.Equal("<p>Hi</p>", row.HtmlBody);
        Assert.Equal("welcome", row.Alias);
        Assert.False(row.HasUnpublishedVersions);
    }

    [Fact]
    public async Task BaseUrl_Override_IsRespectedAndTrailingSlashTrimmed()
    {
        var stub = new StubHttpMessageHandler { ResponseBody = """{"object":"list","has_more":false,"data":[]}""" };
        var client = SendPingClient.Create("mb_test_key", new SendPingClientOptions
        {
            BaseUrl = "http://localhost:3000/",
            HttpMessageHandler = stub,
        });

        await client.DomainListAsync();

        Assert.Equal("http://localhost:3000/domains", stub.LastRequest.RequestUri!.AbsoluteUri);
    }

    [Fact]
    public async Task ContactRetrieveTopics_ForwardsPaginationAndReadsHasMore()
    {
        // GET /contacts/:id/topics is a paginated list endpoint. Before 3.0.0
        // the method took no pagination argument (unlike its three siblings
        // ContactListSegmentsAsync, SegmentListContactsAsync and
        // ReceivedEmailListAttachmentsAsync), and has_more was not modelled.
        var (client, stub) = CreateClient("""{"object":"list","has_more":true,"data":[{"id":"top_1","name":"Product","subscription":"opt_in"}]}""");

        var topics = await client.ContactRetrieveTopicsAsync("con_1", new PaginationOptions { Limit = 2, After = "top_9" });

        Assert.True(topics.HasMore);
        Assert.Single(topics.Data);
        var uri = stub.LastRequest.RequestUri!;
        Assert.Equal("/api/contacts/con_1/topics", uri.AbsolutePath);
        Assert.Contains("limit=2", uri.Query);
        Assert.Contains("after=top_9", uri.Query);
    }

    [Fact]
    public async Task ContactRetrieveTopics_WithoutPagination_SendsNoQuery()
    {
        var (client, stub) = CreateClient("""{"object":"list","has_more":false,"data":[]}""");

        await client.ContactRetrieveTopicsAsync("con_1");

        Assert.Equal(string.Empty, stub.LastRequest.RequestUri!.Query);
    }

    [Fact]
    public async Task TemplateUpdate_ClearsFieldsWithAnExplicitNull()
    {
        // PATCH semantics are `'key' in body`-based: present-with-null clears,
        // absent leaves the field untouched. The client omits nulls, so the
        // clearable properties are Patch<T>? rather than plain string?.
        var (client, stub) = CreateClient("""{"object":"template","id":"tpl_1"}""");

        await client.TemplateUpdateAsync("tpl_1", new TemplateUpdateOptions
        {
            Name = "Receipt",
            Alias = Patch.Clear<string>(),
            Subject = Patch.Clear<string>(),
            From = Patch.Clear<string>(),
            ReplyTo = Patch.Clear<EmailAddressList>(),
            HtmlBody = Patch.Clear<string>(),
            TextBody = Patch.Clear<string>(),
        });

        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        foreach (var key in new[] { "alias", "subject", "from", "reply_to", "html", "text" })
        {
            Assert.True(body.RootElement.TryGetProperty(key, out var property), $"{key} must be present");
            Assert.Equal(JsonValueKind.Null, property.ValueKind);
        }

        Assert.Equal("Receipt", body.RootElement.GetProperty("name").GetString());
    }

    [Fact]
    public async Task TemplateUpdate_OmitsUntouchedFieldsAndSendsSetValues()
    {
        var (client, stub) = CreateClient("""{"object":"template","id":"tpl_1"}""");

        await client.TemplateUpdateAsync("tpl_1", new TemplateUpdateOptions
        {
            Subject = "Your receipt",
        });

        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        Assert.Equal("Your receipt", body.RootElement.GetProperty("subject").GetString());
        Assert.False(body.RootElement.TryGetProperty("alias", out _));
        Assert.False(body.RootElement.TryGetProperty("html", out _));
    }

    [Fact]
    public async Task TopicUpdate_ClearsTheDescription()
    {
        var (client, stub) = CreateClient("""{"object":"topic","id":"top_1"}""");

        await client.TopicUpdateAsync("top_1", new TopicUpdateOptions { Description = Patch.Clear<string>() });

        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        Assert.Equal(JsonValueKind.Null, body.RootElement.GetProperty("description").ValueKind);
    }

    [Fact]
    public async Task SegmentUpdate_ClearsTheEngagementPredicate()
    {
        var (client, stub) = CreateClient("""{"object":"segment","id":"seg_1","audience_id":"aud_1","name":"VIP","created_at":"2026-01-01T00:00:00Z"}""");

        await client.SegmentUpdateAsync("seg_1", new SegmentUpdateOptions
        {
            Filter = new SegmentFilterOptions
            {
                Engagement = Patch.Clear<SegmentEngagementFilter>(),
                PropertyFilters = new List<PropertyFilter>(),
            },
        });

        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        var filter = body.RootElement.GetProperty("filter");
        Assert.Equal(JsonValueKind.Null, filter.GetProperty("engagement").ValueKind);
        Assert.Equal(JsonValueKind.Array, filter.GetProperty("property_filters").ValueKind);
        Assert.Equal(0, filter.GetProperty("property_filters").GetArrayLength());
    }
}

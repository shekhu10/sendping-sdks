# SendPing .NET SDK

Official .NET SDK for the [SendPing](https://www.sendping.co) email API — send transactional and marketing email from your own verified domain.

## Install

```bash
dotnet add package SendPing
```

Targets **.NET 8.0+**. No dependencies beyond the BCL (`HttpClient` + `System.Text.Json`).

## Usage

```csharp
using SendPing;

ISendPing sendping = SendPingClient.Create("mb_xxxxxxxxx");

var sent = await sendping.EmailSendAsync(new EmailMessage
{
    From = "Acme <hello@yourdomain.com>",
    To = "delivered@test.sendping.co",
    Subject = "Hello from SendPing",
    HtmlBody = "<p>Your first email 🎉</p>",
});

Console.WriteLine($"sent {sent.Id}");
```

Non-2xx API responses throw `SendPingException` carrying the API's
`{ statusCode, name, message }` error envelope:

```csharp
try
{
    await sendping.EmailSendAsync(message);
}
catch (SendPingException ex)
{
    Console.Error.WriteLine($"{ex.StatusCode} {ex.Name}: {ex.Message}");
}
```

Branch on `ex.Name` (e.g. `validation_error`, `not_found`,
`daily_quota_exceeded`), and read the real HTTP status from `ex.StatusCode` —
a handler may return a name with a status other than its usual one. Never
pattern-match `ex.Message`: the API scrubs provider identifiers out of it.

Some errors carry more than the envelope. Those extras are typed on the
exception and are `null` on an ordinary error:

```csharp
catch (SendPingException ex)
{
    // WHICH quota ran out, and what would clear it.
    if (ex.Limit is { } limit)
    {
        Console.Error.WriteLine($"{limit.Kind}: {limit.Used}/{limit.Limit} used" +
                                $" over {limit.Period}, upgrade to {limit.NextPlan?.Name}");
    }

    // Reputation gates: whether waiting helps, and until when.
    if (ex.Reputation is { } rep && rep.Retryable)
    {
        Console.Error.WriteLine($"paused on {rep.Scope} until {rep.RetryAt}");
    }

    // A batch that failed part way through — do NOT resend these.
    if (ex.Sent is { } sent)
    {
        Console.Error.WriteLine($"{ex.SentCount} already went out: {string.Join(", ", sent.Select(e => e.Id))}");
    }
}
```

`ex.Extra` holds every additive field unparsed, so a field newer than this SDK
version is still reachable.

Every request carries `Authorization: Bearer <your key>` and a non-empty
`User-Agent` (`sendping-dotnet/<version>`). The API rejects a request with a
missing User-Agent with HTTP 403 `validation_error`, so the header is not
configurable.

### Attachments

Attach files by hosted URL (`Path`, fetched at send time) or inline base64 (`Content`):

```csharp
await sendping.EmailSendAsync(new EmailMessage
{
    From = "Acme <hello@yourdomain.com>",
    To = "delivered@test.sendping.co",
    Subject = "Your invoice",
    HtmlBody = "<p>Invoice attached.</p>",
    Attachments = new List<EmailAttachment>
    {
        new() { Filename = "invoice.pdf", Path = "https://yourdomain.com/invoices/invoice.pdf" },
        new() { Filename = "report.csv", Content = base64Content, ContentType = "text/csv" },
    },
});
```

### Options

```csharp
ISendPing sendping = SendPingClient.Create("mb_xxxxxxxxx", new SendPingClientOptions
{
    BaseUrl = "https://www.sendping.co/api",   // override your API host
    HttpClient = myPooledHttpClient,              // e.g. from IHttpClientFactory
    Timeout = TimeSpan.FromSeconds(30),           // per attempt; Zero disables
    MaxRetries = 2,                               // 429/503 only; 0 disables
});
```

`SendPingClient` is thread-safe and meant to be created once and reused for the
process lifetime. It implements `IDisposable`, but disposes the `HttpClient` only
when it created it — a client you supply via `HttpClient` stays yours.

### Timeouts, retries & rate limits

`Timeout` (default 30s) applies to **each attempt**, so a retry gets a fresh
budget. Exceeding it throws a `SendPingException` with `Name == "timeout"` and
`StatusCode == 0`; a connection failure throws `Name == "network_error"`, also
with `StatusCode == 0`. Neither is retried — the request may already have been
applied.

The client retries **only HTTP 429 and 503**, up to `MaxRetries` times (default
2, so 3 attempts total). It honours the response's `Retry-After` header when
present — delta-seconds or an HTTP-date — and otherwise backs off exponentially
(`0.5s * 2^attempt`); either way a single wait is capped at 30s. Every other
status, including 5xx other than 503, is surfaced immediately.

The `/emails` **send** routes are capped at 30 requests per 60 seconds per client
IP, returning 429 `rate_limit_exceeded`. Reads are not subject to that
per-request cap, so paging a large list will not trip it. Responses on the capped
mount carry `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`, plus
`Retry-After` on the 429 itself — read them to throttle ahead of time instead of
discovering the cap through rejections. Sustained volume is governed separately
by your plan's send quota, which arrives as a limit error (see `ex.Limit`) rather
than a 429 rate-limit rejection.

## Resources

One flat async method per operation, following a consistent
`<Resource><Verb>Async` naming (`Create` / `Retrieve` / `List` / `Update` /
`Delete`, plus resource-specific verbs):

emails (incl. batch, attachments and inbound `ReceivedEmail*`), domains
(incl. claim + one-click DNS), audiences, contacts (domain-first flat +
nested + batch + CSV/Sheet import + segment membership + topics), contact
properties, campaigns, segments, topics, templates, automations, webhooks,
events, api keys, logs, polls.

```csharp
// Emails
await sendping.EmailSendAsync(message);
await sendping.EmailBatchAsync(messages);                    // List<BatchEmailMessage>, max 100
await sendping.EmailBatchSendAsync(messages);                // same call, full response (Queued)
await sendping.EmailListAsync(new PaginationOptions { Limit = 20 });
await sendping.EmailListAsync(new EmailListOptions            // server-side filters
{
    Status = "bounced", Search = "invoice", DomainId = domainId,
});
await sendping.EmailListAsync(new EmailListOptions            // mailbox folder: one of the
{                                                               // EmailFolders constants (Outbox /
    Folder = EmailFolders.Scheduled,                            // Sent / Scheduled / Failed);
});                                                             // any other value is rejected
await sendping.EmailListSourcesAsync();                       // per-origin send counters
await sendping.EmailRetrieveAsync(id);
await sendping.EmailListAttachmentsAsync(id);
await sendping.EmailUpdateAsync(id, "2026-08-01T09:00:00Z"); // reschedule a queued send
await sendping.EmailCancelAsync(id);

// Inbound email
await sendping.ReceivedEmailListAsync();
await sendping.ReceivedEmailListAddressesAsync();             // per-address inbound stats
await sendping.ReceivedEmailRetrieveAsync(id);
byte[] file = await sendping.ReceivedEmailGetAttachmentAsync(id, attachmentId);
await sendping.ReceivedEmailForwardAsync(id, new ReceivedEmailForwardOptions
{
    From = "you@yourdomain.com", To = "delivered@test.sendping.co",
});

// Domains (incl. claiming a domain verified elsewhere)
var domain = await sendping.DomainCreateAsync(new DomainCreateOptions { Name = "example.com" });
await sendping.DomainVerifyAsync(domain.Id);
await sendping.DomainClaimAsync(new DomainClaimOptions { Name = "example.com" });
await sendping.DomainVerifyClaimAsync(domain.Id);
await sendping.DomainDetectDnsAsync(domain.Id);              // one-click DNS options
await sendping.DomainApplyCloudflareDnsAsync(domain.Id, cloudflareToken);
await sendping.DomainMxCheckAsync("example.com");            // MX preflight for inbound
string csv = await sendping.DomainRetrieveRecordsCsvAsync(domain.Id);
```

Pass `BatchEmailMessage` items to `EmailBatchAsync` — the batch endpoint rejects
`Attachments` and `ScheduledAt` per item, and that type simply omits them so the
rule holds at compile time. The older `IEnumerable<EmailMessage>` overload is
`[Obsolete]` for exactly that reason; send attachments or scheduled messages one
at a time through `EmailSendAsync`.

A batch is served one of two ways, chosen by SIZE alone, and both are success —
so if you need to know whether the mail is actually out, call
`EmailBatchSendAsync` and read `Queued`:

```csharp
BatchSendResponse batch = await sendping.EmailBatchSendAsync(messages, idempotencyKey: "nightly-2026-08-19");

if (batch.Queued)
{
    // 41-100 emails: accepted (HTTP 202) and delivered in the BACKGROUND. The
    // ids are real — EmailRetrieveAsync(id) works — but they start at
    // `scheduled` and nothing has been transmitted yet.
    Console.WriteLine($"{batch.QueuedCount} emails queued");
}
else
{
    // 1-40 emails: already handed to the mail service before the call returned.
    Console.WriteLine($"{batch.Data.Count} emails sent");
}
```

`EmailBatchAsync` returns `batch.Data` and nothing else, so it cannot report the
queued case. An inline batch near the 40 boundary can also take ~100s
server-side, past the 30s default `SendPingClientOptions.Timeout` — raise it
for batches that large, and always pass an idempotency key so a client that
gives up mid-request can replay the recorded answer instead of re-sending.

### Contacts are DOMAIN-FIRST

Each sending domain has its own contact pool — the same address on two
domains is two records with separate consent. `Domain` is required on the
flat contacts API (and on segments, topics, campaigns, automations and
`EventSendAsync`):

```csharp
await sendping.ContactCreateAsync(new ContactCreateOptions
{
    Domain = "example.com",              // the pool the contact lands in
    Email = "user@example.com",
    FirstName = "Ada",
});
await sendping.ContactListAsync(new ContactListOptions { Domain = "example.com" });
await sendping.ContactRetrieveAsync(contactId);                        // by id (exact) …
await sendping.ContactRetrieveAsync("user@example.com", "example.com"); // … or by email + domain
await sendping.ContactUpdateAsync(new ContactUpdateOptions { Id = contactId, Unsubscribed = true });
await sendping.ContactDeleteAsync(contactId);

// Bulk import (array or CSV), segment membership and per-topic subscriptions
await sendping.ContactBatchAsync(audienceId, contacts, onConflict: "skip");
// Domain-first: import straight into a domain's pool, no audience id needed.
await sendping.ContactBatchInDomainAsync("yourdomain.com", contacts);
await sendping.ContactImportAsync(audienceId, csvText);
await sendping.ContactAddToSegmentAsync(contactId, segmentId);
await sendping.ContactUpdateTopicsAsync(contactId, new ContactTopicsUpdateOptions
{
    Topics = { new ContactTopicSetting { Id = topicId, Subscription = "opt_in" } },
});

// Contact properties (custom fields / merge tags)
await sendping.ContactPropertyCreateAsync(new ContactPropertyCreateOptions { Key = "plan", Type = "string" });
```

### Campaigns, segments, topics (domain-required)

```csharp
var campaign = await sendping.CampaignCreateAsync(new CampaignCreateOptions
{
    Domain = "example.com",              // REQUIRED: the contact pool it targets
    From = "Acme <hello@example.com>",
    Subject = "Product news",
    HtmlBody = "<p>…</p>",
    SegmentId = segmentId,               // optional subset
});
await sendping.CampaignSendAsync(campaign.Id);                  // or scheduledAt: "2026-08-01T09:00:00Z"
await sendping.CampaignRetrieveStatsAsync(campaign.Id);
await sendping.CampaignRetrieveEngagementAsync(campaign.Id);    // who opened/clicked/replied

var segment = await sendping.SegmentCreateAsync(new SegmentCreateOptions
{
    Domain = "example.com",
    Name = "Subscribed",
    Filter = new SegmentFilterOptions { Status = "subscribed" },
});
await sendping.SegmentListAsync("example.com");
await sendping.SegmentListContactsAsync(segment.Id);            // preview who matches

await sendping.TopicCreateAsync(new TopicCreateOptions
{
    Domain = "example.com",
    Name = "Product updates",
    DefaultSubscription = "opt_in",
});
```

### Templates

```csharp
var tmpl = await sendping.TemplateCreateAsync(new TemplateCreateOptions
{
    Name = "Welcome", Subject = "Welcome, {{first_name}}!", HtmlBody = "<p>Hi {{first_name}}</p>",
});
await sendping.TemplatePublishAsync(tmpl.Id);
await sendping.EmailSendAsync(new EmailMessage
{
    From = from, To = to,                // omit Subject -> the template's is used
    TemplateId = tmpl.Id,
    Variables = new() { ["first_name"] = "Ada" },
});
```

The template only fills fields you leave out: omit `From` / `ReplyTo` / `Subject`
and its own values apply, but a `Subject` you *do* pass wins over the template's.
Templates must be published before they can be sent (an unpublished one is a
422 `validation_error`), and pairing `TemplateId`/`Template` with `HtmlBody` or
`TextBody` is rejected — pick one.

### Automations & events

Every automation belongs to one of your sending domains — `Domain` is
required on create, and `EventSendAsync` names the domain it targets, so the
same event name across several products can never trigger the wrong automation.

```csharp
var automation = await sendping.AutomationCreateAsync(new AutomationCreateOptions
{
    Name = "Welcome series",
    Domain = "yourdomain.com",
    Trigger = "contact.created",
});
await sendping.AutomationAddStepAsync(automation.Id, new AutomationAddStepOptions
{
    Type = "send_email",
    Config = new() { ["template_id"] = "tmpl_welcome" },
});

// Fire a custom event — only yourdomain.com's automations are triggered
await sendping.EventSendAsync(new EventSendOptions
{
    Name = "signup.completed",
    Domain = "yourdomain.com",
    Email = "user@example.com",
    Data = new() { ["plan"] = "pro" },
});

// Inspect execution (optionally filtered by run status)
var runs = await sendping.AutomationListRunsAsync(automation.Id, new AutomationRunListOptions
{
    Limit = 25, Status = new[] { "failed", "running" },
});
await sendping.AutomationRetrieveRunAsync(automation.Id, runs.Data[0].Id);
```

### Webhooks & signature verification

```csharp
var hook = await sendping.WebhookCreateAsync(new WebhookCreateOptions
{
    Endpoint = "https://yourapp.com/hooks/sendping",
    Events = { "email.delivered", "email.bounced", "email.unsubscribed" },
});
// hook.SigningSecret is shown ONCE — store it now.
```

Endpoints must be `https://` and must not resolve to a private address. Event
names come from a fixed vocabulary — `email.sent`, `email.delivered`,
`email.delivery_delayed`, `email.bounced`, `email.complained`, `email.opened`,
`email.clicked`, `email.failed`, `email.scheduled`, `email.suppressed`,
`email.received`, `email.replied`, `email.unsubscribed`, `contact.created`,
`contact.updated`, `contact.deleted`, `domain.created`, `domain.updated`,
`domain.deleted` — anything else is a 422.

`WebhookTestAsync` returns HTTP 200 even when the delivery failed — it does not
throw. The outcome is `result.Ok`, with `result.Status` (your endpoint's HTTP
status, when it responded) and `result.Error` (e.g. `lookup_failed`):

```csharp
var test = await sendping.WebhookTestAsync(webhookId);
if (!test.Ok)
{
    Console.Error.WriteLine($"test delivery failed: {test.Error} (status {test.Status})");
}
```

Verify a delivery in your endpoint (pure local HMAC-SHA256; pass the EXACT raw
request body, not re-serialized JSON):

```csharp
var result = WebhookSignature.Verify(rawBody, new Dictionary<string, string>
{
    ["svix-id"] = Request.Headers["svix-id"]!,
    ["svix-timestamp"] = Request.Headers["svix-timestamp"]!,
    ["svix-signature"] = Request.Headers["svix-signature"]!,
}, signingSecret);

if (!result.Valid) return Unauthorized(result.Reason);
```

(Also available as `sendping.WebhookVerify(...)` on the client.)

### Logs, API keys, polls

```csharp
await sendping.LogListAsync(new LogListOptions { Limit = 100, Method = "POST", Status = 429 });
await sendping.ApiKeyListAsync();
await sendping.PollListAsync();
await sendping.PollRetrieveAsync(emailId);
```

**API keys are created, re-scoped and revoked in the dashboard**, at
[sendping.co/app/api-keys](https://www.sendping.co/app/api-keys). Those
routes accept a signed-in dashboard session only, so `ApiKeyListAsync` is the
entire API-key surface of this SDK. That is the point: a key that leaks cannot
mint itself a replacement, widen its own permission, or revoke the keys around
it — the blast radius stays whatever the leaked key could already do.

An API key's `Token` is only ever the 8-character display prefix (e.g.
`mb_ab12`); the full secret is shown once, in the dashboard, at creation.

### Pagination

`*ListAsync` methods accept optional cursor pagination:

```csharp
await sendping.CampaignListAsync(new PaginationOptions { Limit = 25, After = "cursor_abc" });
```

`limit` is an integer 1–100 (default 20); `After` and `Before` are item ids and
are mutually exclusive. Responses are `{ object: "list", has_more, data }` —
there is no total and no next-cursor: page forward with the last row's `Id`.
Note that several list endpoints (domains, api keys, topics, campaigns,
contacts, segments, contact properties, polls) ignore the default of 20 when you
pass no pagination options at all and return up to **1,000** rows in one
response, while templates, webhooks, audiences, automations, automation runs and
events cap at 20. That 1,000 is a ceiling, not a promise: `HasMore` stays
truthful when it bites, so always page with `After` rather than assuming one
call drained the collection.

### Idempotency

`EmailSendAsync` and `EmailBatchAsync` accept an idempotency key so a retry
cannot send twice:

```csharp
await sendping.EmailSendAsync(message, idempotencyKey: "order-123");
```

- The key is **1–255 characters**, measured after the server trims it — 255, not
  256. `SendPingClient.MaxIdempotencyKeyLength` carries that number. The client
  sends the key verbatim and lets the **server** be the authority: an
  out-of-range key comes back as 400 `invalid_idempotency_key`
  (a `SendPingException`), not a local `ArgumentException`.
- Replaying a completed key returns the original response. Reusing it with a
  different payload is 409 `invalid_idempotent_request`; while the first request
  is still in flight it is 409 `concurrent_idempotent_requests`.
- **`POST /emails`, `POST /emails/batch`, and received-email reply/forward honour the header.** The
  `idempotencyKey` parameter on `EventSendAsync` / `EventCreateAsync` is sent but
  ignored by the API — retrying those creates a second record. De-duplicate on
  your side instead.

## Documentation

Full docs: <https://www.sendping.co/docs>

## License

MIT

## Recovery and tracking contracts

Use a stable, unique operation key for each intended send, batch, reply, or
forward. Keep the same key and payload when recovering that operation. These
are the supported idempotent send endpoints; events do not implement this
header. Existing calls without options still work.

```csharp
await sendping.ReceivedEmailReplyWithIdempotencyKeyAsync(id, reply, "reply-operation-1");
await sendping.ReceivedEmailForwardWithIdempotencyKeyAsync(id, forward, "forward-operation-1");
DomainTrackingHealth health = await sendping.DomainTrackingHealthAsync(domainId);
```

Automatic retries consider only 429/503. They stop on an original email `id`,
positive `sent_count`, nonempty `sent` or `reserved`, or `batch_incomplete`.
An ordinary rate limit can retry; a generic 503 can retry a read or a send with
the same supported key. Other writes retry only documented pre-processing
rejections (`service_unavailable`, `sending_service_unavailable`,
`sending_configuration_unavailable`, `contacts_busy`, `contacts_timeout`).
No network/body-read failure, 409, 422, or other 5xx is retried automatically.
The default transport refuses redirects; a custom transport/client must enforce
its own policy.

On a failed or unconfirmed send, inspect `id` with the email retrieval method
before creating another send. A 422 with an ID can identify an uncertain
provider handoff; 422 does not always mean nothing happened. For interrupted
batches, `sent` contains confirmed sends, `reserved` contains the original
attempted prefix (including uncertain handoffs), and `unsent_count` counts the
never-attempted tail. Do not resend the full batch or the reserved prefix under
a new key. Reconcile original IDs first, then submit only known unattempted
items as a new operation. Recovery fields remain available in the full error
body as well as language-specific fields/accessors.

Tracking health returns `custom_host`, `status` (`shared`, `ready`, or
`unavailable`), and `checked_at`. Configure custom tracking through the domain
API and check health before relying on it. A healthy endpoint cannot guarantee
an open event: recipients may block images, and coupon redemption alone is not
proof that the tracking pixel loaded. SDKs preserve supplied HTML/text and do
not infer opens or rewrite editor spacing.

Campaign cancellation also stops pending follow-ups for an already-sent
campaign while retaining its sent history. Permanent received-email deletion
acknowledges a durable cleanup request; attachment/object cleanup can finish
asynchronously. Retrying that deletion is safe; it cannot be undone after the
purge request is accepted.

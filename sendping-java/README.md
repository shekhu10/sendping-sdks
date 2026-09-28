# sendping-java

Official Java SDK for the [SendPing](https://www.sendping.co) email API — send transactional and marketing email from your own verified domain.

- **Zero dependencies** — built on `java.net.http.HttpClient` with hand-rolled JSON.
- **Java 11+**.

## Install

### Maven

```xml
<dependency>
  <groupId>co.sendping</groupId>
  <artifactId>sendping</artifactId>
  <version>1.0.0</version>
</dependency>
```

### Gradle

```groovy
implementation 'co.sendping:sendping:1.0.0'
```

The jar is plain JVM bytecode compiled for **Java 11**, so it is consumable
unchanged from **Kotlin** (and any other JVM language) — there is no separate
Kotlin artifact, and the same Gradle line works in a `build.gradle.kts`.

## Usage

First, get an API key from your SendPing dashboard.

```java
import co.sendping.SendPing;
import co.sendping.SendPingException;
import co.sendping.SendPingResponse;
import co.sendping.requests.SendEmailRequest;

public class Main {
    public static void main(String[] args) {
        SendPing sendping = new SendPing("mb_xxxxxxxxx");

        SendEmailRequest request = SendEmailRequest.builder()
                .from("Acme <hi@yourdomain.com>")
                .to("delivered@test.sendping.co")
                .subject("Hello from SendPing")
                .html("<p>Your first email 🎉</p>")
                .build();

        try {
            SendPingResponse response = sendping.emails().send(request);
            System.out.println("sent " + response.getString("id"));
        } catch (SendPingException e) {
            System.err.println(e.getStatusCode() + " " + e.getName() + ": " + e.getMessage());
        }
    }
}
```

`delivered@test.sendping.co` is SendPing's delivery simulator — safe to send to
while you wire things up. Do not point examples at `example.com`: it is a
blocked recipient domain, and a send to it fails with
`422 validation_error` / "All to recipients are suppressed".

### Responses and errors

Every method returns a `SendPingResponse` wrapping the raw JSON body with
dotted-path helper getters — `getString("id")`, `getBoolean("has_more")`,
`getList("data")`, `getString("data.0.id")` (numeric segments index into
lists), `asMap()`, and `raw()` for the exact body text. Binary downloads
(received-email attachments, raw MIME) return `byte[]` instead.

Any non-2xx response throws `SendPingException` carrying the API error
envelope: `getStatusCode()`, `getName()`, `getMessage()`.

Branch on `getName()` plus `getStatusCode()` — never on message text, which is
scrubbed server-side and is not a stable contract. A name does not imply a
status either: `validation_error` is 422 most of the time, but 403 for a
missing `User-Agent` and 409 for a duplicate contact-property key.

Some errors add fields on top of the envelope, reachable through `getBody()`,
the dotted-path `get(...)`, or the `getLimit()` shortcut:

```java
try {
    sendping.emails().send(request);
} catch (SendPingException e) {
    if (e.getLimit() != null) {                       // plan / quota rejection
        System.out.println("used " + e.get("limit.used") + " of " + e.get("limit.limit"));
        System.out.println("upgrade to " + e.get("limit.next_plan.name"));
    }
    // Any partial batch failure carries `sent` and `sent_count`, key or not —
    // the key only changes the status (a keyless partial is downgraded to 422
    // so nothing auto-retries it); reputation errors carry `reputation`.
}
```

The SDK always sends a non-empty `User-Agent`. If you build an `ApiClient`
yourself, keep it non-empty — the API rejects requests without one with a 403
`validation_error` before authentication even runs.

### Attachments

Attach files by hosted URL (`path`, fetched at send time) or inline base64 (`content`):

```java
SendEmailRequest request = SendEmailRequest.builder()
        .from("Acme <hi@yourdomain.com>")
        .to("delivered@test.sendping.co")
        .subject("Your invoice")
        .html("<p>Invoice attached.</p>")
        .attachment(Attachment.builder()
                .filename("invoice.pdf")
                .path("https://yourdomain.com/invoices/invoice.pdf")
                .build())
        .attachment(Attachment.builder()
                .filename("report.csv")
                .content(base64Content)
                .contentType("text/csv")
                .build())
        .build();
```

### Options

```java
// Override the API host:
SendPing sendping = new SendPing("mb_xxxxxxxxx", "https://www.sendping.co/api");
// Inject a custom transport (e.g. for tests):
SendPing sendping = new SendPing("mb_xxxxxxxxx", "https://www.sendping.co/api", myTransport);
```

## Resources

One accessor per resource, each following a consistent
(`create` / `get` / `list` / `update` / `remove`, plus resource-specific verbs) shape:

`emails()` (with nested `emails().receiving()`), `batch()`, `domains()`,
`audiences()`, `contacts()`, `contactProperties()`, `campaigns()`,
`segments()`, `topics()`, `templates()`, `automations()`, `webhooks()`,
`logs()`, `events()`, `apiKeys()`, `polls()`.

Read-only resources expose only the verbs they support — `apiKeys()` is
list-only, and `polls()` is list/get.

```java
// Emails
sendping.emails().send(request);
sendping.emails().list(ListParams.builder().limit(20).after(cursor).build());
sendping.emails().list(ListEmailsParams.builder()   // server-side filters
        .status("bounced").search("acme.com").domainId(domainId).build());
// `folder` takes one of outbox / sent / scheduled / failed (the
// ListEmailsParams.FOLDER_* constants); any other value is rejected (422).
sendping.emails().list(ListEmailsParams.builder()
        .folder(ListEmailsParams.FOLDER_SCHEDULED).build());
sendping.emails().sources();   // per-campaign / automation send metrics,
                                 // plus "api" and "individual" roll-up rows
sendping.emails().get(id);
sendping.emails().listAttachments(id);
sendping.emails().getAttachment(id, attachmentId);
sendping.emails().update(id, "2026-08-05T11:52:01.858Z"); // reschedule
sendping.emails().cancel(id);

// Inbound email
sendping.emails().receiving().list();
sendping.emails().receiving().listAddresses(); // per-address inbound stats
sendping.emails().receiving().get(id);
byte[] file = sendping.emails().receiving().getAttachment(id, attachmentId);
byte[] mime = sendping.emails().receiving().getRaw(id);
sendping.emails().receiving().forward(id,
        ForwardEmailRequest.builder().from("you@yourdomain.com").to("delivered@test.sendping.co").build());
sendping.emails().receiving().reply(id,
        ReplyEmailRequest.builder().from("you@yourdomain.com").html("<p>Thanks!</p>").build());

// Batch send — up to 100 emails. Items reject `attachments` and
// `scheduled_at`; send those individually via emails().send(...).
// Up to 40 go out inline (200). 41-100 are ACCEPTED AND QUEUED (202):
// `queued`/`queued_count` are set and the ids are real, but nothing has been
// transmitted yet — check res.statusCode() == 202 before treating a batch as
// sent, and poll emails().get(id) for the outcome. Note the 30s default
// timeout (DefaultHttpTransport.DEFAULT_TIMEOUT): an inline batch near the 40
// boundary can take ~100s server-side, so raise it — and pass an
// Idempotency-Key — for batches that large.
sendping.batch().sendEmails(List.of(batchRequest1, batchRequest2));

// Domains (incl. claiming a domain verified elsewhere + one-click DNS applies)
sendping.domains().create(CreateDomainRequest.builder().name("example.com").build());
sendping.domains().verify(id);
sendping.domains().claim(ClaimDomainRequest.builder().name("example.com").build());
sendping.domains().verifyClaim(id);
sendping.domains().detectDns(id);
sendping.domains().applyCloudflareDns(id, cloudflareToken);
sendping.domains().mxCheck("example.com");   // inbound MX pre-flight
String csv = sendping.domains().recordsCsv(id); // DNS records as text/csv
```

### Contacts are DOMAIN-FIRST

Each sending domain has its own contact pool — the same address on two domains
is two records with separate consent. `domain` is required on the flat
`/contacts` API (pass `audienceId` instead to use the nested audience API):

```java
sendping.contacts().create(CreateContactRequest.builder()
        .domain("example.com")
        .email("ada@lovelace.dev")
        .firstName("Ada")
        .property("plan", "pro")
        .build());

sendping.contacts().list("example.com");
sendping.contacts().get(contactId);                          // by id (exact)
sendping.contacts().get("ada@lovelace.dev", "example.com");  // by email + domain
sendping.contacts().update(UpdateContactRequest.builder()
        .id(contactId).unsubscribed(true).build());
sendping.contacts().remove(contactId);

// Bulk import (array or CSV) + segment membership + topics
sendping.contacts().batch(BatchContactsRequest.builder()
        .audienceId(audienceId)
        .contact(ContactInput.builder().email("a@b.com").build())
        .onConflict("skip")
        .build());
// Domain-first: import straight into a domain's pool, no audience id needed.
sendping.contacts().batch(BatchContactsRequest.builder()
        .domain("yourdomain.com")
        .contact(ContactInput.builder().email("a@b.com").build())
        .build());
sendping.contacts().importCsv(ImportContactsRequest.builder()
        .audienceId(audienceId).csv("email,company\na@b.com,Acme").build());

// Inline CSV is capped at 5 MB / 10,000 rows. For bigger files, mint a
// presigned URL, PUT the file to it yourself, then import by storage key:
SendPingResponse upload = sendping.contacts()
        .createImportUpload(audienceId, "contacts.csv", fileSizeBytes);
// ... PUT the bytes to upload.getString("upload_url") — do not log that URL ...
sendping.contacts().importCsv(ImportContactsRequest.builder()
        .audienceId(audienceId)
        .storageKey(upload.getString("storage_key"))
        .build());

sendping.contacts().addToSegment(contactId, segmentId);
sendping.contacts().listSegments(contactId);
sendping.contacts().updateTopics(contactId, UpdateContactTopicsRequest.builder()
        .optIn(topicId).build());

// Contact properties (custom merge-tag fields)
sendping.contactProperties().create(CreateContactPropertyRequest.builder()
        .key("plan").type("string").build());
```

### Campaigns, segments, topics — also domain-first

`domain` picks the contact pool the campaign/segment/topic targets and is
REQUIRED on create (and on segment/topic list):

```java
sendping.campaigns().create(CreateCampaignRequest.builder()
        .domain("example.com")
        .from("Acme <hi@example.com>")
        .subject("Launch day")
        .html("<h1>We shipped!</h1>")
        .segmentId(segmentId)
        .build());
sendping.campaigns().send(id);                        // now
sendping.campaigns().send(id, "2026-08-05T11:00:00Z"); // scheduled (max 30 days out)
sendping.campaigns().stats(id);
sendping.campaigns().engagement(id); // who opened / clicked / replied
sendping.campaigns().ab(id);         // A/B winner evaluation

sendping.segments().create(CreateSegmentRequest.builder()
        .domain("example.com")
        .name("Pro users")
        .filter(SegmentFilter.builder().status("subscribed")
                .propertyFilter("plan", "eq", "pro").build())
        .build());
sendping.segments().list("example.com");
sendping.segments().contacts(id); // preview who matches

sendping.topics().create(CreateTopicRequest.builder()
        .domain("example.com")
        .name("Product updates")
        .defaultSubscription("opt_in")
        .build());
sendping.topics().list("example.com");
```

### Templates

```java
sendping.templates().create(CreateTemplateRequest.builder()
        .name("Welcome").subject("Hi {{first_name}}").html("<p>Welcome!</p>")
        .variable(TemplateVariable.of("first_name", "string", "there"))
        .build());
sendping.templates().duplicate(id);
sendping.templates().publish(id);
```

### Automations & events

Every automation belongs to one of your sending domains — `domain` is REQUIRED
on create, and `events().send(...)` names the domain it targets, so the same
event name across several products can never trigger the wrong automation:

```java
SendPingResponse automation = sendping.automations().create(
        CreateAutomationRequest.builder()
                .name("Welcome series")
                .domain("yourdomain.com")
                .trigger("contact.created")
                .build());

sendping.automations().addStep(automation.getString("id"), AutomationStep.builder()
        .type("send_email")
        .config("template_id", "tmpl_welcome")
        .build());
sendping.automations().update(automation.getString("id"),
        UpdateAutomationRequest.builder().status("enabled").build());

// Fire a custom event — only yourdomain.com's automations are triggered
sendping.events().send(SendEventRequest.builder()
        .event("signup.completed")
        .domain("yourdomain.com")        // REQUIRED
        .email("delivered@test.sendping.co")
        .payload("plan", "pro")
        .build());

// Inspect execution
sendping.automations().runs(automationId, ListParams.builder().limit(25).build());
sendping.automations().runs(automationId, ListAutomationRunsParams.builder()
        .status("failed", "running").limit(50).build());
sendping.automations().getRun(automationId, runId);
sendping.automations().stop(automationId);

// Editing steps requires a stopped automation. `type` is required even when
// only the config changes, and the step's graph `key` is not editable here —
// PATCH forwards only type/config, so a key sent there is silently dropped.
sendping.automations().updateStep(automationId, stepId, UpdateAutomationStepRequest.builder()
        .type("delay").config("duration", "3 days").build());
```

`events().send(...)` does **not** honour `Idempotency-Key` — a retry ingests a
second event and can enroll the contact twice. Dedupe before you call.

### Webhooks

```java
SendPingResponse hook = sendping.webhooks().create(CreateWebhookRequest.builder()
        .endpoint("https://yourapp.com/hooks/sendping") // must be https://
        .events("email.delivered", "email.bounced", "email.unsubscribed")
        .build());
String secret = hook.getString("signing_secret"); // shown ONCE — store it

sendping.webhooks().rotate(id); // new secret, also shown once

// A failed test delivery is still HTTP 200 — check `ok`, not the status.
SendPingResponse probe = sendping.webhooks().test(id);
if (!Boolean.TRUE.equals(probe.getBoolean("ok"))) {
    System.err.println("endpoint unreachable: " + probe.getString("error"));
}
```

Event names are `email.sent`, `email.delivered`, `email.delivery_delayed`,
`email.bounced`, `email.complained`, `email.opened`, `email.clicked`,
`email.failed`, `email.scheduled`, `email.suppressed`, `email.received`,
`email.replied`, `email.unsubscribed`, `contact.created`, `contact.updated`,
`contact.deleted`, `domain.created`, `domain.updated` and `domain.deleted`.
Anything else is a 422 — note there is no `contact.unsubscribed`.

Verify deliveries locally (no HTTP call) — pass the EXACT raw request body and
the `svix-*` headers:

```java
import co.sendping.resources.Webhooks;
import co.sendping.resources.VerifyWebhookResult;

VerifyWebhookResult result = Webhooks.verifyWebhookSignature(rawBody, headers, secret);
if (!result.isValid()) {
    System.err.println("rejected: " + result.getReason());
}
```

`headers` is a `Map<String, String>` containing `svix-id`, `svix-timestamp`
and `svix-signature` (read case-insensitively). A fourth argument sets the
timestamp tolerance in seconds (default 300; pass 0 to disable the check).

### Logs, API keys, polls

```java
sendping.logs().list(ListLogsParams.builder().limit(100).method("POST").status(429).build());
sendping.logs().get(logId);

sendping.apiKeys().list();   // display prefixes, permission, domain scoping

sendping.polls().list();
sendping.polls().get(emailId);
```

**API keys are created, re-scoped and revoked in the dashboard**, at
[sendping.co/app/api-keys](https://www.sendping.co/app/api-keys). Those
routes accept a signed-in dashboard session only, so `apiKeys()` deliberately
offers nothing but `list()`. That is the point: a key that leaks cannot mint
itself a replacement, widen its own permission, or revoke the keys around it —
containing the blast radius to whatever the leaked key could already do.
`token` on a listed key is only the 8-character display prefix; the full secret
is shown once, in the dashboard, at creation.

### Pagination

`list()` methods accept optional cursor pagination — `limit` is an integer
1–100 and `after`/`before` are item ids (supplying both is a 422):

```java
sendping.campaigns().list(ListParams.builder().limit(25).after("cursor_abc").build());
```

Responses are `{ "object": "list", "has_more": bool, "data": [...] }`. There is
no `total` and no `next_cursor` — page forward with the last `data[].id` as
`after`, and stop when `has_more` is false. An unknown cursor returns an empty
page rather than an error.

**The unpaged default is not uniform.** Called with no pagination params,
`domains()`, `apiKeys()`, `topics()`, `campaigns()`, `contacts()`,
`contactProperties()`, `segments()` and the contact/segment sub-lists return
the **whole collection**, while `templates()`, `webhooks()`, `audiences()`,
`automations()`, `automations().runs(...)` and `events()` cap at **20**. Pass an
explicit `limit` whenever you care which you get.

### Rate limits

The `/emails` **send** routes share one limit of **30 requests per 60 seconds
per client IP**. Reads (`GET /emails`, `GET /emails/:id`, the whole `receiving`
subtree and attachment listings) are NOT subject to that cap, so paging a large
list no longer risks a 429.
Over the cap you get a 429 `rate_limit_exceeded`. Those responses carry
`RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` and a
`Retry-After`, which the default transport already honours: it retries 429 and
503 up to twice, waiting out `Retry-After` (capped at 30s) or falling back to
exponential backoff. Tune or disable it per client:

```java
SendPing sendping = new SendPing(
        "mb_xxxxxxxxx", "https://www.sendping.co/api", Duration.ofSeconds(30), 0);
```

No other resource is rate-limited at the mount level; `automations().createWithAi(...)`
allows 20 requests/60s per account.

### Idempotency

`POST /emails`, `POST /emails/batch`, and received-email reply/forward read
`Idempotency-Key`. Pass one to make a retry replay the first response instead
of sending twice:

```java
sendping.emails().send(request, "order-123");
sendping.batch().sendEmails(requests, "digest-2026-08-08");
```

- The key must be **1–255 characters**, measured after the server trims it —
  255, not 256 (`SendPing.IDEMPOTENCY_KEY_MAX_LENGTH`). The SDK sends the key
  verbatim and lets the **server** be the authority: anything else is a
  `400 invalid_idempotency_key`.
- It is bound to the request body: reusing it with a different payload is a
  `409 invalid_idempotent_request`, and reusing it while the first call is
  still in flight is `409 concurrent_idempotent_requests`.
- Every other endpoint ignores the header, so a retry there creates a second
  resource. `events().send(request, key)` and `events().create(request, key)`
  are deprecated for exactly that reason — dedupe those on your side.

## Building from source

Plain `javac` is enough — there are no dependencies:

```bash
javac -d out $(find src/main/java -name '*.java')
```

The test suite is a set of plain `main()` runner classes (no JUnit):

```bash
javac -d out $(find src -name '*.java')
java -cp out co.sendping.tests.AllTests
```

## Documentation

Full docs: <https://www.sendping.co/docs>

## License

MIT

## Recovery and tracking contracts

Use a stable, unique operation key for each intended send, batch, reply, or
forward. Keep the same key and payload when recovering that operation. These
are the supported idempotent send endpoints; events do not implement this
header. Existing calls without options still work.

```java
sendping.emails().receiving().reply(id, reply, "reply-operation-1");
sendping.emails().receiving().forward(id, forward, "forward-operation-1");
SendPingResponse health = sendping.domains().trackingHealth(domainId);
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

# sendping-php

Official PHP SDK for the [SendPing](https://www.sendping.co) email API — send transactional and marketing email from your own verified domain.

## Requirements

PHP 8.1+ with the `curl` and `json` extensions. No other runtime dependencies.

## Install

```bash
composer require sendping/sendping
```

## Usage

```php
use SendPing\SendPing;

$sendping = SendPing::client('mb_xxxxxxxxx');

$sent = $sendping->emails->send([
    'from' => 'Acme <hello@yourdomain.com>',
    'to' => ['delivered@test.sendping.co'],
    'subject' => 'Hello from SendPing',
    'html' => '<p>Your first email 🎉</p>',
]);

echo 'sent ' . $sent['id'];
```

Every method returns the decoded JSON response as an associative array. Any non-2xx
response throws `SendPing\Exceptions\SendPingException` carrying the API error
shape:

```php
use SendPing\Exceptions\SendPingException;

try {
    $sendping->emails->send($payload);
} catch (SendPingException $e) {
    echo $e->getStatusCode(); // 422
    echo $e->getName();       // 'validation_error'
    echo $e->getMessage();    // 'domain is required'
}
```

Branch on `getName()`, and read `getStatusCode()` from the response rather than
inferring it from the name — a handler may return a name with a non-default
status (a missing `User-Agent`, for example, is `validation_error` with a 403,
and `max_active_keys` is a 429). Messages are sanitized human text and change
freely, so never match on them.

Some errors carry more than that envelope. The extras are accessors on the
exception and return `null` on an ordinary error:

```php
} catch (SendPingException $e) {
    // WHICH quota ran out, and what would clear it.
    if ($limit = $e->getLimit()) {
        echo $limit['kind'];                    // 'emails_daily'
        echo "{$limit['used']}/{$limit['limit']} used over {$limit['period']}";
        echo $limit['next_plan']['name'] ?? ''; // 'Pro'
    }

    // Reputation gates: whether waiting helps, and until when.
    if ($rep = $e->getReputation()) {
        echo $rep['scope'], $rep['retryable'] ? " until {$rep['retry_at']}" : ' (not retryable)';
    }

    // A batch that failed part way through — do NOT resend these.
    if ($sent = $e->getSent()) {
        echo "{$e->getSentCount()} already went out: " . implode(', ', array_column($sent, 'id'));
    }
}
```

`$e->getBody()` is the whole parsed error body, so a field newer than this SDK
version is still reachable.

### Attachments

Attach files by hosted URL (`path`, fetched at send time) or inline base64 (`content`):

```php
$sendping->emails->send([
    'from' => 'Acme <hello@yourdomain.com>',
    'to' => ['delivered@test.sendping.co'],
    'subject' => 'Your invoice',
    'html' => '<p>Invoice attached.</p>',
    'attachments' => [
        ['filename' => 'invoice.pdf', 'path' => 'https://yourdomain.com/invoices/invoice.pdf'],
        ['filename' => 'report.csv', 'content' => $base64Content, 'content_type' => 'text/csv'],
    ],
]);
```

### Options

```php
$sendping = SendPing::client('mb_xxxxxxxxx', [
    'baseUrl' => 'https://www.sendping.co/api', // override your API host
    'timeout' => 30,     // per-request timeout in seconds (0 = no timeout)
    'maxRetries' => 2,   // automatic retries on 429/503 (0 disables)
    // 'transport' => $fake, // any TransportInterface — see Testing
]);
```

`timeout` and `maxRetries` configure the default curl transport only; a
`transport` you supply is used as-is.

## Resources

The client exposes one property per resource, each following a consistent
(`create` / `get` / `list` / `update` / `remove`, plus resource-specific verbs) shape:

`emails` (with nested `emails->receiving`), `batch`,
`domains`, `audiences`, `contacts`, `contactProperties`, `campaigns`, `segments`,
`topics`, `templates`, `automations`, `webhooks`, `logs`, `events`,
`apiKeys` (list only — see below), `polls`.

```php
// Emails
$sendping->emails->send(['from' => …, 'to' => …, 'subject' => …, 'html' => …]);
$sendping->emails->list(['limit' => 20, 'after' => $cursor]); // cursor pagination
$sendping->emails->list(['status' => 'bounced', 'search' => 'ada@']); // server-side filters
$sendping->emails->list(['folder' => 'scheduled']); // outbox | sent | scheduled | failed — any other value is rejected (422)
$sendping->emails->get($id);
$sendping->emails->sources();                                 // per-campaign/automation send metrics
$sendping->emails->listAttachments(id: $id);
$sendping->emails->getAttachment(id: $id, attachmentId: $attachmentId);
$sendping->emails->update($id, ['scheduled_at' => $ts]);      // reschedule
$sendping->emails->cancel($id);

// Inbound email
$sendping->emails->receiving->list();
$sendping->emails->receiving->listAddresses();                    // per-address inbound stats
$sendping->emails->receiving->get($id);
$sendping->emails->receiving->forward($id, ['from' => 'me@yourdomain.com', 'to' => 'team@you.com']);
$sendping->emails->receiving->reply($id, ['from' => 'me@yourdomain.com', 'text' => 'Thanks!']);
$bytes = $sendping->emails->receiving->getAttachment($id, $attachmentId); // raw bytes
$mime = $sendping->emails->receiving->getRaw($id);                        // raw RFC822

// Batch send (alias of $sendping->emails->batch())
$res = $sendping->batch->send([ /* up to 100 email payloads */ ]);
// 1-40 are sent inline (HTTP 200, no 'queued' key). 41-100 are QUEUED (HTTP 202):
// $res['queued'] === true and $res['queued_count'] === count($res['data']), and
// the mail has NOT gone out yet — the worker sends it on its next tick.
if ($res['queued'] ?? false) { /* not transmitted yet — poll $sendping->emails->get($id) */ }

// Domains (incl. claiming a domain verified elsewhere + one-click DNS)
$sendping->domains->create(['name' => 'example.com']);
$sendping->domains->verify($id);
$sendping->domains->claim(['name' => 'example.com']);
$sendping->domains->verifyClaim($id);
$sendping->domains->detectDns($id);
$sendping->domains->applyCloudflareDns($id, ['token' => $cfToken]);
$sendping->domains->mxCheck('example.com');   // live MX lookup
$csv = $sendping->domains->recordsCsv($id);   // DNS records as CSV text

// Contacts are DOMAIN-FIRST: each sending domain has its own contact pool
// (the same address on two domains is two records with separate consent).
$sendping->contacts->create(['domain' => 'example.com', 'email' => $email, 'first_name' => 'Ada']);
$sendping->contacts->list(['domain' => 'example.com']);
$sendping->contacts->get(['id' => $contactId]);                            // by contact id (exact) …
$sendping->contacts->get(['id' => $email, 'domain' => 'example.com']);     // … or by email + domain
$sendping->contacts->update(['id' => $contactId, 'unsubscribed' => true]);
$sendping->contacts->remove(['id' => $contactId]);
$sendping->contacts->batch(['audienceId' => $audienceId, 'contacts' => [ … ]]);
$sendping->contacts->batch(['domain' => 'example.com', 'contacts' => [ … ]]); // domain-first
$sendping->contacts->import(['audienceId' => $audienceId, 'csv' => $csvText]);
// Large files: mint a presigned slot, PUT the file to $slot['upload_url']
// yourself (it is a bearer credential — do not log it), then import by key.
$slot = $sendping->contacts->createImportUpload(['audienceId' => $audienceId, 'filename' => 'leads.csv', 'size' => $bytes]);
$sendping->contacts->import(['audienceId' => $audienceId, 'storage_key' => $slot['storage_key']]);
$sendping->contacts->addToSegment($contactId, $segmentId);
$sendping->contacts->updateTopics($contactId, ['topics' => [['id' => 'top_1', 'subscription' => 'opt_in']]]);

// Contact properties (custom fields)
$sendping->contactProperties->create(['key' => 'plan', 'type' => 'string']);

// Campaigns, Segments — also domain-first: 'domain' picks the contact pool the
// campaign/segment targets. Segment names are unique per domain (reusable
// across domains), and every domain carries an auto-created "General" segment.
$sendping->campaigns->create(['domain' => 'example.com', 'from' => …, 'subject' => …, 'html' => …, 'segment_id' => $segmentId]);
$sendping->campaigns->send($id, ['scheduled_at' => $ts]);
$sendping->campaigns->stats($id);       // counts, rates, top links
$sendping->campaigns->engagement($id);  // who opened / clicked / replied
$sendping->segments->create(['domain' => 'yourdomain.com', 'name' => 'VIP']);
$sendping->segments->list(['domain' => 'yourdomain.com']);
$sendping->segments->contacts($id);   // preview who matches

// Templates
$sendping->templates->create(['name' => $name, 'subject' => $subject, 'html' => $html]);
$sendping->templates->duplicate($id);
$sendping->templates->publish($id);
$sendping->emails->send(['from' => …, 'to' => …, 'template_id' => $templateId, 'variables' => ['first_name' => 'Ada']]);

// Audiences (incl. Google Sheet import)
$sendping->audiences->importSheet($audienceId, ['url' => $sheetUrl]);

// API keys (listing only — creating, re-scoping and revoking is dashboard-only)
$sendping->apiKeys->list();

// Custom events (the triggers for automations)
$sendping->events->create(['name' => 'signup.completed', 'schema' => ['plan' => 'string']]);
$sendping->events->update($eventId, ['schema' => ['plan' => 'string', 'seats' => 'number']]);

// Polls (read-only results of the in-email poll widget)
$sendping->polls->list();
$sendping->polls->get($emailId);
```

### API keys are managed in the dashboard

`apiKeys->list()` is the whole API-key surface: the SDK deliberately exposes no
method to create, re-scope or revoke a key. Key lifecycle belongs to a signed-in
dashboard session, and the API enforces it — `POST /api-keys`,
`PATCH /api-keys/:id` and `DELETE /api-keys/:id` answer `403 dashboard_only` to
any API-key caller, whatever its permission. That is the point: a key that leaks
cannot mint itself a replacement, widen its own access, or revoke the keys you
would use to shut it off. Create and revoke keys at
[sendping.co](https://www.sendping.co).

### Topics

Topics let contacts manage granular subscriptions (e.g. "Product updates").

```php
$topic = $sendping->topics->create([
    'domain' => 'example.com', // topics belong to a sending domain
    'name' => 'Product updates',
    'description' => 'New features and releases',
    'default_subscription' => 'opt_in',
]);

$sendping->topics->list(['domain' => 'example.com', 'limit' => 50]);
$sendping->topics->update($topic['id'], ['visibility' => 'private']);
$sendping->topics->remove($topic['id']);
```

### Automations

Build multi-step automations triggered by events, then inspect their runs.

Every automation belongs to one of your sending domains — `domain` is REQUIRED
on create, and `events->send()` names the domain it targets, so the same event
name across several products can never trigger the wrong automation.

```php
$automation = $sendping->automations->create([
    'name' => 'Welcome series',
    'domain' => 'yourdomain.com',
    'trigger' => 'contact.created',
]);

// Steps are only editable while the automation is disabled — new ones start
// that way, so build first and enable last (call stop() to edit a live one).
$sendping->automations->addStep($automation['id'], [
    'type' => 'send_email',
    'config' => ['template_id' => 'tmpl_welcome'],
]);
// A step update REPLACES the step rather than merging into it: send 'type' plus
// the complete 'config' every time — omitting 'type' is a 422, not "leave the
// type unchanged", and anything left out of 'config' is dropped, not preserved.
$sendping->automations->updateStep($automation['id'], $stepId, ['type' => 'delay', 'config' => ['duration' => '3 days']]);

// Or let AI draft the steps instead — also requires a stopped automation, and
// without 'attach' the automation must have no steps yet
$sendping->automations->createWithAi($automation['id'], ['prompt' => 'Welcome new signups over 3 days']);

// Enable it once the steps are in place
$sendping->automations->update($automation['id'], ['status' => 'enabled']);

// Fire a custom event — only yourdomain.com's automations are triggered
$sendping->events->send([
    'event' => 'signup.completed',
    'domain' => 'yourdomain.com',
    'email' => 'delivered@test.sendping.co',
    'payload' => ['plan' => 'pro'],
]);

// Inspect execution ('status' takes a comma-separated list)
$runs = $sendping->automations->runs($automation['id'], ['limit' => 25, 'status' => 'failed,running']);
$sendping->automations->getRun($automation['id'], $runs['data'][0]['id']);
```

### Webhooks

```php
$hook = $sendping->webhooks->create([
    // The endpoint must be https:// and must not resolve to a private address.
    'endpoint' => 'https://yourapp.com/hooks/sendping',
    'events' => ['email.delivered', 'email.bounced', 'email.unsubscribed'],
]);
// $hook['signing_secret'] is shown ONCE — store it now.

$sendping->webhooks->list();
$sendping->webhooks->update($hook['id'], ['status' => 'disabled']);
$sendping->webhooks->rotate($hook['id']); // new signing_secret, revealed once

// A failed delivery still returns HTTP 200 and does NOT throw — the outcome is
// $result['ok'], with $result['status'] (your endpoint's HTTP status, when it
// responded) and $result['error'] (e.g. 'lookup_failed').
$result = $sendping->webhooks->test($hook['id']);
if (!$result['ok']) {
    error_log("test delivery failed: {$result['error']}");
}
```

Subscribable events: `email.sent`, `email.delivered`, `email.delivery_delayed`,
`email.bounced`, `email.complained`, `email.opened`, `email.clicked`,
`email.failed`, `email.scheduled`, `email.suppressed`, `email.received`,
`email.replied`, `email.unsubscribed`, `contact.created`, `contact.updated`,
`contact.deleted`, `domain.created`, `domain.updated`, `domain.deleted`.
Anything else is rejected with a 422.

Verify a delivery's Svix-style signature in your endpoint (a pure local
HMAC-SHA256 computation — no HTTP request). Pass the EXACT raw request body:

```php
$payload = file_get_contents('php://input'); // do NOT re-serialize parsed JSON

$result = $sendping->webhooks->verify($payload, [
    'svix-id' => $_SERVER['HTTP_SVIX_ID'] ?? '',
    'svix-timestamp' => $_SERVER['HTTP_SVIX_TIMESTAMP'] ?? '',
    'svix-signature' => $_SERVER['HTTP_SVIX_SIGNATURE'] ?? '',
], $signingSecret);

if (!$result['valid']) {
    http_response_code(401); // $result['reason'] says why
}
```

Also available without a client: `SendPing\WebhookSignature::verify(...)`.

### Logs

```php
$sendping->logs->list(['limit' => 100, 'method' => 'POST', 'status' => 429]);
$sendping->logs->get($logId);
```

### Pagination

`list()` methods accept optional cursor pagination — `['limit' => …, 'after' => …, 'before' => …]` —
appended as a query string:

```php
$sendping->campaigns->list(['limit' => 25, 'after' => 'cursor_abc']);
```

`limit` must be an integer between 1 and 100 (default 20). `after` and `before`
are item ids and are mutually exclusive — passing both is a 422. Every list
response is `['object' => 'list', 'has_more' => bool, 'data' => [...]]`; there is
no total and no next cursor, so page forward with the last `data` item's `id` as
`after`. An unknown cursor returns an empty page, not an error.

Note that some list endpoints skip the 20-row default when you pass no
pagination params at all, returning everything up to a hard ceiling of **1,000
rows** instead — `domains`, `apiKeys`, `topics`, `campaigns`, `contacts`,
`contactProperties`, `segments`, `polls`, `segments->contacts()`,
`contacts->listSegments()`, `contacts->getTopics()` and
`emails->receiving->listAttachments()`. Do not read that as "the whole
collection": past 1,000 rows the response is truncated and `has_more` is
`true`, so page with `limit` + `after` rather than relying on one unpaginated
call. The other direction is just as uneven: `templates`, `webhooks`,
`audiences`, `automations`, `automations->runs()` and `events` always cap an
unpaginated call at 20.

### Idempotency

Pass an idempotency key to safely retry a send:

```php
$sendping->emails->send($payload, ['idempotencyKey' => 'order-123']);
$sendping->batch->send($payloads, ['idempotencyKey' => 'batch-2026-08-08']);
```

The key must be **1–255 characters**, measured after the server trims it — 255,
not 256. `SendPing\Client::IDEMPOTENCY_KEY_MAX_LENGTH` carries that number.
The SDK sends the key verbatim and lets the **server** be the authority: an
out-of-range key comes back as a 400 `invalid_idempotency_key`.

Replaying a key returns the original response; reusing it with a different
payload is a 409. `emails->send()`, `batch->send()`, and received-email reply/forward honour it — every
other endpoint, including `events->send()`, still accepts an `idempotencyKey`
option and forwards it, but the API ignores it there, so a retry creates a
second resource. De-duplicate on your side instead.

### Rate limits

Only the `/emails` SEND routes are rate limited: 30 requests per minute per IP.
Reads (`GET /emails`, `GET /emails/:id`, the `receiving` subtree and attachment
listings) are NOT subject to that cap — paging a large list no longer risks a
429. Capped responses carry
`RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` headers on success
too. `automations->createWithAi()` is separately limited to 20 requests per minute per
account. The default transport retries a 429 or 503 automatically (honouring
`Retry-After`) up to `maxRetries` times.

## Testing

The HTTP transport is swappable — pass any `SendPing\Transport\TransportInterface`
implementation as `'transport'` to fake responses in your tests. A real custom
transport must send the headers it is handed verbatim: the API rejects any
request without a non-empty `User-Agent` with a 403 before it even authenticates.

The SDK's own test suite (no framework needed) runs with:

```bash
php tests/run.php
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

```php
$sendping->emails->receiving->reply($id, $reply, ['idempotencyKey' => 'reply-operation-1']);
$sendping->emails->receiving->forward($id, $forward, ['idempotencyKey' => 'forward-operation-1']);
$health = $sendping->domains->trackingHealth($domainId);
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

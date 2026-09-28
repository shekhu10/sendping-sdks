# sendping

Official Ruby SDK for the [SendPing](https://www.sendping.co) email API — send transactional and marketing email from your own verified domain.

Zero runtime dependencies: the gem uses only Ruby's standard library (`Net::HTTP`, `JSON`, `OpenSSL`).

## Install

```bash
gem install sendping
```

Or in your Gemfile:

```ruby
gem "sendping"
```

## Setup

```ruby
require "sendping"

SendPing.api_key = "mb_xxxxxxxxx"

# or
SendPing.configure do |config|
  config.api_key = ENV["SENDPING_API_KEY"]
  # config.base_url = "https://www.sendping.co/api" # override your API host
end
```

## Usage

```ruby
sent = SendPing::Emails.send({
  from: "Acme <hello@yourdomain.com>",
  to: ["delivered@test.sendping.co"], # the mailbox simulator (see below)
  subject: "Hello from SendPing",
  html: "<p>Your first email 🎉</p>"
})
puts sent["id"]
```

`delivered@test.sendping.co` is SendPing's mailbox simulator: the send is accepted, produces a real email object and a delivery event, and never reaches a provider. `bounced@`, `complained@` and `suppressed@test.sendping.co` exercise the other outcomes, and `delivered@` / `bounced@` / `complained@` accept a `+label` suffix (`delivered+signup@test.sendping.co`). Do **not** point a send at `example.com`, `example.net`, `example.org`, or an address under `.test`, `.invalid`, `.localhost` or `.example`: those are reserved for documentation, so every recipient is suppressed and the call comes back 422 `validation_error` ("All `to` recipients are suppressed") having sent nothing. They are fine as *contact* records — only the send path rejects them.

Params are plain hashes with snake_case keys, passed through as JSON. Successful calls return the parsed response (a Hash, or a raw String for binary downloads). Any non-2xx response raises `SendPing::Error`:

```ruby
begin
  SendPing::Emails.send(params)
rescue SendPing::Error => e
  puts e.status_code # => 422
  puts e.name        # => "validation_error"
  puts e.message     # => human-readable explanation
end
```

Branch on `e.name`, never on `e.message` — messages are sanitized server-side and may change. The same `name` can arrive with different HTTP statuses depending on the endpoint, so read `e.status_code` rather than assuming one. Common names: `missing_api_key` (401), `restricted_api_key` (401, the key lacks the scope), `invalid_api_key` (403), `validation_error` (422), `not_found` (404), `plan_limit_reached` (402), `daily_quota_exceeded` / `monthly_quota_exceeded` / `rate_limit_exceeded` (429).

Some errors carry more than that envelope. The extras are readers on the error and are `nil` on an ordinary one:

```ruby
rescue SendPing::Error => e
  # WHICH quota ran out, and what would clear it.
  if (cap = e.limit)
    cap["kind"]                    # => "emails_daily"
    cap["used"], cap["limit"]      # => 100, 100
    cap["period"]                  # => "24h"
    cap.dig("next_plan", "name")   # => "Pro"
  end

  # Reputation gates: whether waiting helps, and until when.
  if (rep = e.reputation)
    rep["retryable"], rep["scope"], rep["retry_at"]
  end

  # A batch that failed part way through — do NOT resend these.
  if (sent = e.sent)
    puts "#{e.sent_count} already went out: #{sent.map { |s| s['id'] }.join(', ')}"
  end
end
```

`e.body` is the whole parsed error body, so a field newer than this SDK version is still reachable.

Every request carries a `User-Agent` automatically — the API rejects requests without one with a 403 `validation_error`.

## Domain-first model

SendPing is **domain-first**: each sending domain has its own pool of contacts. The same email address on two domains is two records with separate consent, so unsubscribes on one product never leak into another.

That means `domain` (the sending domain, e.g. `"yourdomain.com"` — one of your verified domains) is **required** on:

- `Contacts.create` / `Contacts.list` (the flat `/contacts` API — pass `audience_id:` to use the nested audience routes instead)
- `Segments.create` / `Segments.list`
- `Topics.create` / `Topics.list`
- `Campaigns.create` (picks the contact pool the campaign targets; `from` may be a different verified domain)
- `Automations.create` and `Events.send` (only automations belonging to that domain are triggered)

## Emails

```ruby
SendPing::Emails.send({ from: from, to: to, subject: subject, html: html })
SendPing::Emails.list({ limit: 20, after: cursor })   # cursor pagination
SendPing::Emails.list({ status: "bounced", search: "acme.com" }) # filters
SendPing::Emails.list({ folder: "scheduled" }) # one of outbox | sent | scheduled | failed — any other value is rejected (422)
SendPing::Emails.sources                              # per-campaign/automation send metrics
SendPing::Emails.get(email_id)
SendPing::Emails.list_attachments(email_id)
SendPing::Emails.get_attachment(email_id, attachment_id)
SendPing::Emails.update(email_id, { scheduled_at: "2026-08-01T09:00:00Z" }) # reschedule
SendPing::Emails.cancel(email_id)

# Batch send — up to 100 emails in one request.
# Batch items reject `attachments` and `scheduled_at` (422) — send those individually.
SendPing::Batch.send([
  { from: from, to: ["delivered+a@test.sendping.co"], subject: "Hi A", html: "<p>A</p>" },
  { from: from, to: ["delivered+b@test.sendping.co"], subject: "Hi B", html: "<p>B</p>" }
])

# Attachments: hosted URL (path) or inline base64 (content)
SendPing::Emails.send({
  from: from, to: to, subject: "Your invoice", html: "<p>Attached.</p>",
  attachments: [
    { filename: "invoice.pdf", path: "https://yourdomain.com/invoices/invoice.pdf" },
    { filename: "report.csv", content: base64_content, content_type: "text/csv" }
  ]
})
```

### Inbound email

```ruby
SendPing::Emails::Receiving.list
SendPing::Emails::Receiving.list_addresses # per-address inbound stats
SendPing::Emails::Receiving.get(id)
SendPing::Emails::Receiving.list_attachments(id)
SendPing::Emails::Receiving.get_attachment(id, attachment_id) # => raw bytes (String)
SendPing::Emails::Receiving.get_raw(id)                           # => original RFC822 message
SendPing::Emails::Receiving.forward(id, { from: "you@yourdomain.com", to: "team@you.com" })
SendPing::Emails::Receiving.reply(id, { from: "you@yourdomain.com", html: "<p>Thanks!</p>" })
SendPing::Emails::Receiving.delete(id)
```

## Domains

```ruby
SendPing::Domains.create({ name: "yourdomain.com" })
SendPing::Domains.get(id)
SendPing::Domains.list
SendPing::Domains.update(id, { click_tracking: true })
SendPing::Domains.verify(id)
SendPing::Domains.mx_check("yourdomain.com") # inspect live MX before enabling receiving
SendPing::Domains.records_csv(id)            # => CSV text (String)
SendPing::Domains.delete(id)

# Claim a domain verified in another account
SendPing::Domains.claim({ name: "yourdomain.com" })
SendPing::Domains.get_claim(id)
SendPing::Domains.verify_claim(id)

# One-click DNS setup
SendPing::Domains.detect_dns(id)
SendPing::Domains.apply_cloudflare_dns(id, { token: cf_token })
SendPing::Domains.apply_godaddy_dns(id, { key: key, secret: secret })
SendPing::Domains.apply_namecheap_dns(id, { apiUser: user, apiKey: key })
```

## Contacts (domain-first)

```ruby
SendPing::Contacts.create({ domain: "yourdomain.com", email: "user@example.com", first_name: "Ada" })
SendPing::Contacts.list({ domain: "yourdomain.com" })
SendPing::Contacts.get({ id: contact_id })                                # by id (exact) …
SendPing::Contacts.get({ id: "user@example.com", domain: "yourdomain.com" }) # … or email + domain
SendPing::Contacts.update({ id: contact_id, unsubscribed: true })
SendPing::Contacts.delete({ id: contact_id })

# Nested audience variants
SendPing::Contacts.create({ audience_id: aud_id, email: "user@example.com" })
SendPing::Contacts.list({ audience_id: aud_id, segment_id: seg_id })

# Bulk import
SendPing::Contacts.batch({ audience_id: aud_id, contacts: [{ email: "a@b.com" }], on_conflict: "skip" })
# Domain-first: import straight into a domain's pool, no audience id needed.
SendPing::Contacts.batch({ domain: "yourdomain.com", contacts: [{ email: "a@b.com" }] })
SendPing::Contacts.import({ audience_id: aud_id, csv: "email,company\na@b.com,Acme" })

# CSV too big to inline (5 MB / 10,000 rows)? Upload it directly, then import by key.
slot = SendPing::Contacts.create_import_upload({ audience_id: aud_id, filename: "list.csv", size: bytes })
# PUT the file to slot["upload_url"], then:
SendPing::Contacts.import({ audience_id: aud_id, storage_key: slot["storage_key"] })

# Segments & topics per contact
SendPing::Contacts.add_to_segment(contact_id, segment_id)
SendPing::Contacts.remove_from_segment(contact_id, segment_id)
SendPing::Contacts.list_segments(contact_id)
SendPing::Contacts.get_topics(contact_id)
SendPing::Contacts.update_topics(contact_id, { topics: [{ id: topic_id, subscription: "opt_in" }] })

# Custom contact properties ({{merge_tags}})
SendPing::ContactProperties.create({ key: "plan", type: "string", fallback_value: "free" })
```

## Audiences

```ruby
SendPing::Audiences.create({ name: "Newsletter" })
SendPing::Audiences.get(id)
SendPing::Audiences.list
SendPing::Audiences.update(id, { name: "Weekly newsletter" })
SendPing::Audiences.delete(id)

# Import from a link-shared Google Sheet
SendPing::Audiences.import_sheet(id, { url: sheet_url, segment_name: "June leads" })
```

## Segments & Topics (domain-first)

```ruby
SendPing::Segments.create({ domain: "yourdomain.com", name: "VIP", filter: { status: "subscribed" } })
SendPing::Segments.list({ domain: "yourdomain.com" })
SendPing::Segments.get(id)
SendPing::Segments.contacts(id) # preview who matches
SendPing::Segments.update(id, { name: "VIP customers" })
SendPing::Segments.delete(id)

SendPing::Topics.create({ domain: "yourdomain.com", name: "Product updates", default_subscription: "opt_in" })
SendPing::Topics.list({ domain: "yourdomain.com" })
SendPing::Topics.update(id, { description: "New features" })
SendPing::Topics.delete(id)
```

## Campaigns (domain-first)

```ruby
campaign = SendPing::Campaigns.create({
  domain: "yourdomain.com", # REQUIRED — the contact pool this campaign targets
  from: "Acme <hello@yourdomain.com>",
  subject: "Big news",
  html: "<p>Hello {{first_name}}</p>",
  segment_id: seg_id # optional — subset instead of everyone
})

SendPing::Campaigns.send(campaign["id"])                                    # send now
SendPing::Campaigns.send(campaign["id"], { scheduled_at: "2026-08-01T09:00:00Z" }) # or schedule
SendPing::Campaigns.cancel(campaign["id"])
SendPing::Campaigns.stats(campaign["id"])
SendPing::Campaigns.engagement(campaign["id"]) # who opened / clicked / replied
SendPing::Campaigns.ab(campaign["id"]) # A/B winner evaluation
SendPing::Campaigns.get(campaign["id"])
SendPing::Campaigns.list({ limit: 25 })
SendPing::Campaigns.update(campaign["id"], { subject: "Bigger news" })
SendPing::Campaigns.delete(campaign["id"])
```

## Templates

```ruby
tmpl = SendPing::Templates.create({ name: "Welcome", subject: "Welcome!", html: "<p>Hi {{first_name}}</p>" })
SendPing::Templates.publish(tmpl["id"])
SendPing::Templates.duplicate(tmpl["id"], { name: "Welcome v2" })
SendPing::Templates.get(tmpl["id"])
SendPing::Templates.list
SendPing::Templates.update(tmpl["id"], { subject: "Welcome aboard!" })
SendPing::Templates.delete(tmpl["id"])

# Send with a template
SendPing::Emails.send({ from: from, to: to, template_id: tmpl["id"], variables: { first_name: "Ada" } })
```

## Automations & Events (domain-first)

```ruby
automation = SendPing::Automations.create({
  name: "Welcome series",
  domain: "yourdomain.com", # REQUIRED
  trigger: "contact.created"
})

SendPing::Automations.add_step(automation["id"], { type: "send_email", config: { template_id: tmpl_id } })
# `type` is REQUIRED on update_step: PATCH re-validates the whole step and
# `config` REPLACES the stored config wholesale (there is no merge), so resend
# every key you want to keep. A step's graph `key` is create-only — settable on
# add_step, ignored here — so delete and re-add a step to re-key it.
SendPing::Automations.update_step(automation["id"], step_id, { type: "send_email", config: { template_id: tmpl_id, subject: "New subject" } })
SendPing::Automations.update(automation["id"], { status: "enabled" })

# Or describe the flow and let the server build the steps (automation must be stopped)
SendPing::Automations.create_with_ai(automation["id"], { prompt: "Wait 2 days, then send the onboarding email" })

# Fire a custom event — only yourdomain.com's automations are triggered
SendPing::Events.send({
  event: "signup.completed",
  domain: "yourdomain.com", # REQUIRED
  email: "user@example.com",
  payload: { plan: "pro" }
})

# Event definitions — schema types are "string", "number", "boolean" or "date".
# Event names cannot start with the reserved "sendping:" prefix.
SendPing::Events.create({ name: "signup.completed", schema: { plan: "string" } })
SendPing::Events.list
SendPing::Events.update(event_id, { schema: { plan: "string", seats: "number" } }) # name is immutable
SendPing::Events.delete(event_id)

# Inspect execution
runs = SendPing::Automations.runs(automation["id"], { limit: 25, status: ["failed"] })
SendPing::Automations.get_run(automation["id"], runs["data"].first["id"])
SendPing::Automations.delete_step(automation["id"], step_id)
SendPing::Automations.stop(automation["id"])
SendPing::Automations.delete(automation["id"])
```

## Webhooks

```ruby
hook = SendPing::Webhooks.create({
  endpoint: "https://yourapp.com/hooks/sendping",
  events: ["email.delivered", "email.bounced", "email.unsubscribed"]
})
hook["signing_secret"] # shown ONCE — store it

SendPing::Webhooks.list
SendPing::Webhooks.update(hook["id"], { status: "disabled" })
SendPing::Webhooks.rotate(hook["id"]) # new secret returned once
SendPing::Webhooks.test(hook["id"])
SendPing::Webhooks.delete(hook["id"])
```

Endpoints must be `https://` and must not resolve to a private address. Valid event names are `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`, `email.failed`, `email.scheduled`, `email.suppressed`, `email.received`, `email.replied`, `email.unsubscribed`, `contact.created`, `contact.updated`, `contact.deleted`, `domain.created`, `domain.updated` and `domain.deleted`. Anything else is a 422.

`Webhooks.test` returns HTTP 200 even when the delivery failed — it does not raise. The outcome is `result["ok"]`, with `result["status"]` (your endpoint's HTTP status, when it responded) and `result["error"]` (e.g. `"lookup_failed"`):

```ruby
result = SendPing::Webhooks.test(hook["id"])
warn "test delivery failed: #{result['error']}" unless result["ok"]
```

### Verifying deliveries

`verify` checks the Svix-style HMAC-SHA256 signature locally (no HTTP request). Pass the **exact raw request body** — re-serializing parsed JSON breaks the signature.

```ruby
result = SendPing::Webhooks.verify(
  request.raw_post,          # raw body string
  {
    "svix-id" => request.headers["svix-id"],
    "svix-timestamp" => request.headers["svix-timestamp"],
    "svix-signature" => request.headers["svix-signature"]
  },
  signing_secret             # the whsec_... secret from create/rotate
)

head :unauthorized unless result[:valid]
# result => { valid: true } or { valid: false, reason: "no_match" | "timestamp_out_of_tolerance" | ... }
```

Pass `tolerance: 0` to skip the timestamp freshness check (default 300 seconds).

## API keys, Logs & Polls

```ruby
SendPing::ApiKeys.list # `token` is the 8-character display prefix, never the secret

SendPing::Logs.list({ limit: 100, method: "POST", status: 429 })
SendPing::Logs.get(log_id)

SendPing::Polls.list
SendPing::Polls.get(email_id) # aggregated answer breakdown
```

`SendPing::ApiKeys.list` is the whole API-key surface: the SDK deliberately
exposes no method to create, re-scope or revoke a key. Key lifecycle belongs to
a signed-in dashboard session, and the API enforces it — `POST /api-keys`,
`PATCH /api-keys/:id` and `DELETE /api-keys/:id` answer `403 dashboard_only` to
any API-key caller, whatever its permission. That is the point: a key that leaks
cannot mint itself a replacement, widen its own access, or revoke the keys you
would use to shut it off. Create and revoke keys at
[sendping.co](https://www.sendping.co).

## Pagination

`list` methods accept cursor pagination — `{ limit:, after:, before: }` — appended as a query string:

```ruby
page = SendPing::Campaigns.list({ limit: 25, after: "cursor_abc" })
page["object"]   # => "list"
page["has_more"] # => true when more rows exist beyond this page
page["data"]     # => [...]
```

`limit` is an integer between 1 and 100 (default 20); `after` and `before` are item ids and cannot be combined. An unknown cursor returns an empty page, not an error. There is no `total` and no `next_cursor` — page forward with the last `data` entry's `id` as `after`.

Defaults differ per endpoint. `GET /templates`, `/webhooks`, `/audiences`, `/automations`, `/events` and `/automations/:id/runs` cap an unpaginated call at 20 rows. `/domains`, `/api-keys`, `/topics`, `/campaigns`, `/contacts`, `/contact-properties`, `/segments` and `/polls` instead return the collection in one response when you pass neither `limit` nor a cursor — but still bounded, at 1,000 rows. That ceiling is not silent: `has_more` is `true` when it bites, so keep paging with `after` rather than treating the first response as the whole table. Always pass `limit` if you depend on page size.

## Idempotency

Pass an idempotency key to safely retry a send.

```ruby
SendPing::Emails.send(payload, { idempotency_key: "order-123" })
SendPing::Batch.send(payloads, { idempotency_key: "orders-2026-08-08" })
```

The key must be **1–255 characters**, measured after the server trims it — 255, not 256. `SendPing::Client::IDEMPOTENCY_KEY_MAX_LENGTH` carries that number. The SDK sends the key verbatim and lets the **server** be the authority: an out-of-range key comes back as `400 invalid_idempotency_key` (a `SendPing::Error` with `name == "invalid_idempotency_key"`).

Reusing a key replays the original response; reusing it with a *different* body is a 409 (`invalid_idempotent_request`), and a second request while the first is still in flight is a 409 (`concurrent_idempotent_requests`).

`Emails.send`, `Batch.send`, and received-email reply/forward honour the header. Every other endpoint — including `Events.send` — accepts and forwards it but the API ignores it, so a retry there creates a second record. De-duplicate on your side instead.

## Rate limits

Only the `/emails` **send** routes are rate-limited: **30 requests per minute per IP**. Reads (`GET /emails`, `GET /emails/:id`, the `receiving` subtree and attachment listings) are NOT subject to that cap, so paging a large list no longer risks a 429. Capped responses carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` headers (on successes too) so you can throttle before being rejected. The SDK retries a 429 or 503 automatically — up to `SendPing.max_retries` times (default 2), honouring `Retry-After`.

## Documentation

Full docs: <https://www.sendping.co/docs>

## License

MIT

## Recovery and tracking contracts

Use a stable, unique operation key for each intended send, batch, reply, or
forward. Keep the same key and payload when recovering that operation. These
are the supported idempotent send endpoints; events do not implement this
header. Existing calls without options still work.

```ruby
SendPing::Emails::Receiving.reply(id, reply, idempotency_key: "reply-operation-1")
SendPing::Emails::Receiving.forward(id, forward, idempotency_key: "forward-operation-1")
health = SendPing::Domains.tracking_health(domain_id)
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

// Public types for the SendPing SDK. These mirror the REST API shapes.

/** The plan/quota detail attached to a limit rejection (see {@link SendPingError.limit}). */
export interface PlanLimitDetail {
  kind:
    | 'emails_daily' | 'emails_monthly' | 'domains' | 'automation_runs'
    | 'ai_credits' | 'contacts' | 'campaign_preflight' | (string & {});
  used: number;
  limit: number;
  requested?: number;
  remaining?: number;
  /** Rolling window the limit is measured over. */
  period?: '24h' | '30d' | (string & {});
  plan: { id: string; name: string };
  /** The cheapest plan that would fit, or `null` when only Enterprise does. */
  next_plan?: {
    id: string; name: string; amount: number; currency: string;
    monthly_emails: number; daily_emails: number; domains: number;
    contacts: number; ai_credits: number; automation_runs: number;
  } | null;
  /** Top-up credits — present only for the email-quota kinds. */
  credits?: { balance: number; needed: number; purchasable: boolean; unit: number; amount_per_unit_cents: number };
}

/**
 * The reputation-gate detail attached to `reputation_paused` /
 * `reputation_limit_exceeded` and the platform-wide
 * `sending_service_unavailable` (see {@link SendPingError.reputation}).
 *
 * Everything beyond `retryable` and `scope` is optional. The index signature
 * keeps any reputation field newer than this SDK version reachable.
 */
export interface ReputationDetail {
  /**
   * Whether waiting and retrying can succeed (a warm-up capacity ceiling)
   * rather than the send being blocked outright.
   */
  retryable: boolean;
  /** What was gated. */
  scope: 'tenant' | 'domain' | 'platform' | (string & {});
  /** The internal reputation state, when reported. */
  status?: string;
  /** Identifies the gated entity (e.g. the domain). */
  scope_key?: string;
  hourly_limit?: number;
  daily_limit?: number;
  hourly_used?: number;
  daily_used?: number;
  /** ISO 8601 timestamp for when sending may resume. */
  retry_at?: string;
  support_email?: string;
  [k: string]: unknown;
}

/**
 * The API error envelope. `statusCode` always mirrors the HTTP status, and
 * `name` is the machine-readable reason — branch on `name`, never on `message`
 * (messages are scrubbed of provider identifiers and may change).
 *
 * Some errors are a superset of the envelope; those extra fields are preserved:
 * `limit` on plan/quota rejections, `reputation` on reputation gates, and
 * `sent`/`sent_count` on a partial `batch.send` failure.
 */
export interface SendPingError {
  statusCode: number;
  name: string;
  message: string;
  /** Present on `plan_limit_reached` and every `*_quota_exceeded` / `*_limit_reached` error. */
  limit?: PlanLimitDetail;
  /** Present on `reputation_paused` / `reputation_limit_exceeded`. */
  reputation?: ReputationDetail;
  /** Emails already sent before a mid-batch failure (batch send with an Idempotency-Key). */
  sent?: Array<{ id: string }>;
  /**
   * How many emails went out before a mid-batch failure. Falls back to
   * `sent.length` when the body carried the list but not the count, so it can
   * always be trusted. Absent on errors that carry no `sent` list.
   */
  sent_count?: number;
  /** Original email for a failed/unconfirmed send. Inspect before resending. */
  id?: string;
  /** Reserved prefix, including unconfirmed provider handoffs. */
  reserved?: Array<{ id: string }>;
  /** Never-attempted tail; does not count unconfirmed reserved items. */
  unsent_count?: number;
  [k: string]: unknown;
}

/** Every method returns either { data, error: null } or { data: null, error }. */
export type Result<T> = { data: T; error: null } | { data: null; error: SendPingError };

/** Slim acknowledgement shape returned by several create/update routes. */
export interface ObjectRef<O extends string> { object: O; id: string }

export interface RequestOptions {
  /**
   * Optional `Idempotency-Key`, so a retried send is de-duplicated rather than
   * delivered twice. Must be **1–255 characters** after trimming — outside that
   * range the API replies `400 invalid_idempotency_key`.
   *
   * `emails.send`, `batch.send`, and received-email reply/forward honour it. Every other endpoint ignores
   * the header, so a retry there creates a second resource.
   */
  idempotencyKey?: string;
}

// ---- Emails ----
export interface Attachment {
  filename: string;
  /** Base64-encoded file content. Provide `content` OR `path`. */
  content?: string;
  /** A hosted URL to fetch the file from. Provide `content` OR `path`. */
  path?: string;
  content_type?: string;
  /** Content-ID for inline/related parts (renders as `cid:` references). */
  content_id?: string;
}
export interface SendEmailOptions {
  /** `you@yourdomain.com` or `Name <you@yourdomain.com>`. Max 320 characters, on a VERIFIED domain. */
  from: string;
  /** 1–50 recipients. */
  to: string | string[];
  /** No length cap. `''` is allowed; only `null`/`undefined` counts as missing. */
  subject: string;
  /** Up to 50 addresses. */
  bcc?: string | string[];
  /** Up to 50 addresses. */
  cc?: string | string[];
  reply_to?: string | string[];
  /**
   * HTML body. Write ordinary links — every destination is converted to a
   * tracked redirect AT SEND TIME (when the sending domain has click tracking
   * on): `<a href>` targets, markdown-style `[text](url)` links, and bare URLs
   * or domains (`https://…`, `www.…`, `acme.com`) in the body text. Link text
   * is preserved; content already inside `<a>` tags, attribute values, and
   * `<pre>`/`<code>` blocks are left untouched, and unsubscribe/preference
   * links are never wrapped.
   *
   * The content you send is stored and returned to you UNCHANGED — only the
   * copy delivered to the recipient carries the tracking URL.
   */
  html?: string;
  /**
   * Plain-text body, sent as the `text/plain` alternative. URLs in it are
   * rewritten to tracked redirects at send time under the same rule as `html`,
   * so a click is recorded no matter which alternative the recipient's mail
   * client renders. Everything else is sent verbatim.
   *
   * Omit to derive the text part from `html`; pass `''` to send no text part.
   */
  text?: string;
  /**
   * Inbox preview text (preheader) shown next to the subject in the
   * recipient's inbox list. Injected as a hidden element at the top of the
   * HTML body; never visible in the opened email. Max 150 characters.
   */
  preview_text?: string;
  headers?: Record<string, string>;
  /** Max 25 MB decoded per file, 40 MB decoded across all of them. */
  attachments?: Attachment[];
  /**
   * When to send: an ISO 8601 timestamp, or a relative phrase like
   * `'in 1 min'` / `'tomorrow at 9am'`. At most 30 days ahead.
   */
  scheduled_at?: string;
  /** Drop recipients unsubscribed from this topic (topic gating). */
  topic_id?: string;
  /** Send using a saved template; its subject/html/text fill any omitted field. */
  template_id?: string;
  /**
   * Nested template reference. Provide `template` OR
   * `html`/`text`, not both. `id` OR `alias` selects the template.
   */
  template?: { id?: string; alias?: string; variables?: Record<string, unknown> };
  /** Values for the template's {{ placeholder }} variables. */
  variables?: Record<string, string | number | boolean | null>;
}
/**
 * A single email in a batch send (POST /emails/batch). Identical to
 * {@link SendEmailOptions} minus `attachments` and `scheduled_at` — the batch
 * endpoint rejects both per item; send those individually via POST /emails.
 */
export type BatchEmailOptions = Omit<SendEmailOptions, 'attachments' | 'scheduled_at'>;
export interface CreateEmailResponse { id: string }

/**
 * The answer to a batch send (POST /emails/batch). The API serves a batch one
 * of two ways, chosen by its SIZE alone — and both are success, so branch on
 * `queued`, not on the absence of `error`:
 *
 * - **1–40 emails** are sent while the request is open → `200`, `queued` absent.
 *   Every id in `data` has already been handed to the mail service.
 * - **41–100 emails** are accepted, written as due-now sends and delivered in
 *   the background → `202`, `queued: true`, `queued_count` = `data.length`.
 *   The ids are real email ids from that moment (`mb.emails.get(id)` works),
 *   but they start at `scheduled` and nothing has been transmitted yet.
 *
 * A caller that only reads `data` needs no change; a caller that must know
 * whether the mail is already out has to read `queued`.
 */
export interface BatchSendResponse {
  /** One `{ id }` per email, in request order. */
  data: CreateEmailResponse[];
  /** `true` only on a queued (202) batch. ABSENT on an inline 200 — never `false`. */
  queued?: boolean;
  /** How many emails were queued. Always equals `data.length`. Present only with `queued`. */
  queued_count?: number;
}
export interface EmailEvent { type: string; created_at: string }
export interface Email {
  object: 'email';
  id: string;
  /** Provider message id; null until the send is accepted. */
  message_id?: string | null;
  from: string;
  to: string[];
  /** The sending domain this email went out on; `null` on legacy rows. */
  domain_id?: string | null;
  cc?: string[];
  bcc?: string[];
  reply_to?: string[];
  subject: string | null;
  html?: string | null;
  text?: string | null;
  status: string;
  last_event?: string;
  /** Plain-language failure reason; present (non-null) only when the send failed. */
  error?: string | null;
  scheduled_at?: string | null;
  created_at: string;
  events?: EmailEvent[];
}

/**
 * Lightweight reference returned by `mb.emails.list()` (GET /emails). The list
 * endpoint trims the full {@link Email}: there is NO `status`, `html`, `text`, or
 * `events`, and unset `cc`/`bcc`/`reply_to` come back as `null` (not `[]`).
 * Use `mb.emails.get(id)` to retrieve the full email with its event timeline.
 */
export interface SentEmailListItem {
  object: 'email';
  id: string;
  message_id: string | null;
  from: string;
  to: string[];
  /** The sending domain this email went out on; `null` on legacy rows. */
  domain_id: string | null;
  cc: string[] | null;
  bcc: string[] | null;
  reply_to: string[] | null;
  subject: string | null;
  /** Latest recorded event/state, e.g. `sent`, `delivered`, `bounced`. */
  last_event: string;
  scheduled_at: string | null;
  /** Set when the email came from a campaign send (follow-ups included). */
  campaign_id: string | null;
  /** Set when the email came from an automation run. */
  automation_id: string | null;
  created_at: string;
}

/** Params for `mb.emails.list()` — cursor pagination plus filters. */
export interface ListEmailsParams extends PaginationParams {
  /** Only emails sent by this campaign. Takes precedence over `automation_id`/`source`. */
  campaign_id?: string;
  /** Only emails sent by this automation. Ignored when `campaign_id` is set. */
  automation_id?: string;
  /** Restricts to one-off sends (no campaign/automation): `'individual'` is the whole bucket, `'api'` narrows to API-key sends (includes mail sent before the send origin was recorded), `'dashboard'` narrows to mail composed in the dashboard (composer, inbox replies/forwards). Only honored when neither `campaign_id` nor `automation_id` is set. */
  source?: 'individual' | 'api' | 'dashboard';
  /** Only emails sent from this sending domain (domain id). Composes with the source filters. */
  domain_id?: string;
  /** Match the row's latest state, e.g. `delivered` — the same value reads expose as `last_event`. Case-insensitive. */
  status?: string;
  /** Substring search across recipients, subject and sender. */
  search?: string;
  /** Mailbox folder: `outbox` (sending), `sent`, `scheduled`, or `failed`. Independent of `status`. */
  folder?: 'outbox' | 'sent' | 'scheduled' | 'failed';
}

/** One row of `mb.emails.sources()` — per-origin send metrics. */
export interface EmailSource {
  /** `'api'` rolls up one-off API-key sends (including mail sent before the send origin was recorded); `'individual'` rolls up dashboard-composed one-offs. */
  kind: 'campaign' | 'automation' | 'api' | 'individual';
  /** `null` for the `api` and `individual` roll-up rows. */
  id: string | null;
  name: string | null;
  /** `null` for `automation`, `api` and `individual` rows. */
  subject: string | null;
  status: string | null;
  total: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  failed: number;
  last_sent_at: string | null;
}

/** One row of `mb.emails.receiving.listAddresses()` — per-address inbound stats. */
export interface ReceivingAddressStats {
  address: string;
  total: number;
  replies: number;
  interested: number;
  last_received_at: string | null;
}

/** Params for `mb.emails.receiving.list()` — cursor pagination plus filters. */
export interface ListReceivedEmailsParams extends PaginationParams {
  /** Only messages received for this address (matches the `received_for` recipients). */
  received_for?: string;
}

// ---- Domains ----
export interface DomainRecord {
  record: 'DKIM' | 'SPF' | 'DMARC' | 'Tracking' | 'Receiving MX';
  name: string;
  type: 'CNAME' | 'MX' | 'TXT' | 'CAA';
  ttl: string;
  status: string;
  value: string;
  priority?: number;
}
export interface DomainCapabilities {
  sending: 'enabled' | 'disabled';
  receiving: 'enabled' | 'disabled';
}
export interface Domain {
  object: 'domain';
  id: string;
  name: string;
  /**
   * Aggregated verification status: `not_started`, `pending`, `verified`,
   * `partially_verified`, `failed`, `temporary_failure`, or `revoked` (a
   * different account verified an overlapping domain). Rows still in the
   * `claim` state are hidden from `domains.list()` — read them via
   * `domains.getClaim()`.
   */
  status: string;
  region: string;
  /**
   * The DNS zone the registrar manages (e.g. `acme.com` when `name` is
   * `replies.acme.com`). Record names should be entered relative to it.
   * Equals `name` for apex domains or while the zone is still being resolved.
   */
  zone?: string;
  created_at: string;
  records: DomainRecord[];
  /** MAIL FROM subdomain (Return-Path); always present (defaults to 'send'). */
  custom_return_path?: string;
  open_tracking?: boolean;
  click_tracking?: boolean;
  /** Open/click tracking subdomain label (null ⇒ tracking on the shared host). */
  tracking_subdomain?: string | null;
  /** Outbound TLS policy. */
  tls?: 'opportunistic' | 'enforced';
  /** Sending/receiving capabilities. */
  capabilities?: DomainCapabilities;
  tracking_domain?: string | null;
  tracking_verified?: boolean;
  /** When the DNS/provider state was last re-checked. */
  aws_last_checked_at?: string | null;
  /** Why the last re-check failed, if it did. */
  aws_check_error?: string | null;
}
export interface CreateDomainOptions {
  name: string;
  /** Sending region. Creatable: `us-east-1`, `ap-south-1`. Defaults to `us-east-1`. */
  region?: 'us-east-1' | 'ap-south-1' | (string & {});
  /** MAIL FROM subdomain (Return-Path); defaults to 'send'. */
  custom_return_path?: string;
  /** Defaults to false. */
  open_tracking?: boolean;
  /** Defaults to true. */
  click_tracking?: boolean;
  /** Serve open/click tracking from your own subdomain. Implied by `tracking_subdomain`. */
  custom_tracking?: boolean;
  /** Custom tracking host label, e.g. 'email' ⇒ email.<domain>. Defaults to 't'. */
  tracking_subdomain?: string;
  /** Outbound TLS policy. Defaults to 'opportunistic'. */
  tls?: 'opportunistic' | 'enforced';
  /** Capabilities to enable, e.g. { receiving: 'enabled' }. Wins over `receiving`. */
  capabilities?: { receiving?: 'enabled' | 'disabled' };
  /** Shorthand for `capabilities.receiving`. Defaults to false. */
  receiving?: boolean;
}
export interface UpdateDomainOptions {
  open_tracking?: boolean;
  click_tracking?: boolean;
  tracking_subdomain?: string;
  /** Enable/disable the custom open/click tracking host for this domain. */
  custom_tracking?: boolean;
  /** MAIL FROM subdomain (Return-Path); a single DNS label. */
  custom_return_path?: string;
  tls?: 'opportunistic' | 'enforced';
  capabilities?: { receiving?: 'enabled' | 'disabled' };
  /** Shorthand for `capabilities.receiving`; used only when that is absent. */
  receiving?: boolean;
}

// ---- Audiences & Contacts ----
export interface Audience {
  object: 'audience';
  id: string;
  name: string;
  /**
   * Set when this audience is a sending domain's contact POOL (domain-first
   * model: one pool per domain, lazily created). `null` on plain user-created
   * audiences. Lets you map a domain name to its pool's audience id.
   */
  domain: string | null;
  created_at: string;
}
export interface Contact {
  object: 'contact';
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  unsubscribed: boolean;
  /** Custom contact properties (own values merged over registered fallbacks). */
  properties?: Record<string, unknown>;
  created_at: string;
}
export interface CreateContactOptions {
  /**
   * The sending domain whose contact pool the contact lands in (domain-first
   * model, e.g. `'yourdomain.com'` — one of your domains). REQUIRED on the
   * flat `/contacts` API (i.e. whenever `audienceId` is omitted). The same
   * address on two domains is two records with separate consent.
   */
  domain?: string;
  /**
   * Target a specific audience via the nested
   * `/audiences/:id/contacts` API instead of `domain`.
   */
  audienceId?: string;
  email: string;
  first_name?: string;
  last_name?: string;
  unsubscribed?: boolean;
  /** Custom contact property values keyed by the property key. */
  properties?: Record<string, string | number>;
}
export interface UpdateContactOptions {
  /**
   * Disambiguates an EMAIL `id` across domains (an email can exist in several
   * domains' pools; a contact id is exact and needs no domain).
   */
  domain?: string;
  /** Audience the contact belongs to. OMIT for the flat `/contacts/:id` API. */
  audienceId?: string;
  /** Contact id OR email. */
  id: string;
  first_name?: string;
  last_name?: string;
  unsubscribed?: boolean;
  properties?: Record<string, string | number>;
}
/** A single contact in a bulk import (no audienceId — it's on the call). */
/**
 * Target + payload for a bulk contact import. Domain-first, exactly like
 * `CreateContactOptions`: pass `domain` to import into that domain's contact
 * pool via the flat `/contacts/batch` API, or `audienceId` to target one
 * audience via the nested API. When both are set, `audienceId` takes
 * precedence and `domain` is ignored.
 *
 * Prefer this over a `create()` loop for many contacts: the whole batch takes
 * the account's contact-limit lock ONCE, where a create-per-contact loop
 * serializes on it and can exhaust the server's connection pool.
 */
export interface BatchContactsOptions {
  /**
   * The sending domain whose contact pool the contacts land in (domain-first
   * model, e.g. `'yourdomain.com'`). Used when `audienceId` is omitted.
   */
  domain?: string;
  /** Target a specific audience via the nested API instead of `domain`. */
  audienceId?: string;
  /** Up to 10,000 contacts per call. */
  contacts: ContactInput[];
  /** `'skip'` leaves existing contacts untouched (default `'upsert'`). */
  on_conflict?: 'upsert' | 'skip';
}
export interface ContactInput {
  email: string;
  first_name?: string;
  last_name?: string;
  unsubscribed?: boolean;
  properties?: Record<string, string | number>;
}
/** Result of a batch / CSV contact import. */
export interface ImportContactsResponse {
  object: 'contact_import';
  imported: number; // newly inserted
  updated: number;  // existing contacts updated
  skipped: number;  // rows dropped: missing/invalid email OR left untouched under on_conflict:'skip'
  total: number;    // distinct contacts processed
  /** CSV import only — rows with no usable email. */
  invalid_rows?: number;
  /** CSV import only — rows dropped because the plan's contact cap was reached. */
  limit_skipped?: number;
  /** CSV import only — rows dropped by the importer itself (suppressed addresses, …). */
  system_skipped?: number;
  ignored_columns?: string[]; // CSV headers that matched no registered property (CSV import only)
  /** CSV import only — where the uploaded file was archived. */
  source_file?: { file_name: string; storage_key: string; archived: boolean };
  /** CSV import only — how the import sat against the plan's contact cap. */
  contact_limit?: {
    plan: { id: string; name: string };
    used_before: number;
    limit: number;
    remaining_before: number | null;
    remaining_after: number | null;
    limit_skipped: number;
    reached: boolean;
    message: string;
  };
  /** Present only when `segment_id` was supplied — how many emails joined it. */
  segment_added?: number;
}

/** Presigned direct-upload slot for a large CSV (`contacts.createImportUpload`). */
export interface ContactImportUpload {
  object: 'contact_import_upload';
  /** Pass this back to `contacts.import({ storage_key })` once the PUT completes. */
  storage_key: string;
  /** Presigned PUT URL — a bearer credential; never log it. */
  upload_url: string;
  content_type: string;
  /** Seconds until `upload_url` expires. */
  expires_in: number;
  /** Hard upload ceiling in bytes (256 MB). */
  max_bytes: number;
}

/** MX preflight result for a hostname (GET /domains/mx-check). */
export interface MxCheckResponse {
  /** Whether the hostname has any MX records. */
  has_mx: boolean;
  /** Whether every MX record points at our inbound host (receiving-ready). */
  ours: boolean;
  records: Array<{ exchange: string; priority: number }>;
}

/** Update a custom-event definition's payload schema (PATCH /events/:id). The
 * name is immutable — create a new event to rename. */
export interface UpdateEventOptions {
  schema?: Record<string, unknown> | null;
}
/** Cursor paging for listing contacts (limit ≤ 100). */
export interface ListContactsParams {
  /**
   * The sending domain whose contact pool to list (domain-first model).
   * REQUIRED on the flat `/contacts` API (i.e. whenever `audienceId` is omitted).
   */
  domain?: string;
  /** List a specific audience via the nested `/audiences/:id/contacts` API instead of `domain`. */
  audienceId?: string;
  limit?: number;
  /** Cursor: id of the last item on the previous page. */
  after?: string;
  /** Cursor: id of the first item on the next page. */
  before?: string;
  /** Restrict to members of this segment (works with or without audienceId). */
  segment_id?: string;
}

// ---- Campaigns ----
export interface Campaign {
  object: 'campaign';
  id: string;
  name: string | null;
  audience_id: string;
  /** Segment target (null ⇒ whole audience). */
  segment_id: string | null;
  /** Topic gate (null ⇒ no gating). */
  topic_id: string | null;
  from: string | null;
  subject: string | null;
  html?: string | null;
  text?: string | null;
  reply_to?: string | null;
  preview_text?: string | null;
  /**
   * `draft`, `scheduled`, `recurring`, `queued`, `paused`, `canceled`, `sent`
   * or `failed`. `queued` is the in-flight fan-out. `canceled` is terminal — a
   * `queued` campaign that was stopped part-way; it cannot be re-sent.
   */
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  /** IANA zone the schedule and daily batching are evaluated in. */
  schedule_timezone?: string | null;
  /** Max recipients fanned out per batch-day (null ⇒ all at once). */
  daily_batch_size?: number | null;
  /** Why the campaign failed, when it did. */
  failure_reason?: string | null;
  /** A/B config + decision. `{ enabled: false }` when not an A/B campaign. */
  ab_test?: CampaignAbState;
  /** Engagement follow-ups (retrieve only). */
  followups?: Array<{
    id: string; condition: string; delay: string; subject: string | null;
    html?: string | null;
    status: string; run_at: string | null; sent_count: number;
    created_at?: string | null;
  }>;
  /** Generated mailing-list To address (retrieve only; null unless list_to was set). */
  list_address?: string | null;
  /** How the unsubscribe list applied to this campaign (retrieve only). */
  unsubscribe_policy?: 'account' | 'domain' | 'ignore';
  /** Recurrence cadence (null ⇒ one-off). */
  recurrence?: { interval: CampaignRecurrence; every: number } | null;
  /** Set on auto-generated occurrences of a recurring campaign. */
  parent_campaign_id?: string | null;
  /**
   * Engagement counts — included only on GET /campaigns/:id (retrieve).
   *
   * Counts and `rates` only: the embedded block does NOT carry `links`. Call
   * `mb.campaigns.stats(id)` for the per-link click breakdown.
   */
  statistics?: CampaignStatistics;
}

/** The A/B block as READ back from the API (`{ enabled: false }` when off). */
export interface CampaignAbState {
  enabled: boolean;
  subject_b?: string | null;
  html_b?: string | null;
  text_b?: string | null;
  test_pct?: number;
  metric?: 'open' | 'click' | 'reply';
  eval_hours?: number | null;
  status?: string | null;
  winner?: string | null;
}

/**
 * One row of `mb.campaigns.list()`. The list serializer is deliberately
 * narrower than the full {@link Campaign}: no bodies, no reply_to/preview_text,
 * no follow-ups, no statistics. Use `mb.campaigns.get(id)` for those.
 */
export interface CampaignListItem {
  object: 'campaign';
  id: string;
  name: string | null;
  subject: string | null;
  audience_id: string;
  segment_id: string | null;
  /** Same vocabulary as {@link Campaign.status}. */
  status: string;
  ab_test: CampaignAbState;
  created_at: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  failure_reason: string | null;
}
/**
 * A/B-test config accepted on campaign create. When `enabled`, supply at least
 * one variant-B field (`subject_b`, `html_b`, or `text_b`). `test_pct` is the
 * percentage of the audience used for the test split; `metric` decides the winner.
 */
export interface CampaignAbTest {
  enabled: boolean;
  subject_b?: string | null;
  html_b?: string | null;
  text_b?: string | null;
  /** Percentage (1-100) of the audience used to pick the winner. Defaults to 20. */
  test_pct?: number;
  /** Winner metric. Defaults to 'open'. */
  metric?: 'open' | 'click' | 'reply';
  /** Hours (1-168) to run the test before evaluating and sending the winner. */
  eval_hours?: number;
}
/** A recurring campaign re-sends every `recurrence_every` periods. */
export type CampaignRecurrence = 'daily' | 'weekly' | 'monthly';
export interface CreateCampaignOptions {
  /**
   * REQUIRED. The sending domain whose contact pool this campaign targets
   * (e.g. `'yourdomain.com'` — one of your domains). Replaces the retired
   * `audience_id`. Orthogonal to `from`: the from address may be a different
   * verified domain (e.g. a dedicated sending subdomain).
   */
  domain: string;
  from: string;
  subject: string;
  /**
   * HTML body. Write ordinary links — every destination is converted to a
   * tracked redirect AT SEND TIME (when the sending domain has click tracking
   * on): `<a href>` targets, markdown-style `[text](url)` links, and bare URLs
   * or domains (`https://…`, `www.…`, `acme.com`) in the body text. Link text
   * is preserved; content already inside `<a>` tags, attribute values, and
   * `<pre>`/`<code>` blocks are left untouched, and unsubscribe/preference
   * links are never wrapped.
   *
   * The content you send is stored and returned to you UNCHANGED — only the
   * copy delivered to the recipient carries the tracking URL.
   */
  html?: string;
  /**
   * Plain-text body, sent as the `text/plain` alternative. URLs in it are
   * rewritten to tracked redirects at send time under the same rule as `html`,
   * so a click is recorded no matter which alternative the recipient's mail
   * client renders. Everything else is sent verbatim.
   *
   * Omit to derive the text part from `html`; pass `''` to send no text part.
   */
  text?: string;
  reply_to?: string | string[];
  preview_text?: string;
  name?: string;
  /** Target a segment (subset of the audience) instead of everyone. */
  segment_id?: string;
  /** Gate recipients by a topic subscription. */
  topic_id?: string;
  /** Make this a recurring campaign (re-sends every `recurrence_every` periods). */
  recurrence?: CampaignRecurrence;
  /** Number of periods between recurring sends (1-365). Defaults to 1. */
  recurrence_every?: number;
  /** A/B-test configuration. */
  ab_test?: CampaignAbTest;
  /**
   * Engagement follow-ups (max 5): sent `delay` after the campaign finishes to
   * recipients matching `condition`, threaded as replies to the original email.
   */
  followups?: Array<{
    condition: 'opened' | 'clicked' | 'not_opened' | 'not_clicked' | 'replied' | 'not_replied';
    /** Natural-language duration, e.g. '5 hours' or '4 days' (max 30 days). */
    delay: string;
    /** Defaults to `Re: <campaign subject>` (keeps the thread). */
    subject?: string;
    html: string;
  }>;
  /** Show a generated mailing-list address (recipient-<hex>@your-domain) as the visible To. Delivery stays individual. */
  list_to?: boolean;
  /**
   * How the unsubscribe list applies: 'account' (default — any opt-out blocks),
   * 'domain' (only this sending domain's + account-wide opt-outs block), or
   * 'ignore' (opt-outs skipped; bounced/complained addresses ALWAYS excluded).
   */
  unsubscribe_policy?: 'account' | 'domain' | 'ignore';
  /** Send immediately on create (or schedule it when `send` is true and `scheduled_at` is given). */
  send?: boolean;
  /** ISO 8601 (or natural-language) schedule used when `send` is true. */
  scheduled_at?: string;
  /**
   * IANA timezone the schedule + daily batching are evaluated in (e.g.
   * `'America/New_York'`). Defaults to the account timezone, then UTC.
   */
  schedule_timezone?: string | null;
  /**
   * Max recipients fanned out per batch-day (1-100000). Omit/null sends to
   * everyone at once.
   */
  daily_batch_size?: number | null;
}
export interface UpdateCampaignOptions {
  name?: string;
  from?: string;
  subject?: string;
  html?: string;
  text?: string;
  reply_to?: string | string[];
  preview_text?: string;
  /**
   * Re-point the campaign at another of your domains' contact pools (draft
   * campaigns only). Clears a segment/topic scoped to the old domain unless
   * the same request re-targets them.
   */
  domain?: string;
  /** Re-target a segment (pass null to clear). */
  segment_id?: string | null;
  /** Re-target a topic gate (pass null to clear). */
  topic_id?: string | null;
  /** Update the recurrence cadence. */
  recurrence?: CampaignRecurrence;
  /** Update the number of periods between recurring sends (1-365). */
  recurrence_every?: number;
  /** Update the A/B-test configuration. */
  ab_test?: CampaignAbTest;
  /**
   * Replace the pending engagement follow-ups (max 5). Same shape as on
   * create; an empty array clears them.
   */
  followups?: Array<{
    condition: 'opened' | 'clicked' | 'not_opened' | 'not_clicked' | 'replied' | 'not_replied';
    /** Natural-language duration, e.g. '5 hours' or '4 days' (max 30 days). */
    delay: string;
    /** Defaults to `Re: <campaign subject>` (keeps the thread). */
    subject?: string;
    html: string;
  }>;
  /** Enable (true) or clear (false) the generated mailing-list To address. */
  list_to?: boolean;
  /**
   * How the unsubscribe list applies: 'account' (default — any opt-out blocks),
   * 'domain' (only this sending domain's + account-wide opt-outs block), or
   * 'ignore' (opt-outs skipped; bounced/complained addresses ALWAYS excluded).
   */
  unsubscribe_policy?: 'account' | 'domain' | 'ignore';
  /**
   * IANA timezone the schedule + daily batching are evaluated in (pass null to
   * clear back to the account timezone, then UTC).
   */
  schedule_timezone?: string | null;
  /** Max recipients fanned out per batch-day (1-100000; pass null to clear). */
  daily_batch_size?: number | null;
}
/**
 * The counts-and-rates core of a campaign's analytics. This is exactly what
 * `Campaign.statistics` carries on GET /campaigns/:id — note there is no
 * `links` there; only GET /campaigns/:id/stats computes the link breakdown.
 */
export interface CampaignStatistics {
  total: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  complained: number;
  /** Percentages. Open/click/reply are over `delivered`, falling back to `total`. */
  rates: { delivery: number; open: number; click: number; reply: number; bounce: number; complaint: number };
}

/** Per-campaign analytics returned by GET /campaigns/:id/stats. */
export interface CampaignStats extends CampaignStatistics {
  object: 'campaign_stats';
  campaign_id: string;
  /** Top 50 links by clicks, then url ascending. Only this endpoint returns it. */
  links: Array<{ url: string; clicks: number }>;
}

/**
 * Per-recipient engagement returned by GET /campaigns/:id/engagement. Each
 * list is capped at 500 rows and this endpoint is NOT paginated.
 */
export interface CampaignEngagement {
  object: 'campaign_engagement';
  campaign_id: string;
  opened: Array<{ email: string; contact_id: string | null; opened_at: string; open_count: number }>;
  clicked: Array<{ email: string; contact_id: string | null; clicked_at: string; click_count: number }>;
  replied: Array<{
    email: string; contact_id: string | null; replied_at: string | null;
    received_email_id: string; subject: string | null;
    /** First 300 characters of the reply body. */
    preview: string | null;
    category: string | null; received_at: string;
  }>;
}

/**
 * A/B winner evaluation returned by GET /campaigns/:id/ab. Note `zScore` and
 * `pValue` are camelCase on the wire — that is deliberate, not a typo.
 *
 * CAUTION on units: `rate` and `lift` here are FRACTIONS (`0.25` = 25%), unlike
 * {@link CampaignStats.rates}, which are already percentages (`25` = 25%).
 * Multiply these by 100 for display; do not multiply those.
 */
export interface CampaignAbResult {
  object: 'campaign_ab';
  campaign_id: string;
  metric: 'open' | 'click' | 'reply';
  /** `rate` = conversions / sent, as a fraction (0-1). */
  a: { variant: 'A'; sent: number; conversions: number; rate: number };
  /** `rate` = conversions / sent, as a fraction (0-1). */
  b: { variant: 'B'; sent: number; conversions: number; rate: number };
  winner: 'A' | 'B';
  /** True when a variant had zero sends or the rates tied (winner defaults to A). */
  fallback: boolean;
  /** Relative lift of the winner over the loser, as a fraction (`0.25` = +25%). */
  lift: number;
  /** Signed toward the winner; `0` when undefined (zero sample or zero variance). */
  zScore: number;
  /** One-sided; `1` when undefined. */
  pValue: number;
  /** Forced to `low` when either arm has fewer than 20 sends. */
  confidence: 'low' | 'medium' | 'high';
  reason: string;
}

// ---- Segments ----
/** `members_only` matches just the explicitly added members, ignoring the filter. */
export type SegmentStatus = 'all' | 'subscribed' | 'unsubscribed' | 'members_only';
/** Operators for a custom-property segment predicate. */
export type PropertyOperator = 'eq' | 'contains' | 'exists';
/** A single custom-property predicate. `value` is required for eq/contains. */
export interface PropertyFilter {
  key: string;
  operator: PropertyOperator;
  value?: string | number | null;
}
/** Narrow a segment to contacts who did (or did not) engage with one campaign. */
export interface EngagementFilter {
  event: 'clicked' | 'not_clicked' | 'opened' | 'not_opened';
  campaign_id: string;
}
/** The filter block of a segment as read back from the API. */
export interface SegmentFilter {
  status: SegmentStatus;
  email_contains: string | null;
  property_filters: PropertyFilter[];
  engagement: EngagementFilter | null;
}
/** The filter block accepted on segment create/update (every field optional). */
export interface SegmentFilterInput {
  status?: SegmentStatus;
  email_contains?: string | null;
  /** `null` clears every property predicate. */
  property_filters?: PropertyFilter[] | null;
  /** `null` clears the engagement predicate. */
  engagement?: EngagementFilter | null;
}
export interface Segment {
  object: 'segment';
  id: string;
  audience_id: string;
  name: string;
  filter: SegmentFilter;
  created_at: string;
  updated_at: string;
}
/**
 * A row of `mb.segments.contacts()`. The segment-membership serializer is
 * reduced: there is no `object` key and no `properties`. Use
 * `mb.contacts.get({ id })` for the full contact.
 */
export interface SegmentContact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  unsubscribed: boolean;
  created_at: string | null;
}
/** A row of `mb.contacts.listSegments()` — id/name/created_at only. */
export interface ContactSegmentRef {
  id: string;
  name: string;
  created_at: string | null;
}
export interface CreateSegmentOptions {
  /**
   * REQUIRED. The sending domain this segment belongs to (e.g.
   * `'yourdomain.com'` — one of your domains). Replaces the retired
   * `audience_id`. Segment names are unique WITHIN a domain but freely
   * reusable across domains; every domain also carries an auto-created
   * "General" (all contacts) segment.
   */
  domain: string;
  name: string;
  filter?: SegmentFilterInput;
}
/** Params for listing segments — domain-scoped (only that domain's segments). */
export interface ListSegmentsParams extends PaginationParams {
  /** REQUIRED. The sending domain whose segments to list. */
  domain: string;
}
/**
 * A segment's domain cannot change — passing `domain` (or `audience_id`) here
 * is a 422. Create a new segment on the other domain instead.
 */
export interface UpdateSegmentOptions {
  name?: string;
  filter?: SegmentFilterInput;
}

// ---- Templates ----
/**
 * A declared template variable, as returned inside `Template.variables`. The
 * registry carries only the declaration — the API sends no per-variable `id`,
 * `created_at` or `updated_at`, so they are absent here rather than typed and
 * always `undefined`.
 */
export interface TemplateVariable {
  key: string;
  type: 'string' | 'number';
  fallback_value: string | number | null;
}
export interface Template {
  object: 'template';
  id: string;
  name: string;
  subject: string | null;
  from?: string | null;
  reply_to?: string | null;
  html: string | null;
  text: string | null;
  status?: string;
  /** Stable handle usable anywhere an id is accepted. */
  alias?: string | null;
  /** When the template was last published (null while only a draft exists). */
  published_at?: string | null;
  /** True when the draft has edits not yet published. (Retrieve only.) */
  has_unpublished_versions?: boolean;
  current_version_id?: string | null;
  variables?: TemplateVariable[];
  created_at: string;
  updated_at: string;
}
/**
 * A row of `mb.templates.list()`. The list serializer is narrower than the
 * full {@link Template}: no `object`, `from`, `reply_to`, `text`, `variables`
 * or `current_version_id`. Use `mb.templates.get(idOrAlias)` for those.
 */
export interface TemplateListItem {
  id: string;
  name: string;
  subject: string | null;
  html: string | null;
  /** 'draft' | 'published' */
  status: string;
  published_at: string | null;
  alias: string | null;
  has_unpublished_versions: boolean;
  created_at: string;
  updated_at: string;
}
/** A template variable definition accepted on create/update. */
export interface TemplateVariableInput {
  key: string;
  type?: 'string' | 'number';
  fallback_value?: string | number | null;
}
/** Requires `name` plus at least one of `html` / `text`. */
export interface CreateTemplateOptions {
  /** Max 255 characters. */
  name: string;
  /** Optional stable handle for sending by alias. Unique per account; max 255. */
  alias?: string | null;
  /** Max 998 characters. */
  subject?: string | null;
  /** Max 320 characters. */
  from?: string | null;
  /** Max 320 characters (an array is joined with ", " before the check). */
  reply_to?: string | string[] | null;
  html?: string | null;
  text?: string | null;
  /** At most 50 entries. */
  variables?: TemplateVariableInput[];
}
/**
 * Patches the DRAFT — it never changes `status` or the published snapshot.
 * A field present with `null` clears it; an absent field is left alone.
 * Publish with `mb.templates.publish(id)` to make the edits live.
 */
export interface UpdateTemplateOptions {
  name?: string;
  alias?: string | null;
  subject?: string | null;
  from?: string | null;
  reply_to?: string | string[] | null;
  html?: string | null;
  text?: string | null;
  variables?: TemplateVariableInput[];
}
/** Body for templates.duplicate. The copy is always a fresh draft. */
export interface DuplicateTemplateOptions {
  /** Defaults to `"<source name> (copy)"`. */
  name?: string;
  /** Must be unused. Omit to leave the copy without an alias. */
  alias?: string | null;
}

// ---- API keys ----
/**
 * An API key as returned by `mb.apiKeys.list()` (GET /api-keys).
 *
 * Listing is the only key operation the SDK offers. Creating, re-scoping and
 * revoking keys happen in the SendPing dashboard, behind a signed-in session,
 * so a leaked key cannot mint a replacement or widen its own access.
 */
export interface ApiKey {
  id: string;
  name: string;
  /**
   * Non-secret display prefix — the key's first 8 characters, e.g. `mb_ab12`;
   * `null` for legacy keys with no stored prefix. The full secret is shown
   * exactly once, in the dashboard, at the moment the key is created.
   */
  token: string | null;
  /** Derived from the key's scopes. */
  permission: 'full_access' | 'sending_access';
  /** Set when the key is scoped to exactly one sending domain (legacy). */
  domain_id: string | null;
  /** Domains the key is scoped to; `null` when unscoped. */
  domain_ids: string[] | null;
  created_at: string;
  /** Last time the key authenticated a request; `null` if never used. */
  last_used_at: string | null;
}
export interface ListResponse<T> { object: 'list'; has_more: boolean; data: T[] }
export interface RemovedResponse { object: string; id: string; deleted: true }

/** Cursor pagination params accepted by most list() methods. */
export interface PaginationParams {
  limit?: number;
  after?: string;
  before?: string;
}

// ---- Email attachments (sent) ----
// Matches the backend `toSentAttachment` shape (src/routes/emails_api.ts).
export interface AttachmentMeta {
  object: 'attachment';
  id: string;
  filename: string | null;
  content_type: string | null;
  content_disposition: string;
  content_id: string | null;
  size: number | null;
  download_url: string | null;
  expires_at: string | null;
}

// ---- Inbound / received emails ----
// Matches the backend received-email output (src/services/inbound.ts).
/**
 * One inbound attachment. The API serves this in two places whose fields differ
 * slightly, so a few are optional here:
 *
 * - embedded in {@link ReceivedEmail.attachments} — no `object`, but carries the
 *   relative `url` alias.
 * - as a row of `mb.emails.receiving.listAttachments()` — always carries
 *   `object: 'attachment'` and an `id`, and no `url`.
 *
 * `download_url` is present only when the bytes were actually persisted
 * (`downloadable: true`); fetch them with
 * `mb.emails.receiving.getAttachment(emailId, attachmentId)`.
 */
export interface ReceivedAttachment {
  /** `'attachment'` on `listAttachments()` rows; absent on embedded attachments. */
  object?: 'attachment';
  /** Always set on rows written by the current ingest; absent only on legacy embedded rows. */
  id?: string;
  filename: string | null;
  content_type: string | null;
  /**
   * Decoded size in bytes, or `null` when the stored ingest metadata carries
   * none. The two shapes differ: a `listAttachments()` row serializes `size`
   * straight off untyped jsonb and sends `null` when it is absent, while the
   * copy embedded in {@link ReceivedEmail.attachments} substitutes 0 — this
   * type covers both, so it is the union. Responses are cast through, never
   * coerced, so guard before arithmetic: `size.toFixed(1)` throws on a nulled
   * row. The sent-side sibling {@link AttachmentMeta.size} is nullable too, but
   * for its own reason: it is derived from inline base64 `content`, so an
   * attachment sent by `path` never has one.
   */
  size: number | null;
  content_id?: string;
  content_disposition?: string;
  downloadable: boolean;
  download_url?: string;
  expires_at?: string;
  /** Backward-compatible relative-path alias. Embedded attachments only. */
  url?: string;
}
export interface ReceivedEmail {
  object: 'received_email';
  id: string;
  from: string;
  to: string[];
  /**
   * The RECEIVING domain this message arrived via — the inbound counterpart of
   * {@link Email.domain_id}. Always sent (`null` on legacy rows); optional here
   * only so existing fixtures keep compiling. Read it to attribute inbound mail
   * when the account receives on more than one domain.
   */
  domain_id?: string | null;
  cc?: string[];
  bcc?: string[];
  received_for?: string[];
  subject: string | null;
  html?: string | null;
  text?: string | null;
  /** Parsed message headers as a name → value map. */
  headers?: Record<string, string>;
  message_id?: string;
  /** AI reply intent (replies only). */
  category?: 'interested' | 'neutral' | 'not_interested' | null;
  /** When this message is a reply to an email you sent, that sent email's id. */
  reply_to_email_id?: string | null;
  spf?: string;
  verdicts?: Record<string, unknown>;
  attachments?: ReceivedAttachment[];
  raw_available: boolean;
  raw?: { download_url: string; expires_at?: string };
  raw_url?: string;
  created_at: string;
}
export interface ForwardReceivedEmailOptions {
  /** A verified sending address to forward from (required by the backend). */
  from: string;
  to: string | string[];
  /** Falls back to the original subject, else "(no subject)". */
  subject?: string;
}
/**
 * Reply to a received email. The recipient is derived server-side (the
 * original's Reply-To, else its From) and the message is threaded via
 * In-Reply-To/References — you only supply the sender and body.
 */
export interface ReplyReceivedEmailOptions {
  /** A verified sending address to reply from (required by the backend). */
  from: string;
  html?: string;
  text?: string;
  /** Defaults to the original subject prefixed with "Re: ". */
  subject?: string;
}

// ---- Domain claims ----
export interface DomainClaimRecord {
  type: 'TXT';
  name: string;
  value: string | null;
  ttl: string;
}
export interface DomainClaim {
  object: 'domain_claim';
  id: string;
  name: string;
  domain_id: string;
  region: string;
  status: string;
  record: DomainClaimRecord;
  blocked_reason: string | null;
  failure_reason: string | null;
  created_at: string;
  expires_at: string;
}
export interface ClaimDomainOptions { name: string; region?: string }

// ---- Contact properties ----
// Backend only supports string | number (src/services/contact_properties.ts).
export type ContactPropertyType = 'string' | 'number';
export interface ContactProperty {
  object: 'contact_property';
  id: string;
  key: string;
  type: ContactPropertyType;
  fallback_value: string | number | null;
  created_at: string;
}

// ── Polls ────────────────────────────────────────────────────────────────────
/** One row of `polls.list()` — an email that has in-email poll responses. */
export interface Poll {
  object: 'poll';
  /** The email the poll was sent on. */
  email_id: string;
  subject: string | null;
  responses: number;
  distinct_answers: number;
  last_response_at: string | null;
}
/** A single answer's tally within a poll result. */
export interface PollAnswer {
  answer: string;
  count: number;
  /** Share of all responses, 0–100, one decimal. */
  pct: number;
}
/** `polls.get(emailId)` — the aggregated answer breakdown for one email. */
export interface PollResult {
  object: 'poll_result';
  email_id: string;
  total: number;
  unique_respondents: number;
  /** Most-voted answer first. */
  answers: PollAnswer[];
}
export interface CreateContactPropertyOptions {
  /**
   * Canonical merge-tag key: 1–50 characters, letters/digits/underscore only.
   * `name` is accepted as an alias.
   */
  key?: string;
  name?: string;
  /** Defaults to 'string'. Immutable after creation. */
  type?: ContactPropertyType;
  fallback_value?: string | number | null;
}
/** Only fallback_value is mutable; key/type are immutable. */
export interface UpdateContactPropertyOptions {
  fallback_value?: string | number | null;
}

// ---- Contact <-> topics ----
export interface ContactTopicSubscription {
  id: string;
  name: string;
  description: string | null;
  subscription: 'opt_in' | 'opt_out';
}
export interface ContactTopics {
  object: 'list';
  has_more: boolean;
  data: ContactTopicSubscription[];
}
/**
 * Replace a contact's topic subscriptions. The whole list is validated before
 * anything is written, so one bad entry rejects the request outright.
 */
export interface UpdateContactTopicsOptions {
  topics: { id: string; subscription: 'opt_in' | 'opt_out' }[];
}

// ---- Topics ----
export interface Topic {
  object: 'topic';
  id: string;
  audience_id: string;
  name: string;
  description: string | null;
  default_subscription: 'opt_in' | 'opt_out';
  visibility: 'public' | 'private';
  created_at: string;
}
export interface CreateTopicOptions {
  /**
   * REQUIRED. The sending domain this topic belongs to (e.g.
   * `'yourdomain.com'` — one of your domains). Replaces the retired
   * `audience_id`. Topic names are reusable across domains.
   */
  domain: string;
  /** Max 255 characters. */
  name: string;
  /** Required, and IMMUTABLE after creation. */
  default_subscription: 'opt_in' | 'opt_out';
  /** Defaults to 'private'. */
  visibility?: 'public' | 'private';
  /** Max 200 characters. */
  description?: string | null;
}
/** Params for listing topics — domain-scoped (only that domain's topics). */
export interface ListTopicsParams extends PaginationParams {
  /** REQUIRED. The sending domain whose topics to list. */
  domain: string;
}
/** `default_subscription` is immutable and is silently ignored here. */
export interface UpdateTopicOptions {
  /** 1–255 characters. */
  name?: string;
  /** Max 200 characters. */
  description?: string | null;
  visibility?: 'public' | 'private';
}

// ---- Automations ----
/**
 * Config for the `'sendping:schedule'` trigger: the automation fires ONCE at
 * `at`, enrolling every contact of its domain's pool. Required when the
 * trigger is `'sendping:schedule'`; not accepted on any other trigger.
 */
export interface AutomationTriggerConfig {
  /** ISO 8601 instant the automation fires (future, at most 366 days ahead). */
  at: string;
  /** IANA timezone the schedule was picked in (e.g. 'America/New_York'). */
  timezone: string;
}
export interface AutomationStep {
  /** Absent on the synthesized trigger step. */
  id?: string;
  key: string;
  type: string;
  position?: number;
  config: Record<string, unknown>;
}
export interface AutomationConnection {
  from: string;
  to: string;
  type: string;
}
export interface Automation {
  object: 'automation';
  id: string;
  audience_id: string;
  name: string;
  trigger: string;
  /**
   * The sending domain this automation belongs to. Only `events.send` calls
   * with the same `domain` trigger it. `null` on pre-domain rows (treated as
   * the account's single domain when exactly one exists).
   */
  domain: string | null;
  /** 'enabled' | 'disabled' */
  status: string;
  /** Set only on the `'sendping:schedule'` trigger; `null` otherwise. */
  trigger_config?: AutomationTriggerConfig | null;
  /** Graph key of the synthetic trigger step (`'trigger'` when unset). */
  trigger_key?: string | null;
  /**
   * The step graph. OMITTED on `automations.list()` — retrieve one automation
   * to get its steps. `steps[0]` is always the synthetic trigger step (no
   * `id`, no `position`).
   */
  steps?: AutomationStep[];
  /** Typed edges between step keys. Also omitted on `automations.list()`. */
  connections?: AutomationConnection[];
  /** Enrollment counts — included only on GET /automations/:id (retrieve). */
  enrollments?: { active: number; completed: number };
  created_at: string;
  updated_at: string;
}
export interface CreateAutomationOptions {
  name: string;
  /**
   * REQUIRED. The sending domain this automation belongs to (e.g.
   * `'yourdomain.com'` — one of your domains). Only `events.send` calls with
   * the same `domain` trigger it.
   */
  domain: string;
  /**
   * The event that starts a run. One of:
   * - `'contact.created'` (built-in audience trigger)
   * - `'sendping:schedule'` (built-in scheduled trigger — fires once at
   *   `trigger_config.at`, enrolling every contact of the domain's pool;
   *   requires `trigger_config`)
   * - an engagement event: `'email.opened'`, `'email.clicked'`, `'email.replied'`,
   *   `'email.bounced'`, `'email.delivered'` (the contact is enrolled on that event
   *   for one of your non-automation sends)
   * - any custom event name you send via `events.send`.
   * Usually supplied as a steps[0] trigger step instead.
   */
  trigger?: string;
  /**
   * Schedule for the `'sendping:schedule'` trigger ({ at, timezone }).
   * Required with that trigger; not accepted on any other.
   */
  trigger_config?: AutomationTriggerConfig;
  /** Initial status: 'enabled' | 'disabled' (default 'disabled'). */
  status?: 'enabled' | 'disabled' | (string & {});
  /** Optional inline step graph; each step may carry a `key` for connections. */
  steps?: Array<{ key?: string; type: string; config?: Record<string, unknown>; [k: string]: unknown }>;
  /** Optional typed edges between step keys. Cycles are rejected at write time. */
  connections?: Array<{ from: string; to: string; type?: AutomationConnectionType }>;
}
export interface UpdateAutomationOptions {
  /** Max 255 characters. */
  name?: string;
  status?: 'enabled' | 'disabled' | (string & {});
  /** Re-point the automation at another of your domains (disabled automations only). */
  domain?: string;
  /** Change the triggering event (disabled automations only). */
  trigger?: string;
  /** Graph key for the trigger step; only meaningful alongside `trigger`. */
  trigger_key?: string;
  /**
   * Update the `'sendping:schedule'` trigger's schedule ({ at, timezone }).
   * Only valid on automations with that trigger, and only while disabled.
   */
  trigger_config?: AutomationTriggerConfig | null;
  /** Replace the edge list (disabled automations only). */
  connections?: Array<{ from: string; to: string; type?: AutomationConnectionType }>;
}
/** The edge kinds accepted between automation steps (`'default'` aliases `'next'`). */
export type AutomationConnectionType =
  | 'next' | 'default' | 'condition_met' | 'condition_not_met' | 'event_received' | 'timeout';
/**
 * Documented step types. The internal names (`send`, `wait`) are accepted on
 * input too, and are what `steps` responses echo back.
 */
export type AutomationStepType =
  | 'delay' | 'send_email' | 'wait_for_event' | 'condition' | 'split'
  | 'add_to_segment' | 'contact_update' | 'contact_delete';
export interface AddAutomationStepOptions {
  /** The automation must be `disabled`. `'trigger'` is rejected here. */
  type: AutomationStepType | (string & {});
  /** Per-type fields may also sit at the top level of the body. */
  config?: Record<string, unknown>;
  /** Graph key used by `connections`; defaults to the new step's id. */
  key?: string;
  [k: string]: unknown;
}
/**
 * Body for `automations.updateStep()`. Separate from {@link AddAutomationStepOptions}
 * because the two endpoints do not accept the same fields.
 *
 * The step is REPLACED, not merged: the route re-runs the add-step validator and
 * overwrites type and config wholesale, so `type` is REQUIRED (omitting it is
 * `422 validation_error`, "type must be one of: …") and any per-type field you
 * leave out is dropped rather than preserved.
 *
 * `key` is create-only. Update forwards ONLY type and config to storage —
 * deliberately, so the `connections` edges pointing at this step keep resolving
 * — and a `key` in the body is discarded, with the response echoing the STORED
 * key back so the re-key looks like it worked. Set the key on `addStep()`, or
 * delete and re-add the step. `position` is server-assigned (steps append) and
 * is settable on neither endpoint.
 */
export interface UpdateAutomationStepOptions {
  /** The automation must be `disabled`. `'trigger'` is rejected here. */
  type: AutomationStepType | (string & {});
  /** Per-type fields may also sit at the top level of the body. */
  config?: Record<string, unknown>;
  /**
   * Create-only — set it on `addStep()`. Declared `never` rather than simply
   * omitted because the catch-all below would otherwise wave it through with no
   * autocomplete and no error, which is how the silent no-op reads today.
   */
  key?: never;
  [k: string]: unknown;
}
/** Params for `automations.runs()` — pagination plus a status filter. */
export interface ListAutomationRunsParams extends PaginationParams {
  /**
   * Keep only runs in these statuses (`running`, `completed`, `failed`,
   * `skipped`). Sent as a comma-separated list; filtering runs before paging.
   */
  status?: string | string[];
}
/** Body for `automations.createWithAi()` — "Create with AI". */
export interface AutomationAiOptions {
  /** Required, max 2000 characters. */
  prompt: string;
  /** Templates the plan may send; only the first 10 are used. */
  template_ids?: string[];
  /** Event names the plan may wait on; only the first 10 are used. */
  events?: string[];
  /**
   * Append to an existing graph instead of authoring a whole workflow. Without
   * it the automation must have zero steps.
   */
  attach?: {
    /** The trigger key or an existing step key. */
    from: string;
    type?: 'default' | 'condition_met' | 'condition_not_met' | 'event_received' | 'timeout';
    /** Insert before this existing step key. */
    before?: string;
  };
}
/** `automations.createWithAi()` result — the updated automation plus what AI did. */
export type AutomationAiResult = Automation & {
  ai: { added_steps: number; mode: 'workflow' | 'append' };
};
export interface AutomationRunStep {
  key: string;
  type: string;
  /** 'completed' | 'failed' | 'skipped' */
  status: string;
  started_at: string | null;
  completed_at: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
}
export interface AutomationRun {
  object: 'automation_run';
  id: string;
  contact_id: string;
  /** Email of the contact the run is for; `null` if that contact was deleted. */
  contact_email: string | null;
  /** 'running' | 'completed' | 'failed' | 'skipped' */
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  /** Present on GET /automations/:id/runs/:runId (retrieve) only. */
  automation_id?: string;
  steps?: AutomationRunStep[];
  error?: string | null;
}

// ---- Webhooks ----
/**
 * The canonical webhook event names. Short aliases are accepted on write
 * (`open`, `click`, `bounce`, `complaint`, `reply`, `unsubscribe`, `sent`,
 * `delivered`, `delivery_delayed`) but are always normalized to these before
 * being stored or returned. Anything else is a `validation_error`.
 */
export type WebhookEvent =
  | 'email.sent' | 'email.delivered' | 'email.delivery_delayed' | 'email.bounced'
  | 'email.complained' | 'email.opened' | 'email.clicked' | 'email.failed'
  | 'email.scheduled' | 'email.suppressed' | 'email.received'
  | 'email.replied' | 'email.unsubscribed'
  | 'contact.created' | 'contact.updated' | 'contact.deleted'
  | 'domain.created' | 'domain.updated' | 'domain.deleted';

/** Every canonical webhook event name, for validation or building UIs. */
export const WEBHOOK_EVENTS: readonly WebhookEvent[] = [
  'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced',
  'email.complained', 'email.opened', 'email.clicked', 'email.failed',
  'email.scheduled', 'email.suppressed', 'email.received',
  'contact.created', 'contact.updated', 'contact.deleted',
  'domain.created', 'domain.updated', 'domain.deleted',
  'email.replied', 'email.unsubscribed',
] as const;

export interface Webhook {
  object: 'webhook';
  id: string;
  endpoint: string;
  events: WebhookEvent[];
  /** 'enabled' | 'disabled' */
  status: string;
  /** Whether a signing secret is set. (The secret itself is returned ONLY on create + rotate, never on get/list.) */
  has_secret?: boolean;
  /** Timestamp of the last delivery attempt (null until first delivery). */
  last_delivery_at?: string | null;
  /** HTTP status of the last delivery attempt (null until first delivery). */
  last_delivery_status?: number | null;
  /** Consecutive delivery failure count. */
  failure_count?: number;
  created_at: string;
}
export interface CreateWebhookOptions {
  /**
   * Must be `https://` and must not resolve to a private, loopback, CGNAT or
   * link-local address — plain `http://` is rejected with `requires_https`.
   */
  endpoint: string;
  /** At least one event. Aliases are normalized to {@link WebhookEvent}. */
  events: Array<WebhookEvent | (string & {})>;
  /** Optional caller-supplied signing secret. When omitted, SendPing generates one (returned once). */
  secret?: string;
}
export interface UpdateWebhookOptions {
  endpoint?: string;
  /** Full replacement of the subscribed events, not a merge. */
  events?: Array<WebhookEvent | (string & {})>;
  /** Re-enabling also resets `failure_count` to 0. */
  status?: 'enabled' | 'disabled';
}
/**
 * Result of `webhooks.test()`. A failed delivery is still HTTP 200 — branch on
 * `ok`, never on the status code.
 */
export interface WebhookTestResult {
  object: 'webhook_test';
  id: string;
  ok: boolean;
  /** The endpoint's HTTP status, when it responded. */
  status?: number;
  /** Why the delivery failed, e.g. `lookup_failed`. */
  error?: string;
}
/**
 * The Svix-style delivery headers SendPing sends with each webhook, as a plain
 * object — Node's `req.headers` on Express and `node:http`. `webhooks.verify`
 * reads them case-insensitively, so the capitalized spellings a proxy may hand
 * you verify just the same.
 */
export interface WebhookHeaders {
  'svix-id'?: string;
  'svix-timestamp'?: string;
  'svix-signature'?: string;
  [k: string]: string | string[] | undefined;
}
/**
 * Every container `webhooks.verify` will read headers out of: a plain object, a
 * Fetch `Headers` — which is what `request.headers` IS in Next.js App Router,
 * Remix, Hono, Cloudflare Workers, Deno and Bun — or any `(name, value)`
 * iterable such as a `Map`.
 *
 * A `Headers` holds its fields internally, so it is not assignable to
 * {@link WebhookHeaders} and its own enumerable keys are `[]`. Verification used
 * to enumerate those keys, so every genuinely signed delivery on a Fetch-based
 * framework answered `missing_headers` — pointing the blame at SendPing for
 * headers that were present and a signature that was valid.
 */
export type WebhookHeaderInput =
  | WebhookHeaders
  | Headers
  | Iterable<[string, string]>;
/** Outcome of verifying a webhook delivery signature. */
export interface VerifyWebhookResult {
  /** True when the signature matches and (when checked) the timestamp is fresh. */
  valid: boolean;
  /** A machine reason when `valid` is false (e.g. 'missing_headers', 'no_match'). */
  reason?: string;
}
/** Options for webhooks.verify (timestamp tolerance). */
export interface VerifyWebhookOptions {
  /** Max allowed clock skew in seconds (default 300). Pass 0 to skip the check. */
  toleranceSec?: number;
}

// ---- Logs ----
export interface LogEntry {
  object: 'log';
  id: string;
  endpoint: string | null;
  method: string;
  response_status: number;
  user_agent: string | null;
  created_at: string;
  /** Present only on retrieve (GET /logs/:id). */
  request_body?: unknown;
  response_body?: unknown;
}

// ---- Events (automation custom events) ----
export interface SendEventOptions {
  /** The custom event name automations can trigger on. (`name` is accepted as an alias.) */
  event?: string;
  /** Alias for `event`. */
  name?: string;
  /**
   * REQUIRED. The sending domain this event belongs to (e.g. `'yourdomain.com'`
   * — one of your verified domains). Only automations belonging to that domain
   * are triggered, so the same event name (e.g. `user.created`) across several
   * products can never double-fire. Contacts auto-created by this event land in
   * the domain's own contact pool, with unsubscribe state separate per domain.
   */
  domain: string;
  /** Identify the contact by id. Provide `contact_id` OR `email`. */
  contact_id?: string;
  /** Identify the contact by email. Provide `contact_id` OR `email`. */
  email?: string;
  /** Arbitrary event payload. (`data` is accepted as an alias.) */
  payload?: Record<string, unknown>;
  /** Alias for `payload`. */
  data?: Record<string, unknown>;
}
export interface SendEventResponse {
  object: 'event';
  id: string;
  /** The event name that was ingested. */
  event?: string;
  /** The resolved contact id the event was attributed to. */
  contact_id?: string;
  /** Number of automations the event enrolled the contact into. */
  enrolled?: number;
}
export interface CreateEventOptions {
  /** The custom event name (cannot start with the reserved `sendping:` prefix). */
  name: string;
  /** Optional flat key→type schema; types: 'string' | 'number' | 'boolean' | 'date'. */
  schema?: Record<string, 'string' | 'number' | 'boolean' | 'date'>;
}
export interface EventDefinition {
  object: 'event';
  id: string;
  name: string;
  schema: Record<string, string> | null;
  created_at: string;
  updated_at: string;
}

/** HTTPS tracking readiness, separate from sending-domain DNS verification. */
export interface DomainTrackingHealth {
  custom_host: string | null;
  status: 'shared' | 'ready' | 'unavailable';
  checked_at: string;
}

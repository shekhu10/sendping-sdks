import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpClient, type ClientConfig, DEFAULT_BASE_URL, VERSION, USER_AGENT, IDEMPOTENCY_KEY_MAX_LENGTH } from './client';
import type {
  Result, RequestOptions, PaginationParams, ObjectRef,
  SendEmailOptions, BatchEmailOptions, CreateEmailResponse, BatchSendResponse, Email, SentEmailListItem,
  ListEmailsParams, ListReceivedEmailsParams, EmailSource, ReceivingAddressStats,
  AttachmentMeta, ReceivedAttachment, ReceivedEmail, ForwardReceivedEmailOptions,
  ReplyReceivedEmailOptions,
  CreateDomainOptions, UpdateDomainOptions, Domain, MxCheckResponse, DomainTrackingHealth,
  DomainClaim, ClaimDomainOptions,
  Audience, Contact, CreateContactOptions, UpdateContactOptions,
  BatchContactsOptions,
  ContactInput, ImportContactsResponse, ListContactsParams, ContactImportUpload,
  ContactTopics, UpdateContactTopicsOptions, ContactSegmentRef,
  ContactProperty, CreateContactPropertyOptions, UpdateContactPropertyOptions,
  Poll, PollResult,
  Campaign, CampaignListItem, CreateCampaignOptions, UpdateCampaignOptions,
  CampaignStats, CampaignAbResult, CampaignEngagement,
  Segment, SegmentContact, CreateSegmentOptions, UpdateSegmentOptions, ListSegmentsParams,
  Topic, CreateTopicOptions, UpdateTopicOptions, ListTopicsParams,
  Template, TemplateListItem, CreateTemplateOptions, UpdateTemplateOptions, DuplicateTemplateOptions,
  Automation, CreateAutomationOptions, UpdateAutomationOptions,
  AddAutomationStepOptions, UpdateAutomationStepOptions, AutomationStep, AutomationRun, ListAutomationRunsParams,
  AutomationAiOptions, AutomationAiResult,
  Webhook, CreateWebhookOptions, UpdateWebhookOptions, WebhookTestResult,
  WebhookHeaderInput, VerifyWebhookResult, VerifyWebhookOptions,
  LogEntry, SendEventOptions, SendEventResponse, CreateEventOptions, UpdateEventOptions, EventDefinition,
  ApiKey,
  ListResponse, RemovedResponse,
} from './types';

export * from './types';
export { DEFAULT_BASE_URL, VERSION, USER_AGENT, IDEMPOTENCY_KEY_MAX_LENGTH };

/**
 * Tagged template that percent-encodes every interpolated segment, so an id
 * like `../api-keys` or `dom_x/../../admin` can't traverse the URL path and
 * forge a request to a different endpoint. Use for all id-bearing paths; the
 * static string parts (which contain the intended `/`) pass through verbatim.
 */
function p(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce(
    (acc, s, i) => acc + s + (i < values.length ? encodeURIComponent(String(values[i])) : ''),
    '',
  );
}

/** Append `limit`/`after`/`before` to a URLSearchParams, skipping absent ones. */
function addPagination(q: URLSearchParams, params?: PaginationParams): URLSearchParams {
  if (params?.limit != null) q.set('limit', String(params.limit));
  if (params?.after != null) q.set('after', params.after);
  if (params?.before != null) q.set('before', params.before);
  return q;
}

/** Render a URLSearchParams as `?a=b`, or `''` when empty. */
function qs(q: URLSearchParams): string {
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Build a `?limit=&after=&before=` query string from pagination params. */
function paginate(params?: PaginationParams): string {
  return params ? qs(addPagination(new URLSearchParams(), params)) : '';
}

/** Inbound (received) email — accessed as `mb.emails.receiving`. */
class ReceivingEmails {
  constructor(private readonly http: HttpClient) {}
  /**
   * List received emails. GET /emails/receiving — optional `received_for` filter.
   *
   * Note the divergent default: with no `limit` and no cursor this returns up
   * to 1000 rows in one response. Pass `limit` for normal 1–100 paging.
   */
  list(params?: ListReceivedEmailsParams): Promise<Result<ListResponse<ReceivedEmail>>> {
    const q = addPagination(new URLSearchParams(), params);
    if (params?.received_for != null) q.set('received_for', params.received_for);
    return this.http.request('GET', `/emails/receiving${qs(q)}`);
  }
  /**
   * Per-address inbound stats — one row per address you receive mail for.
   * GET /emails/receiving/addresses (not paginated).
   */
  listAddresses(): Promise<Result<ListResponse<ReceivingAddressStats>>> {
    return this.http.request('GET', '/emails/receiving/addresses');
  }
  /** Retrieve a received email. GET /emails/receiving/:id */
  get(id: string): Promise<Result<ReceivedEmail>> {
    return this.http.request('GET', p`/emails/receiving/${id}`);
  }
  /**
   * List a received email's attachments. GET /emails/receiving/:id/attachments.
   *
   * With no `limit` and no cursor the response is still capped at 1000 rows
   * (the server's unpaginated ceiling) and sets `has_more: true` when it bites
   * — keep walking with `after` rather than treating one page as complete.
   */
  listAttachments(id: string, params?: PaginationParams): Promise<Result<ListResponse<ReceivedAttachment>>> {
    return this.http.request('GET', p`/emails/receiving/${id}/attachments` + paginate(params));
  }
  /**
   * Download one attachment of a received email as raw bytes.
   * GET /emails/receiving/:id/attachments/:attachmentId — this route streams the
   * binary file (not JSON), so the result `data` is an ArrayBuffer.
   */
  getAttachment(id: string, attachmentId: string): Promise<Result<ArrayBuffer>> {
    return this.http.requestRaw('GET', p`/emails/receiving/${id}/attachments/${attachmentId}`);
  }
  /**
   * Download the original RFC822/MIME message as raw bytes.
   * GET /emails/receiving/:id/raw — streams `message/rfc822`, so `data` is an
   * ArrayBuffer.
   */
  getRaw(id: string): Promise<Result<ArrayBuffer>> {
    return this.http.requestRaw('GET', p`/emails/receiving/${id}/raw`);
  }
  /** Forward a received email, attachments included. POST /emails/receiving/:id/forward */
  forward(id: string, payload: ForwardReceivedEmailOptions, options?: RequestOptions): Promise<Result<ObjectRef<'email'>>> {
    return this.http.request('POST', p`/emails/receiving/${id}/forward`, payload, options);
  }
  /**
   * Reply to a received email's sender, threaded into the same conversation
   * (In-Reply-To the received message; subject defaults to `Re: …`).
   * POST /emails/receiving/:id/reply
   */
  reply(id: string, payload: ReplyReceivedEmailOptions, options?: RequestOptions): Promise<Result<ObjectRef<'email'>>> {
    return this.http.request('POST', p`/emails/receiving/${id}/reply`, payload, options);
  }
  /** Delete a received email. DELETE /emails/receiving/:id */
  remove(id: string): Promise<Result<RemovedResponse>> {
    return this.http.request('DELETE', p`/emails/receiving/${id}`);
  }
}

class Emails {
  /** Inbound email sub-resource. */
  readonly receiving: ReceivingEmails;
  constructor(private readonly http: HttpClient) {
    this.receiving = new ReceivingEmails(http);
  }
  /** Send a single email. POST /emails */
  send(payload: SendEmailOptions, options?: RequestOptions): Promise<Result<CreateEmailResponse>> {
    return this.http.request('POST', '/emails', payload, options);
  }
  /**
   * Send up to 100 emails in one request. POST /emails/batch (alias of
   * `mb.batch.send`). Batch items reject `attachments` and `scheduled_at` —
   * send those individually via `emails.send`.
   *
   * Two modes, chosen by batch SIZE and both successful — read
   * {@link BatchSendResponse.queued} to tell them apart: up to 40 emails are
   * sent inline (`queued` absent), 41–100 are accepted and delivered in the
   * background (`queued: true`).
   *
   * An inline batch near the 40 boundary can take ~100s server-side, well past
   * this client's 30s default timeout — raise it with
   * `new SendPing(key, { timeoutMs })` if you send batches that large, and
   * always pass an `idempotencyKey`, since a client that gives up mid-request
   * cannot tell what was already sent.
   */
  batch(payloads: BatchEmailOptions[], options?: RequestOptions): Promise<Result<BatchSendResponse>> {
    return this.http.request('POST', '/emails/batch', payloads, options);
  }
  /**
   * List sent emails. GET /emails — returns trimmed {@link SentEmailListItem}s
   * (no status/html/text/events). Optional filters: `campaign_id`,
   * `automation_id`, `source` (`individual` = all one-off sends, `api` =
   * API-key one-offs, `dashboard` = dashboard-composed one-offs),
   * `domain_id`, `status` (matched
   * against `last_event`), `search` (recipients / subject / sender) and
   * `folder` (`outbox` / `sent` / `scheduled` / `failed`).
   */
  list(params?: ListEmailsParams): Promise<Result<ListResponse<SentEmailListItem>>> {
    const q = addPagination(new URLSearchParams(), params);
    if (params?.campaign_id != null) q.set('campaign_id', params.campaign_id);
    if (params?.automation_id != null) q.set('automation_id', params.automation_id);
    if (params?.source != null) q.set('source', params.source);
    if (params?.domain_id != null) q.set('domain_id', params.domain_id);
    if (params?.status != null) q.set('status', params.status);
    if (params?.search != null) q.set('search', params.search);
    if (params?.folder != null) q.set('folder', params.folder);
    return this.http.request('GET', `/emails${qs(q)}`);
  }
  /**
   * Per-source send metrics — one row per campaign and automation, plus an
   * `api` roll-up (one-off API-key sends) and an `individual` roll-up
   * (dashboard-composed one-offs). GET /emails/sources (not paginated).
   */
  sources(): Promise<Result<ListResponse<EmailSource>>> {
    return this.http.request('GET', '/emails/sources');
  }
  /** Retrieve a sent email and its events. GET /emails/:id */
  get(id: string): Promise<Result<Email>> {
    return this.http.request('GET', p`/emails/${id}`);
  }
  /** List a sent email's attachments. GET /emails/:id/attachments */
  listAttachments(id: string): Promise<Result<ListResponse<AttachmentMeta>>> {
    return this.http.request('GET', p`/emails/${id}/attachments`);
  }
  /** Retrieve one attachment of a sent email. GET /emails/:id/attachments/:attachmentId */
  getAttachment(id: string, attachmentId: string): Promise<Result<AttachmentMeta>> {
    return this.http.request('GET', p`/emails/${id}/attachments/${attachmentId}`);
  }
  /**
   * Reschedule a scheduled email — only while it is still `scheduled`.
   * `scheduled_at` is an ISO 8601 timestamp or a relative phrase like
   * `'in 1 min'`, must be in the future, and at most 30 days ahead.
   * PATCH /emails/:id
   */
  update(id: string, payload: { scheduled_at: string }): Promise<Result<ObjectRef<'email'>>> {
    return this.http.request('PATCH', p`/emails/${id}`, payload);
  }
  /** Cancel a scheduled email (only while it is still `scheduled`). POST /emails/:id/cancel */
  cancel(id: string): Promise<Result<ObjectRef<'email'>>> {
    return this.http.request('POST', p`/emails/${id}/cancel`);
  }
}

/** Batch send — `mb.batch.send([...])`. The `batch` resource. */
class Batch {
  constructor(private readonly http: HttpClient) {}
  /**
   * Send up to 100 emails in one request. POST /emails/batch. Batch items
   * reject `attachments` and `scheduled_at` — send those individually via
   * `emails.send`.
   *
   * Two modes, chosen by batch SIZE and both successful — read
   * {@link BatchSendResponse.queued} to tell them apart: up to 40 emails are
   * sent inline (`queued` absent), 41–100 are accepted and delivered in the
   * background (`queued: true`).
   *
   * An inline batch near the 40 boundary can take ~100s server-side, well past
   * this client's 30s default timeout — raise it with
   * `new SendPing(key, { timeoutMs })` if you send batches that large, and
   * always pass an `idempotencyKey`, since a client that gives up mid-request
   * cannot tell what was already sent.
   */
  send(payloads: BatchEmailOptions[], options?: RequestOptions): Promise<Result<BatchSendResponse>> {
    return this.http.request('POST', '/emails/batch', payloads, options);
  }
}

class Domains {
  /** Check custom tracking readiness; unavailable hosts schedule server-side repair. */
  trackingHealth(id: string): Promise<Result<DomainTrackingHealth>> {
    return this.http.request('GET', p`/domains/${id}/tracking-health`);
  }

  constructor(private readonly http: HttpClient) {}
  create(payload: CreateDomainOptions): Promise<Result<Domain>> {
    return this.http.request('POST', '/domains', payload);
  }
  get(id: string): Promise<Result<Domain>> {
    return this.http.request('GET', p`/domains/${id}`);
  }
  /**
   * List domains. Rows still in the `claim` state are excluded.
   *
   * With no pagination params the response is capped at 1000 rows (the
   * server's unpaginated ceiling) and sets `has_more: true` when it bites —
   * pass `limit` and walk with `after` instead of assuming one page is
   * everything.
   */
  list(params?: PaginationParams): Promise<Result<ListResponse<Domain>>> {
    return this.http.request('GET', `/domains${paginate(params)}`);
  }
  /** Returns the slim ack { object: 'domain', id }. */
  update(id: string, payload: UpdateDomainOptions): Promise<Result<ObjectRef<'domain'>>> {
    return this.http.request('PATCH', p`/domains/${id}`, payload);
  }
  /** Returns the slim ack { object: 'domain', id }. */
  verify(id: string): Promise<Result<ObjectRef<'domain'>>> {
    return this.http.request('POST', p`/domains/${id}/verify`);
  }
  /** Claim a domain already verified elsewhere. POST /domains/claim */
  claim(payload: ClaimDomainOptions): Promise<Result<DomainClaim>> {
    return this.http.request('POST', '/domains/claim', payload);
  }
  /** MX preflight for a hostname before enabling receiving: does it already have
   * MX records, and do they all point at our inbound host? GET /domains/mx-check */
  mxCheck(name: string): Promise<Result<MxCheckResponse>> {
    return this.http.request('GET', `/domains/mx-check?name=${encodeURIComponent(name)}`);
  }
  /**
   * This domain's DNS records as CSV text, ready to hand to a registrar.
   * Columns: Type,Host,Full name,Value,Priority,TTL,Purpose,Status.
   * GET /domains/:id/records.csv
   */
  recordsCsv(id: string): Promise<Result<string>> {
    return this.http.requestText('GET', p`/domains/${id}/records.csv`);
  }
  /** Retrieve a domain's claim record. GET /domains/:id/claim */
  getClaim(id: string): Promise<Result<DomainClaim>> {
    return this.http.request('GET', p`/domains/${id}/claim`);
  }
  /** Verify a domain claim. POST /domains/:id/claim/verify */
  verifyClaim(id: string): Promise<Result<DomainClaim>> {
    return this.http.request('POST', p`/domains/${id}/claim/verify`);
  }
  /**
   * Detect a domain's DNS provider and the one-click apply methods available
   * (Cloudflare token, GoDaddy key/secret, hosted Domain Connect, panel deep-link).
   * GET /domains/:id/dns/detect
   */
  detectDns(id: string): Promise<Result<{ provider: unknown; nameservers: string[]; methods: Array<Record<string, unknown>> }>> {
    return this.http.request('GET', p`/domains/${id}/dns/detect`);
  }
  /** Apply this domain's DNS records via the Cloudflare API, then auto-verify. POST /domains/:id/dns/cloudflare */
  applyCloudflareDns(id: string, payload: { token: string }): Promise<Result<Record<string, unknown>>> {
    return this.http.request('POST', p`/domains/${id}/dns/cloudflare`, payload);
  }
  /** Apply this domain's DNS records via the GoDaddy API, then auto-verify. POST /domains/:id/dns/godaddy */
  applyGoDaddyDns(id: string, payload: { key: string; secret: string }): Promise<Result<Record<string, unknown>>> {
    return this.http.request('POST', p`/domains/${id}/dns/godaddy`, payload);
  }
  /**
   * Apply this domain's DNS records via the Namecheap API (existing records are
   * preserved), then auto-verify. Namecheap must have the calling server's IP
   * whitelisted in the account's API settings. POST /domains/:id/dns/namecheap
   */
  applyNamecheapDns(id: string, payload: { apiUser: string; apiKey: string; userName?: string }): Promise<Result<Record<string, unknown>>> {
    return this.http.request('POST', p`/domains/${id}/dns/namecheap`, payload);
  }
  remove(id: string): Promise<Result<RemovedResponse>> {
    return this.http.request('DELETE', p`/domains/${id}`);
  }
}

class Audiences {
  constructor(private readonly http: HttpClient) {}
  create(payload: { name: string }): Promise<Result<Audience>> {
    return this.http.request('POST', '/audiences', payload);
  }
  get(id: string): Promise<Result<Audience>> {
    return this.http.request('GET', p`/audiences/${id}`);
  }
  list(params?: PaginationParams): Promise<Result<ListResponse<Audience>>> {
    return this.http.request('GET', `/audiences${paginate(params)}`);
  }
  /**
   * Import contacts from a link-shared Google Sheet. Header columns become
   * contact properties (usable as {{merge_tags}}); rows land in a fresh
   * segment. POST /audiences/:id/contacts/import-sheet
   */
  importSheet(audienceId: string, payload: { url: string; segment_name?: string }): Promise<Result<{
    object: 'sheet_import'; imported: number; updated: number; skipped: number; total: number;
    segment_id: string; segment_name: string; segment_added: number; variables: string[];
  }>> {
    return this.http.request('POST', `/audiences/${encodeURIComponent(audienceId)}/contacts/import-sheet`, payload);
  }
  /** Rename an audience. PATCH /audiences/:id */
  update(id: string, payload: { name: string }): Promise<Result<Audience>> {
    return this.http.request('PATCH', p`/audiences/${id}`, payload);
  }
  remove(id: string): Promise<Result<RemovedResponse>> {
    return this.http.request('DELETE', p`/audiences/${id}`);
  }
}

class Contacts {
  constructor(private readonly http: HttpClient) {}
  /**
   * Create a contact. Returns the slim ack { object: 'contact', id }.
   * Domain-first: pass `domain` to create in that domain's contact pool via
   * the flat `/contacts` API (required there), or `audienceId` to target a
   * specific audience via the nested API.
   */
  create(payload: CreateContactOptions): Promise<Result<ObjectRef<'contact'>>> {
    const { audienceId, domain, ...body } = payload;
    // The nested audience route derives its pool from the path; only the flat
    // route takes `domain` in the body.
    return audienceId
      ? this.http.request('POST', p`/audiences/${audienceId}/contacts`, body)
      : this.http.request('POST', '/contacts', { ...body, domain });
  }
  /**
   * Retrieve a contact by id or email. An id is exact; an EMAIL can exist in
   * several domains' pools, so pass `domain` to pick the pool (omitted → the
   * oldest match anywhere).
   */
  get(params: { audienceId?: string; domain?: string; id: string }): Promise<Result<Contact>> {
    const id = encodeURIComponent(params.id);
    if (params.audienceId) return this.http.request('GET', `/audiences/${encodeURIComponent(params.audienceId)}/contacts/${id}`);
    const qs = params.domain ? `?domain=${encodeURIComponent(params.domain)}` : '';
    return this.http.request('GET', `/contacts/${id}${qs}`);
  }
  /** List contacts. Domain-first: `domain` is required on the flat `/contacts` list (names the pool). */
  list(params: ListContactsParams = {}): Promise<Result<ListResponse<Contact>>> {
    const q = new URLSearchParams();
    if (params.domain != null && !params.audienceId) q.set('domain', params.domain);
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.after != null) q.set('after', params.after);
    if (params.before != null) q.set('before', params.before);
    // segment_id filter is honored by both the flat and audience-scoped list.
    if (params.segment_id != null) q.set('segment_id', params.segment_id);
    const qs = q.toString();
    const base = params.audienceId ? `/audiences/${encodeURIComponent(params.audienceId)}/contacts` : '/contacts';
    return this.http.request('GET', `${base}${qs ? `?${qs}` : ''}`);
  }
  /**
   * Bulk-import contacts from an array. Upserts by email; max 10,000 per call.
   * `on_conflict: 'skip'` leaves existing contacts untouched (default 'upsert').
   *
   * Domain-first, like `create`: pass `domain` for the flat `/contacts/batch`
   * API, or `audienceId` for the nested one. THIS is the shape to use for many
   * contacts — the batch takes the account's contact-limit lock once, while a
   * `create()` loop serializes on it per contact.
   */
  batch(params: BatchContactsOptions): Promise<Result<ImportContactsResponse>> {
    const qs = params.on_conflict ? `?on_conflict=${params.on_conflict}` : '';
    // The nested audience route derives its pool from the path; only the flat
    // route takes `domain` (accepted in the body, same as POST /contacts).
    return params.audienceId
      ? this.http.request('POST', `/audiences/${encodeURIComponent(params.audienceId)}/contacts/batch${qs}`, { contacts: params.contacts })
      : this.http.request('POST', `/contacts/batch${qs}`, { contacts: params.contacts, domain: params.domain });
  }
  /**
   * Bulk-import contacts from CSV text (header row optional). Upserts by email.
   * `on_conflict: 'skip'` leaves existing contacts untouched (default 'upsert').
   * By default every non-builtin CSV column is auto-registered as a custom property
   * (so `company`, `plan`, … survive and become `{{merge}}` tags) — same as the
   * dashboard and Google-Sheet import. Pass `create_properties: false` for strict
   * mode, where only already-registered columns are kept and the rest are returned
   * in `ignored_columns`.
   */
  import(params: {
    audienceId: string;
    /** Inline CSV text (max 5 MB / 10,000 rows). Provide `csv` OR `storage_key`. */
    csv?: string;
    /** Key from {@link Contacts.createImportUpload} once the file is uploaded — for files past the inline caps. */
    storage_key?: string;
    /** Name recorded for the archived source file (inline mode). */
    file_name?: string;
    on_conflict?: 'upsert' | 'skip';
    create_properties?: boolean;
    /** Also add every imported email to this segment (must belong to the audience). */
    segment_id?: string;
  }): Promise<Result<ImportContactsResponse>> {
    const q = new URLSearchParams();
    if (params.on_conflict) q.set('on_conflict', params.on_conflict);
    if (params.create_properties === false) q.set('create_properties', 'false');
    if (params.segment_id != null) q.set('segment_id', params.segment_id);
    const body: Record<string, unknown> = {};
    if (params.csv != null) body.csv = params.csv;
    if (params.storage_key != null) body.storage_key = params.storage_key;
    if (params.file_name != null) body.file_name = params.file_name;
    return this.http.request('POST', p`/audiences/${params.audienceId}/contacts/import` + qs(q), body);
  }
  /**
   * Mint a presigned direct-upload URL for a CSV too large for the 5 MB inline
   * import (up to 256 MB). PUT the file to `upload_url`, then call
   * `contacts.import({ audienceId, storage_key })`.
   * POST /audiences/:id/contacts/import/upload
   *
   * The returned `upload_url` is a bearer credential — never log it.
   */
  createImportUpload(params: { audienceId: string; filename: string; size: number }): Promise<Result<ContactImportUpload>> {
    return this.http.request('POST', p`/audiences/${params.audienceId}/contacts/import/upload`, {
      filename: params.filename,
      size: params.size,
    });
  }
  /**
   * Update a contact. Returns the slim ack { object: 'contact', id }. On the
   * flat API, pass `domain` when `id` is an EMAIL (disambiguates across pools).
   */
  update(payload: UpdateContactOptions): Promise<Result<ObjectRef<'contact'>>> {
    const { audienceId, domain, id, ...body } = payload;
    const eid = encodeURIComponent(id);
    // The nested audience route derives its pool from the path; the flat route
    // takes an optional `domain` in the body.
    return audienceId
      ? this.http.request('PATCH', `/audiences/${encodeURIComponent(audienceId)}/contacts/${eid}`, body)
      : this.http.request('PATCH', `/contacts/${eid}`, domain != null ? { ...body, domain } : body);
  }
  /**
   * Delete a contact. On the flat API, pass `domain` when `id` is an EMAIL
   * (disambiguates across pools).
   */
  remove(params: { audienceId?: string; domain?: string; id: string }): Promise<Result<RemovedResponse>> {
    const id = encodeURIComponent(params.id);
    if (params.audienceId) return this.http.request('DELETE', `/audiences/${encodeURIComponent(params.audienceId)}/contacts/${id}`);
    const qs = params.domain ? `?domain=${encodeURIComponent(params.domain)}` : '';
    return this.http.request('DELETE', `/contacts/${id}${qs}`);
  }
  /** Add a contact to a segment. POST /contacts/:id/segments/:segmentId → { id } (the segment id). */
  addToSegment(id: string, segmentId: string): Promise<Result<{ id: string }>> {
    return this.http.request('POST', `/contacts/${encodeURIComponent(id)}/segments/${encodeURIComponent(segmentId)}`);
  }
  /** Remove a contact from a segment. DELETE /contacts/:id/segments/:segmentId → { id, audienceId, deleted }. */
  removeFromSegment(id: string, segmentId: string): Promise<Result<{ id: string; audienceId: string; deleted: boolean }>> {
    return this.http.request('DELETE', `/contacts/${encodeURIComponent(id)}/segments/${encodeURIComponent(segmentId)}`);
  }
  /**
   * List the segments a contact belongs to. GET /contacts/:id/segments —
   * rows carry only `id`/`name`/`created_at`; use `mb.segments.get(id)` for
   * the full segment.
   */
  listSegments(id: string, params?: PaginationParams): Promise<Result<ListResponse<ContactSegmentRef>>> {
    return this.http.request('GET', p`/contacts/${id}/segments` + paginate(params));
  }
  /** Get a contact's topic subscriptions. GET /contacts/:id/topics */
  getTopics(id: string, params?: PaginationParams): Promise<Result<ContactTopics>> {
    return this.http.request('GET', p`/contacts/${id}/topics` + paginate(params));
  }
  /** Update a contact's topic subscriptions. PATCH /contacts/:id/topics → { id } (the contact id). */
  updateTopics(id: string, payload: UpdateContactTopicsOptions): Promise<Result<{ id: string }>> {
    return this.http.request('PATCH', `/contacts/${encodeURIComponent(id)}/topics`, payload);
  }
}

class ContactProperties {
  constructor(private readonly http: HttpClient) {}
  /** Returns the slim ack { object: 'contact_property', id }. */
  create(payload: CreateContactPropertyOptions): Promise<Result<ObjectRef<'contact_property'>>> {
    return this.http.request('POST', '/contact-properties', payload);
  }
  get(id: string): Promise<Result<ContactProperty>> {
    return this.http.request('GET', p`/contact-properties/${id}`);
  }
  list(params?: PaginationParams): Promise<Result<ListResponse<ContactProperty>>> {
    return this.http.request('GET', `/contact-properties${paginate(params)}`);
  }
  /** Returns the slim ack { object: 'contact_property', id }. */
  update(id: string, payload: UpdateContactPropertyOptions): Promise<Result<ObjectRef<'contact_property'>>> {
    return this.http.request('PATCH', p`/contact-properties/${id}`, payload);
  }
  remove(id: string): Promise<Result<RemovedResponse>> {
    return this.http.request('DELETE', p`/contact-properties/${id}`);
  }
}

/** Read-only results of the in-email poll widget. `mb.polls`. */
class Polls {
  constructor(private readonly http: HttpClient) {}
  /**
   * One summary row per email that has poll responses. GET /polls.
   *
   * With no `limit` the response is capped at 1000 rows (the server's
   * unpaginated ceiling) and sets `has_more: true` when it bites.
   */
  list(params?: PaginationParams): Promise<Result<ListResponse<Poll>>> {
    return this.http.request('GET', `/polls${paginate(params)}`);
  }
  /** The aggregated answer breakdown for one email. GET /polls/:emailId */
  get(emailId: string): Promise<Result<PollResult>> {
    return this.http.request('GET', `/polls/${encodeURIComponent(emailId)}`);
  }
}

/** Campaigns — bulk sends to an audience or segment. Calls the /campaigns endpoints. */
class Campaigns {
  constructor(private readonly http: HttpClient) {}
  create(payload: CreateCampaignOptions): Promise<Result<{ id: string }>> {
    return this.http.request('POST', '/campaigns', payload);
  }
  /** Retrieve one campaign, including `statistics`, `followups` and `list_address`. */
  get(id: string): Promise<Result<Campaign>> {
    return this.http.request('GET', p`/campaigns/${id}`);
  }
  /**
   * List campaigns. Rows are the trimmed {@link CampaignListItem} (no bodies,
   * no follow-ups, no statistics) — use `campaigns.get(id)` for the full
   * object.
   *
   * With no params the response is capped at 1000 rows (the server's
   * unpaginated ceiling) and sets `has_more: true` when it bites — page with
   * `limit`/`after` rather than assuming one call returns every campaign.
   */
  list(params?: PaginationParams): Promise<Result<ListResponse<CampaignListItem>>> {
    return this.http.request('GET', `/campaigns${paginate(params)}`);
  }
  update(id: string, payload: UpdateCampaignOptions): Promise<Result<{ id: string }>> {
    return this.http.request('PATCH', p`/campaigns/${id}`, payload);
  }
  /**
   * Send now, or schedule with { scheduled_at }. `schedule_timezone` (IANA
   * name) is persisted onto the campaign so daily batching evaluates
   * batch-days in that zone.
   */
  send(id: string, payload?: { scheduled_at?: string; schedule_timezone?: string }): Promise<Result<{ id: string }>> {
    return this.http.request('POST', p`/campaigns/${id}/send`, payload ?? {});
  }
  /**
   * Stop a campaign's remaining work. POST /campaigns/:id/cancel — accepted
   * only on `scheduled`, `recurring`, `paused` and `queued`; any other status
   * is a `validation_error`.
   *
   * The resulting status depends on whether the send had started:
   * - `scheduled` / `recurring` / `paused` → back to **`draft`**, editable and
   *   re-sendable; the pending job (next occurrence included) is dropped.
   * - `queued` (already fanning out) → **`canceled`**, which is TERMINAL. Part
   *   of the audience has already been mailed, so it is deliberately not
   *   re-sendable; copies already handed to the mail service cannot be
   *   recalled. What stops is every remaining recipient — for a staggered
   *   campaign, every future batch-day.
   *
   * Read `data.status` to see which happened.
   */
  cancel(id: string): Promise<Result<Campaign>> {
    return this.http.request('POST', p`/campaigns/${id}/cancel`);
  }
  /** Per-campaign analytics (counts, engagement rates, top links). GET /campaigns/:id/stats */
  stats(id: string): Promise<Result<CampaignStats>> {
    return this.http.request('GET', p`/campaigns/${id}/stats`);
  }
  /**
   * Who opened, clicked and replied. GET /campaigns/:id/engagement — NOT
   * paginated; each list is capped at 500 rows.
   */
  engagement(id: string): Promise<Result<CampaignEngagement>> {
    return this.http.request('GET', p`/campaigns/${id}/engagement`);
  }
  /** A/B winner evaluation for an A/B campaign. GET /campaigns/:id/ab */
  ab(id: string): Promise<Result<CampaignAbResult>> {
    return this.http.request('GET', p`/campaigns/${id}/ab`);
  }
  remove(id: string): Promise<Result<RemovedResponse>> {
    return this.http.request('DELETE', p`/campaigns/${id}`);
  }
}

class Segments {
  constructor(private readonly http: HttpClient) {}
  /** Create a segment on a sending domain (`domain` is required; names are unique within a domain). */
  create(payload: CreateSegmentOptions): Promise<Result<Segment>> {
    return this.http.request('POST', '/segments', payload);
  }
  get(id: string): Promise<Result<Segment>> {
    return this.http.request('GET', p`/segments/${id}`);
  }
  /** List a domain's segments (`domain` is required; includes its auto-created "General" segment). */
  list(params: ListSegmentsParams): Promise<Result<ListResponse<Segment>>> {
    const q = addPagination(new URLSearchParams({ domain: params.domain }), params);
    return this.http.request('GET', `/segments?${q.toString()}`);
  }
  /**
   * Preview the contacts a segment currently resolves to (filter matches plus
   * explicit members). Rows are the reduced {@link SegmentContact} shape — no
   * `object`, no `properties`.
   */
  contacts(id: string, params?: PaginationParams): Promise<Result<ListResponse<SegmentContact>>> {
    return this.http.request('GET', p`/segments/${id}/contacts` + paginate(params));
  }
  update(id: string, payload: UpdateSegmentOptions): Promise<Result<Segment>> {
    return this.http.request('PATCH', p`/segments/${id}`, payload);
  }
  remove(id: string): Promise<Result<RemovedResponse>> {
    return this.http.request('DELETE', p`/segments/${id}`);
  }
}

class Templates {
  constructor(private readonly http: HttpClient) {}
  /** Returns the slim ack { object: 'template', id }. */
  create(payload: CreateTemplateOptions): Promise<Result<ObjectRef<'template'>>> {
    return this.http.request('POST', '/templates', payload);
  }
  /** Retrieve a template by id OR alias — both are accepted wherever `:id` is. */
  get(id: string): Promise<Result<Template>> {
    return this.http.request('GET', p`/templates/${id}`);
  }
  /**
   * List templates. Rows are the trimmed {@link TemplateListItem} (no `from`,
   * `reply_to`, `text` or `variables`). Defaults to 20 per page.
   */
  list(params?: PaginationParams): Promise<Result<ListResponse<TemplateListItem>>> {
    return this.http.request('GET', `/templates${paginate(params)}`);
  }
  /** Returns the slim ack { object: 'template', id }. */
  update(id: string, payload: UpdateTemplateOptions): Promise<Result<ObjectRef<'template'>>> {
    return this.http.request('PATCH', p`/templates/${id}`, payload);
  }
  /** Duplicate a template. POST /templates/:id/duplicate → { object: 'template', id }. */
  duplicate(id: string, payload?: DuplicateTemplateOptions): Promise<Result<ObjectRef<'template'>>> {
    return this.http.request('POST', p`/templates/${id}/duplicate`, payload ?? {});
  }
  /** Publish a template (make its latest draft live). POST /templates/:id/publish → { object: 'template', id }. */
  publish(id: string): Promise<Result<ObjectRef<'template'>>> {
    return this.http.request('POST', p`/templates/${id}/publish`);
  }
  remove(id: string): Promise<Result<RemovedResponse>> {
    return this.http.request('DELETE', p`/templates/${id}`);
  }
}

class Topics {
  constructor(private readonly http: HttpClient) {}
  /** Create a topic on a sending domain (`domain` is required). */
  create(payload: CreateTopicOptions): Promise<Result<Topic>> {
    return this.http.request('POST', '/topics', payload);
  }
  get(id: string): Promise<Result<Topic>> {
    return this.http.request('GET', p`/topics/${id}`);
  }
  /**
   * List a domain's topics (`domain` is required).
   *
   * With no `limit` the response is capped at 1000 rows (the server's
   * unpaginated ceiling) and sets `has_more: true` when it bites.
   */
  list(params: ListTopicsParams): Promise<Result<ListResponse<Topic>>> {
    const q = addPagination(new URLSearchParams({ domain: params.domain }), params);
    return this.http.request('GET', `/topics?${q.toString()}`);
  }
  update(id: string, payload: UpdateTopicOptions): Promise<Result<Topic>> {
    return this.http.request('PATCH', p`/topics/${id}`, payload);
  }
  remove(id: string): Promise<Result<RemovedResponse>> {
    return this.http.request('DELETE', p`/topics/${id}`);
  }
}

class Automations {
  constructor(private readonly http: HttpClient) {}
  create(payload: CreateAutomationOptions): Promise<Result<Automation>> {
    return this.http.request('POST', '/automations', payload);
  }
  get(id: string): Promise<Result<Automation>> {
    return this.http.request('GET', p`/automations/${id}`);
  }
  list(params?: PaginationParams): Promise<Result<ListResponse<Automation>>> {
    return this.http.request('GET', `/automations${paginate(params)}`);
  }
  update(id: string, payload: UpdateAutomationOptions): Promise<Result<Automation>> {
    return this.http.request('PATCH', p`/automations/${id}`, payload);
  }
  /** Append a step to an automation. POST /automations/:id/steps → the created step. */
  addStep(id: string, payload: AddAutomationStepOptions): Promise<Result<AutomationStep>> {
    return this.http.request('POST', p`/automations/${id}/steps`, payload);
  }
  /** Replace a step's type/config in place — the graph key stays stable, so the
   * `connections` edges pointing at it keep resolving, and a `key` in the body is
   * discarded. The automation must be disabled.
   * PATCH /automations/:id/steps/:stepId → the step. */
  updateStep(id: string, stepId: string, payload: UpdateAutomationStepOptions): Promise<Result<AutomationStep>> {
    return this.http.request('PATCH', p`/automations/${id}/steps/${stepId}`, payload);
  }
  /** Delete a step from an automation. DELETE /automations/:id/steps/:stepId → { id, deleted }. */
  deleteStep(id: string, stepId: string): Promise<Result<{ id: string; deleted: boolean }>> {
    return this.http.request('DELETE', p`/automations/${id}/steps/${stepId}`);
  }
  /**
   * List an automation's runs, newest first. GET /automations/:id/runs —
   * optionally filtered to one or more `status` values (`running`,
   * `completed`, `failed`, `skipped`), applied before paging.
   */
  runs(id: string, params?: ListAutomationRunsParams): Promise<Result<ListResponse<AutomationRun>>> {
    const q = addPagination(new URLSearchParams(), params);
    if (params?.status != null) {
      q.set('status', Array.isArray(params.status) ? params.status.join(',') : params.status);
    }
    return this.http.request('GET', p`/automations/${id}/runs` + qs(q));
  }
  /** Retrieve a single automation run. GET /automations/:id/runs/:runId */
  getRun(id: string, runId: string): Promise<Result<AutomationRun>> {
    return this.http.request('GET', p`/automations/${id}/runs/${runId}`);
  }
  /** Stop an automation — prevents new runs; in-progress runs finish. POST /automations/:id/stop */
  stop(id: string): Promise<Result<Automation>> {
    return this.http.request('POST', p`/automations/${id}/stop`);
  }
  /**
   * Author (or extend) the step graph from a natural-language prompt. The
   * automation must be disabled; without `attach` it must also have no steps
   * yet. Consumes AI credits and is limited to 20 calls per minute per account.
   * POST /automations/:id/ai
   */
  createWithAi(id: string, payload: AutomationAiOptions): Promise<Result<AutomationAiResult>> {
    return this.http.request('POST', p`/automations/${id}/ai`, payload);
  }
  remove(id: string): Promise<Result<RemovedResponse>> {
    return this.http.request('DELETE', p`/automations/${id}`);
  }
}

class Webhooks {
  constructor(private readonly http: HttpClient) {}
  /** Create a webhook. The signing secret is shown ONCE, only here. */
  create(payload: CreateWebhookOptions): Promise<Result<ObjectRef<'webhook'> & { signing_secret: string }>> {
    return this.http.request('POST', '/webhooks', payload);
  }
  get(id: string): Promise<Result<Webhook>> {
    return this.http.request('GET', p`/webhooks/${id}`);
  }
  /** List webhooks. Defaults to 20 per page. */
  list(params?: PaginationParams): Promise<Result<ListResponse<Webhook>>> {
    return this.http.request('GET', `/webhooks${paginate(params)}`);
  }
  /** Returns the slim ack { object: 'webhook', id }. */
  update(id: string, payload: UpdateWebhookOptions): Promise<Result<ObjectRef<'webhook'>>> {
    return this.http.request('PATCH', p`/webhooks/${id}`, payload);
  }
  /**
   * Rotate the signing secret. The new plaintext `signing_secret` is returned
   * ONCE (reveal-once); the old secret stops verifying immediately.
   * POST /webhooks/:id/rotate
   */
  rotate(id: string): Promise<Result<ObjectRef<'webhook'> & { signing_secret: string }>> {
    return this.http.request('POST', p`/webhooks/${id}/rotate`);
  }
  /**
   * Send a synchronous test delivery and return the endpoint's live result.
   * POST /webhooks/:id/test — a FAILED delivery still returns HTTP 200, so
   * branch on `data.ok`, not on `error`.
   */
  test(id: string): Promise<Result<WebhookTestResult>> {
    return this.http.request('POST', p`/webhooks/${id}/test`);
  }
  remove(id: string): Promise<Result<RemovedResponse>> {
    return this.http.request('DELETE', p`/webhooks/${id}`);
  }
  /**
   * Verify a webhook delivery's Svix-style signature against your endpoint's
   * signing secret. Mirrors the backend signing scheme
   * (`${id}.${timestamp}.${body}` → base64 HMAC-SHA256, tagged `v1,`).
   *
   * `payload` MUST be the exact raw request body string the server sent (do not
   * re-serialize the parsed JSON — whitespace differences break the signature).
   * `headers` accepts the svix-id/svix-timestamp/svix-signature headers (read
   * case-insensitively) out of a plain object, a Fetch `Headers` or any
   * `(name, value)` iterable, so `request.headers` passes straight through on
   * every framework. A header may carry multiple space-separated signatures;
   * any one matching makes the delivery valid.
   *
   * This is a pure local computation — it makes no HTTP request.
   */
  verify(payload: string, headers: WebhookHeaderInput, secret: string, options: VerifyWebhookOptions = {}): VerifyWebhookResult {
    return verifyWebhookSignature(payload, headers, secret, options);
  }
}

/**
 * Best-effort `(name, value)` pairs out of ANY header container. `entries()`
 * first, because a WHATWG `Headers` — what `request.headers` IS in Next.js App
 * Router, Remix, Hono, Cloudflare Workers, Deno and Bun — and a `Map` both hold
 * their fields internally, so `Object.keys()` on one is `[]` and every genuinely
 * signed delivery on those frameworks answered `missing_headers`.
 *
 * The `typeof === 'function'` guards are load-bearing: a plain object carrying a
 * header literally named `entries` holds a string there, not a function, so it
 * still falls through to the own-keys branch.
 */
function headerPairs(headers: WebhookHeaderInput): Array<[unknown, unknown]> {
  if (!headers) return [];
  const h = headers as any;
  // Symbol.iterator FIRST, and the order is load-bearing. Headers, Map and an
  // array of pairs all iterate as (name, value), but `Array.prototype.entries()`
  // yields (INDEX, value) -- so entries-first turns a documented input shape,
  // `[['svix-id', ...]]`, into pairs keyed 0, 1, 2 that match no header name and
  // fail as `missing_headers`. That is the same silent-verification-failure this
  // helper exists to remove, just for a different caller.
  if (typeof h[Symbol.iterator] === 'function') return Array.from(h);
  if (typeof h.entries === 'function') return Array.from(h.entries());
  return Object.keys(h).map((k) => [k, h[k]]);
}

/** Case-insensitively read a single header value (first if it's an array). */
function readHeader(headers: WebhookHeaderInput, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of headerPairs(headers)) {
    if (String(k).toLowerCase() === lower) return Array.isArray(v) ? v[0] : (v as string | undefined);
  }
  return undefined;
}

/**
 * Derive the HMAC key from a `whsec_`-prefixed secret (base64-decode the suffix);
 * a secret without the prefix is used as raw UTF-8 bytes. Mirrors the backend's
 * `secretToKey` (src/services/svix_signature.ts).
 */
function secretToKey(secret: string): Buffer {
  const s = String(secret || '');
  if (s.startsWith('whsec_')) {
    const b64 = s.slice('whsec_'.length);
    try {
      const buf = Buffer.from(b64, 'base64');
      if (buf.length) return buf;
    } catch { /* fall through to raw */ }
  }
  return Buffer.from(s, 'utf8');
}

/** Constant-time compare of two base64 signature strings. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Pure Svix-style signature verification. Exported so it can be used without
 * constructing a client (e.g. in a request handler that only has the raw body).
 */
export function verifyWebhookSignature(
  payload: string,
  headers: WebhookHeaderInput,
  secret: string,
  options: VerifyWebhookOptions = {},
): VerifyWebhookResult {
  const id = readHeader(headers, 'svix-id');
  const timestamp = readHeader(headers, 'svix-timestamp');
  const sigHeader = readHeader(headers, 'svix-signature');
  if (!id || !timestamp || !sigHeader) return { valid: false, reason: 'missing_headers' };
  if (!secret) return { valid: false, reason: 'missing_secret' };

  // Optional timestamp freshness check (default 5-minute tolerance; 0 disables).
  const toleranceSec = options.toleranceSec ?? 300;
  if (toleranceSec > 0) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return { valid: false, reason: 'invalid_timestamp' };
    const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
    if (skew > toleranceSec) return { valid: false, reason: 'timestamp_out_of_tolerance' };
  }

  const signed = `${id}.${timestamp}.${payload}`;
  const expected = createHmac('sha256', secretToKey(secret)).update(signed).digest('base64');

  // The header may contain multiple space-separated `v1,<sig>` entries; any match wins.
  for (const part of sigHeader.split(' ')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const sig = trimmed.startsWith('v1,') ? trimmed.slice('v1,'.length) : trimmed;
    if (safeEqual(sig, expected)) return { valid: true };
  }
  return { valid: false, reason: 'no_match' };
}

/** List-logs params: cursor pagination plus optional method/status filters. */
export interface ListLogsParams extends PaginationParams {
  /** Filter to an exact HTTP method, e.g. 'POST'. */
  method?: string;
  /** Filter to an exact response status, e.g. 200 or 429. */
  status?: number;
}

class Logs {
  constructor(private readonly http: HttpClient) {}
  /**
   * List API request logs. Cursor-paginated (`limit`/`after`/`before`) with
   * optional `method` and `status` filters (server-side).
   */
  list(params?: ListLogsParams): Promise<Result<ListResponse<LogEntry>>> {
    const qs = new URLSearchParams();
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.after) qs.set('after', params.after);
    if (params?.before) qs.set('before', params.before);
    if (params?.method) qs.set('method', params.method);
    if (params?.status != null) qs.set('status', String(params.status));
    const q = qs.toString();
    return this.http.request('GET', `/logs${q ? `?${q}` : ''}`);
  }
  get(id: string): Promise<Result<LogEntry>> {
    return this.http.request('GET', p`/logs/${id}`);
  }
}

class Events {
  constructor(private readonly http: HttpClient) {}
  /**
   * Send a custom event that automations can trigger on. POST /events/send
   *
   * `options.idempotencyKey` is still sent as `Idempotency-Key`, but the API
   * honours that header on `POST /emails`, `POST /emails/batch`, and received-email reply/forward — it is
   * ignored here, so a retry ingests a SECOND event and can enroll the contact
   * twice. De-duplicate on your side instead.
   */
  send(payload: SendEventOptions, options?: RequestOptions): Promise<Result<SendEventResponse>> {
    return this.http.request('POST', '/events/send', payload, options);
  }
  /**
   * Create a custom-event definition (name + optional payload schema). POST /events
   *
   * `options.idempotencyKey` carries no guarantee here — see {@link Events.send}.
   * A duplicate event name is already a 422 `validation_error`.
   */
  create(payload: CreateEventOptions, options?: RequestOptions): Promise<Result<EventDefinition>> {
    return this.http.request('POST', '/events', payload, options);
  }
  /** List custom-event definitions. GET /events */
  list(params?: PaginationParams): Promise<Result<ListResponse<EventDefinition>>> {
    return this.http.request('GET', `/events${paginate(params)}`);
  }
  /** Update a custom-event definition's payload schema (the name is immutable).
   * PATCH /events/:id */
  update(id: string, payload: UpdateEventOptions): Promise<Result<EventDefinition>> {
    return this.http.request('PATCH', p`/events/${id}`, payload);
  }
  /** Delete a custom-event definition. DELETE /events/:id */
  remove(id: string): Promise<Result<RemovedResponse>> {
    return this.http.request('DELETE', p`/events/${id}`);
  }
}

/**
 * Read-only view of your API keys.
 *
 * Keys are created, re-scoped and revoked **in the SendPing dashboard only**,
 * so this resource deliberately exposes nothing but `list()`. That is a
 * security property: a key that leaks cannot mint itself a replacement, widen
 * its own permission or domain scope, or revoke the keys around it. The API
 * enforces it server-side — POST/PATCH/DELETE on `/api-keys` answer
 * `403 dashboard_only` to every API-key caller, whatever its scopes.
 */
class ApiKeys {
  constructor(private readonly http: HttpClient) {}
  /**
   * List active keys (revoked ones are excluded).
   *
   * With no params the response is capped at 1000 rows (the server's
   * unpaginated ceiling) and sets `has_more: true` when it bites.
   */
  list(params?: PaginationParams): Promise<Result<ListResponse<ApiKey>>> {
    return this.http.request('GET', `/api-keys${paginate(params)}`);
  }
}

export interface SendPingOptions extends ClientConfig {}

/**
 * The SendPing API client.
 *
 * ```ts
 * import { SendPing } from 'sendping';
 * const mb = new SendPing('mb_xxxxxxxxx');
 * const { data, error } = await mb.emails.send({
 *   from: 'you@yourdomain.com',
 *   to: ['user@example.com'],
 *   subject: 'Hello',
 *   html: '<p>Hi 👋</p>',
 * });
 * ```
 */
export class SendPing {
  readonly emails: Emails;
  readonly batch: Batch;
  readonly domains: Domains;
  readonly audiences: Audiences;
  readonly contacts: Contacts;
  readonly contactProperties: ContactProperties;
  readonly campaigns: Campaigns;
  readonly segments: Segments;
  readonly topics: Topics;
  readonly templates: Templates;
  readonly automations: Automations;
  readonly webhooks: Webhooks;
  readonly logs: Logs;
  readonly events: Events;
  readonly apiKeys: ApiKeys;
  readonly polls: Polls;

  constructor(apiKey: string, options: SendPingOptions = {}) {
    const http = new HttpClient(apiKey, options);
    this.emails = new Emails(http);
    this.batch = new Batch(http);
    this.domains = new Domains(http);
    this.audiences = new Audiences(http);
    this.contacts = new Contacts(http);
    this.contactProperties = new ContactProperties(http);
    this.campaigns = new Campaigns(http);
    this.segments = new Segments(http);
    this.topics = new Topics(http);
    this.templates = new Templates(http);
    this.automations = new Automations(http);
    this.webhooks = new Webhooks(http);
    this.logs = new Logs(http);
    this.events = new Events(http);
    this.apiKeys = new ApiKeys(http);
    this.polls = new Polls(http);
  }
}

export default SendPing;

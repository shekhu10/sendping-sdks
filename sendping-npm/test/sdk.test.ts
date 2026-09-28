import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  SendPing,
  verifyWebhookSignature,
  VERSION,
  USER_AGENT,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  type ReputationDetail,
  type ReceivedAttachment,
} from '../src/index';

interface Captured { url: string; method: string; headers: Record<string, string>; body: any }

// A mock fetch that records the request and returns a canned response.
function mockFetch(status: number, responseBody: unknown) {
  const calls: Captured[] = [];
  const fn = (async (url: string, init: any) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (responseBody === undefined ? '' : JSON.stringify(responseBody)),
      arrayBuffer: async () => {
        if (responseBody instanceof ArrayBuffer) return responseBody;
        const s = responseBody === undefined ? '' : JSON.stringify(responseBody);
        return new TextEncoder().encode(s).buffer;
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test('constructor requires an API key', () => {
  // @ts-expect-error intentionally missing key
  assert.throws(() => new SendPing());
});

test('VERSION tracks package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version, 'client.ts VERSION must match the manifest');
});

test('every request carries a non-empty User-Agent and a Bearer token', async () => {
  // A request without a User-Agent is rejected with 403 validation_error
  // BEFORE authentication, masking every other error — so this is load-bearing.
  const { fn, calls } = mockFetch(200, { object: 'list', has_more: false, data: [] });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.domains.list();
  await mb.emails.receiving.getRaw('r1');   // the raw-bytes path sets its own headers
  await mb.domains.recordsCsv('d1');        // …and so does the text path
  for (const call of calls) {
    assert.equal(call.headers['User-Agent'], USER_AGENT);
    assert.ok(call.headers['User-Agent'].trim().length > 0);
    assert.equal(call.headers.Authorization, 'Bearer mb_test');
  }
});

test('emails.send issues POST /emails with auth + body and returns { data }', async () => {
  const { fn, calls } = mockFetch(200, { id: 'e-1' });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.emails.send({ from: 'a@x.com', to: 'b@y.com', subject: 'Hi', html: '<p>x</p>' });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://api.test/emails');
  assert.equal(calls[0].headers.Authorization, 'Bearer mb_test');
  assert.equal(calls[0].body.subject, 'Hi');
  assert.deepEqual(res, { data: { id: 'e-1' }, error: null });
});

test('emails.send forwards the Idempotency-Key header', async () => {
  const { fn, calls } = mockFetch(200, { id: 'e-2' });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.emails.send({ from: 'a@x.com', to: 'b@y.com', subject: 'Hi', text: 't' }, { idempotencyKey: 'k1' });
  assert.equal(calls[0].headers['Idempotency-Key'], 'k1');
});

// The documented bound is 1-255 characters, measured AFTER the server trims the
// value (api_idempotency.key is VARCHAR(255)) — 255, not 256. The constant is
// exported so the rule is discoverable; the key itself goes out verbatim and the
// SERVER answers an out-of-range one with 400 invalid_idempotency_key.
test('the Idempotency-Key bound is exported, and the key is sent verbatim', async () => {
  assert.equal(IDEMPOTENCY_KEY_MAX_LENGTH, 255);

  const { fn, calls } = mockFetch(200, { id: 'e-3' });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const tooLong = 'k'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1);
  const res = await mb.emails.send(
    { from: 'a@x.com', to: 'b@y.com', subject: 'Hi', text: 't' },
    { idempotencyKey: tooLong },
  );
  assert.equal(res.error, null);
  assert.equal(calls[0].headers['Idempotency-Key'], tooLong);
});

// Only POST /emails, POST /emails/batch, and received-email reply/forward honour the header. events.send still
// ACCEPTS and forwards a key (the options bag is shared), but the API ignores
// it there — the method's doc comment says so.
test('events.send still forwards an idempotency key the API will ignore', async () => {
  const { fn, calls } = mockFetch(200, { object: 'event', id: 'ev-1' });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.events.send(
    { event: 'signup.completed', domain: 'yourdomain.com', email: 'a@b.com' },
    { idempotencyKey: 'evt-1' },
  );
  assert.equal(calls[0].headers['Idempotency-Key'], 'evt-1');
});

test('retries a 429 (honoring Retry-After) then succeeds; a 422 is not retried', async () => {
  let n = 0;
  const seenSignals: boolean[] = [];
  const fn = (async (_url: string, init: any) => {
    seenSignals.push(!!init.signal);
    n += 1;
    if (n === 1) {
      return { ok: false, status: 429, headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? '0' : null) }, text: async () => '' } as unknown as Response;
    }
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ id: 'ok' }) } as unknown as Response;
  }) as unknown as typeof fetch;
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn, maxRetries: 2 });
  const res = await mb.emails.send({ from: 'a@x.com', to: 'b@y.com', subject: 'Hi', html: 'x' });
  assert.equal(n, 2, 'the 429 was retried exactly once');
  assert.deepEqual(res, { data: { id: 'ok' }, error: null });
  assert.ok(seenSignals.every((s) => s), 'every attempt carried a timeout AbortSignal');
});

test('gives up after maxRetries on a persistent 429 and returns the error', async () => {
  let n = 0;
  const fn = (async () => {
    n += 1;
    return { ok: false, status: 429, headers: { get: () => '0' }, text: async () => JSON.stringify({ statusCode: 429, name: 'rate_limited', message: 'slow down' }) } as unknown as Response;
  }) as unknown as typeof fetch;
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn, maxRetries: 2 });
  const res = await mb.emails.send({ from: 'a@x.com', to: 'b@y.com', subject: 'Hi', html: 'x' });
  assert.equal(n, 3, 'initial attempt + 2 retries');
  assert.equal(res.error?.statusCode, 429);
});

test('maxRetries: 0 disables retries', async () => {
  let n = 0;
  const fn = (async () => { n += 1; return { ok: false, status: 503, headers: { get: () => null }, text: async () => '' } as unknown as Response; }) as unknown as typeof fetch;
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn, maxRetries: 0 });
  await mb.emails.send({ from: 'a@x.com', to: 'b@y.com', subject: 'Hi', html: 'x' });
  assert.equal(n, 1, 'no retries when maxRetries is 0');
});

test('a non-2xx returns { error } with the SendPing error shape', async () => {
  const { fn } = mockFetch(422, { statusCode: 422, name: 'validation_error', message: 'bad' });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.emails.send({ from: 'a@x.com', to: 'b@y.com', subject: 'Hi', html: 'x' });
  assert.equal(res.data, null);
  assert.deepEqual(res.error, { statusCode: 422, name: 'validation_error', message: 'bad' });
});

test('a plan/quota error keeps its additive `limit` object', async () => {
  // Limit rejections are a SUPERSET of the envelope; dropping `limit` would
  // hide which quota was hit and what the next plan is.
  const limit = {
    kind: 'emails_daily', used: 100, limit: 100, requested: 3, remaining: 0,
    period: '24h', plan: { id: 'free', name: 'Free' }, next_plan: null,
  };
  const { fn } = mockFetch(429, {
    statusCode: 429, name: 'daily_quota_exceeded', message: 'over quota', limit,
  });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn, maxRetries: 0 });
  const res = await mb.emails.send({ from: 'a@x.com', to: 'b@y.com', subject: 'Hi', html: 'x' });
  assert.equal(res.error?.name, 'daily_quota_exceeded');
  assert.deepEqual(res.error?.limit, limit);
});

test('a reputation gate keeps its additive `reputation` object, typed', async () => {
  // The sibling of `limit`: Go, Rust and .NET all model this as a named detail
  // struct, so the fields below must be reachable without a cast. The typed
  // bindings below are compile-time assertions — they fail `typecheck:test` if
  // `reputation` is ever widened back to `Record<string, unknown>`.
  const reputation = {
    retryable: true, scope: 'domain', status: 'warming', scope_key: 'acme.com',
    hourly_limit: 50, daily_limit: 500, hourly_used: 50, daily_used: 120,
    retry_at: '2026-08-08T12:00:00.000Z', support_email: 'support@sendping.co',
  };
  const { fn } = mockFetch(429, {
    statusCode: 429, name: 'reputation_limit_exceeded', message: 'Warm-up capacity reached.', reputation,
  });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn, maxRetries: 0 });
  const res = await mb.emails.send({ from: 'a@x.com', to: 'b@y.com', subject: 'Hi', html: 'x' });
  assert.equal(res.error?.name, 'reputation_limit_exceeded');
  const rep: ReputationDetail | undefined = res.error?.reputation;
  const retryable: boolean | undefined = rep?.retryable;
  const scopeKey: string | undefined = rep?.scope_key;
  const retryAt: string | undefined = rep?.retry_at;
  assert.equal(retryable, true);
  assert.equal(rep?.scope, 'domain');
  assert.equal(scopeKey, 'acme.com');
  assert.equal(retryAt, '2026-08-08T12:00:00.000Z');
  assert.deepEqual(rep, reputation);
});

test('`reputation` stays absent on an error that is not a reputation gate', async () => {
  const { fn } = mockFetch(422, { statusCode: 422, name: 'validation_error', message: 'bad' });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn, maxRetries: 0 });
  const res = await mb.emails.send({ from: 'a@x.com', to: 'b@y.com', subject: 'Hi', html: 'x' });
  assert.equal(res.error?.reputation, undefined);
  assert.equal(res.error?.limit, undefined);
});

test('a partial batch failure keeps `sent` / `sent_count`', async () => {
  const { fn } = mockFetch(429, {
    statusCode: 429, name: 'daily_quota_exceeded', message: 'over quota',
    sent: [{ id: 'e-1' }], sent_count: 1,
  });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn, maxRetries: 0 });
  const res = await mb.batch.send([{ from: 'a@x.com', to: 'b@y.com', subject: 's', text: 't' }]);
  assert.equal(res.error?.sent_count, 1);
  assert.deepEqual(res.error?.sent, [{ id: 'e-1' }]);
});

test('`sent_count` falls back to `sent.length` when the body omits it', async () => {
  // Every other SendPing SDK derives the count from the list, so a caller
  // deciding what NOT to resend never has to compute it themselves.
  const { fn } = mockFetch(429, {
    statusCode: 429, name: 'daily_quota_exceeded', message: 'over quota',
    sent: [{ id: 'e-1' }, { id: 'e-2' }],
  });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn, maxRetries: 0 });
  const res = await mb.batch.send([{ from: 'a@x.com', to: 'b@y.com', subject: 's', text: 't' }]);
  assert.equal(res.error?.sent_count, 2);
});

test('`sent_count` stays absent on an error that sent nothing', async () => {
  // A synthesized 0 would read as "a batch ran and delivered none", which is a
  // different claim from "this error has no batch outcome at all".
  const { fn } = mockFetch(422, {
    statusCode: 422, name: 'validation_error', message: 'bad payload',
  });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn, maxRetries: 0 });
  const res = await mb.batch.send([{ from: 'a@x.com', to: 'b@y.com', subject: 's', text: 't' }]);
  assert.equal(res.error?.sent_count, undefined);
  assert.equal(res.error?.sent, undefined);
});

test('a non-envelope error body lifts `error` into `name`', async () => {
  // The rate-limited public mounts and the CSRF guard answer with
  // {"error":"..."} instead of {statusCode,name,message}.
  const { fn } = mockFetch(403, { error: 'csrf_failed' });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.domains.list();
  assert.equal(res.error?.statusCode, 403);
  assert.equal(res.error?.name, 'csrf_failed');
});

test('emails: batch / get / update / cancel map to the right routes', async () => {
  const { fn, calls } = mockFetch(200, { ok: true });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.emails.batch([{ from: 'a@x.com', to: 'b@y.com', subject: 's', text: 't' }]);
  await mb.emails.get('e1');
  await mb.emails.update('e1', { scheduled_at: '2030-01-01T00:00:00Z' });
  await mb.emails.cancel('e1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/emails/batch',
    'GET https://api.test/emails/e1',
    'PATCH https://api.test/emails/e1',
    'POST https://api.test/emails/e1/cancel',
  ]);
});

test('receiving.reply + audiences.importSheet map to the right routes', async () => {
  const { fn, calls } = mockFetch(200, { ok: true });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.emails.receiving.reply('r-1', { from: 'me@my.test', text: 'hi' });
  await mb.audiences.importSheet('aud-1', { url: 'https://docs.google.com/spreadsheets/d/x' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/emails/receiving/r-1/reply',
    'POST https://api.test/audiences/aud-1/contacts/import-sheet',
  ]);
});

test('polls resource maps list + get to the right routes', async () => {
  const { fn, calls } = mockFetch(200, { object: 'list', has_more: false, data: [] });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.polls.list();
  await mb.polls.get('e-42');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET https://api.test/polls',
    'GET https://api.test/polls/e-42',
  ]);
});

test('domains resource maps every method', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.domains.create({ name: 'example.com' });
  await mb.domains.list();
  await mb.domains.get('d1');
  await mb.domains.update('d1', { open_tracking: false });
  await mb.domains.verify('d1');
  await mb.domains.remove('d1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/domains',
    'GET https://api.test/domains',
    'GET https://api.test/domains/d1',
    'PATCH https://api.test/domains/d1',
    'POST https://api.test/domains/d1/verify',
    'DELETE https://api.test/domains/d1',
  ]);
});

test('audiences + contacts (nested) map to the right routes', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.audiences.create({ name: 'Newsletter' });
  await mb.contacts.create({ audienceId: 'a1', email: 'x@y.com', first_name: 'X' });
  await mb.contacts.get({ audienceId: 'a1', id: 'x@y.com' });
  await mb.contacts.update({ audienceId: 'a1', id: 'c1', unsubscribed: true });
  await mb.contacts.remove({ audienceId: 'a1', id: 'c1' });
  await mb.contacts.list({ audienceId: 'a1' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/audiences',
    'POST https://api.test/audiences/a1/contacts',
    'GET https://api.test/audiences/a1/contacts/x%40y.com',
    'PATCH https://api.test/audiences/a1/contacts/c1',
    'DELETE https://api.test/audiences/a1/contacts/c1',
    'GET https://api.test/audiences/a1/contacts',
  ]);
  // contact create strips audienceId from the body
  assert.deepEqual(calls[1].body, { email: 'x@y.com', first_name: 'X' });
});

test('contacts (flat, no audienceId) hit the top-level /contacts routes with domain', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.contacts.create({ domain: 'x.com', email: 'x@y.com', first_name: 'X' });
  await mb.contacts.get({ id: 'x@y.com', domain: 'x.com' });
  await mb.contacts.update({ id: 'c1', unsubscribed: true });
  await mb.contacts.update({ id: 'x@y.com', domain: 'x.com', unsubscribed: true });
  await mb.contacts.remove({ id: 'c1' });
  await mb.contacts.remove({ id: 'x@y.com', domain: 'x.com' });
  await mb.contacts.list({ domain: 'x.com' });
  await mb.contacts.list({ domain: 'x.com', segment_id: 'seg1', limit: 10 });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/contacts',
    'GET https://api.test/contacts/x%40y.com?domain=x.com',
    'PATCH https://api.test/contacts/c1',
    'PATCH https://api.test/contacts/x%40y.com',
    'DELETE https://api.test/contacts/c1',
    'DELETE https://api.test/contacts/x%40y.com?domain=x.com',
    'GET https://api.test/contacts?domain=x.com',
    'GET https://api.test/contacts?domain=x.com&limit=10&segment_id=seg1',
  ]);
  // Flat create carries the domain in the body (names the contact pool).
  assert.deepEqual(calls[0].body, { email: 'x@y.com', first_name: 'X', domain: 'x.com' });
  // An id-addressed PATCH has no domain; an email-addressed one carries it.
  assert.deepEqual(calls[2].body, { unsubscribed: true });
  assert.deepEqual(calls[3].body, { unsubscribed: true, domain: 'x.com' });
});

test('contacts.batch / import / paginated list map to the right routes', async () => {
  const { fn, calls } = mockFetch(201, { object: 'list', imported: 2, updated: 0, skipped: 0, total: 2 });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.contacts.batch({ audienceId: 'a1', contacts: [{ email: 'a@x.com' }, { email: 'b@x.com', first_name: 'B' }] });
  await mb.contacts.import({ audienceId: 'a1', csv: 'email\nc@x.com\n' });
  await mb.contacts.list({ audienceId: 'a1', limit: 50, after: 'cur1' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/audiences/a1/contacts/batch',
    'POST https://api.test/audiences/a1/contacts/import',
    'GET https://api.test/audiences/a1/contacts?limit=50&after=cur1',
  ]);
  assert.deepEqual(calls[0].body, { contacts: [{ email: 'a@x.com' }, { email: 'b@x.com', first_name: 'B' }] });
  assert.deepEqual(calls[1].body, { csv: 'email\nc@x.com\n' });
});

test('contacts.batch is domain-first: `domain` uses the flat /contacts/batch door', async () => {
  // The bulk door for the domain-first API. A create-per-contact loop takes the
  // account's contact-limit lock once PER CONTACT; one batch takes it once, which
  // is why this is the shape to recommend for many contacts.
  const { fn, calls } = mockFetch(201, { object: 'contact_import', imported: 2, updated: 0, skipped: 0, total: 2 });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.contacts.batch({ domain: 'x.com', contacts: [{ email: 'a@x.com' }, { email: 'b@x.com' }] });
  await mb.contacts.batch({ domain: 'x.com', contacts: [{ email: 'c@x.com' }], on_conflict: 'skip' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/contacts/batch',
    'POST https://api.test/contacts/batch?on_conflict=skip',
  ]);
  // `domain` travels in the BODY here, exactly as it does for POST /contacts —
  // the nested route takes its pool from the path instead.
  assert.deepEqual(calls[0].body, { contacts: [{ email: 'a@x.com' }, { email: 'b@x.com' }], domain: 'x.com' });
  // And the audience-scoped form must NOT start sending a domain.
  await mb.contacts.batch({ audienceId: 'a1', contacts: [{ email: 'd@x.com' }] });
  assert.equal(calls[2].url, 'https://api.test/audiences/a1/contacts/batch');
  assert.deepEqual(calls[2].body, { contacts: [{ email: 'd@x.com' }] });
});

test('contacts batch/import on_conflict + audience-scoped segment_id', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.contacts.batch({ audienceId: 'a1', contacts: [{ email: 'a@x.com' }], on_conflict: 'skip' });
  await mb.contacts.import({ audienceId: 'a1', csv: 'email\nc@x.com\n', on_conflict: 'skip' });
  await mb.contacts.list({ audienceId: 'a1', segment_id: 'seg1' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/audiences/a1/contacts/batch?on_conflict=skip',
    'POST https://api.test/audiences/a1/contacts/import?on_conflict=skip',
    'GET https://api.test/audiences/a1/contacts?segment_id=seg1',
  ]);
});

test('segments resource maps every method (incl. contacts preview)', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.segments.create({ domain: 'x.com', name: 'Gmail users', filter: { status: 'subscribed', email_contains: '@gmail.com' } });
  await mb.segments.list({ domain: 'x.com' });
  await mb.segments.list({ domain: 'x.com', limit: 5 });
  await mb.segments.get('s1');
  await mb.segments.contacts('s1');
  await mb.segments.update('s1', { name: 'Renamed' });
  await mb.segments.remove('s1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/segments',
    'GET https://api.test/segments?domain=x.com',
    'GET https://api.test/segments?domain=x.com&limit=5',
    'GET https://api.test/segments/s1',
    'GET https://api.test/segments/s1/contacts',
    'PATCH https://api.test/segments/s1',
    'DELETE https://api.test/segments/s1',
  ]);
  // Domain-first: the segment is created on a domain, not an audience.
  assert.equal(calls[0].body.domain, 'x.com');
});

test('campaigns.create forwards segment_id', async () => {
  const { fn, calls } = mockFetch(200, { id: 'b-1' });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.campaigns.create({ domain: 'x.com', from: 'f@x.com', subject: 's', html: 'x', segment_id: 's1' });
  assert.equal(calls[0].body.segment_id, 's1');
});

test('templates resource maps every method', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.templates.create({ name: 'Welcome', subject: 'Hi {{name}}', html: '<p>Hello {{name}}</p>' });
  await mb.templates.list();
  await mb.templates.get('t1');
  await mb.templates.update('t1', { subject: 'Yo {{name}}' });
  await mb.templates.remove('t1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/templates',
    'GET https://api.test/templates',
    'GET https://api.test/templates/t1',
    'PATCH https://api.test/templates/t1',
    'DELETE https://api.test/templates/t1',
  ]);
});

test('emails.send forwards template_id + variables in the body', async () => {
  const { fn, calls } = mockFetch(200, { id: 'e-9' });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.emails.send({ from: 'a@x.com', to: 'b@y.com', subject: 'ignored', template_id: 't1', variables: { name: 'Ada' } });
  assert.equal(calls[0].body.template_id, 't1');
  assert.deepEqual(calls[0].body.variables, { name: 'Ada' });
});

test('campaigns map to the right routes', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.campaigns.create({ domain: 'x.com', from: 'f@x.com', subject: 's', html: 'x' });
  await mb.campaigns.send('b1', { scheduled_at: '2030-01-01T00:00:00Z' });
  await mb.campaigns.cancel('b1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/campaigns',
    'POST https://api.test/campaigns/b1/send',
    'POST https://api.test/campaigns/b1/cancel',
  ]);
});

test('emails.list + sent-attachments map to the right routes', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.emails.list({ limit: 10, after: 'cur1' });
  await mb.emails.listAttachments('e1');
  await mb.emails.getAttachment('e1', 'att1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET https://api.test/emails?limit=10&after=cur1',
    'GET https://api.test/emails/e1/attachments',
    'GET https://api.test/emails/e1/attachments/att1',
  ]);
});

test('emails.list forwards the status + search filters', async () => {
  const { fn, calls } = mockFetch(200, { object: 'list', has_more: false, data: [] });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.emails.list({ status: 'delivered', search: 'ada@', domain_id: 'd1' });
  assert.equal(
    calls[0].url,
    'https://api.test/emails?domain_id=d1&status=delivered&search=ada%40',
  );
});

test('emails.list forwards the mailbox folder filter', async () => {
  const { fn, calls } = mockFetch(200, { object: 'list', has_more: false, data: [] });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.emails.list({ folder: 'outbox' });
  assert.equal(calls[0].url, 'https://api.test/emails?folder=outbox');
});

test('emails.sources + receiving.listAddresses map to the right routes', async () => {
  const { fn, calls } = mockFetch(200, { object: 'list', has_more: false, data: [] });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.emails.sources();
  await mb.emails.receiving.listAddresses();
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET https://api.test/emails/sources',
    'GET https://api.test/emails/receiving/addresses',
  ]);
});

test('a received email exposes domain_id and list rows expose object/id', async () => {
  // The inbound serializer returns `domain_id` (the receiving domain) alongside
  // the sent-side counterpart, and listAttachments rows are `object:'attachment'`
  // items with an always-present id. Both must be reachable without a cast.
  const { fn } = mockFetch(200, {
    object: 'received_email', id: 'r1', from: 'them@example.com',
    to: ['support@mine.com'], domain_id: 'dom_1', subject: 'Hi',
    raw_available: false, created_at: '2026-08-19T00:00:00.000Z',
  });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const got = await mb.emails.receiving.get('r1');
  assert.equal(got.data!.domain_id, 'dom_1');

  const list = mockFetch(200, {
    object: 'list', has_more: false,
    data: [{
      object: 'attachment', id: 'att_1', filename: 'a.pdf', size: 12,
      content_type: 'application/pdf', content_disposition: 'attachment',
      content_id: null, downloadable: true,
      download_url: 'https://api.test/emails/receiving/r1/attachments/att_1',
    }],
  });
  const mb2 = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: list.fn });
  const atts = await mb2.emails.receiving.listAttachments('r1');
  assert.equal(atts.data!.data[0].object, 'attachment');
  assert.equal(atts.data!.data[0].id, 'att_1');
  assert.equal(atts.data!.data[0].downloadable, true);
});

test('a listAttachments row may carry a null size', async () => {
  // REGRESSION: `size` was typed `number`, but the list serializer emits it
  // straight off untyped jsonb and sends `null` when the stored metadata has
  // none — while the copy embedded in a received_email substitutes 0. The client
  // casts the parsed body through without coercing it, so the declared type was
  // a promise the runtime never kept: `size.toFixed(1)` type-checked clean and
  // then threw the first time a row without a recorded size came back.
  //
  // Typing the fixture as the SDK's own row type is the type-level half of this
  // test, enforced by `npm run typecheck:test` — while `size` was `number` the
  // shape the server actually sends could not even be spelled (TS2322).
  const legacy: ReceivedAttachment = {
    object: 'attachment', id: '0', filename: 'legacy.pdf', size: null,
    content_type: 'application/pdf', content_disposition: 'attachment',
    downloadable: false,
  };
  const { fn } = mockFetch(200, { object: 'list', has_more: false, data: [{ ...legacy, content_id: null }] });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const atts = await mb.emails.receiving.listAttachments('r1');
  assert.equal(atts.data!.data[0].size, null);
});

test('emails.receiving maps every method', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.emails.receiving.list({ limit: 5 });
  await mb.emails.receiving.get('r1');
  await mb.emails.receiving.listAttachments('r1');
  await mb.emails.receiving.getAttachment('r1', 'att2');
  await mb.emails.receiving.forward('r1', { from: 'me@x.com', to: 'fwd@x.com' });
  await mb.emails.receiving.remove('r1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET https://api.test/emails/receiving?limit=5',
    'GET https://api.test/emails/receiving/r1',
    'GET https://api.test/emails/receiving/r1/attachments',
    'GET https://api.test/emails/receiving/r1/attachments/att2',
    'POST https://api.test/emails/receiving/r1/forward',
    'DELETE https://api.test/emails/receiving/r1',
  ]);
  assert.deepEqual(calls[4].body, { from: 'me@x.com', to: 'fwd@x.com' });
});

test('emails.receiving.getAttachment returns raw bytes (ArrayBuffer)', async () => {
  const { fn } = mockFetch(200, 'BINARY');
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.emails.receiving.getAttachment('r1', 'att2');
  assert.equal(res.error, null);
  assert.ok(res.data instanceof ArrayBuffer);
});

test('batch.send posts the payload array to /emails/batch', async () => {
  const { fn, calls } = mockFetch(200, { data: [] });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.batch.send([{ from: 'a@x.com', to: 'b@y.com', subject: 's', text: 't' }]);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://api.test/emails/batch');
  assert.ok(Array.isArray(calls[0].body));
});

test('an inline batch (200) reports no `queued` flag', async () => {
  const { fn } = mockFetch(200, { data: [{ id: 'e-1' }, { id: 'e-2' }] });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.batch.send([
    { from: 'a@x.com', to: 'delivered@test.sendping.co', subject: 's', text: 't' },
    { from: 'a@x.com', to: 'delivered@test.sendping.co', subject: 's', text: 't' },
  ]);
  assert.equal(res.error, null);
  assert.equal(res.data!.data.length, 2);
  // Absent, not false — the caller must be able to tell "sent" from "queued".
  assert.equal(res.data!.queued, undefined);
  assert.equal(res.data!.queued_count, undefined);
});

test('a queued batch (202) surfaces queued + queued_count as success', async () => {
  // Batches above the inline ceiling (41-100 emails) are accepted and delivered
  // in the background: HTTP 202 with { data, queued, queued_count }. 202 must
  // read as success, and both extra fields must reach the caller — the ids are
  // real but nothing has been transmitted yet.
  const ids = Array.from({ length: 41 }, (_, i) => ({ id: `e-${i}` }));
  const { fn } = mockFetch(202, { data: ids, queued: true, queued_count: 41 });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.emails.batch(
    ids.map(() => ({ from: 'a@x.com', to: 'delivered@test.sendping.co', subject: 's', text: 't' })),
  );
  assert.equal(res.error, null);
  assert.equal(res.data!.queued, true);
  assert.equal(res.data!.queued_count, 41);
  assert.equal(res.data!.queued_count, res.data!.data.length);
});

test('domains claim methods map to the right routes', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.domains.claim({ name: 'example.com' });
  await mb.domains.getClaim('d1');
  await mb.domains.verifyClaim('d1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/domains/claim',
    'GET https://api.test/domains/d1/claim',
    'POST https://api.test/domains/d1/claim/verify',
  ]);
});

test('contacts segment + topic methods map to the right routes', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.contacts.addToSegment('c1', 's1');
  await mb.contacts.removeFromSegment('c1', 's1');
  await mb.contacts.listSegments('c1');
  await mb.contacts.getTopics('c1');
  await mb.contacts.updateTopics('c1', { topics: [{ id: 't1', subscription: 'opt_in' }] });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/contacts/c1/segments/s1',
    'DELETE https://api.test/contacts/c1/segments/s1',
    'GET https://api.test/contacts/c1/segments',
    'GET https://api.test/contacts/c1/topics',
    'PATCH https://api.test/contacts/c1/topics',
  ]);
  assert.deepEqual(calls[4].body, { topics: [{ id: 't1', subscription: 'opt_in' }] });
});

test('contactProperties resource maps every method', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.contactProperties.create({ name: 'Plan', type: 'string' });
  await mb.contactProperties.list();
  await mb.contactProperties.get('p1');
  await mb.contactProperties.update('p1', { fallback_value: 'free' });
  await mb.contactProperties.remove('p1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/contact-properties',
    'GET https://api.test/contact-properties',
    'GET https://api.test/contact-properties/p1',
    'PATCH https://api.test/contact-properties/p1',
    'DELETE https://api.test/contact-properties/p1',
  ]);
});

test('topics resource maps every method', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.topics.create({ domain: 'x.com', name: 'Product updates', default_subscription: 'opt_in' });
  await mb.topics.list({ domain: 'x.com' });
  await mb.topics.get('t1');
  await mb.topics.update('t1', { description: 'News' });
  await mb.topics.remove('t1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/topics',
    'GET https://api.test/topics?domain=x.com',
    'GET https://api.test/topics/t1',
    'PATCH https://api.test/topics/t1',
    'DELETE https://api.test/topics/t1',
  ]);
});

test('templates duplicate + publish map to the right routes', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.templates.duplicate('t1');
  await mb.templates.publish('t1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/templates/t1/duplicate',
    'POST https://api.test/templates/t1/publish',
  ]);
});

test('automations resource maps every method', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.automations.create({ name: 'Onboarding', domain: 'x.com', trigger: 'contact.created' });
  await mb.automations.list();
  await mb.automations.get('au1');
  await mb.automations.update('au1', { status: 'enabled' });
  await mb.automations.addStep('au1', { type: 'send_email', config: { template_id: 't1' } });
  await mb.automations.updateStep('au1', 'st1', { type: 'send_email', config: { template_id: 't2' } });
  await mb.automations.runs('au1');
  await mb.automations.getRun('au1', 'run1');
  await mb.automations.stop('au1');
  await mb.automations.remove('au1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/automations',
    'GET https://api.test/automations',
    'GET https://api.test/automations/au1',
    'PATCH https://api.test/automations/au1',
    'POST https://api.test/automations/au1/steps',
    'PATCH https://api.test/automations/au1/steps/st1',
    'GET https://api.test/automations/au1/runs',
    'GET https://api.test/automations/au1/runs/run1',
    'POST https://api.test/automations/au1/stop',
    'DELETE https://api.test/automations/au1',
  ]);
  assert.deepEqual(calls[5].body, { type: 'send_email', config: { template_id: 't2' } });
});

test('webhooks resource maps every method', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.webhooks.create({ endpoint: 'https://hooks.x.com/mb', events: ['email.delivered'] });
  await mb.webhooks.list();
  await mb.webhooks.get('wh1');
  await mb.webhooks.update('wh1', { status: 'disabled' });
  await mb.webhooks.remove('wh1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/webhooks',
    'GET https://api.test/webhooks',
    'GET https://api.test/webhooks/wh1',
    'PATCH https://api.test/webhooks/wh1',
    'DELETE https://api.test/webhooks/wh1',
  ]);
});

test('campaigns.stats + ab map to the right routes', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.campaigns.stats('b1');
  await mb.campaigns.ab('b1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET https://api.test/campaigns/b1/stats',
    'GET https://api.test/campaigns/b1/ab',
  ]);
});

test('campaigns.create forwards recurrence + ab_test + new fields', async () => {
  const { fn, calls } = mockFetch(200, { id: 'b-1' });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.campaigns.create({
    domain: 'x.com', from: 'f@x.com', subject: 's', html: 'x',
    reply_to: 'r@x.com', preview_text: 'pv',
    recurrence: 'weekly', recurrence_every: 2,
    ab_test: { enabled: true, subject_b: 'B', metric: 'click', test_pct: 30 },
  });
  assert.equal(calls[0].body.recurrence, 'weekly');
  assert.equal(calls[0].body.recurrence_every, 2);
  assert.equal(calls[0].body.preview_text, 'pv');
  assert.equal(calls[0].body.reply_to, 'r@x.com');
  assert.deepEqual(calls[0].body.ab_test, { enabled: true, subject_b: 'B', metric: 'click', test_pct: 30 });
});

test('audiences.update maps to PATCH /audiences/:id', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.audiences.update('a1', { name: 'Renamed' });
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].url, 'https://api.test/audiences/a1');
  assert.deepEqual(calls[0].body, { name: 'Renamed' });
});

test('domains dns helpers map to the right routes', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.domains.detectDns('d1');
  await mb.domains.applyCloudflareDns('d1', { token: 'cf' });
  await mb.domains.applyGoDaddyDns('d1', { key: 'k', secret: 's' });
  await mb.domains.applyNamecheapDns('d1', { apiUser: 'u', apiKey: 'nk' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET https://api.test/domains/d1/dns/detect',
    'POST https://api.test/domains/d1/dns/cloudflare',
    'POST https://api.test/domains/d1/dns/godaddy',
    'POST https://api.test/domains/d1/dns/namecheap',
  ]);
  assert.deepEqual(calls[1].body, { token: 'cf' });
  assert.deepEqual(calls[2].body, { key: 'k', secret: 's' });
  assert.deepEqual(calls[3].body, { apiUser: 'u', apiKey: 'nk' });
});

test('segments.create forwards filter.property_filters', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.segments.create({
    domain: 'x.com', name: 'Pro users',
    filter: { status: 'subscribed', property_filters: [{ key: 'plan', operator: 'eq', value: 'pro' }] },
  });
  assert.deepEqual(calls[0].body.filter.property_filters, [{ key: 'plan', operator: 'eq', value: 'pro' }]);
});

test('emails.receiving.getRaw returns raw bytes (ArrayBuffer)', async () => {
  const { fn, calls } = mockFetch(200, 'RAWMIME');
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.emails.receiving.getRaw('r1');
  assert.equal(calls[0].url, 'https://api.test/emails/receiving/r1/raw');
  assert.equal(res.error, null);
  assert.ok(res.data instanceof ArrayBuffer);
});

test('automations.deleteStep maps to DELETE /automations/:id/steps/:stepId', async () => {
  const { fn, calls } = mockFetch(200, { id: 'st1', deleted: true });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.automations.deleteStep('au1', 'st1');
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].url, 'https://api.test/automations/au1/steps/st1');
});

test('webhooks.rotate + test map to the right routes', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.webhooks.rotate('wh1');
  await mb.webhooks.test('wh1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/webhooks/wh1/rotate',
    'POST https://api.test/webhooks/wh1/test',
  ]);
});

test('webhooks.verify validates a correct Svix-style signature', () => {
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: mockFetch(200, {}).fn });
  const secret = 'whsec_' + Buffer.from('supersecretkeybytes!!').toString('base64');
  const id = 'msg_123';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = JSON.stringify({ type: 'email.delivered', data: { id: 'e1' } });
  // Mirror the backend: HMAC over `${id}.${timestamp}.${body}` with the decoded key.
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const sig = 'v1,' + createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest('base64');

  const ok = mb.webhooks.verify(payload, { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': sig }, secret);
  assert.deepEqual(ok, { valid: true });

  // Wrong payload → no match.
  const bad = mb.webhooks.verify('{}', { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': sig }, secret);
  assert.equal(bad.valid, false);
  assert.equal(bad.reason, 'no_match');

  // Missing headers.
  const missing = mb.webhooks.verify(payload, {}, secret);
  assert.deepEqual(missing, { valid: false, reason: 'missing_headers' });

  // Reads headers case-insensitively + accepts a raw secret (no whsec_ prefix).
  const rawSecret = 'plainsecret';
  const sig2 = 'v1,' + createHmac('sha256', Buffer.from(rawSecret, 'utf8')).update(`${id}.${timestamp}.${payload}`).digest('base64');
  const ci = mb.webhooks.verify(payload, { 'Svix-Id': id, 'Svix-Timestamp': timestamp, 'Svix-Signature': sig2 }, rawSecret);
  assert.deepEqual(ci, { valid: true });
});

test('webhooks.verify reads a Fetch Headers / Map, not just a plain object', () => {
  // REGRESSION: verification used to enumerate `Object.keys(headers)`, which is
  // `[]` for a WHATWG `Headers` — and `request.headers` IS a `Headers` in Next.js
  // App Router, Remix, Hono, Cloudflare Workers, Deno and Bun. Every genuinely
  // signed delivery on those frameworks came back `missing_headers`, blaming
  // SendPing for headers that were present and a signature that was valid.
  const secret = 'whsec_' + Buffer.from('supersecretkeybytes!!').toString('base64');
  const id = 'msg_123';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = JSON.stringify({ type: 'email.delivered', data: { id: 'e1' } });
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const sig = 'v1,' + createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest('base64');

  // A Fetch Headers — the container half the Node ecosystem hands its users.
  const fetchHeaders = new Headers({ 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': sig });
  assert.equal(Object.keys(fetchHeaders).length, 0, 'a Headers exposes no own keys — that is the trap');
  assert.deepEqual(verifyWebhookSignature(payload, fetchHeaders, secret), { valid: true });

  // Any (name, value) iterable, e.g. a Map, reads the same way.
  const asMap = new Map([['Svix-Id', id], ['Svix-Timestamp', timestamp], ['Svix-Signature', sig]]);
  assert.deepEqual(verifyWebhookSignature(payload, asMap, secret), { valid: true });

  // A null-prototype plain object (what `node:http` actually gives you) and
  // array-valued headers (what a proxy may give you) still take the own-keys path.
  const nodeStyle = Object.assign(Object.create(null), {
    'svix-id': [id], 'svix-timestamp': timestamp, 'svix-signature': sig,
  });
  assert.deepEqual(verifyWebhookSignature(payload, nodeStyle, secret), { valid: true });

  // A plain object carrying a header literally NAMED `entries` holds a string
  // there, not a function, so it must not be mistaken for a Headers-like.
  const trap = { entries: 'not-a-function', 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': sig };
  assert.deepEqual(verifyWebhookSignature(payload, trap, secret), { valid: true });

  // A bare ARRAY of (name, value) pairs — the `Iterable<[string, string]>` arm the
  // public type advertises. This is why headerPairs() must try Symbol.iterator
  // BEFORE entries(): `Array.prototype.entries()` yields (INDEX, value), so an
  // entries-first order reads these as headers named "0", "1", "2" and fails the
  // delivery as missing_headers while blaming the caller.
  const asPairs: Array<[string, string]> = [
    ['svix-id', id], ['svix-timestamp', timestamp], ['svix-signature', sig],
  ];
  assert.deepEqual(verifyWebhookSignature(payload, asPairs, secret), { valid: true });

  // An empty container is still an honest missing_headers.
  assert.deepEqual(verifyWebhookSignature(payload, new Headers(), secret), { valid: false, reason: 'missing_headers' });
});

test('verifyWebhookSignature enforces timestamp tolerance (and 0 disables it)', () => {
  const secret = 'whsec_' + Buffer.from('key').toString('base64');
  const id = 'msg_1';
  const stale = String(Math.floor(Date.now() / 1000) - 10_000);
  const payload = '{}';
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const sig = 'v1,' + createHmac('sha256', key).update(`${id}.${stale}.${payload}`).digest('base64');
  const headers = { 'svix-id': id, 'svix-timestamp': stale, 'svix-signature': sig };

  const rejected = verifyWebhookSignature(payload, headers, secret);
  assert.equal(rejected.valid, false);
  assert.equal(rejected.reason, 'timestamp_out_of_tolerance');

  const accepted = verifyWebhookSignature(payload, headers, secret, { toleranceSec: 0 });
  assert.deepEqual(accepted, { valid: true });
});

test('emails.list returns trimmed SentEmailListItem shape (no status; null cc/bcc/reply_to)', async () => {
  // Mirrors the backend GET /emails serializer (toSendPingEmailListItem): the
  // list item has last_event but NO status/html/text/events, and unset
  // cc/bcc/reply_to are null (not []). The SDK type must not promise `status`.
  const item = {
    object: 'email', id: 'e-9', message_id: null, from: 'a@x.com', to: ['b@y.com'],
    cc: null, bcc: null, reply_to: null, subject: 'Hi', last_event: 'sent',
    scheduled_at: null, created_at: '2026-07-04T00:00:00Z',
  };
  const { fn } = mockFetch(200, { object: 'list', has_more: false, data: [item] });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.emails.list({ limit: 10 });
  const row = res.data!.data[0];
  assert.equal(row.last_event, 'sent');
  assert.equal(row.cc, null);
  // Compile-time: `status` must NOT exist on the list item type. If the SDK
  // regressed to ListResponse<Email>, `row.status` would typecheck and the
  // directive below would become an unused-directive build error.
  // (Do not start a comment line with the directive name in prose — TypeScript
  // reads that as a second, real directive.)
  // @ts-expect-error SentEmailListItem has no `status`
  assert.equal(row.status, undefined);
});

test('apiKeys.list exposes token prefix, permission and last_used_at', async () => {
  // `token` on a read is the 8-char display PREFIX of the key, never a secret
  // and never an `mb_live_` form (that prefix does not exist).
  const key = {
    id: '7', name: 'CI', token: 'mb_ab12', permission: 'sending_access',
    domain_id: null, created_at: '2026-07-04T00:00:00Z', last_used_at: null,
  };
  const { fn } = mockFetch(200, { object: 'list', has_more: false, data: [key] });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.apiKeys.list();
  const k = res.data!.data[0];
  // These three fields are returned by the backend and must be typed.
  assert.equal(k.token, 'mb_ab12');
  assert.equal(k.permission, 'sending_access');
  assert.equal(k.last_used_at, null);
});

test('apiKeys.list accepts pagination', async () => {
  const { fn, calls } = mockFetch(200, { object: 'list', has_more: false, data: [] });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.apiKeys.list({ limit: 5 });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET https://api.test/api-keys?limit=5',
  ]);
});

test('apiKeys exposes list only — key lifecycle is dashboard-only', async () => {
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test' });
  // Creating, re-scoping and revoking keys require a signed-in dashboard
  // session, so the SDK ships no method for them: a leaked key cannot mint a
  // replacement or widen its own scope. Absent at compile time too — each
  // access below is a type error, which is what @ts-expect-error asserts.
  for (const method of ['create', 'update', 'remove', 'revoke', 'delete'] as const) {
    assert.equal((mb.apiKeys as unknown as Record<string, unknown>)[method], undefined);
  }
  // @ts-expect-error apiKeys.create does not exist
  assert.equal(mb.apiKeys.create, undefined);
  // @ts-expect-error apiKeys.update does not exist
  assert.equal(mb.apiKeys.update, undefined);
  // @ts-expect-error apiKeys.remove does not exist
  assert.equal(mb.apiKeys.remove, undefined);
  assert.equal(typeof mb.apiKeys.list, 'function');
});

test('logs + events map to the right routes', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.logs.list({ limit: 20, before: 'cur2' });
  await mb.logs.get('l1');
  await mb.events.send({ name: 'signup.completed', domain: 'x.com', email: 'c@x.com', data: { plan: 'pro' } });
  await mb.events.create({ name: 'signup.completed', schema: { plan: 'string' } });
  await mb.events.list();
  await mb.events.update('ev1', { schema: { plan: 'string', seats: 'number' } });
  await mb.events.remove('ev1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET https://api.test/logs?limit=20&before=cur2',
    'GET https://api.test/logs/l1',
    'POST https://api.test/events/send',
    'POST https://api.test/events',
    'GET https://api.test/events',
    'PATCH https://api.test/events/ev1',
    'DELETE https://api.test/events/ev1',
  ]);
  assert.deepEqual(calls[2].body, { name: 'signup.completed', domain: 'x.com', email: 'c@x.com', data: { plan: 'pro' } });
  assert.deepEqual(calls[3].body, { name: 'signup.completed', schema: { plan: 'string' } });
  assert.deepEqual(calls[5].body, { schema: { plan: 'string', seats: 'number' } });
});

test('contacts.remove returns the { object, id, deleted } ack', async () => {
  // The route answers { object:'contact', id, deleted:true } — there is no
  // `contact` key. Typing one would send callers looking for a field that
  // never arrives.
  const { fn } = mockFetch(200, { object: 'contact', id: 'c1', deleted: true });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.contacts.remove({ id: 'c1' });
  assert.equal(res.data?.id, 'c1');
  assert.equal(res.data?.deleted, true);
  // @ts-expect-error the delete ack has no `contact` field
  assert.equal(res.data?.contact, undefined);
});

test('contacts.listSegments returns id/name/created_at rows and accepts paging', async () => {
  const { fn, calls } = mockFetch(200, {
    object: 'list', has_more: false,
    data: [{ id: 's1', name: 'General', created_at: '2026-07-04T00:00:00Z' }],
  });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.contacts.listSegments('c1', { limit: 5 });
  assert.equal(calls[0].url, 'https://api.test/contacts/c1/segments?limit=5');
  assert.equal(res.data!.data[0].name, 'General');
  // @ts-expect-error the nested rows carry no `filter`
  assert.equal(res.data!.data[0].filter, undefined);
});

test('segments.contacts returns the reduced membership shape and accepts paging', async () => {
  const row = {
    id: 'c1', email: 'a@x.com', first_name: null, last_name: null,
    unsubscribed: false, created_at: '2026-07-04T00:00:00Z',
  };
  const { fn, calls } = mockFetch(200, { object: 'list', has_more: false, data: [row] });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.segments.contacts('s1', { limit: 25 });
  assert.equal(calls[0].url, 'https://api.test/segments/s1/contacts?limit=25');
  assert.equal(res.data!.data[0].email, 'a@x.com');
  // @ts-expect-error segment membership rows carry no `properties`
  assert.equal(res.data!.data[0].properties, undefined);
});

test('segments accept a members_only status and an engagement filter', async () => {
  const { fn, calls } = mockFetch(201, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.segments.create({
    domain: 'x.com', name: 'Openers',
    filter: { status: 'members_only', engagement: { event: 'opened', campaign_id: 'cmp1' } },
  });
  assert.equal(calls[0].body.filter.status, 'members_only');
  assert.deepEqual(calls[0].body.filter.engagement, { event: 'opened', campaign_id: 'cmp1' });
});

test('campaign.statistics carries counts only — `links` is stats-only', async () => {
  // GET /campaigns/:id embeds getCampaignStats() verbatim, which computes counts
  // and rates and NOTHING else. Only GET /campaigns/:id/stats adds `links`, so
  // the embedded block must not promise it — `statistics.links.length` used to
  // typecheck and then throw on undefined.
  const statistics = {
    total: 10, delivered: 9, opened: 4, clicked: 2, replied: 1, bounced: 1, complained: 0,
    rates: { delivery: 90, open: 44.4, click: 22.2, reply: 11.1, bounce: 10, complaint: 0 },
  };
  const { fn } = mockFetch(200, {
    object: 'campaign', id: 'c1', name: null, audience_id: 'aud_1', segment_id: null,
    topic_id: null, from: 'a@x.com', subject: 's', status: 'sent',
    scheduled_at: null, sent_at: null, created_at: '2026-08-19T00:00:00.000Z',
    statistics,
  });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.campaigns.get('c1');
  assert.deepEqual(res.data!.statistics, statistics);
  // The embedded block is CampaignStatistics (no `links`); the stats endpoint's
  // CampaignStats extends it and adds one.
  // The cast has to go via `unknown`: CampaignStatistics has no `links` at all,
  // which is the whole point — a direct property read would not compile.
  assert.equal((res.data!.statistics as unknown as Record<string, unknown>).links, undefined);

  const withLinks = mockFetch(200, {
    object: 'campaign_stats', campaign_id: 'c1', ...statistics,
    links: [{ url: 'https://acme.com', clicks: 2 }],
  });
  const mb2 = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: withLinks.fn });
  const stats = await mb2.campaigns.stats('c1');
  assert.equal(stats.data!.links[0].clicks, 2);
  assert.equal(stats.data!.delivered, 9);
});

test('campaigns.engagement maps to GET /campaigns/:id/engagement', async () => {
  const { fn, calls } = mockFetch(200, { object: 'campaign_engagement', campaign_id: 'b1', opened: [], clicked: [], replied: [] });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.campaigns.engagement('b1');
  assert.equal(calls[0].url, 'https://api.test/campaigns/b1/engagement');
  assert.deepEqual(res.data?.opened, []);
});

test('updateStep rejects the create-only graph `key`', async () => {
  // REGRESSION: updateStep took the ADD-step body, which offers `key` with a
  // create-only doc comment ("defaults to the new step's id") rendered at the
  // update call site. PATCH forwards only type and config to storage, so the
  // key is discarded — and the response echoes the STORED key back, so the
  // intended re-key type-checks, returns 200, and silently never happens while
  // the automation's `connections` stay pointed at the old key.
  const { fn, calls } = mockFetch(200, { id: 'st1', key: 'welcome', type: 'send', position: 0, config: {} });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });

  // @ts-expect-error `key` is create-only — set it on addStep(), not updateStep()
  await mb.automations.updateStep('au1', 'st1', { type: 'send_email', key: 'welcome_v2', config: {} });
  // addStep, the endpoint that DOES honour it, still accepts it.
  await mb.automations.addStep('au1', { type: 'send_email', key: 'welcome_v2', config: {} });

  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'PATCH https://api.test/automations/au1/steps/st1',
    'POST https://api.test/automations/au1/steps',
  ]);
});

test('automations.runs forwards a status filter as a comma-separated list', async () => {
  const { fn, calls } = mockFetch(200, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.automations.runs('au1', { status: ['failed', 'running'], limit: 10 });
  await mb.automations.runs('au1', { status: 'completed' });
  assert.deepEqual(calls.map((c) => c.url), [
    'https://api.test/automations/au1/runs?limit=10&status=failed%2Crunning',
    'https://api.test/automations/au1/runs?status=completed',
  ]);
});

test('automations.createWithAi maps to POST /automations/:id/ai', async () => {
  const { fn, calls } = mockFetch(200, { object: 'automation', id: 'au1', ai: { added_steps: 3, mode: 'workflow' } });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.automations.createWithAi('au1', { prompt: 'welcome series', template_ids: ['t1'] });
  assert.equal(calls[0].url, 'https://api.test/automations/au1/ai');
  assert.deepEqual(calls[0].body, { prompt: 'welcome series', template_ids: ['t1'] });
  assert.equal(res.data?.ai.added_steps, 3);
});

test('domains.recordsCsv returns the CSV body as text', async () => {
  const csv = 'Type,Host,Full name,Value,Priority,TTL,Purpose,Status\r\n';
  const fn = (async () => ({
    ok: true, status: 200, headers: { get: () => null }, text: async () => csv,
  })) as unknown as typeof fetch;
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.domains.recordsCsv('d1');
  assert.equal(res.error, null);
  assert.equal(res.data, csv);
});

test('contacts.import supports storage_key + segment_id; createImportUpload maps correctly', async () => {
  const { fn, calls } = mockFetch(201, {});
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.contacts.createImportUpload({ audienceId: 'a1', filename: 'big.csv', size: 1024 });
  await mb.contacts.import({ audienceId: 'a1', storage_key: 'uploads/a1/big.csv', segment_id: 'seg1' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.test/audiences/a1/contacts/import/upload',
    'POST https://api.test/audiences/a1/contacts/import?segment_id=seg1',
  ]);
  assert.deepEqual(calls[0].body, { filename: 'big.csv', size: 1024 });
  assert.deepEqual(calls[1].body, { storage_key: 'uploads/a1/big.csv' });
});

test('webhooks.test surfaces a failed delivery as data.ok === false', async () => {
  // The route answers HTTP 200 even when the endpoint could not be reached.
  const { fn } = mockFetch(200, { object: 'webhook_test', id: 'wh1', ok: false, error: 'lookup_failed' });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  const res = await mb.webhooks.test('wh1');
  assert.equal(res.error, null);
  assert.equal(res.data?.ok, false);
  assert.equal(res.data?.error, 'lookup_failed');
});

test('domains.mxCheck maps to GET /domains/mx-check', async () => {
  const { fn, calls } = mockFetch(200, { has_mx: false, ours: false, records: [] });
  const mb = new SendPing('mb_test', { baseUrl: 'https://api.test', fetch: fn });
  await mb.domains.mxCheck('mail.example.com');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://api.test/domains/mx-check?name=mail.example.com');
});

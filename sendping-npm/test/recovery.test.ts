import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { HttpClient } from '../src/client';
import { SendPing } from '../src/index';

const corpus = JSON.parse(readFileSync(new URL('../../scripts/http-recovery-corpus.json', import.meta.url), 'utf8')) as Array<{
  name: string; method: string; path: string; status: number; body: unknown; key?: string; attempts: number;
}>;

for (const c of corpus) {
  test(`HTTP recovery: ${c.name}`, async () => {
    let calls = 0;
    const client = new HttpClient('mb_test', { fetch: async (_url, init) => {
      calls++;
      if (c.key) assert.equal((init!.headers as Record<string, string>)['Idempotency-Key'], c.key);
      return calls === 1
        ? new Response(JSON.stringify(c.body), { status: c.status, headers: { 'Retry-After': '0' } })
        : Response.json({ id: 'em_retry' });
    }});
    const result = await client.request(c.method, c.path, c.method === 'GET' ? undefined : { text: 'a  b\n\n c' }, { idempotencyKey: c.key });
    assert.equal(calls, c.attempts);
    if (c.attempts === 1) {
      assert.equal(result.error?.statusCode, c.status);
      if (typeof c.body === 'object' && c.body) {
        for (const [k, v] of Object.entries(c.body)) if (k !== 'statusCode') assert.deepEqual(result.error?.[k], v);
      }
    } else assert.equal(result.error, null);
  });
}

test('body read failures keep the Result contract for JSON, text and binary', async () => {
  const client = new HttpClient('mb_test', { fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error('body connection reset')); },
  })) });
  for (const invoke of [() => client.request('GET', '/domains'), () => client.requestText('GET', '/records.csv'), () => client.requestRaw('GET', '/raw')]) {
    const result = await invoke();
    assert.equal(result.error?.name, 'network_error');
    assert.equal(result.error?.statusCode, 0);
  }
});

test('reply and forward pass stable operation keys without changing content', async () => {
  const calls: RequestInit[] = [];
  const mb = new SendPing('mb_test', { fetch: async (_url, init) => { calls.push(init!); return Response.json({ object: 'email', id: 'em_one' }); } });
  await mb.emails.receiving.reply('rcv_1', { from: 'sender@domain.test', text: 'a  b\n\n c' }, { idempotencyKey: 'reply-1' });
  await mb.emails.receiving.forward('rcv_1', { from: 'sender@domain.test', to: 'to@domain.test' }, { idempotencyKey: 'forward-1' });
  assert.equal((calls[0].headers as Record<string, string>)['Idempotency-Key'], 'reply-1');
  assert.equal((calls[1].headers as Record<string, string>)['Idempotency-Key'], 'forward-1');
  assert.equal(JSON.parse(String(calls[0].body)).text, 'a  b\n\n c');
});

test('default transport does not forward email bodies through redirects', async () => {
  let redirected = 0;
  const target = createServer((req, res) => { redirected++; req.resume(); res.end('{"id":"redirected"}'); });
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
  const address = target.address() as {port: number};
  const origin = createServer((req, res) => { req.resume(); res.writeHead(307, { Location: `http://127.0.0.1:${address.port}/collect` }); res.end(); });
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
  try {
    const port = (origin.address() as {port: number}).port;
    const mb = new SendPing('mb_test', { baseUrl: `http://127.0.0.1:${port}` });
    const result = await mb.emails.send({ from: 'sender@domain.test', to: 'to@domain.test', subject: 'private', text: 'private body' });
    assert.equal(result.error?.statusCode, 307);
    assert.equal(redirected, 0);
  } finally {
    origin.closeAllConnections(); target.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => origin.close(() => resolve())), new Promise<void>(resolve => target.close(() => resolve()))]);
  }
});

test('tracking health and recovery metadata use the actual HTTP status', async () => {
  const mb = new SendPing('mb_test', { fetch: async (url) => {
    assert.ok(String(url).endsWith('/domains/domain%20one/tracking-health'));
    return Response.json({custom_host: null, status: 'shared', checked_at: '2026-09-10T00:00:00Z'});
  }});
  assert.equal((await mb.domains.trackingHealth('domain one')).data?.status, 'shared');
  const client = new HttpClient('mb_test', { fetch: async () => Response.json({statusCode: 503, name: 'validation_error', id: 'em_one', reserved: [{id: 'em_one'}], unsent_count: 0}, {status: 422}) });
  const error = (await client.request('POST', '/emails', {})).error;
  assert.equal(error?.statusCode, 422); assert.equal(error?.id, 'em_one');
  assert.deepEqual(error?.reserved, [{id: 'em_one'}]); assert.equal(error?.unsent_count, 0);
});

test('native timeout covers slow JSON, text and binary response bodies', async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    calls++; req.resume();
    res.writeHead(200, {'Content-Type': 'application/json', 'Content-Length': '100'});
    res.write('{'); // Headers arrive; body never completes until client aborts.
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new HttpClient('mb_test', { baseUrl: `http://127.0.0.1:${(server.address() as {port: number}).port}`, timeoutMs: 100 });
    for (const invoke of [() => client.request('GET', '/json'), () => client.requestText('GET', '/text'), () => client.requestRaw('GET', '/raw')]) {
      const result = await invoke();
      assert.equal(result.error?.statusCode, 0);
      assert.equal(result.error?.name, 'network_error');
    }
    assert.equal(calls, 3);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('invalid infinite retry/timeout settings fail before any request', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => new HttpClient('mb_test', {maxRetries: value}), RangeError);
    assert.throws(() => new HttpClient('mb_test', {timeoutMs: value}), RangeError);
  }
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createContext, run } = require('../src/cli');

const RESOURCES = [
  'emails', 'batch', 'domains', 'audiences', 'contacts', 'contactProperties',
  'segments', 'topics', 'campaigns',
  'templates', 'automations', 'webhooks', 'logs', 'events', 'apiKeys', 'polls',
];

/** Recording proxy for one resource; `emails.receiving` nests a sub-recorder. */
function makeRecorder(calls, resource, response) {
  return new Proxy(
    {},
    {
      get: (_t, method) => {
        if (resource === 'emails' && method === 'receiving') {
          return makeRecorder(calls, 'emails.receiving', response);
        }
        return (...args) => {
          calls.push({ resource, method, args });
          return Promise.resolve(response);
        };
      },
    },
  );
}

/** Build a fake SDK client that records every resource.method(...args) call. */
function makeMockClient(response = { data: { id: 'obj_1', ok: true }, error: null }) {
  const calls = [];
  const client = {};
  for (const resource of RESOURCES) {
    client[resource] = makeRecorder(calls, resource, response);
  }
  return { client, calls };
}

/** Run the CLI against a mocked client; returns calls, output, exit code. */
async function runCli(argv, { response, env, clientFactory, verifyResult } = {}) {
  const mock = makeMockClient(response);
  let out = '';
  let err = '';
  const created = [];
  // `webhooks verify` is local-only: it goes through ctx.verifyWebhook and must
  // never touch createClient, so record its arguments separately.
  const verifyCalls = [];
  const ctx = createContext({
    createClient: clientFactory || ((apiKey, options) => {
      created.push({ apiKey, options });
      return mock.client;
    }),
    verifyWebhook: (...args) => {
      verifyCalls.push(args);
      return verifyResult !== undefined ? verifyResult : { valid: true };
    },
    stdout: (s) => { out += s; },
    stderr: (s) => { err += s; },
    env: env !== undefined ? env : { SENDPING_API_KEY: 'mb_test_key' },
  });
  const exitCode = await run(ctx, argv);
  return { calls: mock.calls, out, err, exitCode, created, verifyCalls };
}

function lastCall(r) {
  assert.equal(r.exitCode, 0, `expected exit 0, stderr: ${r.err}`);
  assert.equal(r.calls.length, 1, `expected exactly one SDK call, got ${JSON.stringify(r.calls)}`);
  return r.calls[0];
}

// ---- emails ----

test('emails send maps flags to emails.send payload', async () => {
  const r = await runCli([
    'emails', 'send',
    '--from', 'Acme <hi@yourdomain.com>',
    '--to', 'a@b.com', '--to', 'c@d.com,e@f.com',
    '--subject', 'hello',
    '--html', '<p>hi</p>',
    '--reply-to', 'reply@yourdomain.com',
    '--scheduled-at', '2026-08-01T00:00:00Z',
    '--variables', '{"first_name":"Ada"}',
    '--idempotency-key', 'order-123',
  ]);
  const call = lastCall(r);
  assert.equal(call.resource, 'emails');
  assert.equal(call.method, 'send');
  assert.deepEqual(call.args[0], {
    from: 'Acme <hi@yourdomain.com>',
    to: ['a@b.com', 'c@d.com', 'e@f.com'],
    subject: 'hello',
    html: '<p>hi</p>',
    reply_to: ['reply@yourdomain.com'],
    scheduled_at: '2026-08-01T00:00:00Z',
    variables: { first_name: 'Ada' },
  });
  assert.deepEqual(call.args[1], { idempotencyKey: 'order-123' });
});

test('emails get / update / cancel map id and payload', async () => {
  let call = lastCall(await runCli(['emails', 'get', 'em_1']));
  assert.deepEqual([call.resource, call.method, call.args], ['emails', 'get', ['em_1']]);

  call = lastCall(await runCli(['emails', 'update', 'em_1', '--scheduled-at', '2026-08-02T00:00:00Z']));
  assert.deepEqual([call.method, call.args], ['update', ['em_1', { scheduled_at: '2026-08-02T00:00:00Z' }]]);

  call = lastCall(await runCli(['emails', 'cancel', 'em_1']));
  assert.deepEqual([call.method, call.args], ['cancel', ['em_1']]);
});

test('emails list maps pagination flags', async () => {
  const call = lastCall(await runCli(['emails', 'list', '--limit', '5', '--after', 'em_9']));
  assert.deepEqual([call.method, call.args], ['list', [{ limit: 5, after: 'em_9' }]]);
});

test('emails attachments / attachment map to listAttachments / getAttachment', async () => {
  let call = lastCall(await runCli(['emails', 'attachments', 'em_1']));
  assert.deepEqual([call.method, call.args], ['listAttachments', ['em_1']]);

  call = lastCall(await runCli(['emails', 'attachment', 'em_1', 'att_2']));
  assert.deepEqual([call.method, call.args], ['getAttachment', ['em_1', 'att_2']]);
});

// ---- emails batch ----

test('emails batch --file reads a JSON array and calls batch.send', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-cli-'));
  const file = path.join(dir, 'batch.json');
  const payloads = [
    { from: 'a@d.com', to: ['b@e.com'], subject: 'one', html: '<p>1</p>' },
    { from: 'a@d.com', to: ['c@e.com'], subject: 'two', text: '2' },
  ];
  fs.writeFileSync(file, JSON.stringify(payloads));
  const call = lastCall(await runCli(['emails', 'batch', '--file', file]));
  assert.deepEqual([call.resource, call.method], ['batch', 'send']);
  assert.deepEqual(call.args[0], payloads);
  assert.equal(call.args[1], undefined);
});

test('emails batch --data accepts an inline JSON array and passes idempotency key', async () => {
  const call = lastCall(
    await runCli([
      'emails', 'batch',
      '--data', '[{"from":"a@d.com","to":["b@e.com"],"subject":"hi","text":"x"}]',
      '--idempotency-key', 'batch-9',
    ]),
  );
  assert.deepEqual([call.resource, call.method], ['batch', 'send']);
  assert.deepEqual(call.args[0], [{ from: 'a@d.com', to: ['b@e.com'], subject: 'hi', text: 'x' }]);
  assert.deepEqual(call.args[1], { idempotencyKey: 'batch-9' });
});

test('emails batch fails cleanly on missing/unparseable/non-array input', async () => {
  let r = await runCli(['emails', 'batch']);
  assert.equal(r.exitCode, 1);
  assert.equal(r.calls.length, 0);
  assert.match(r.err, /--file <path> or --data/);

  r = await runCli(['emails', 'batch', '--file', '/nope/does-not-exist.json']);
  assert.equal(r.exitCode, 1);
  assert.equal(r.calls.length, 0);
  assert.match(r.err, /Cannot read --file/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-cli-'));
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{nope');
  r = await runCli(['emails', 'batch', '--file', bad]);
  assert.equal(r.exitCode, 1);
  assert.equal(r.calls.length, 0);
  assert.match(r.err, /Invalid JSON in --file/);

  const obj = path.join(dir, 'obj.json');
  fs.writeFileSync(obj, '{"from":"a@d.com"}');
  r = await runCli(['emails', 'batch', '--file', obj]);
  assert.equal(r.exitCode, 1);
  assert.equal(r.calls.length, 0);
  assert.match(r.err, /must be a JSON array/);

  r = await runCli(['emails', 'batch', '--file', obj, '--data', '[]']);
  assert.equal(r.exitCode, 1);
  assert.equal(r.calls.length, 0);
  assert.match(r.err, /only one of --file or --data/);
});

// ---- emails receiving ----

test('emails receiving list / get / attachments / delete map to the receiving sub-resource', async () => {
  let call = lastCall(await runCli(['emails', 'receiving', 'list', '--limit', '5']));
  assert.deepEqual([call.resource, call.method, call.args], ['emails.receiving', 'list', [{ limit: 5 }]]);

  call = lastCall(await runCli(['emails', 'receiving', 'get', 'rem_1']));
  assert.deepEqual([call.resource, call.method, call.args], ['emails.receiving', 'get', ['rem_1']]);

  call = lastCall(await runCli(['emails', 'receiving', 'attachments', 'rem_1']));
  assert.deepEqual([call.resource, call.method, call.args], ['emails.receiving', 'listAttachments', ['rem_1', {}]]);

  call = lastCall(await runCli(['emails', 'receiving', 'delete', 'rem_1']));
  assert.deepEqual([call.resource, call.method, call.args], ['emails.receiving', 'remove', ['rem_1']]);
});

test('emails receiving attachment writes binary to --output and prints the path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-cli-'));
  const out = path.join(dir, 'invoice.pdf');
  const bytes = new TextEncoder().encode('binary-attachment-bytes');
  const r = await runCli(
    ['emails', 'receiving', 'attachment', 'rem_1', 'att_2', '--output', out],
    { response: { data: bytes.buffer, error: null } },
  );
  const call = lastCall(r);
  assert.deepEqual([call.resource, call.method, call.args], ['emails.receiving', 'getAttachment', ['rem_1', 'att_2']]);
  assert.equal(fs.readFileSync(out, 'utf8'), 'binary-attachment-bytes');
  const printed = JSON.parse(r.out);
  assert.equal(printed.path, out);
  assert.equal(printed.bytes, bytes.byteLength);
});

test('emails receiving attachment defaults the filename to the attachment id', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-cli-'));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const bytes = new TextEncoder().encode('x');
    const r = await runCli(
      ['emails', 'receiving', 'attachment', 'rem_1', 'att_2'],
      { response: { data: bytes.buffer, error: null } },
    );
    lastCall(r);
    assert.ok(fs.existsSync(path.join(dir, 'att_2')));
    assert.equal(JSON.parse(r.out).path, path.join(fs.realpathSync(dir), 'att_2'));
  } finally {
    process.chdir(prev);
  }
});

test('emails receiving raw writes the RFC822 message, defaulting to <id>.eml', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-cli-'));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const bytes = new TextEncoder().encode('From: a@b.com\r\n\r\nhi');
    const r = await runCli(
      ['emails', 'receiving', 'raw', 'rem_1'],
      { response: { data: bytes.buffer, error: null } },
    );
    const call = lastCall(r);
    assert.deepEqual([call.resource, call.method, call.args], ['emails.receiving', 'getRaw', ['rem_1']]);
    assert.equal(fs.readFileSync(path.join(dir, 'rem_1.eml'), 'utf8'), 'From: a@b.com\r\n\r\nhi');
  } finally {
    process.chdir(prev);
  }

  // --output overrides the default filename
  const out = path.join(dir, 'message.eml');
  const r = await runCli(
    ['emails', 'receiving', 'raw', 'rem_1', '--output', out],
    { response: { data: new TextEncoder().encode('raw').buffer, error: null } },
  );
  lastCall(r);
  assert.equal(fs.readFileSync(out, 'utf8'), 'raw');
});

test('emails receiving binary commands surface API errors without writing a file', async () => {
  const error = { statusCode: 404, name: 'not_found', message: 'no such attachment' };
  const r = await runCli(
    ['emails', 'receiving', 'attachment', 'rem_1', 'att_2', '--output', '/nope/never-written.bin'],
    { response: { data: null, error } },
  );
  assert.equal(r.exitCode, 1);
  assert.equal(r.out, '');
  assert.deepEqual(JSON.parse(r.err), error);
});

test('emails receiving forward splits --to and maps subject', async () => {
  const call = lastCall(
    await runCli([
      'emails', 'receiving', 'forward', 'rem_1',
      '--from', 'me@yourdomain.com',
      '--to', 'a@b.com', '--to', 'c@d.com,e@f.com',
      '--subject', 'FYI',
    ]),
  );
  assert.deepEqual([call.resource, call.method], ['emails.receiving', 'forward']);
  assert.deepEqual(call.args, [
    'rem_1',
    { from: 'me@yourdomain.com', to: ['a@b.com', 'c@d.com', 'e@f.com'], subject: 'FYI' },
    undefined,
  ]);
});

test('emails receiving reply maps body flags and requires --html or --text', async () => {
  const call = lastCall(
    await runCli(['emails', 'receiving', 'reply', 'rem_1', '--from', 'me@yourdomain.com', '--html', '<p>thanks</p>']),
  );
  assert.deepEqual([call.resource, call.method], ['emails.receiving', 'reply']);
  assert.deepEqual(call.args, ['rem_1', { from: 'me@yourdomain.com', html: '<p>thanks</p>' }, undefined]);

  const missing = await runCli(['emails', 'receiving', 'reply', 'rem_1', '--from', 'me@yourdomain.com']);
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.calls.length, 0);
  assert.match(missing.err, /--html or --text/);
});

// ---- domains ----

test('domains add / verify / delete / list', async () => {
  let call = lastCall(await runCli(['domains', 'add', 'yourdomain.com', '--tls', 'enforced']));
  assert.deepEqual([call.resource, call.method], ['domains', 'create']);
  assert.deepEqual(call.args[0], { name: 'yourdomain.com', tls: 'enforced' });

  call = lastCall(await runCli(['domains', 'verify', 'dom_1']));
  assert.deepEqual([call.method, call.args], ['verify', ['dom_1']]);

  call = lastCall(await runCli(['domains', 'delete', 'dom_1']));
  assert.deepEqual([call.method, call.args], ['remove', ['dom_1']]);

  call = lastCall(await runCli(['domains', 'list']));
  assert.deepEqual([call.method, call.args], ['list', [{}]]);
});

test('domains dns detect / cloudflare / godaddy / namecheap map to the DNS apply methods', async () => {
  let call = lastCall(await runCli(['domains', 'dns', 'detect', 'dom_1']));
  assert.deepEqual([call.resource, call.method, call.args], ['domains', 'detectDns', ['dom_1']]);

  call = lastCall(await runCli(['domains', 'dns', 'cloudflare', 'dom_1', '--token', 'cf_tok']));
  assert.deepEqual([call.method, call.args], ['applyCloudflareDns', ['dom_1', { token: 'cf_tok' }]]);

  call = lastCall(await runCli(['domains', 'dns', 'godaddy', 'dom_1', '--key', 'gd_key', '--secret', 'gd_sec']));
  assert.deepEqual([call.method, call.args], ['applyGoDaddyDns', ['dom_1', { key: 'gd_key', secret: 'gd_sec' }]]);

  call = lastCall(
    await runCli(['domains', 'dns', 'namecheap', 'dom_1', '--api-user', 'ncuser', '--key', 'nc_key', '--user-name', 'acct']),
  );
  assert.deepEqual([call.method, call.args], [
    'applyNamecheapDns',
    ['dom_1', { apiUser: 'ncuser', apiKey: 'nc_key', userName: 'acct' }],
  ]);

  call = lastCall(await runCli(['domains', 'dns', 'namecheap', 'dom_1', '--api-user', 'ncuser', '--key', 'nc_key']));
  assert.deepEqual(call.args, ['dom_1', { apiUser: 'ncuser', apiKey: 'nc_key' }]);
});

test('domains claim start / get / verify map to claim / getClaim / verifyClaim', async () => {
  let call = lastCall(await runCli(['domains', 'claim', 'start', 'yourdomain.com']));
  assert.deepEqual([call.resource, call.method, call.args], ['domains', 'claim', [{ name: 'yourdomain.com' }]]);

  call = lastCall(await runCli(['domains', 'claim', 'get', 'dom_1']));
  assert.deepEqual([call.method, call.args], ['getClaim', ['dom_1']]);

  call = lastCall(await runCli(['domains', 'claim', 'verify', 'dom_1']));
  assert.deepEqual([call.method, call.args], ['verifyClaim', ['dom_1']]);
});

// ---- contacts (domain-first) ----

test('contacts create requires --domain and maps fields', async () => {
  const r = await runCli([
    'contacts', 'create',
    '--domain', 'yourdomain.com',
    '--email', 'a@b.com',
    '--first-name', 'Ada',
    '--properties', '{"plan":"pro"}',
  ]);
  const call = lastCall(r);
  assert.deepEqual([call.resource, call.method], ['contacts', 'create']);
  assert.deepEqual(call.args[0], {
    domain: 'yourdomain.com',
    email: 'a@b.com',
    first_name: 'Ada',
    properties: { plan: 'pro' },
  });

  const missing = await runCli(['contacts', 'create', '--email', 'a@b.com']);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.err, /--domain/);
});

test('contacts list maps domain + segment filter', async () => {
  const call = lastCall(
    await runCli(['contacts', 'list', '--domain', 'yourdomain.com', '--segment-id', 'seg_1', '--limit', '10']),
  );
  assert.deepEqual([call.method, call.args], [
    'list',
    [{ domain: 'yourdomain.com', segment_id: 'seg_1', limit: 10 }],
  ]);
});

test('contacts get / update / delete pass id and optional domain', async () => {
  let call = lastCall(await runCli(['contacts', 'get', 'a@b.com', '--domain', 'yourdomain.com']));
  assert.deepEqual([call.method, call.args], ['get', [{ id: 'a@b.com', domain: 'yourdomain.com' }]]);

  call = lastCall(await runCli(['contacts', 'update', 'con_1', '--unsubscribed']));
  assert.deepEqual([call.method, call.args], ['update', [{ id: 'con_1', unsubscribed: true }]]);

  call = lastCall(await runCli(['contacts', 'delete', 'con_1']));
  assert.deepEqual([call.method, call.args], ['remove', [{ id: 'con_1' }]]);
});

test('contacts remove-from-segment / topics / set-topics map to segment and topic methods', async () => {
  let call = lastCall(await runCli(['contacts', 'remove-from-segment', 'con_1', 'seg_2']));
  assert.deepEqual([call.resource, call.method, call.args], ['contacts', 'removeFromSegment', ['con_1', 'seg_2']]);

  call = lastCall(await runCli(['contacts', 'topics', 'con_1']));
  assert.deepEqual([call.method, call.args], ['getTopics', ['con_1', {}]]);

  call = lastCall(
    await runCli(['contacts', 'set-topics', 'con_1', '--topics', '[{"id":"top_1","subscription":"opt_out"}]']),
  );
  assert.deepEqual([call.method, call.args], [
    'updateTopics',
    ['con_1', { topics: [{ id: 'top_1', subscription: 'opt_out' }] }],
  ]);

  const bad = await runCli(['contacts', 'set-topics', 'con_1', '--topics', '{nope']);
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.calls.length, 0);
  assert.match(bad.err, /Invalid JSON for --topics/);
});

test('contacts batch --domain uses the domain-first door, and one-of is enforced', async () => {
  // The bulk door for the domain-first API. `audienceId` stays a POSITIONAL for
  // backwards compatibility, so the two must not be usable together.
  let call = lastCall(await runCli(['contacts', 'batch', '--domain', 'x.com', '--data', '[{"email":"a@x.com"}]']));
  assert.deepEqual([call.resource, call.method], ['contacts', 'batch']);
  assert.deepEqual(call.args[0], { domain: 'x.com', contacts: [{ email: 'a@x.com' }] });

  call = lastCall(await runCli(['contacts', 'batch', '--domain', 'x.com', '--data', '[{"email":"b@x.com"}]', '--on-conflict', 'skip']));
  assert.deepEqual(call.args[0], { domain: 'x.com', contacts: [{ email: 'b@x.com' }], on_conflict: 'skip' });

  // Neither target -> the same guard message the other contacts commands give.
  let bad = await runCli(['contacts', 'batch', '--data', '[{"email":"c@x.com"}]']);
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.calls.length, 0);
  assert.match(bad.err, /--domain/);

  // Both targets -> rejected rather than silently preferring one.
  bad = await runCli(['contacts', 'batch', 'aud_1', '--domain', 'x.com', '--data', '[{"email":"c@x.com"}]']);
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.calls.length, 0);
  assert.match(bad.err, /only one of/i);
});

test('contacts batch --audience-id targets the audience exactly like the positional', async () => {
  // The missing-target error advises --audience-id, so it must be a real
  // registered option here, not just on the sibling commands.
  const flagged = lastCall(await runCli(['contacts', 'batch', '--audience-id', 'aud_1', '--data', '[{"email":"a@x.com"}]']));
  assert.deepEqual([flagged.resource, flagged.method], ['contacts', 'batch']);

  const positional = lastCall(await runCli(['contacts', 'batch', 'aud_1', '--data', '[{"email":"a@x.com"}]']));
  assert.deepEqual(flagged.args, positional.args);
  assert.deepEqual(flagged.args[0], { audienceId: 'aud_1', contacts: [{ email: 'a@x.com' }] });

  const help = await runCli(['contacts', 'batch', '--help']);
  assert.equal(help.exitCode, 0);
  assert.match(help.out, /--audience-id <id>/);
});

test('contacts batch reads --file / --data and maps to contacts.batch (SDK-3)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbcli-'));
  const file = path.join(dir, 'contacts.json');
  fs.writeFileSync(file, JSON.stringify([{ email: 'a@x.com' }, { email: 'b@x.com', first_name: 'B' }]));

  let call = lastCall(await runCli(['contacts', 'batch', 'aud_1', '--file', file, '--on-conflict', 'skip']));
  assert.deepEqual([call.resource, call.method], ['contacts', 'batch']);
  assert.deepEqual(call.args[0], { audienceId: 'aud_1', contacts: [{ email: 'a@x.com' }, { email: 'b@x.com', first_name: 'B' }], on_conflict: 'skip' });

  call = lastCall(await runCli(['contacts', 'batch', 'aud_1', '--data', '[{"email":"c@x.com"}]']));
  assert.deepEqual(call.args[0], { audienceId: 'aud_1', contacts: [{ email: 'c@x.com' }] });

  // Guards: no input, both inputs, non-array, unreadable file.
  let bad = await runCli(['contacts', 'batch', 'aud_1']);
  assert.equal(bad.exitCode, 1);
  assert.match(bad.err, /--file .* or --data/);
  bad = await runCli(['contacts', 'batch', 'aud_1', '--data', '{"email":"x"}']);
  assert.equal(bad.exitCode, 1);
  assert.match(bad.err, /must be a JSON array/);
});

test('contacts import reads --csv and maps to contacts.import with strict flag (SDK-3)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbcli-'));
  const csvFile = path.join(dir, 'contacts.csv');
  fs.writeFileSync(csvFile, 'email,first_name\nz@x.com,Zed\n');

  let call = lastCall(await runCli(['contacts', 'import', 'aud_1', '--csv', csvFile, '--on-conflict', 'upsert']));
  assert.deepEqual([call.resource, call.method], ['contacts', 'import']);
  assert.deepEqual(call.args[0], { audienceId: 'aud_1', csv: 'email,first_name\nz@x.com,Zed\n', on_conflict: 'upsert' });

  // --no-create-properties → create_properties:false is threaded through.
  call = lastCall(await runCli(['contacts', 'import', 'aud_1', '--csv', csvFile, '--no-create-properties']));
  assert.equal(call.args[0].create_properties, false);

  const bad = await runCli(['contacts', 'import', 'aud_1', '--csv', '/nope/missing.csv']);
  assert.equal(bad.exitCode, 1);
  assert.match(bad.err, /Cannot read --csv/);
});

test('webhooks verify computes a local signature check (SDK-4)', async () => {
  const r = await runCli([
    'webhooks', 'verify',
    '--secret', 'whsec_test',
    '--payload', '{"type":"email.delivered"}',
    '--svix-id', 'msg_1', '--svix-timestamp', '1700000000', '--svix-signature', 'v1,abc',
    '--tolerance', '0',
  ]);
  assert.equal(r.exitCode, 0, r.err);
  assert.equal(r.calls.length, 0, 'verify must not issue an SDK call');
  assert.equal(r.verifyCalls.length, 1);
  const [payload, headers, secret, options] = r.verifyCalls[0];
  assert.equal(payload, '{"type":"email.delivered"}');
  assert.deepEqual(headers, { 'svix-id': 'msg_1', 'svix-timestamp': '1700000000', 'svix-signature': 'v1,abc' });
  assert.equal(secret, 'whsec_test');
  assert.deepEqual(options, { toleranceSec: 0 });

  const bad = await runCli(['webhooks', 'verify', '--secret', 's', '--svix-id', 'm', '--svix-timestamp', 't', '--svix-signature', 'x']);
  assert.equal(bad.exitCode, 1);
  assert.match(bad.err, /--payload .* or --payload-file/);
});

test('webhooks verify needs no API key — it makes no request', async () => {
  // The whole point of the command is running inside a webhook RECEIVER, which
  // has no reason to hold a send-capable SendPing key.
  const r = await runCli([
    'webhooks', 'verify', '--secret', 'whsec_test', '--payload', '{}',
    '--svix-id', 'msg_1', '--svix-timestamp', '1700000000', '--svix-signature', 'v1,abc',
  ], { env: {} });
  assert.equal(r.exitCode, 0, r.err);
  assert.deepEqual(r.created, [], 'no client may be constructed');
  assert.equal(r.verifyCalls.length, 1);
  // No --tolerance → the SDK default (300s) applies; nothing is forced.
  assert.deepEqual(r.verifyCalls[0][3], {});
  assert.deepEqual(JSON.parse(r.out), { valid: true });
});

test('webhooks verify rejects a non-numeric --tolerance instead of skipping the freshness check', async () => {
  // Number('5m') is NaN and the SDK gate is `toleranceSec > 0`, so a coerced
  // NaN silently disabled the replay window and called a stale delivery valid.
  const bad = await runCli([
    'webhooks', 'verify', '--secret', 'whsec_test', '--payload', '{}',
    '--svix-id', 'msg_1', '--svix-timestamp', '1700000000', '--svix-signature', 'v1,abc',
    '--tolerance', '5m',
  ]);
  assert.equal(bad.exitCode, 1);
  assert.match(bad.err, /--tolerance must be an integer/);

  const negative = await runCli([
    'webhooks', 'verify', '--secret', 'whsec_test', '--payload', '{}',
    '--svix-id', 'msg_1', '--svix-timestamp', '1700000000', '--svix-signature', 'v1,abc',
    '--tolerance', '-1',
  ]);
  assert.equal(negative.exitCode, 1);
  assert.match(negative.err, /--tolerance must be 0 or greater/);
});

// ---- contact properties ----

test('contact-properties create / list / get / update / delete', async () => {
  let call = lastCall(
    await runCli(['contact-properties', 'create', '--key', 'company', '--type', 'string', '--fallback-value', 'Acme']),
  );
  assert.deepEqual([call.resource, call.method], ['contactProperties', 'create']);
  assert.deepEqual(call.args[0], { key: 'company', type: 'string', fallback_value: 'Acme' });

  call = lastCall(await runCli(['contact-properties', 'list', '--limit', '10']));
  assert.deepEqual([call.method, call.args], ['list', [{ limit: 10 }]]);

  call = lastCall(await runCli(['contact-properties', 'get', 'prop_1']));
  assert.deepEqual([call.method, call.args], ['get', ['prop_1']]);

  call = lastCall(await runCli(['contact-properties', 'update', 'prop_1', '--fallback-value', 'n/a']));
  assert.deepEqual([call.method, call.args], ['update', ['prop_1', { fallback_value: 'n/a' }]]);

  call = lastCall(await runCli(['contact-properties', 'delete', 'prop_1']));
  assert.deepEqual([call.method, call.args], ['remove', ['prop_1']]);
});

// ---- audiences ----

test('audiences create / list / get / update / delete / import-sheet', async () => {
  let call = lastCall(await runCli(['audiences', 'create', '--name', 'General']));
  assert.deepEqual([call.resource, call.method], ['audiences', 'create']);
  assert.deepEqual(call.args, [{ name: 'General' }]);

  call = lastCall(await runCli(['audiences', 'list', '--limit', '3']));
  assert.deepEqual([call.method, call.args], ['list', [{ limit: 3 }]]);

  call = lastCall(await runCli(['audiences', 'get', 'aud_1']));
  assert.deepEqual([call.method, call.args], ['get', ['aud_1']]);

  call = lastCall(await runCli(['audiences', 'update', 'aud_1', '--name', 'Newsletter']));
  assert.deepEqual([call.method, call.args], ['update', ['aud_1', { name: 'Newsletter' }]]);

  call = lastCall(await runCli(['audiences', 'delete', 'aud_1']));
  assert.deepEqual([call.method, call.args], ['remove', ['aud_1']]);

  call = lastCall(
    await runCli([
      'audiences', 'import-sheet', 'aud_1',
      '--url', 'https://docs.google.com/spreadsheets/d/abc/edit',
      '--segment-name', 'July leads',
    ]),
  );
  assert.deepEqual([call.method, call.args], [
    'importSheet',
    ['aud_1', { url: 'https://docs.google.com/spreadsheets/d/abc/edit', segment_name: 'July leads' }],
  ]);
});

// ---- segments / topics ----

test('segments create / list are domain-scoped', async () => {
  let call = lastCall(await runCli(['segments', 'create', '--domain', 'yourdomain.com', '--name', 'VIP']));
  assert.deepEqual([call.resource, call.method], ['segments', 'create']);
  assert.deepEqual(call.args[0], { domain: 'yourdomain.com', name: 'VIP' });

  call = lastCall(await runCli(['segments', 'list', '--domain', 'yourdomain.com']));
  assert.deepEqual([call.method, call.args], ['list', [{ domain: 'yourdomain.com' }]]);
});

test('topics create maps default_subscription', async () => {
  const call = lastCall(
    await runCli([
      'topics', 'create', '--domain', 'yourdomain.com', '--name', 'Product updates',
      '--default-subscription', 'opt_out', '--description', 'News',
    ]),
  );
  assert.deepEqual(call.args[0], {
    domain: 'yourdomain.com',
    name: 'Product updates',
    default_subscription: 'opt_out',
    description: 'News',
  });
});

// ---- campaigns ----

test('campaigns create and send map flags', async () => {
  let call = lastCall(
    await runCli([
      'campaigns', 'create', '--domain', 'yourdomain.com',
      '--from', 'Acme <hi@yourdomain.com>', '--subject', 'Sale', '--html', '<p>50% off</p>',
      '--segment-id', 'seg_1',
    ]),
  );
  assert.deepEqual([call.resource, call.method], ['campaigns', 'create']);
  assert.deepEqual(call.args[0], {
    domain: 'yourdomain.com',
    from: 'Acme <hi@yourdomain.com>',
    subject: 'Sale',
    html: '<p>50% off</p>',
    segment_id: 'seg_1',
  });

  call = lastCall(await runCli(['campaigns', 'send', 'camp_1', '--scheduled-at', '2026-08-01T00:00:00Z']));
  assert.deepEqual([call.method, call.args], ['send', ['camp_1', { scheduled_at: '2026-08-01T00:00:00Z' }]]);

  call = lastCall(await runCli(['campaigns', 'send', 'camp_1']));
  assert.deepEqual([call.method, call.args], ['send', ['camp_1', undefined]]);
});

test('campaigns ab maps to campaigns.ab', async () => {
  const call = lastCall(await runCli(['campaigns', 'ab', 'camp_1']));
  assert.deepEqual([call.resource, call.method, call.args], ['campaigns', 'ab', ['camp_1']]);
});

// ---- templates / automations ----

test('templates create and publish', async () => {
  let call = lastCall(await runCli(['templates', 'create', '--name', 'Welcome', '--subject', 'Hi', '--html', '<p>Hi</p>']));
  assert.deepEqual([call.resource, call.method], ['templates', 'create']);
  assert.deepEqual(call.args[0], { name: 'Welcome', subject: 'Hi', html: '<p>Hi</p>' });

  call = lastCall(await runCli(['templates', 'publish', 'tmpl_1']));
  assert.deepEqual([call.method, call.args], ['publish', ['tmpl_1']]);
});

test('templates create / update carry the declared-variable registry', async () => {
  // `variables` is a supported create/update field (it holds each variable's
  // type and fallback, which the send path prefers when a caller omits it), and
  // the CLI had no way to set it at all.
  let call = lastCall(await runCli([
    'templates', 'create', '--name', 'Welcome', '--html', '<p>Hi {{first_name}}</p>',
    '--variables', '[{"key":"first_name","type":"string","fallback_value":"there"}]',
  ]));
  assert.deepEqual(call.args[0], {
    name: 'Welcome',
    html: '<p>Hi {{first_name}}</p>',
    variables: [{ key: 'first_name', type: 'string', fallback_value: 'there' }],
  });

  // An empty array is meaningful: it clears the registry.
  call = lastCall(await runCli(['templates', 'update', 'tmpl_1', '--variables', '[]']));
  assert.deepEqual([call.method, call.args], ['update', ['tmpl_1', { variables: [] }]]);

  const bad = await runCli(['templates', 'create', '--name', 'Welcome', '--variables', '{oops']);
  assert.equal(bad.exitCode, 1);
  assert.match(bad.err, /Invalid JSON for --variables/);
  assert.equal(bad.calls.length, 0);
});

test('automations create / add-step / runs / stop', async () => {
  let call = lastCall(
    await runCli(['automations', 'create', '--name', 'Welcome series', '--domain', 'yourdomain.com', '--trigger', 'contact.created']),
  );
  assert.deepEqual(call.args[0], { name: 'Welcome series', domain: 'yourdomain.com', trigger: 'contact.created' });

  call = lastCall(
    await runCli(['automations', 'add-step', 'auto_1', '--type', 'send_email', '--config', '{"template_id":"tmpl_1"}']),
  );
  assert.deepEqual([call.method, call.args], ['addStep', ['auto_1', { type: 'send_email', config: { template_id: 'tmpl_1' } }]]);

  call = lastCall(await runCli(['automations', 'runs', 'auto_1', '--limit', '25']));
  assert.deepEqual([call.method, call.args], ['runs', ['auto_1', { limit: 25 }]]);

  call = lastCall(await runCli(['automations', 'stop', 'auto_1']));
  assert.deepEqual([call.method, call.args], ['stop', ['auto_1']]);
});

test('automations delete-step maps to deleteStep', async () => {
  const call = lastCall(await runCli(['automations', 'delete-step', 'auto_1', 'step_2']));
  assert.deepEqual([call.resource, call.method, call.args], ['automations', 'deleteStep', ['auto_1', 'step_2']]);
});

// ---- webhooks / api-keys / logs / polls / events ----

test('webhooks create splits comma-separated events', async () => {
  const call = lastCall(
    await runCli(['webhooks', 'create', '--endpoint', 'https://app.com/hook', '--events', 'email.delivered,email.bounced']),
  );
  assert.deepEqual(call.args[0], {
    endpoint: 'https://app.com/hook',
    events: ['email.delivered', 'email.bounced'],
  });
});

test('api-keys list', async () => {
  const call = lastCall(await runCli(['api-keys', 'list']));
  assert.deepEqual([call.resource, call.method, call.args], ['apiKeys', 'list', [{}]]);
});

test('logs list maps method and numeric status filters', async () => {
  const call = lastCall(await runCli(['logs', 'list', '--method', 'POST', '--status', '429', '--limit', '100']));
  assert.deepEqual([call.resource, call.method], ['logs', 'list']);
  assert.deepEqual(call.args[0], { limit: 100, method: 'POST', status: 429 });
});

test('polls list and get', async () => {
  let call = lastCall(await runCli(['polls', 'list']));
  assert.deepEqual([call.resource, call.method, call.args], ['polls', 'list', [{}]]);

  call = lastCall(await runCli(['polls', 'get', 'em_1']));
  assert.deepEqual([call.method, call.args], ['get', ['em_1']]);
});

test('events send maps name/domain/email/data (domain required)', async () => {
  const call = lastCall(
    await runCli([
      'events', 'send', '--domain', 'yourdomain.com', '--name', 'signup.completed',
      '--email', 'a@b.com', '--data', '{"plan":"pro"}',
    ]),
  );
  assert.deepEqual([call.resource, call.method], ['events', 'send']);
  assert.deepEqual(call.args[0], {
    name: 'signup.completed',
    domain: 'yourdomain.com',
    email: 'a@b.com',
    data: { plan: 'pro' },
  });

  const missing = await runCli(['events', 'send', '--name', 'signup.completed']);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.err, /--domain/);
});

// ---- auth, output modes, error handling ----

test('API key comes from env or --api-key; base URL override is passed through', async () => {
  let r = await runCli(['emails', 'get', 'em_1']);
  assert.equal(r.created[0].apiKey, 'mb_test_key');
  assert.deepEqual(r.created[0].options, {});

  r = await runCli(['emails', 'get', 'em_1', '--api-key', 'mb_flag', '--base-url', 'http://localhost:3000/api'], { env: {} });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.created[0], { apiKey: 'mb_flag', options: { baseUrl: 'http://localhost:3000/api' } });
});

test('missing API key fails with exit 1 and a clear message', async () => {
  const r = await runCli(['emails', 'get', 'em_1'], { env: {} });
  assert.equal(r.exitCode, 1);
  assert.equal(r.calls.length, 0);
  assert.match(r.err, /SENDPING_API_KEY/);
});

test('API error goes to stderr as {statusCode,name,message} with exit 1', async () => {
  const error = { statusCode: 422, name: 'validation_error', message: 'domain is required' };
  const r = await runCli(['emails', 'get', 'em_1'], { response: { data: null, error } });
  assert.equal(r.exitCode, 1);
  assert.equal(r.out, '');
  assert.deepEqual(JSON.parse(r.err), error);
});

test('output is pretty by default and raw with --json', async () => {
  const data = { id: 'em_1', object: 'email' };
  let r = await runCli(['emails', 'get', 'em_1'], { response: { data, error: null } });
  assert.equal(r.out, `${JSON.stringify(data, null, 2)}\n`);

  r = await runCli(['emails', 'get', 'em_1', '--json'], { response: { data, error: null } });
  assert.equal(r.out, `${JSON.stringify(data)}\n`);
});

test('--json applies to the error stream too', async () => {
  const error = { statusCode: 422, name: 'validation_error', message: 'domain is required' };
  let r = await runCli(['emails', 'get', 'em_1', '--json'], { response: { data: null, error } });
  assert.equal(r.exitCode, 1);
  assert.equal(r.err, `${JSON.stringify(error)}\n`);

  // A local usage error is the same envelope, honouring the same flag.
  r = await runCli(['emails', 'get', 'em_1', '--json'], { env: {} });
  assert.equal(r.exitCode, 1);
  assert.equal(r.err, `${JSON.stringify({ statusCode: null, name: 'cli_error', message: 'Missing API key. Set the SENDPING_API_KEY environment variable or pass --api-key.' })}\n`);
});

test('invalid JSON flag fails cleanly without calling the SDK', async () => {
  const r = await runCli(['events', 'send', '--domain', 'd.com', '--name', 'x', '--data', '{nope']);
  assert.equal(r.exitCode, 1);
  assert.equal(r.calls.length, 0);
  assert.match(r.err, /Invalid JSON for --data/);
});

test('--help exits 0 at root and resource level', async () => {
  let r = await runCli(['--help']);
  assert.equal(r.exitCode, 0);
  assert.match(r.out, /emails/);
  assert.match(r.out, /campaigns/);

  r = await runCli(['emails', '--help']);
  assert.equal(r.exitCode, 0);
  assert.match(r.out, /send/);
  assert.match(r.out, /attachments/);
});

// The documented Idempotency-Key bound is 1-255 characters, measured AFTER the
// server trims the value. The CLI does not pre-check it — the server answers a
// bad key with 400 invalid_idempotency_key — so the help text is where the rule
// is discoverable, and both send and batch must state it identically.
test('--idempotency-key help states the documented 1-255 bound', async () => {
  for (const cmd of ['send', 'batch']) {
    const r = await runCli(['emails', cmd, '--help']);
    assert.equal(r.exitCode, 0);
    assert.match(r.out, /--idempotency-key <key>\s+idempotency key for safe retries \(1-255 characters\)/);
  }
});

test('unknown command exits non-zero', async () => {
  const r = await runCli(['bogus']);
  assert.equal(r.exitCode, 1);
});

// ---- 2.0.0: contract-parity additions ----

test('emails list maps the status and search filters', async () => {
  const call = lastCall(
    await runCli(['emails', 'list', '--status', 'delivered', '--search', 'invoice', '--limit', '50']),
  );
  assert.deepEqual([call.resource, call.method], ['emails', 'list']);
  assert.deepEqual(call.args[0], { limit: 50, status: 'delivered', search: 'invoice' });
});

test('emails list maps the mailbox folder filter', async () => {
  const call = lastCall(await runCli(['emails', 'list', '--folder', 'outbox']));
  assert.deepEqual(call.args[0], { folder: 'outbox' });
});

test('--after and --before are mutually exclusive (the API answers 422)', async () => {
  const r = await runCli(['emails', 'list', '--after', 'em_1', '--before', 'em_9']);
  assert.equal(r.exitCode, 1);
  assert.equal(r.calls.length, 0);
  assert.match(r.err, /--after or --before, not both/);
});

test('emails send attaches local files as base64 and hosted files by path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-cli-'));
  const file = path.join(dir, 'invoice.pdf');
  fs.writeFileSync(file, 'pdf-bytes');

  const call = lastCall(
    await runCli([
      'emails', 'send', '--from', 'hi@yourdomain.com', '--to', 'a@b.com', '--subject', 'hi', '--text', 'x',
      '--attachment', file,
      '--attachment-url', 'https://cdn.example.com/files/terms.pdf',
    ]),
  );
  assert.deepEqual(call.args[0].attachments, [
    { filename: 'invoice.pdf', content: Buffer.from('pdf-bytes').toString('base64') },
    { filename: 'terms.pdf', path: 'https://cdn.example.com/files/terms.pdf' },
  ]);

  let bad = await runCli([
    'emails', 'send', '--from', 'hi@yourdomain.com', '--to', 'a@b.com', '--subject', 'hi', '--text', 'x',
    '--attachment', '/nope/missing.pdf',
  ]);
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.calls.length, 0);
  assert.match(bad.err, /Cannot read --attachment/);

  bad = await runCli([
    'emails', 'send', '--from', 'hi@yourdomain.com', '--to', 'a@b.com', '--subject', 'hi', '--text', 'x',
    '--attachment-url', 'not-a-url',
  ]);
  assert.equal(bad.exitCode, 1);
  assert.match(bad.err, /Invalid URL for --attachment-url/);
});

test('emails send resolves a template by alias, and refuses both selectors', async () => {
  const call = lastCall(
    await runCli([
      'emails', 'send', '--from', 'hi@yourdomain.com', '--to', 'a@b.com', '--subject', 'hi',
      '--template-alias', 'welcome', '--variables', '{"first_name":"Ada"}',
    ]),
  );
  assert.deepEqual(call.args[0].template, { alias: 'welcome', variables: { first_name: 'Ada' } });

  const bad = await runCli([
    'emails', 'send', '--from', 'hi@yourdomain.com', '--to', 'a@b.com', '--subject', 'hi',
    '--template-id', 'tmpl_1', '--template-alias', 'welcome',
  ]);
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.calls.length, 0);
  assert.match(bad.err, /--template-id or --template-alias/);
});

// A template send must be able to use the template's OWN from/subject, so those
// flags cannot be required at the parser: resolveTemplate falls back per field
// on `!= null`, which means the keys have to be ABSENT from the payload — a key
// present as '' wins over the template. Declaring them `.requiredOption` made
// this documented one-liner exit 1 before the handler ever ran, so the only way
// through was to retype the template's values, which then override those two
// fields on every send: republishing the template no longer changed the from and
// subject the CLI sent (the body still re-renders from the template).
test('emails send with a template omits from/subject rather than sending blanks', async () => {
  const call = lastCall(await runCli(['emails', 'send', '--template-id', 'tmpl_1', '--to', 'a@b.com']));
  assert.deepEqual([call.resource, call.method], ['emails', 'send']);
  assert.equal('from' in call.args[0], false);
  assert.equal('subject' in call.args[0], false);
  assert.deepEqual(call.args[0], { to: ['a@b.com'], template_id: 'tmpl_1' });

  const aliased = lastCall(
    await runCli(['emails', 'send', '--template-alias', 'welcome', '--to', 'a@b.com']),
  );
  assert.equal('from' in aliased.args[0], false);
  assert.equal('subject' in aliased.args[0], false);
  assert.deepEqual(aliased.args[0].template, { alias: 'welcome' });
});

// Nothing supplies them without a template, so the CLI still refuses locally
// instead of spending a round trip on a guaranteed 422. An EMPTY value is a
// deliberate choice, not a missing one, and keeps reaching the wire verbatim:
// `--subject ''` is the documented way to ship a blank subject line, and
// `--from ''` must keep earning its own 422 rather than being rewritten here.
test('emails send still requires from/subject with no template, but passes empties through', async () => {
  const bad = await runCli(['emails', 'send', '--to', 'a@b.com', '--text', 'hi']);
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.calls.length, 0);
  assert.match(bad.err, /--from and --subject are required unless you pass --template-id or --template-alias/);

  const call = lastCall(
    await runCli(['emails', 'send', '--from', 'hi@yourdomain.com', '--to', 'a@b.com', '--subject', '', '--text', 'hi']),
  );
  assert.equal(call.args[0].subject, '');
});

// `canceled` is TERMINAL — it cannot be resumed or re-sent — and it is where an
// already-`queued` campaign lands, not `draft`. The old help asserted the draft
// outcome unconditionally, which is the reading an operator stops a live send
// on; they only learn otherwise when `campaigns update` answers 422.
test('campaigns cancel help names the terminal outcome, not just draft', async () => {
  const r = await runCli(['campaigns', '--help']);
  assert.equal(r.exitCode, 0);
  // Commander wraps the description column to the terminal width, so collapse
  // whitespace rather than pinning the assertion to one machine's line breaks.
  assert.match(
    r.out.replace(/\s+/g, ' '),
    /cancel \[options\] <id> Stop a campaign \(back to draft, or terminal canceled if it is already queued\)/,
  );
});

test('domains mx-check maps to domains.mxCheck', async () => {
  const call = lastCall(await runCli(['domains', 'mx-check', 'yourdomain.com']));
  assert.deepEqual([call.resource, call.method, call.args], ['domains', 'mxCheck', ['yourdomain.com']]);
});

test('domains add / update map the receiving capability and return-path flags', async () => {
  let call = lastCall(await runCli(['domains', 'add', 'yourdomain.com', '--receiving']));
  assert.deepEqual(call.args[0], { name: 'yourdomain.com', capabilities: { receiving: 'enabled' } });

  call = lastCall(await runCli(['domains', 'add', 'yourdomain.com', '--no-receiving']));
  assert.deepEqual(call.args[0], { name: 'yourdomain.com', capabilities: { receiving: 'disabled' } });

  call = lastCall(
    await runCli(['domains', 'update', 'dom_1', '--custom-return-path', 'mail', '--custom-tracking', '--no-receiving']),
  );
  assert.deepEqual(call.args, [
    'dom_1',
    { custom_tracking: true, custom_return_path: 'mail', capabilities: { receiving: 'disabled' } },
  ]);

  // Untouched booleans stay out of the patch entirely.
  call = lastCall(await runCli(['domains', 'update', 'dom_1', '--tls', 'enforced']));
  assert.deepEqual(call.args, ['dom_1', { tls: 'enforced' }]);
});

test('contacts update refuses contradictory consent flags', async () => {
  const r = await runCli(['contacts', 'update', 'a@b.com', '--unsubscribed', '--subscribed']);
  assert.equal(r.exitCode, 1);
  assert.match(r.err, /only one of --unsubscribed or --subscribed/);
  assert.equal(r.calls.length, 0);

  let call = lastCall(await runCli(['contacts', 'update', 'a@b.com', '--subscribed']));
  assert.deepEqual(call.args, [{ id: 'a@b.com', unsubscribed: false }]);

  call = lastCall(await runCli(['contacts', 'update', 'a@b.com', '--unsubscribed']));
  assert.deepEqual(call.args, [{ id: 'a@b.com', unsubscribed: true }]);
});

test('contacts create / list accept --audience-id as an alternative to --domain', async () => {
  let call = lastCall(await runCli(['contacts', 'create', '--audience-id', 'aud_1', '--email', 'a@b.com']));
  assert.deepEqual(call.args[0], { audienceId: 'aud_1', email: 'a@b.com' });

  call = lastCall(await runCli(['contacts', 'list', '--audience-id', 'aud_1', '--limit', '5']));
  assert.deepEqual(call.args[0], { audienceId: 'aud_1', limit: 5 });

  let bad = await runCli(['contacts', 'list', '--domain', 'd.com', '--audience-id', 'aud_1']);
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.calls.length, 0);
  assert.match(bad.err, /only one of --domain or --audience-id/);

  bad = await runCli(['contacts', 'list']);
  assert.equal(bad.exitCode, 1);
  assert.match(bad.err, /--domain/);
});

test('contact-properties update clears the fallback with --clear-fallback', async () => {
  const call = lastCall(await runCli(['contact-properties', 'update', 'prop_1', '--clear-fallback']));
  assert.deepEqual(call.args, ['prop_1', { fallback_value: null }]);

  let bad = await runCli(['contact-properties', 'update', 'prop_1']);
  assert.equal(bad.exitCode, 1);
  assert.match(bad.err, /--fallback-value .* or --clear-fallback/);

  bad = await runCli(['contact-properties', 'update', 'prop_1', '--fallback-value', 'x', '--clear-fallback']);
  assert.equal(bad.exitCode, 1);
  assert.match(bad.err, /only one of --fallback-value or --clear-fallback/);
});

test('campaigns create maps recurrence, A/B, follow-ups and send-on-create', async () => {
  const call = lastCall(
    await runCli([
      'campaigns', 'create', '--domain', 'yourdomain.com',
      '--from', 'Acme <hi@yourdomain.com>', '--subject', 'Sale', '--html', '<p>x</p>',
      '--unsubscribe-policy', 'domain', '--list-to',
      '--recurrence', 'weekly', '--recurrence-every', '2',
      '--ab-test', '{"enabled":true,"subject_b":"Sale B"}',
      '--followups', '[{"condition":"not_opened","delay":"2 days","html":"<p>ping</p>"}]',
      '--send', '--scheduled-at', 'in 1 min',
    ]),
  );
  assert.deepEqual(call.args[0], {
    domain: 'yourdomain.com',
    from: 'Acme <hi@yourdomain.com>',
    subject: 'Sale',
    html: '<p>x</p>',
    send: true,
    scheduled_at: 'in 1 min',
    unsubscribe_policy: 'domain',
    list_to: true,
    recurrence: 'weekly',
    recurrence_every: 2,
    ab_test: { enabled: true, subject_b: 'Sale B' },
    followups: [{ condition: 'not_opened', delay: '2 days', html: '<p>ping</p>' }],
  });
});

test('campaigns update can re-target the domain and replace follow-ups', async () => {
  const call = lastCall(
    await runCli([
      'campaigns', 'update', 'camp_1', '--domain', 'other.com', '--reply-to', 'r@other.com', '--followups', '[]',
    ]),
  );
  assert.deepEqual(call.args, [
    'camp_1',
    { domain: 'other.com', reply_to: ['r@other.com'], followups: [] },
  ]);
});

test('automations update-step maps to updateStep and requires --type', async () => {
  const call = lastCall(
    await runCli([
      'automations', 'update-step', 'auto_1', 'step_2',
      '--type', 'wait_for_event',
      '--config', '{"event":"email.opened","timeout":"12 hours"}',
    ]),
  );
  assert.deepEqual([call.resource, call.method], ['automations', 'updateStep']);
  assert.deepEqual(call.args, [
    'auto_1', 'step_2',
    { type: 'wait_for_event', config: { event: 'email.opened', timeout: '12 hours' } },
  ]);

  // PATCH re-validates the whole step, so a body without `type` is a guaranteed
  // 422 (`type must be one of: …`). Fail locally instead of round-tripping.
  const noType = await runCli(['automations', 'update-step', 'auto_1', 'step_2', '--config', '{"event":"email.opened"}']);
  assert.equal(noType.exitCode, 1);
  assert.match(noType.err, /--type/);
  assert.equal(noType.calls.length, 0);

  // A step's graph key is immutable server-side; the flag only ever misled.
  const withKey = await runCli([
    'automations', 'update-step', 'auto_1', 'step_2', '--type', 'delay',
    '--config', '{"duration":"1 day"}', '--key', 'renamed',
  ]);
  assert.equal(withKey.exitCode, 1);
  assert.match(withKey.err, /unknown option/);
  assert.equal(withKey.calls.length, 0);
});

test('events update patches or clears the schema (the name is immutable)', async () => {
  let call = lastCall(await runCli(['events', 'update', 'evt_1', '--schema', '{"plan":"string"}']));
  assert.deepEqual([call.resource, call.method], ['events', 'update']);
  assert.deepEqual(call.args, ['evt_1', { schema: { plan: 'string' } }]);

  call = lastCall(await runCli(['events', 'update', 'evt_1', '--clear-schema']));
  assert.deepEqual(call.args, ['evt_1', { schema: null }]);

  const bad = await runCli(['events', 'update', 'evt_1']);
  assert.equal(bad.exitCode, 1);
  assert.match(bad.err, /--schema .* or --clear-schema/);
});

// ---- 2.0.0: SDK-parity commands (capabilities the SDK exposed but the CLI did not) ----

test('emails sources maps to emails.sources (no params, not paginated)', async () => {
  const call = lastCall(await runCli(['emails', 'sources']));
  assert.deepEqual([call.resource, call.method, call.args], ['emails', 'sources', []]);
});

test('emails receiving addresses maps to the receiving sub-resource', async () => {
  const call = lastCall(await runCli(['emails', 'receiving', 'addresses']));
  assert.deepEqual([call.resource, call.method, call.args], ['emails.receiving', 'listAddresses', []]);
});

test('emails receiving attachments forwards pagination flags', async () => {
  let call = lastCall(await runCli(['emails', 'receiving', 'attachments', 'rem_1', '--limit', '5']));
  assert.deepEqual([call.resource, call.method, call.args], [
    'emails.receiving', 'listAttachments', ['rem_1', { limit: 5 }],
  ]);

  call = lastCall(await runCli(['emails', 'receiving', 'attachments', 'rem_1']));
  assert.deepEqual(call.args, ['rem_1', {}]);
});

test('campaigns engagement maps to campaigns.engagement', async () => {
  const call = lastCall(await runCli(['campaigns', 'engagement', 'camp_1']));
  assert.deepEqual([call.resource, call.method, call.args], ['campaigns', 'engagement', ['camp_1']]);
});

test('api-keys list forwards pagination flags', async () => {
  const call = lastCall(await runCli(['api-keys', 'list', '--limit', '5', '--after', 'key_9']));
  assert.deepEqual([call.resource, call.method, call.args], [
    'apiKeys', 'list', [{ limit: 5, after: 'key_9' }],
  ]);
});

test('api-keys exposes list only — create/update/delete are dashboard-only', async () => {
  // Key lifecycle needs a signed-in dashboard session, so the CLI ships no
  // subcommand for it: a leaked key cannot mint a replacement or widen its own
  // scope from a terminal. Unknown subcommands must fail without calling the SDK.
  for (const argv of [
    ['api-keys', 'create', '--name', 'CI'],
    ['api-keys', 'update', 'key_1', '--name', 'CI'],
    ['api-keys', 'delete', 'key_1'],
  ]) {
    const r = await runCli(argv);
    assert.equal(r.exitCode, 1, `expected ${argv[1]} to be rejected`);
    assert.equal(r.calls.length, 0);
  }

  const help = await runCli(['api-keys', '--help']);
  assert.match(help.out, /list/);
  assert.doesNotMatch(help.out, /^\s*(create|update|delete)\b/m);
});

test('domains records-csv writes the CSV, defaulting to <id>-dns-records.csv', async () => {
  const csv = 'Type,Host,Full name,Value,Priority,TTL,Purpose,Status\r\nTXT,@,x,y,,3600,SPF,verified\r\n';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-cli-'));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const r = await runCli(['domains', 'records-csv', 'dom_1'], { response: { data: csv, error: null } });
    const call = lastCall(r);
    assert.deepEqual([call.resource, call.method, call.args], ['domains', 'recordsCsv', ['dom_1']]);
    assert.equal(fs.readFileSync(path.join(dir, 'dom_1-dns-records.csv'), 'utf8'), csv);
    assert.equal(JSON.parse(r.out).bytes, Buffer.byteLength(csv));
  } finally {
    process.chdir(prev);
  }

  const out = path.join(dir, 'records.csv');
  const r = await runCli(['domains', 'records-csv', 'dom_1', '--output', out], {
    response: { data: csv, error: null },
  });
  lastCall(r);
  assert.equal(fs.readFileSync(out, 'utf8'), csv);

  // An API error surfaces without writing anything.
  const error = { statusCode: 404, name: 'not_found', message: 'Domain not found.' };
  const failed = await runCli(['domains', 'records-csv', 'dom_1', '--output', '/nope/never-written.csv'], {
    response: { data: null, error },
  });
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.out, '');
  assert.deepEqual(JSON.parse(failed.err), error);
});

test('automations runs filters by --status (repeatable or comma-separated)', async () => {
  let call = lastCall(await runCli(['automations', 'runs', 'auto_1', '--status', 'failed']));
  assert.deepEqual([call.resource, call.method, call.args], [
    'automations', 'runs', ['auto_1', { status: ['failed'] }],
  ]);

  call = lastCall(
    await runCli(['automations', 'runs', 'auto_1', '--status', 'running,failed', '--status', 'skipped', '--limit', '5']),
  );
  assert.deepEqual(call.args, ['auto_1', { limit: 5, status: ['running', 'failed', 'skipped'] }]);

  // No filter → the params object carries pagination only.
  call = lastCall(await runCli(['automations', 'runs', 'auto_1']));
  assert.deepEqual(call.args, ['auto_1', {}]);
});

test('automations ai maps the prompt, allow-lists and the attach slot', async () => {
  let call = lastCall(await runCli(['automations', 'ai', 'auto_1', '--prompt', 'welcome new signups']));
  assert.deepEqual([call.resource, call.method, call.args], [
    'automations', 'createWithAi', ['auto_1', { prompt: 'welcome new signups' }],
  ]);

  call = lastCall(
    await runCli([
      'automations', 'ai', 'auto_1', '--prompt', 'nudge them',
      '--template-id', 'tmpl_1,tmpl_2', '--event', 'signup.completed',
      '--attach-from', 'step_3', '--attach-type', 'condition_met', '--attach-before', 'step_9',
    ]),
  );
  assert.deepEqual(call.args, ['auto_1', {
    prompt: 'nudge them',
    template_ids: ['tmpl_1', 'tmpl_2'],
    events: ['signup.completed'],
    attach: { from: 'step_3', type: 'condition_met', before: 'step_9' },
  }]);

  const bad = await runCli(['automations', 'ai', 'auto_1']);
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.calls.length, 0);
  assert.match(bad.err, /--prompt/);
});

test('contacts import-upload sends the CSV name and size, not its contents', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbcli-'));
  const csvFile = path.join(dir, 'big-list.csv');
  fs.writeFileSync(csvFile, 'email\na@x.com\n');

  const call = lastCall(await runCli(['contacts', 'import-upload', 'aud_1', '--csv', csvFile]));
  assert.deepEqual([call.resource, call.method], ['contacts', 'createImportUpload']);
  assert.deepEqual(call.args[0], {
    audienceId: 'aud_1',
    filename: 'big-list.csv',
    size: fs.statSync(csvFile).size,
  });

  const bad = await runCli(['contacts', 'import-upload', 'aud_1', '--csv', '/nope/missing.csv']);
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.calls.length, 0);
  assert.match(bad.err, /Cannot read --csv/);
});

test('contacts import accepts --storage-key / --segment-id / --file-name and needs exactly one source', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbcli-'));
  const csvFile = path.join(dir, 'contacts.csv');
  fs.writeFileSync(csvFile, 'email\nz@x.com\n');

  let call = lastCall(
    await runCli(['contacts', 'import', 'aud_1', '--storage-key', 'imports/abc.csv', '--segment-id', 'seg_1']),
  );
  assert.deepEqual([call.resource, call.method], ['contacts', 'import']);
  assert.deepEqual(call.args[0], { audienceId: 'aud_1', storage_key: 'imports/abc.csv', segment_id: 'seg_1' });

  call = lastCall(await runCli(['contacts', 'import', 'aud_1', '--csv', csvFile, '--file-name', 'july.csv']));
  assert.deepEqual(call.args[0], { audienceId: 'aud_1', csv: 'email\nz@x.com\n', file_name: 'july.csv' });

  let bad = await runCli(['contacts', 'import', 'aud_1']);
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.calls.length, 0);
  assert.match(bad.err, /--csv <path>/);

  bad = await runCli(['contacts', 'import', 'aud_1', '--csv', csvFile, '--storage-key', 'imports/abc.csv']);
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.calls.length, 0);
  assert.match(bad.err, /only one of --csv or --storage-key/);
});

test('contacts segments / topics and segments contacts forward pagination flags', async () => {
  let call = lastCall(await runCli(['contacts', 'segments', 'con_1', '--limit', '5']));
  assert.deepEqual([call.resource, call.method, call.args], ['contacts', 'listSegments', ['con_1', { limit: 5 }]]);

  call = lastCall(await runCli(['contacts', 'topics', 'con_1', '--after', 'top_9']));
  assert.deepEqual([call.method, call.args], ['getTopics', ['con_1', { after: 'top_9' }]]);

  call = lastCall(await runCli(['segments', 'contacts', 'seg_1', '--limit', '10']));
  assert.deepEqual([call.resource, call.method, call.args], ['segments', 'contacts', ['seg_1', { limit: 10 }]]);
});

test('webhooks test prints the body but exits 1 when the delivery failed', async () => {
  const failed = { object: 'webhook_test', id: 'wh_1', ok: false, error: 'lookup_failed' };
  let r = await runCli(['webhooks', 'test', 'wh_1'], { response: { data: failed, error: null } });
  assert.equal(r.exitCode, 1);
  assert.equal(r.err, '');
  assert.deepEqual(JSON.parse(r.out), failed);

  const ok = { object: 'webhook_test', id: 'wh_1', ok: true, status: 200 };
  r = await runCli(['webhooks', 'test', 'wh_1'], { response: { data: ok, error: null } });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(JSON.parse(r.out), ok);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { createContext, run } = require('../src/cli');

test('CLI uses the installed local SDK for keys, tracking health and recovery errors', async () => {
  const calls = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    calls.push({ path: req.url, key: req.headers['idempotency-key'], body: raw ? JSON.parse(raw) : null });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('tracking-health')) return res.end('{"custom_host":null,"status":"shared","checked_at":"2026-09-10T00:00:00Z"}');
    if (req.url === '/emails/batch') {
      res.writeHead(503, { 'Retry-After': '0' });
      return res.end('{"name":"batch_incomplete","sent":[],"reserved":[{"id":"em_uncertain"}],"unsent_count":2}');
    }
    res.end('{"id":"em_one"}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let out = '', err = '';
  const context = () => createContext({
    env: { SENDPING_API_KEY: 'mb_test', SENDPING_BASE_URL: `http://127.0.0.1:${server.address().port}` },
    stdout: s => { out += s; }, stderr: s => { err += s; },
  });
  try {
    assert.equal(await run(context(), ['emails','receiving','reply','rcv_one','--from','a@b.test','--text','a  b\n\n c','--idempotency-key','reply-1']), 0, err);
    assert.equal(await run(context(), ['emails','receiving','forward','rcv_one','--from','a@b.test','--to','c@d.test','--idempotency-key','forward-1']), 0, err);
    assert.deepEqual(calls.slice(0,2).map(c=>c.key), ['reply-1','forward-1']);
    assert.equal(calls[0].body.text, 'a  b\n\n c');
    out = '';
    assert.equal(await run(context(), ['domains','tracking-health','domain one']), 0, err);
    assert.equal(JSON.parse(out).status, 'shared');
    assert.equal(calls[2].path, '/domains/domain%20one/tracking-health');
    out = ''; err = '';
    assert.equal(await run(context(), ['emails','batch','--data','[]','--idempotency-key','batch-1','--json']), 1);
    const error = JSON.parse(err);
    assert.equal(error.statusCode, 503);
    assert.deepEqual(error.reserved, [{id:'em_uncertain'}]);
    assert.equal(error.unsent_count, 2);
    assert.equal(calls.length, 4); // No duplicate request for the reserved batch.
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

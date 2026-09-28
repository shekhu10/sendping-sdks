'use strict';

const fs = require('node:fs');
const { CliError, collect, clean, toInt, withPagination, pagination } = require('../helpers');

function register({ group, leaf, act }) {
  const webhooks = group('webhooks', 'Manage webhooks');

  act(
    leaf(webhooks, 'create', 'Create a webhook (the signing secret is shown once)')
      .requiredOption('--endpoint <url>', 'the HTTPS endpoint to deliver events to')
      .requiredOption(
        '--events <event>',
        "events to subscribe to (repeatable or comma-separated), e.g. 'email.delivered,email.bounced'",
        collect,
      )
      .option('--secret <secret>', 'caller-supplied signing secret (otherwise generated)'),
    ({ client, opts }) =>
      client.webhooks.create(clean({ endpoint: opts.endpoint, events: opts.events, secret: opts.secret })),
  );

  act(leaf(webhooks, 'get <id>', 'Retrieve a webhook'), ({ client, args: [id] }) =>
    client.webhooks.get(id),
  );

  act(withPagination(leaf(webhooks, 'list', 'List webhooks')), ({ client, opts }) =>
    client.webhooks.list(pagination(opts)),
  );

  act(
    leaf(webhooks, 'update <id>', 'Update a webhook')
      .option('--endpoint <url>', 'new endpoint URL')
      .option('--events <event>', 'new event list (repeatable or comma-separated)', collect)
      .option('--status <status>', "'enabled' | 'disabled'"),
    ({ client, opts, args: [id] }) =>
      client.webhooks.update(
        id,
        clean({ endpoint: opts.endpoint, events: opts.events, status: opts.status }),
      ),
  );

  act(
    leaf(webhooks, 'rotate <id>', 'Rotate the signing secret (new secret shown once)'),
    ({ client, args: [id] }) => client.webhooks.rotate(id),
  );

  // The API answers 200 even when the delivery failed — the outcome lives in
  // `ok`. Print the body either way, but exit 1 on a failed delivery so the
  // command is usable in a shell `&&` chain.
  act(
    leaf(webhooks, 'test <id>', 'Send a synchronous test delivery (exits 1 when ok is false)'),
    async ({ client, args: [id] }) => {
      const result = await client.webhooks.test(id);
      if (result.error) return result;
      return { data: result.data, failed: !!result.data && result.data.ok === false };
    },
  );

  act(leaf(webhooks, 'delete <id>', 'Delete a webhook'), ({ client, args: [id] }) =>
    client.webhooks.remove(id),
  );

  // Verify a delivery's signature LOCALLY — pure computation, no HTTP request (SDK-4).
  //
  // Registered with `local: true`, so no SDK client (and therefore no API key)
  // is resolved: this command never reaches the network, and demanding
  // SENDPING_API_KEY for it pushed people into putting a send-capable key on
  // the very webhook receiver whose job is to distrust its input.
  act(
    leaf(webhooks, 'verify', 'Verify a webhook delivery signature locally (no HTTP request, no API key)', { local: true })
      .requiredOption('--secret <secret>', 'the endpoint signing secret')
      .option('--payload <raw>', 'the raw request body string (exact bytes the server sent)')
      .option('--payload-file <path>', 'path to a file containing the raw request body')
      .requiredOption('--svix-id <id>', 'the svix-id header')
      .requiredOption('--svix-timestamp <ts>', 'the svix-timestamp header')
      .requiredOption('--svix-signature <sig>', 'the svix-signature header')
      .option('--tolerance <seconds>', 'max timestamp skew in seconds (default 300; 0 = skip the freshness check)'),
    ({ ctx, opts }) => {
      if (opts.payload && opts.payloadFile) throw new CliError('Provide only one of --payload or --payload-file.');
      let payload;
      if (opts.payloadFile) {
        try { payload = fs.readFileSync(opts.payloadFile, 'utf8'); }
        catch (err) { throw new CliError(`Cannot read --payload-file ${opts.payloadFile}: ${err.message}`); }
      } else if (opts.payload != null) {
        payload = opts.payload;
      } else {
        throw new CliError('Provide --payload <raw> or --payload-file <path>.');
      }
      const headers = {
        'svix-id': opts.svixId,
        'svix-timestamp': opts.svixTimestamp,
        'svix-signature': opts.svixSignature,
      };
      const options = {};
      if (opts.tolerance != null) {
        // Parsed, not coerced. `Number('5m')` is NaN, and the SDK's freshness
        // gate is `if (toleranceSec > 0)` — which NaN fails — so a typo'd
        // tolerance used to SKIP the replay-window check silently and report a
        // stale delivery as valid. A bad value is a usage error instead.
        const tolerance = toInt(opts.tolerance, '--tolerance');
        if (tolerance < 0) throw new CliError('--tolerance must be 0 or greater.');
        options.toleranceSec = tolerance;
      }
      // A pure, synchronous local computation returning { valid, reason }.
      // Wrapped in the {data,error} shape the CLI runner prints.
      return { data: ctx.verifyWebhook(payload, headers, opts.secret, options), error: null };
    },
  );
}

module.exports = { register };

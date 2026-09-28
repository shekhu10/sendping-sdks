'use strict';

const { clean, withPagination, pagination, saveFile } = require('../helpers');

function register({ group, leaf, act }) {
  const domains = group('domains', 'Manage sending domains');
  act(leaf(domains, 'tracking-health <id>', 'Check tracking HTTPS readiness and schedule repair when unavailable'),
    ({ client, args: [id] }) => client.domains.trackingHealth(id));

  act(
    leaf(domains, 'add <name>', 'Add a sending domain')
      .option('--region <region>', 'sending region')
      .option('--custom-return-path <label>', "MAIL FROM subdomain (default 'send')")
      .option('--tracking-subdomain <label>', "custom tracking host label, e.g. 'email'")
      .option('--tls <policy>', "outbound TLS policy: 'opportunistic' | 'enforced'")
      .option('--open-tracking', 'enable open tracking')
      .option('--no-open-tracking', 'disable open tracking')
      .option('--click-tracking', 'enable click tracking')
      .option('--no-click-tracking', 'disable click tracking')
      .option('--receiving', 'enable inbound email receiving')
      .option('--no-receiving', 'disable inbound email receiving'),
    ({ client, opts, args: [name] }) =>
      client.domains.create(
        clean({
          name,
          region: opts.region,
          custom_return_path: opts.customReturnPath,
          tracking_subdomain: opts.trackingSubdomain,
          tls: opts.tls,
          // Only send the booleans the user explicitly set.
          open_tracking: 'openTracking' in opts ? opts.openTracking : undefined,
          click_tracking: 'clickTracking' in opts ? opts.clickTracking : undefined,
          capabilities:
            'receiving' in opts
              ? { receiving: opts.receiving ? 'enabled' : 'disabled' }
              : undefined,
        }),
      ),
  );

  act(leaf(domains, 'get <id>', 'Retrieve a domain and its DNS records'), ({ client, args: [id] }) =>
    client.domains.get(id),
  );

  act(withPagination(leaf(domains, 'list', 'List your domains')), ({ client, opts }) =>
    client.domains.list(pagination(opts)),
  );

  act(leaf(domains, 'verify <id>', 'Trigger DNS verification for a domain'), ({ client, args: [id] }) =>
    client.domains.verify(id),
  );

  act(
    leaf(domains, 'update <id>', "Update a domain's tracking/TLS settings")
      .option('--open-tracking', 'enable open tracking')
      .option('--no-open-tracking', 'disable open tracking')
      .option('--click-tracking', 'enable click tracking')
      .option('--no-click-tracking', 'disable click tracking')
      .option('--tracking-subdomain <label>', 'custom tracking host label')
      .option('--custom-tracking', 'serve tracking links from the custom tracking host')
      .option('--no-custom-tracking', 'serve tracking links from the SendPing host')
      .option('--custom-return-path <label>', 'MAIL FROM subdomain (Return-Path) DNS label')
      .option('--receiving', 'enable inbound email receiving')
      .option('--no-receiving', 'disable inbound email receiving')
      .option('--tls <policy>', "outbound TLS policy: 'opportunistic' | 'enforced'"),
    ({ client, opts, args: [id] }) =>
      client.domains.update(
        id,
        clean({
          open_tracking: 'openTracking' in opts ? opts.openTracking : undefined,
          click_tracking: 'clickTracking' in opts ? opts.clickTracking : undefined,
          custom_tracking: 'customTracking' in opts ? opts.customTracking : undefined,
          tracking_subdomain: opts.trackingSubdomain,
          custom_return_path: opts.customReturnPath,
          capabilities:
            'receiving' in opts
              ? { receiving: opts.receiving ? 'enabled' : 'disabled' }
              : undefined,
          tls: opts.tls,
        }),
      ),
  );

  act(
    leaf(domains, 'mx-check <name>', 'Check whether a domain already has MX records pointed at us'),
    ({ client, args: [name] }) => client.domains.mxCheck(name),
  );

  act(
    leaf(
      domains,
      'records-csv <id>',
      "Download this domain's DNS records as CSV, ready to hand to a registrar",
    ).option('--output <path>', 'file to write (default: <id>-dns-records.csv)'),
    async ({ client, opts, args: [id] }) => {
      // The endpoint answers text/csv, not JSON — write it out and print where
      // it landed, the same way the binary download commands do.
      const result = await client.domains.recordsCsv(id);
      if (result.error) return result;
      return saveFile(opts.output || `${id}-dns-records.csv`, result.data);
    },
  );

  act(leaf(domains, 'delete <id>', 'Delete a domain'), ({ client, args: [id] }) =>
    client.domains.remove(id),
  );

  // ---- one-click DNS ----

  const dns = domains
    .command('dns')
    .description("Detect a domain's DNS provider and apply its records via provider APIs");

  act(
    leaf(dns, 'detect <id>', 'Detect the DNS provider and available one-click apply methods'),
    ({ client, args: [id] }) => client.domains.detectDns(id),
  );

  act(
    leaf(dns, 'cloudflare <id>', 'Apply DNS records via the Cloudflare API, then auto-verify').requiredOption(
      '--token <token>',
      'Cloudflare API token with DNS edit access',
    ),
    ({ client, opts, args: [id] }) => client.domains.applyCloudflareDns(id, { token: opts.token }),
  );

  act(
    leaf(dns, 'godaddy <id>', 'Apply DNS records via the GoDaddy API, then auto-verify')
      .requiredOption('--key <key>', 'GoDaddy API key')
      .requiredOption('--secret <secret>', 'GoDaddy API secret'),
    ({ client, opts, args: [id] }) =>
      client.domains.applyGoDaddyDns(id, { key: opts.key, secret: opts.secret }),
  );

  act(
    leaf(dns, 'namecheap <id>', 'Apply DNS records via the Namecheap API, then auto-verify')
      .requiredOption('--api-user <user>', 'Namecheap API user')
      .requiredOption('--key <key>', 'Namecheap API key')
      .option('--user-name <name>', 'Namecheap account user name (default: the API user)'),
    ({ client, opts, args: [id] }) =>
      client.domains.applyNamecheapDns(
        id,
        clean({ apiUser: opts.apiUser, apiKey: opts.key, userName: opts.userName }),
      ),
  );

  // ---- domain claims ----
  // `claim` is a subgroup (start/get/verify) so the takeover flow reads
  // unambiguously: `claim start <name>` begins a claim, then `claim get <id>`
  // and `claim verify <id>` operate on the domain id it returns.

  const claim = domains
    .command('claim')
    .description('Claim a domain already verified by another account (start, then verify)');

  act(
    leaf(claim, 'start <name>', 'Start a claim for a domain name').option(
      '--region <region>',
      'sending region',
    ),
    ({ client, opts, args: [name] }) => client.domains.claim(clean({ name, region: opts.region })),
  );

  act(
    leaf(claim, 'get <id>', "Retrieve a domain's claim record"),
    ({ client, args: [id] }) => client.domains.getClaim(id),
  );

  act(
    leaf(claim, 'verify <id>', 'Verify a domain claim (completes the takeover)'),
    ({ client, args: [id] }) => client.domains.verifyClaim(id),
  );
}

module.exports = { register };

'use strict';

const { Command } = require('commander');
const { CliError } = require('./helpers');

const VERSION = require('../package.json').version;

const RESOURCES = [
  require('./commands/emails'),
  require('./commands/domains'),
  require('./commands/contacts'),
  require('./commands/contact_properties'),
  require('./commands/audiences'),
  require('./commands/segments'),
  require('./commands/topics'),
  require('./commands/campaigns'),
  require('./commands/templates'),
  require('./commands/automations'),
  require('./commands/webhooks'),
  require('./commands/apikeys'),
  require('./commands/events'),
  require('./commands/logs'),
  require('./commands/polls'),
];

/**
 * Build the execution context. Everything side-effectful (client construction,
 * writing, environment) is injectable so tests can run the command layer with
 * a mocked SDK client.
 */
function createContext(overrides = {}) {
  return {
    createClient(apiKey, options) {
      const { SendPing } = require('sendping');
      return new SendPing(apiKey, options);
    },
    // Pure, offline signature check. The SDK exports it as a standalone
    // function precisely so it can be used WITHOUT a client — `webhooks verify`
    // makes no HTTP request, so it must not demand an API key it never sends.
    verifyWebhook(payload, headers, secret, options) {
      const { verifyWebhookSignature } = require('sendping');
      return verifyWebhookSignature(payload, headers, secret, options);
    },
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    env: process.env,
    exitCode: 0,
    ...overrides,
  };
}

/** Resolve auth/base-url flags (falling back to env) into an SDK client. */
function getClient(ctx, opts) {
  const apiKey = opts.apiKey || ctx.env.SENDPING_API_KEY;
  if (!apiKey) {
    throw new CliError('Missing API key. Set the SENDPING_API_KEY environment variable or pass --api-key.');
  }
  const baseUrl = opts.baseUrl || ctx.env.SENDPING_BASE_URL;
  return ctx.createClient(apiKey, baseUrl ? { baseUrl } : {});
}

/** Print a success payload: pretty JSON by default, raw compact with --json. */
function print(ctx, data, opts) {
  const s = opts.json ? JSON.stringify(data) : JSON.stringify(data, null, 2);
  ctx.stdout(`${s}\n`);
}

/**
 * Print an API/CLI error to stderr and mark the run failed. `--json` means
 * "raw compact JSON output" for BOTH streams — an error printed pretty while
 * the flag asked for compact made the flag a half-truth.
 */
function fail(ctx, error, opts = {}) {
  ctx.stderr(`${opts.json ? JSON.stringify(error) : JSON.stringify(error, null, 2)}\n`);
  ctx.exitCode = 1;
}

/**
 * Build the toolkit passed to each resource module: `group` creates a
 * top-level resource command, `leaf` a subcommand carrying the shared
 * auth/output flags, and `act` wires a handler that receives the SDK client
 * and returns its `{ data, error }` result.
 */
function makeToolkit(program, ctx) {
  // Commands declared `local` make no HTTP request, so they neither resolve a
  // client nor advertise the auth flags. Declared once, on the leaf; `act` reads
  // it back rather than taking a second, drift-prone copy of the same fact.
  const localCommands = new WeakSet();

  function group(name, description) {
    return program.command(name).description(description);
  }
  function leaf(parent, spec, description, options = {}) {
    const cmd = parent.command(spec).description(description);
    if (options.local) {
      localCommands.add(cmd);
    } else {
      cmd
        .option('--api-key <key>', 'API key (default: SENDPING_API_KEY env var)')
        .option('--base-url <url>', 'API base URL (default: SENDPING_BASE_URL env var)');
    }
    // `--json` still applies: a local command prints its result like any other.
    return cmd.option('--json', 'raw compact JSON output (default: pretty-printed)');
  }
  function act(cmd, handler) {
    cmd.action(async (...cbArgs) => {
      const command = cbArgs[cbArgs.length - 1];
      const args = cbArgs.slice(0, -1);
      const opts = command.opts();
      try {
        const client = localCommands.has(cmd) ? undefined : getClient(ctx, opts);
        const result = await handler({ client, ctx, opts, args });
        if (result && result.error) return fail(ctx, result.error, opts);
        print(ctx, result ? result.data : null, opts);
        // Some endpoints answer 200 while reporting a failed operation in the
        // body (e.g. POST /webhooks/:id/test → { ok: false }). A handler flags
        // that with `failed` so the body is still printed but the shell sees 1.
        if (result && result.failed) ctx.exitCode = 1;
        return undefined;
      } catch (err) {
        if (err instanceof CliError) {
          return fail(ctx, { statusCode: null, name: 'cli_error', message: err.message }, opts);
        }
        throw err;
      }
    });
    return cmd;
  }
  return { group, leaf, act };
}

/** Assemble the full commander program for the given context. */
function buildProgram(ctx) {
  const program = new Command();
  program
    .name('sendping')
    .description('Official SendPing CLI — send email, manage domains, contacts, campaigns and more.')
    .version(VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (s) => ctx.stdout(s),
      writeErr: (s) => ctx.stderr(s),
    })
    .addHelpText(
      'after',
      '\nAuthentication:\n  Set SENDPING_API_KEY (or pass --api-key to any command).\n  Set SENDPING_BASE_URL (or --base-url) to target a different API host.\n\nExamples:\n  sendping emails send --from \'Acme <hi@yourdomain.com>\' --to delivered@test.sendping.co --subject hello --html \'<p>hi</p>\'\n  sendping contacts list --domain yourdomain.com\n  sendping events send --domain yourdomain.com --name signup.completed --email ada@example.com --data \'{"plan":"pro"}\'',
    );

  const toolkit = makeToolkit(program, ctx);
  for (const resource of RESOURCES) resource.register(toolkit);
  return program;
}

/**
 * Parse and execute argv (user args only, no node/script prefix).
 * Returns the exit code; never calls process.exit itself.
 */
async function run(ctx, argv) {
  const program = buildProgram(ctx);
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (err) {
    // Commander throws for --help/--version (exitCode 0) and usage errors
    // (exitCode 1) because of exitOverride; the message is already printed.
    if (err && typeof err.exitCode === 'number' && String(err.code || '').startsWith('commander.')) {
      if (err.exitCode !== 0) ctx.exitCode = err.exitCode;
      return ctx.exitCode;
    }
    throw err;
  }
  return ctx.exitCode;
}

/** Entry point used by bin/sendping.js. */
function main(argv) {
  return run(createContext(), argv);
}

module.exports = { createContext, buildProgram, run, main };

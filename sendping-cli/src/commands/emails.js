'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { CliError, collect, append, parseJson, clean, withPagination, pagination, saveFile } = require('../helpers');

/** Server-side attachment caps (decoded bytes) — mirrored so we fail before uploading. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS_TOTAL = 40 * 1024 * 1024;

/**
 * Accepted `Idempotency-Key` length, 1-<max> characters measured after the
 * server trims the value (the storage column is VARCHAR(255)) — not 256.
 * Mirrored from `IDEMPOTENCY_KEY_MAX_LENGTH` in the sendping SDK so the
 * `--idempotency-key` help text cannot drift from the documented rule.
 *
 * Unlike the attachment caps above this is NOT pre-checked: the key is sent as
 * given and the server is the authority (400 invalid_idempotency_key). Only
 * `emails send` and `emails batch` honour the header at all.
 */
const IDEMPOTENCY_KEY_MAX_LENGTH = 255;
const IDEMPOTENCY_KEY_HELP = `idempotency key for safe retries (1-${IDEMPOTENCY_KEY_MAX_LENGTH} characters)`;

/**
 * Build the `attachments` array from `--attachment <path>` (read + base64) and
 * `--attachment-url <url>` (fetched server-side). Local files are size-checked
 * against the same caps the API enforces so an oversized send fails instantly.
 */
function readAttachments(opts) {
  const files = opts.attachment || [];
  const urls = opts.attachmentUrl || [];
  if (!files.length && !urls.length) return undefined;

  let total = 0;
  const attachments = files.map((filePath) => {
    let buf;
    try {
      buf = fs.readFileSync(filePath);
    } catch (err) {
      throw new CliError(`Cannot read --attachment ${filePath}: ${err.message}`);
    }
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      throw new CliError(
        `Attachment ${path.basename(filePath)} is ${buf.length} bytes; the limit is 25 MB per file.`,
      );
    }
    total += buf.length;
    return { filename: path.basename(filePath), content: buf.toString('base64') };
  });
  if (total > MAX_ATTACHMENTS_TOTAL) {
    throw new CliError(`Attachments total ${total} bytes; the limit is 40 MB per message.`);
  }
  for (const url of urls) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new CliError(`Invalid URL for --attachment-url: ${url}`);
    }
    attachments.push({ filename: path.basename(parsed.pathname) || 'attachment', path: url });
  }
  return attachments;
}

/** Resolve the batch payload array from --file or --data, with friendly errors. */
function readBatchPayloads(opts) {
  if (opts.file && opts.data) throw new CliError('Provide only one of --file or --data.');
  if (!opts.file && !opts.data) throw new CliError('Provide --file <path> or --data <json array>.');
  let payloads;
  if (opts.data) {
    payloads = parseJson(opts.data, '--data');
  } else {
    let raw;
    try {
      raw = fs.readFileSync(opts.file, 'utf8');
    } catch (err) {
      throw new CliError(`Cannot read --file ${opts.file}: ${err.message}`);
    }
    try {
      payloads = JSON.parse(raw);
    } catch {
      throw new CliError(`Invalid JSON in --file ${opts.file}`);
    }
  }
  if (!Array.isArray(payloads)) {
    throw new CliError('Batch payload must be a JSON array of send objects.');
  }
  return payloads;
}

function register({ group, leaf, act }) {
  const emails = group('emails', 'Send and manage emails');

  act(
    leaf(emails, 'send', 'Send an email')
      .option('--from <from>', "sender, e.g. 'Acme <hi@yourdomain.com>' — omit to use the template's own from")
      .requiredOption('--to <address>', 'recipient (repeatable or comma-separated)', collect)
      .option('--subject <subject>', "subject line — omit to use the template's own subject")
      .option('--html <html>', 'HTML body')
      .option('--text <text>', 'plain-text body')
      .option('--cc <address>', 'cc recipient (repeatable or comma-separated)', collect)
      .option('--bcc <address>', 'bcc recipient (repeatable or comma-separated)', collect)
      .option('--reply-to <address>', 'reply-to address (repeatable or comma-separated)', collect)
      .option('--preview-text <text>', 'inbox preview text (preheader)')
      .option('--template-id <id>', 'send using a saved template')
      .option('--template-alias <alias>', "send using a saved template by its alias")
      .option('--variables <json>', 'template variables as a JSON object')
      .option('--headers <json>', 'custom headers as a JSON object')
      .option('--attachment <path>', 'file to attach (repeatable; max 25 MB each, 40 MB total)', append)
      .option('--attachment-url <url>', 'hosted file to attach by URL (repeatable)', append)
      .option('--scheduled-at <when>', "ISO 8601 timestamp, or a phrase like 'in 1 min' (max 30 days ahead)")
      .option('--topic-id <id>', 'drop recipients unsubscribed from this topic')
      .option('--idempotency-key <key>', IDEMPOTENCY_KEY_HELP),
    ({ client, opts }) => {
      if (opts.templateId && opts.templateAlias) {
        throw new CliError('Provide only one of --template-id or --template-alias.');
      }
      // `from`/`subject` are required only when no template supplies them, so
      // they cannot be parser-level required options: declaring them so made the
      // documented template one-liner unrunnable, and retyping the values the
      // template already stores then overrides those two fields on every send
      // (republishing the template no longer changes the from and subject,
      // though the body still re-renders from it).
      // The server falls back per field on `!= null`, so an ABSENT key takes the
      // template's value while a key present as '' wins — which is why this
      // tests `=== undefined` and not falsiness: `--subject ''` is a legitimate
      // blank subject line, and `--from ''` must keep earning its 422 rather
      // than being silently rewritten here. `clean()` drops only `undefined`,
      // so an omitted flag never reaches the wire at all.
      if (!opts.templateId && !opts.templateAlias
        && (opts.from === undefined || opts.subject === undefined)) {
        throw new CliError('--from and --subject are required unless you pass --template-id or --template-alias.');
      }
      const variables = parseJson(opts.variables, '--variables');
      return client.emails.send(
        clean({
          from: opts.from,
          to: opts.to,
          subject: opts.subject,
          html: opts.html,
          text: opts.text,
          cc: opts.cc,
          bcc: opts.bcc,
          reply_to: opts.replyTo,
          preview_text: opts.previewText,
          template_id: opts.templateId,
          // An alias goes through the nested `template` form, which carries its
          // own variables; the flat form keeps them top-level.
          template: opts.templateAlias
            ? clean({ alias: opts.templateAlias, variables })
            : undefined,
          variables: opts.templateAlias ? undefined : variables,
          headers: parseJson(opts.headers, '--headers'),
          attachments: readAttachments(opts),
          scheduled_at: opts.scheduledAt,
          topic_id: opts.topicId,
        }),
        opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
      );
    },
  );

  act(
    leaf(
      emails,
      'batch',
      'Send up to 100 emails in one request (no attachments and no scheduled_at — the API 422s on either; send those individually)',
    )
      .option('--file <path>', 'path to a JSON file containing an array of send payloads')
      .option('--data <json>', 'inline JSON array of send payloads')
      .option('--idempotency-key <key>', IDEMPOTENCY_KEY_HELP),
    ({ client, opts }) =>
      client.batch.send(
        readBatchPayloads(opts),
        opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
      ),
  );

  act(leaf(emails, 'get <id>', 'Retrieve a sent email and its events'), ({ client, args: [id] }) =>
    client.emails.get(id),
  );

  act(
    withPagination(leaf(emails, 'list', 'List sent emails'))
      .option('--campaign-id <id>', 'only emails sent by this campaign')
      .option('--automation-id <id>', 'only emails sent by this automation')
      .option(
        '--source <source>',
        "'individual' restricts to all one-off sends, 'api' to API-key sends, 'dashboard' to dashboard-composed mail",
      )
      .option('--domain-id <id>', 'only emails sent from this sending domain')
      .option('--status <status>', "only emails whose last event matches, e.g. 'delivered'")
      .option('--search <text>', 'match recipients, subject or sender')
      .option('--folder <folder>', "mailbox folder: outbox | sent | scheduled | failed"),
    ({ client, opts }) =>
      client.emails.list(
        clean({
          ...pagination(opts),
          campaign_id: opts.campaignId,
          automation_id: opts.automationId,
          source: opts.source,
          domain_id: opts.domainId,
          status: opts.status,
          search: opts.search,
          folder: opts.folder,
        }),
      ),
  );

  act(
    leaf(emails, 'update <id>', 'Reschedule a scheduled email').requiredOption(
      '--scheduled-at <when>',
      "new send time: ISO 8601 or a phrase like 'in 1 min' (max 30 days ahead)",
    ),
    ({ client, opts, args: [id] }) => client.emails.update(id, { scheduled_at: opts.scheduledAt }),
  );

  act(leaf(emails, 'cancel <id>', 'Cancel a scheduled email'), ({ client, args: [id] }) =>
    client.emails.cancel(id),
  );

  act(
    leaf(emails, 'sources', 'Per-source send metrics: one row per campaign and automation, plus api and individual one-off roll-ups'),
    ({ client }) => client.emails.sources(),
  );

  act(
    leaf(emails, 'attachments <emailId>', "List a sent email's attachments"),
    ({ client, args: [emailId] }) => client.emails.listAttachments(emailId),
  );

  act(
    leaf(emails, 'attachment <emailId> <attachmentId>', 'Retrieve one attachment of a sent email'),
    ({ client, args: [emailId, attachmentId] }) => client.emails.getAttachment(emailId, attachmentId),
  );

  // ---- inbound (received) email ----

  const receiving = emails.command('receiving').description('Manage inbound (received) email');

  act(
    withPagination(leaf(receiving, 'list', 'List received emails')).option(
      '--received-for <address>',
      'only messages received for this address',
    ),
    ({ client, opts }) =>
      client.emails.receiving.list(
        clean({ ...pagination(opts), received_for: opts.receivedFor }),
      ),
  );

  act(
    leaf(receiving, 'addresses', 'Per-address inbound stats: one row per address you receive mail for'),
    ({ client }) => client.emails.receiving.listAddresses(),
  );

  act(leaf(receiving, 'get <id>', 'Retrieve a received email'), ({ client, args: [id] }) =>
    client.emails.receiving.get(id),
  );

  act(
    withPagination(leaf(receiving, 'attachments <id>', "List a received email's attachments")),
    ({ client, opts, args: [id] }) => client.emails.receiving.listAttachments(id, pagination(opts)),
  );

  act(
    leaf(
      receiving,
      'attachment <id> <attachmentId>',
      'Download one attachment of a received email to a file',
    ).option('--output <path>', 'file to write (default: the attachment id)'),
    async ({ client, opts, args: [id, attachmentId] }) => {
      const result = await client.emails.receiving.getAttachment(id, attachmentId);
      if (result.error) return result;
      return saveFile(opts.output || attachmentId, result.data);
    },
  );

  act(
    leaf(receiving, 'raw <id>', 'Download the original RFC822/MIME message to a file').option(
      '--output <path>',
      'file to write (default: <id>.eml)',
    ),
    async ({ client, opts, args: [id] }) => {
      const result = await client.emails.receiving.getRaw(id);
      if (result.error) return result;
      return saveFile(opts.output || `${id}.eml`, result.data);
    },
  );

  act(
    leaf(receiving, 'forward <id>', 'Forward a received email')
      .requiredOption('--from <from>', 'a verified sending address to forward from')
      .requiredOption('--to <address>', 'recipient (repeatable or comma-separated)', collect)
      .option('--subject <subject>', 'override the subject line')
      .option('--idempotency-key <key>', IDEMPOTENCY_KEY_HELP),
    ({ client, opts, args: [id] }) =>
      client.emails.receiving.forward(
        id,
        clean({ from: opts.from, to: opts.to, subject: opts.subject }),
        opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
      ),
  );

  act(
    leaf(receiving, 'reply <id>', "Reply to a received email's sender (threaded)")
      .requiredOption('--from <from>', 'a verified sending address to reply from')
      .option('--html <html>', 'HTML body')
      .option('--text <text>', 'plain-text body')
      .option('--subject <subject>', "override the subject (default: 'Re: …')")
      .option('--idempotency-key <key>', IDEMPOTENCY_KEY_HELP),
    ({ client, opts, args: [id] }) => {
      if (opts.html === undefined && opts.text === undefined) {
        throw new CliError('Provide at least one of --html or --text.');
      }
      return client.emails.receiving.reply(
        id,
        clean({ from: opts.from, html: opts.html, text: opts.text, subject: opts.subject }),
        opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
      );
    },
  );

  act(leaf(receiving, 'delete <id>', 'Delete a received email'), ({ client, args: [id] }) =>
    client.emails.receiving.remove(id),
  );
}

module.exports = { register };

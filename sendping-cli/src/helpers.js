'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Error whose message is reported as a CLI usage error (exit 1, no stack). */
class CliError extends Error {}

/**
 * Commander collector for repeatable flags. Each occurrence may itself be
 * comma-separated: `--to a@b.com --to c@d.com,e@f.com` → [a@b.com, c@d.com, e@f.com].
 */
function collect(value, previous) {
  return (previous || []).concat(
    String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Commander collector for repeatable flags whose values must stay verbatim
 * (file paths, URLs) — unlike `collect`, it never splits on commas.
 */
function append(value, previous) {
  return (previous || []).concat(value);
}

/** Parse a JSON-valued flag, failing with a friendly message. */
function parseJson(value, flagName) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new CliError(`Invalid JSON for ${flagName}: ${value}`);
  }
}

/** Parse an integer-valued flag. */
function toInt(value, flagName) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new CliError(`${flagName} must be an integer, got: ${value}`);
  return n;
}

/** Drop undefined values so we only send what the user set. */
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Add the standard cursor-pagination flags to a list command. The API accepts
 * an integer 1-100 and rejects `--after` together with `--before`.
 *
 * Omitting `--limit` does NOT mean "20 everywhere" and never means "everything":
 * lib/api/pagination.ts applies its 20 default only to the `forceLimit` list
 * routes, while the rest fall back to UNPAGINATED_MAX (1,000) — and both set
 * `has_more` truthfully when the page was truncated. The old help text said
 * "default 20" flatly, which understated ~1,000-row first pages on
 * domains/contacts/segments/topics/campaigns/polls/api-keys/contact-properties
 * and their friends. Page with `--after` and trust `has_more`, not a number.
 */
function withPagination(cmd) {
  return cmd
    .option('--limit <n>', 'max results per page (integer 1-100). Omitted: the endpoint default (20 on most lists, up to 1000 on the rest) — keep paging while has_more is true')
    .option('--after <cursor>', 'cursor: the id of the last item on the previous page')
    .option('--before <cursor>', 'cursor: the id of the first item on the next page');
}

/**
 * Build the SDK pagination params object from parsed options. `after` and
 * `before` are mutually exclusive (the API answers 422); catch that locally so
 * the user gets a usage error instead of a round-trip.
 */
function pagination(opts) {
  if (opts.after !== undefined && opts.before !== undefined) {
    throw new CliError('Use either --after or --before, not both.');
  }
  return clean({
    limit: toInt(opts.limit, '--limit'),
    after: opts.after,
    before: opts.before,
  });
}

/**
 * Write a non-JSON API payload to disk and return the printable `{ data }`
 * summary the command layer expects. A few endpoints answer with bytes
 * (attachments, raw RFC822) or text (a domain's records.csv) rather than JSON,
 * so the file is saved and stdout keeps its JSON-only contract.
 */
function saveFile(filePath, contents) {
  const abs = path.resolve(filePath);
  const buf = typeof contents === 'string' ? Buffer.from(contents, 'utf8') : Buffer.from(contents);
  fs.writeFileSync(abs, buf);
  return { data: { object: 'file', path: abs, bytes: buf.length } };
}

module.exports = {
  CliError, collect, append, parseJson, toInt, clean, withPagination, pagination, saveFile,
};

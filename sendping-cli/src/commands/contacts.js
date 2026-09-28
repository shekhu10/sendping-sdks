'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CliError, parseJson, clean, withPagination, pagination } = require('../helpers');

/**
 * A contact lives either in a sending domain's pool (`--domain`, the
 * domain-first default) or in a plain audience (`--audience-id`, the nested
 * `/audiences/:id/contacts` API). Exactly one of the two names the container.
 */
function requireContainer(opts) {
  if (opts.domain && opts.audienceId) {
    throw new CliError('Provide only one of --domain or --audience-id.');
  }
  if (!opts.domain && !opts.audienceId) {
    throw new CliError('Provide --domain <domain> (or --audience-id <id> to target an audience).');
  }
}

function register({ group, leaf, act }) {
  const contacts = group('contacts', 'Manage contacts (domain-first: each sending domain has its own pool)');

  act(
    leaf(contacts, 'create', "Create a contact in a domain's pool")
      .option('--domain <domain>', 'the sending domain whose contact pool to use')
      .option('--audience-id <id>', 'create in this audience instead of a domain pool')
      .requiredOption('--email <email>', "the contact's email address")
      .option('--first-name <name>', 'first name')
      .option('--last-name <name>', 'last name')
      .option('--unsubscribed', 'create as unsubscribed')
      .option('--properties <json>', 'custom property values as a JSON object'),
    ({ client, opts }) => {
      requireContainer(opts);
      return client.contacts.create(
        clean({
          domain: opts.domain,
          audienceId: opts.audienceId,
          email: opts.email,
          first_name: opts.firstName,
          last_name: opts.lastName,
          unsubscribed: opts.unsubscribed,
          properties: parseJson(opts.properties, '--properties'),
        }),
      );
    },
  );

  act(
    withPagination(
      leaf(contacts, 'list', "List a domain's contacts")
        .option('--domain <domain>', 'the sending domain whose contact pool to list')
        .option('--audience-id <id>', 'list this audience instead of a domain pool')
        .option('--segment-id <id>', 'only contacts in this segment'),
    ),
    ({ client, opts }) => {
      requireContainer(opts);
      return client.contacts.list(
        clean({
          domain: opts.domain,
          audienceId: opts.audienceId,
          segment_id: opts.segmentId,
          ...pagination(opts),
        }),
      );
    },
  );

  act(
    leaf(contacts, 'get <id>', 'Retrieve a contact by id or email').option(
      '--domain <domain>',
      'disambiguates an email id across domain pools',
    ),
    ({ client, opts, args: [id] }) => client.contacts.get(clean({ id, domain: opts.domain })),
  );

  act(
    leaf(contacts, 'update <id>', 'Update a contact (id or email)')
      .option('--domain <domain>', 'disambiguates an email id across domain pools')
      .option('--first-name <name>', 'first name')
      .option('--last-name <name>', 'last name')
      .option('--unsubscribed', 'mark unsubscribed')
      .option('--subscribed', 'mark subscribed again')
      .option('--properties <json>', 'custom property values as a JSON object'),
    ({ client, opts, args: [id] }) => {
      // Contradictory consent flags used to resolve silently in favour of
      // --unsubscribed, which could write the OPPOSITE of what the operator
      // meant onto a subscription state. Refuse, like every other mutually
      // exclusive pair in this CLI.
      if (opts.unsubscribed && opts.subscribed) {
        throw new CliError('Provide only one of --unsubscribed or --subscribed.');
      }
      return client.contacts.update(
        clean({
          id,
          domain: opts.domain,
          first_name: opts.firstName,
          last_name: opts.lastName,
          unsubscribed: opts.unsubscribed ? true : opts.subscribed ? false : undefined,
          properties: parseJson(opts.properties, '--properties'),
        }),
      );
    },
  );

  act(
    leaf(contacts, 'delete <id>', 'Delete a contact (id or email)').option(
      '--domain <domain>',
      'disambiguates an email id across domain pools',
    ),
    ({ client, opts, args: [id] }) => client.contacts.remove(clean({ id, domain: opts.domain })),
  );

  act(
    leaf(contacts, 'add-to-segment <id> <segmentId>', 'Add a contact to a segment'),
    ({ client, args: [id, segmentId] }) => client.contacts.addToSegment(id, segmentId),
  );

  act(
    withPagination(leaf(contacts, 'segments <id>', 'List the segments a contact belongs to')),
    ({ client, opts, args: [id] }) => client.contacts.listSegments(id, pagination(opts)),
  );

  act(
    leaf(contacts, 'remove-from-segment <id> <segmentId>', 'Remove a contact from a segment'),
    ({ client, args: [id, segmentId] }) => client.contacts.removeFromSegment(id, segmentId),
  );

  act(
    withPagination(leaf(contacts, 'topics <id>', "Get a contact's topic subscriptions")),
    ({ client, opts, args: [id] }) => client.contacts.getTopics(id, pagination(opts)),
  );

  act(
    leaf(contacts, 'set-topics <id>', "Update a contact's topic subscriptions").requiredOption(
      '--topics <json>',
      'JSON array of {"id","subscription"} objects, e.g. \'[{"id":"top_1","subscription":"opt_in"}]\'',
    ),
    ({ client, opts, args: [id] }) =>
      client.contacts.updateTopics(id, { topics: parseJson(opts.topics, '--topics') }),
  );

  // Bulk import — from a JSON array of contacts, or a CSV file (SDK-3).
  act(
    leaf(contacts, 'batch [audienceId]', 'Bulk-import contacts from a JSON array (upsert by email; max 10,000)')
      .option('--domain <domain>', "the sending domain whose contact pool to import into (instead of an audience)")
      .option('--audience-id <id>', 'target this audience instead of a domain pool (same as the positional)')
      .option('--file <path>', 'path to a JSON file containing an array of contact objects')
      .option('--data <json>', 'inline JSON array of contact objects')
      .option('--on-conflict <mode>', "how to resolve an existing email: 'upsert' (default) or 'skip'"),
    ({ client, opts, args: [audienceId] }) => {
      // The audience arrives as a positional (backwards compatibility) or as
      // the --audience-id flag every sibling command carries — and which this
      // command's own missing-target error suggests, so it must exist here.
      requireContainer({ domain: opts.domain, audienceId: audienceId || opts.audienceId });
      if (opts.file && opts.data) throw new CliError('Provide only one of --file or --data.');
      if (!opts.file && !opts.data) throw new CliError('Provide --file <path> or --data <json array>.');
      let contactsArr;
      if (opts.file) {
        let raw;
        try { raw = fs.readFileSync(opts.file, 'utf8'); }
        catch (err) { throw new CliError(`Cannot read --file ${opts.file}: ${err.message}`); }
        contactsArr = parseJson(raw, `--file ${opts.file}`);
      } else {
        contactsArr = parseJson(opts.data, '--data');
      }
      if (!Array.isArray(contactsArr)) throw new CliError('The contacts payload must be a JSON array.');
      return client.contacts.batch(clean({
        domain: opts.domain,
        audienceId: audienceId || opts.audienceId,
        contacts: contactsArr,
        on_conflict: opts.onConflict,
      }));
    },
  );

  act(
    leaf(contacts, 'import <audienceId>', 'Bulk-import contacts from a CSV file (email column required; header row optional)')
      .option('--csv <path>', 'path to a CSV file to send inline (max 5 MB / 10,000 rows)')
      .option('--storage-key <key>', 'key from `contacts import-upload`, once the file has been PUT to its upload URL')
      .option('--file-name <name>', 'name recorded for the archived source file (inline --csv mode)')
      .option('--segment-id <id>', 'also add every imported email to this segment (must belong to the audience)')
      .option('--on-conflict <mode>', "how to resolve an existing email: 'upsert' (default) or 'skip'")
      .option('--no-create-properties', 'strict mode: keep only columns matching a registered property'),
    ({ client, opts, args: [audienceId] }) => {
      if (opts.csv && opts.storageKey) {
        throw new CliError('Provide only one of --csv or --storage-key.');
      }
      if (!opts.csv && !opts.storageKey) {
        throw new CliError('Provide --csv <path> (or --storage-key <key> for an already-uploaded file).');
      }
      let csv;
      if (opts.csv) {
        try { csv = fs.readFileSync(opts.csv, 'utf8'); }
        catch (err) { throw new CliError(`Cannot read --csv ${opts.csv}: ${err.message}`); }
      }
      // commander sets opts.createProperties=false for --no-create-properties (default true).
      return client.contacts.import(clean({
        audienceId, csv, storage_key: opts.storageKey, file_name: opts.fileName,
        segment_id: opts.segmentId, on_conflict: opts.onConflict,
        create_properties: opts.createProperties === false ? false : undefined,
      }));
    },
  );

  act(
    leaf(
      contacts,
      'import-upload <audienceId>',
      'Mint a presigned upload URL for a CSV too large to send inline (up to 256 MB)',
    ).requiredOption('--csv <path>', 'path to the CSV file to upload (its name and size are sent, not its contents)'),
    ({ client, opts, args: [audienceId] }) => {
      let stat;
      try { stat = fs.statSync(opts.csv); }
      catch (err) { throw new CliError(`Cannot read --csv ${opts.csv}: ${err.message}`); }
      // PUT the file to the returned `upload_url`, then finish the import with
      // `contacts import <audienceId> --storage-key <storage_key>`.
      return client.contacts.createImportUpload({
        audienceId,
        filename: path.basename(opts.csv),
        size: stat.size,
      });
    },
  );
}

module.exports = { register };

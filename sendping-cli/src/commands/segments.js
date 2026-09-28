'use strict';

const { parseJson, clean, withPagination, pagination } = require('../helpers');

function register({ group, leaf, act }) {
  const segments = group('segments', 'Manage contact segments (scoped to a sending domain)');

  act(
    leaf(segments, 'create', 'Create a segment on a sending domain')
      .requiredOption('--domain <domain>', 'the sending domain this segment belongs to')
      .requiredOption('--name <name>', 'segment name (unique within the domain)')
      .option('--filter <json>', "filter as JSON, e.g. '{\"status\":\"subscribed\"}'"),
    ({ client, opts }) =>
      client.segments.create(
        clean({ domain: opts.domain, name: opts.name, filter: parseJson(opts.filter, '--filter') }),
      ),
  );

  act(
    withPagination(
      leaf(segments, 'list', "List a domain's segments").requiredOption(
        '--domain <domain>',
        'the sending domain whose segments to list',
      ),
    ),
    ({ client, opts }) => client.segments.list({ domain: opts.domain, ...pagination(opts) }),
  );

  act(leaf(segments, 'get <id>', 'Retrieve a segment'), ({ client, args: [id] }) =>
    client.segments.get(id),
  );

  act(
    withPagination(leaf(segments, 'contacts <id>', 'Preview the contacts a segment currently resolves to')),
    ({ client, opts, args: [id] }) => client.segments.contacts(id, pagination(opts)),
  );

  act(
    leaf(segments, 'update <id>', 'Update a segment')
      .option('--name <name>', 'new name')
      .option('--filter <json>', 'new filter as JSON'),
    ({ client, opts, args: [id] }) =>
      client.segments.update(id, clean({ name: opts.name, filter: parseJson(opts.filter, '--filter') })),
  );

  act(leaf(segments, 'delete <id>', 'Delete a segment'), ({ client, args: [id] }) =>
    client.segments.remove(id),
  );
}

module.exports = { register };

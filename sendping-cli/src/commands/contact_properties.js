'use strict';

const { CliError, clean, withPagination, pagination } = require('../helpers');

function register({ group, leaf, act }) {
  const props = group('contact-properties', 'Manage custom contact properties (merge-tag keys)');

  act(
    leaf(props, 'create', 'Create a contact property')
      .requiredOption('--key <key>', "canonical merge-tag key, e.g. 'company'")
      .requiredOption('--type <type>', "value type: 'string' | 'number'")
      .option('--fallback-value <value>', 'value used when a contact has none'),
    ({ client, opts }) =>
      client.contactProperties.create(
        clean({ key: opts.key, type: opts.type, fallback_value: opts.fallbackValue }),
      ),
  );

  act(withPagination(leaf(props, 'list', 'List contact properties')), ({ client, opts }) =>
    client.contactProperties.list(pagination(opts)),
  );

  act(leaf(props, 'get <id>', 'Retrieve a contact property'), ({ client, args: [id] }) =>
    client.contactProperties.get(id),
  );

  act(
    leaf(props, 'update <id>', 'Update a contact property (only the fallback is mutable)')
      .option('--fallback-value <value>', 'new fallback value')
      .option('--clear-fallback', 'clear the fallback (sets it to null)'),
    ({ client, opts, args: [id] }) => {
      if (opts.clearFallback && opts.fallbackValue !== undefined) {
        throw new CliError('Provide only one of --fallback-value or --clear-fallback.');
      }
      if (!opts.clearFallback && opts.fallbackValue === undefined) {
        throw new CliError('Provide --fallback-value <value> or --clear-fallback.');
      }
      return client.contactProperties.update(id, {
        fallback_value: opts.clearFallback ? null : opts.fallbackValue,
      });
    },
  );

  act(leaf(props, 'delete <id>', 'Delete a contact property'), ({ client, args: [id] }) =>
    client.contactProperties.remove(id),
  );
}

module.exports = { register };

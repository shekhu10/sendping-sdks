'use strict';

const { clean, withPagination, pagination } = require('../helpers');

function register({ group, leaf, act }) {
  const audiences = group('audiences', 'Manage audiences');

  act(
    leaf(audiences, 'create', 'Create an audience').requiredOption('--name <name>', 'audience name'),
    ({ client, opts }) => client.audiences.create({ name: opts.name }),
  );

  act(withPagination(leaf(audiences, 'list', 'List audiences')), ({ client, opts }) =>
    client.audiences.list(pagination(opts)),
  );

  act(leaf(audiences, 'get <id>', 'Retrieve an audience'), ({ client, args: [id] }) =>
    client.audiences.get(id),
  );

  act(
    leaf(audiences, 'update <id>', 'Rename an audience').requiredOption('--name <name>', 'new name'),
    ({ client, opts, args: [id] }) => client.audiences.update(id, { name: opts.name }),
  );

  act(leaf(audiences, 'delete <id>', 'Delete an audience'), ({ client, args: [id] }) =>
    client.audiences.remove(id),
  );

  act(
    leaf(
      audiences,
      'import-sheet <audienceId>',
      'Import contacts from a link-shared Google Sheet (rows land in a fresh segment)',
    )
      .requiredOption('--url <url>', 'link-shared Google Sheet URL')
      .option('--segment-name <name>', 'name for the created segment'),
    ({ client, opts, args: [audienceId] }) =>
      client.audiences.importSheet(
        audienceId,
        clean({ url: opts.url, segment_name: opts.segmentName }),
      ),
  );
}

module.exports = { register };

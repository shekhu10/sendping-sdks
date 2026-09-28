'use strict';

const { clean, toInt, withPagination, pagination } = require('../helpers');

function register({ group, leaf, act }) {
  const logs = group('logs', 'Inspect API request logs');

  act(
    withPagination(
      leaf(logs, 'list', 'List API request logs')
        .option('--method <method>', "filter by HTTP method, e.g. 'POST'")
        .option('--status <status>', 'filter by response status, e.g. 429'),
    ),
    ({ client, opts }) =>
      client.logs.list(
        clean({ ...pagination(opts), method: opts.method, status: toInt(opts.status, '--status') }),
      ),
  );

  act(leaf(logs, 'get <id>', 'Retrieve a log entry'), ({ client, args: [id] }) => client.logs.get(id));
}

module.exports = { register };

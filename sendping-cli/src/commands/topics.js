'use strict';

const { clean, withPagination, pagination } = require('../helpers');

function register({ group, leaf, act }) {
  const topics = group('topics', 'Manage subscription topics (scoped to a sending domain)');

  act(
    leaf(topics, 'create', 'Create a topic on a sending domain')
      .requiredOption('--domain <domain>', 'the sending domain this topic belongs to')
      .requiredOption('--name <name>', 'topic name')
      .option('--default-subscription <mode>', "'opt_in' | 'opt_out' (default: opt_in)", 'opt_in')
      .option('--visibility <visibility>', "'public' | 'private'")
      .option('--description <text>', 'topic description'),
    ({ client, opts }) =>
      client.topics.create(
        clean({
          domain: opts.domain,
          name: opts.name,
          default_subscription: opts.defaultSubscription,
          visibility: opts.visibility,
          description: opts.description,
        }),
      ),
  );

  act(
    withPagination(
      leaf(topics, 'list', "List a domain's topics").requiredOption(
        '--domain <domain>',
        'the sending domain whose topics to list',
      ),
    ),
    ({ client, opts }) => client.topics.list({ domain: opts.domain, ...pagination(opts) }),
  );

  act(leaf(topics, 'get <id>', 'Retrieve a topic'), ({ client, args: [id] }) => client.topics.get(id));

  act(
    leaf(topics, 'update <id>', 'Update a topic')
      .option('--name <name>', 'new name')
      .option('--description <text>', 'new description')
      .option('--visibility <visibility>', "'public' | 'private'"),
    ({ client, opts, args: [id] }) =>
      client.topics.update(
        id,
        clean({ name: opts.name, description: opts.description, visibility: opts.visibility }),
      ),
  );

  act(leaf(topics, 'delete <id>', 'Delete a topic'), ({ client, args: [id] }) =>
    client.topics.remove(id),
  );
}

module.exports = { register };

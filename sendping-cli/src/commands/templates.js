'use strict';

const { parseJson, clean, withPagination, pagination } = require('../helpers');

/**
 * `variables` is the template's declared-variable registry, not the per-send
 * values: a JSON array of `{"key","type"?,"fallback_value"?}` (max 50, `type`
 * is 'string' | 'number', a number's fallback must parse as a number). The send
 * path prefers a declared fallback when a caller omits the variable, so a
 * template with no registry has no fallbacks — which is why this could not be
 * left to the dashboard. Passing `[]` clears the registry.
 */
const VARIABLES_HELP =
  'declared variables as a JSON array of {"key","type"?,"fallback_value"?} (max 50; [] clears them)';

function register({ group, leaf, act }) {
  const templates = group('templates', 'Manage email templates');

  act(
    leaf(templates, 'create', 'Create a template')
      .requiredOption('--name <name>', 'template name')
      .option('--subject <subject>', 'subject line')
      .option('--html <html>', 'HTML body')
      .option('--text <text>', 'plain-text body')
      .option('--from <from>', 'default sender')
      .option('--reply-to <address>', 'default reply-to')
      .option('--alias <alias>', 'stable handle for sending by alias')
      .option('--variables <json>', VARIABLES_HELP),
    ({ client, opts }) =>
      client.templates.create(
        clean({
          name: opts.name,
          subject: opts.subject,
          html: opts.html,
          text: opts.text,
          from: opts.from,
          reply_to: opts.replyTo,
          alias: opts.alias,
          variables: parseJson(opts.variables, '--variables'),
        }),
      ),
  );

  act(leaf(templates, 'get <id>', 'Retrieve a template'), ({ client, args: [id] }) =>
    client.templates.get(id),
  );

  act(withPagination(leaf(templates, 'list', 'List templates')), ({ client, opts }) =>
    client.templates.list(pagination(opts)),
  );

  act(
    leaf(templates, 'update <id>', "Update a template's draft")
      .option('--name <name>', 'template name')
      .option('--subject <subject>', 'subject line')
      .option('--html <html>', 'HTML body')
      .option('--text <text>', 'plain-text body')
      .option('--from <from>', 'default sender')
      .option('--reply-to <address>', 'default reply-to')
      .option('--alias <alias>', 'stable handle')
      .option('--variables <json>', VARIABLES_HELP),
    ({ client, opts, args: [id] }) =>
      client.templates.update(
        id,
        clean({
          name: opts.name,
          subject: opts.subject,
          html: opts.html,
          text: opts.text,
          from: opts.from,
          reply_to: opts.replyTo,
          alias: opts.alias,
          variables: parseJson(opts.variables, '--variables'),
        }),
      ),
  );

  act(
    leaf(templates, 'duplicate <id>', 'Duplicate a template')
      .option('--name <name>', 'name for the copy')
      .option('--alias <alias>', 'alias for the copy'),
    ({ client, opts, args: [id] }) =>
      client.templates.duplicate(id, clean({ name: opts.name, alias: opts.alias })),
  );

  act(
    leaf(templates, 'publish <id>', 'Publish a template (make its latest draft live)'),
    ({ client, args: [id] }) => client.templates.publish(id),
  );

  act(leaf(templates, 'delete <id>', 'Delete a template'), ({ client, args: [id] }) =>
    client.templates.remove(id),
  );
}

module.exports = { register };

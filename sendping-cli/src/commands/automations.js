'use strict';

const { collect, parseJson, clean, withPagination, pagination } = require('../helpers');

function register({ group, leaf, act }) {
  const automations = group('automations', 'Manage automations (scoped to a sending domain)');

  act(
    leaf(automations, 'create', 'Create an automation')
      .requiredOption('--name <name>', 'automation name')
      .requiredOption('--domain <domain>', 'the sending domain this automation belongs to')
      .option(
        '--trigger <event>',
        "trigger event, e.g. 'contact.created', 'sendping:schedule' (requires --trigger-at/--trigger-timezone), or a custom event name",
      )
      .option('--trigger-at <iso>', "ISO 8601 instant the 'sendping:schedule' trigger fires (with --trigger-timezone)")
      .option('--trigger-timezone <tz>', "IANA timezone the schedule was picked in, e.g. 'America/New_York'")
      .option('--status <status>', "'enabled' | 'disabled' (default: disabled)"),
    ({ client, opts }) =>
      client.automations.create(
        clean({
          name: opts.name,
          domain: opts.domain,
          trigger: opts.trigger,
          trigger_config:
            opts.triggerAt || opts.triggerTimezone
              ? clean({ at: opts.triggerAt, timezone: opts.triggerTimezone })
              : undefined,
          status: opts.status,
        }),
      ),
  );

  act(leaf(automations, 'get <id>', 'Retrieve an automation'), ({ client, args: [id] }) =>
    client.automations.get(id),
  );

  act(withPagination(leaf(automations, 'list', 'List automations')), ({ client, opts }) =>
    client.automations.list(pagination(opts)),
  );

  act(
    leaf(automations, 'update <id>', 'Update an automation')
      .option('--name <name>', 'new name')
      .option('--status <status>', "'enabled' | 'disabled'")
      .option('--trigger-at <iso>', "update the 'sendping:schedule' trigger's ISO 8601 fire time (with --trigger-timezone)")
      .option('--trigger-timezone <tz>', "IANA timezone the schedule was picked in, e.g. 'America/New_York'"),
    ({ client, opts, args: [id] }) =>
      client.automations.update(
        id,
        clean({
          name: opts.name,
          status: opts.status,
          trigger_config:
            opts.triggerAt || opts.triggerTimezone
              ? clean({ at: opts.triggerAt, timezone: opts.triggerTimezone })
              : undefined,
        }),
      ),
  );

  act(
    leaf(automations, 'add-step <id>', 'Append a step to an automation')
      .requiredOption(
        '--type <type>',
        "step type: 'send_email' | 'wait_for_event' | 'delay' | 'condition' | 'split' | 'add_to_segment' | 'contact_update' | 'contact_delete'",
      )
      .option('--config <json>', "step config as JSON, e.g. '{\"template_id\":\"tmpl_x\"}'")
      .option('--key <key>', 'step key (for connections)'),
    ({ client, opts, args: [id] }) =>
      client.automations.addStep(
        id,
        clean({ type: opts.type, config: parseJson(opts.config, '--config'), key: opts.key }),
      ),
  );

  // PATCH /automations/:id/steps/:stepId re-validates the WHOLE step through the
  // same validateStep the create path uses, so `--type` is required here too: a
  // body without it fails `type must be one of: …` (422) before the config is
  // ever looked at. It was optional, which made `update-step … --config …` — the
  // form the docs showed — a request that could never succeed.
  //
  // `--key` is deliberately absent: the server updates a step's type and config
  // only (the graph key and position are stable), so a `key` in the body was
  // accepted and silently dropped, leaving the caller believing the step had
  // been re-keyed and its connections re-pointed. Delete and re-add the step
  // with `add-step --key` to change its key.
  act(
    leaf(automations, 'update-step <id> <stepId>', 'Update a step of an automation')
      .requiredOption(
        '--type <type>',
        "step type: 'send_email' | 'wait_for_event' | 'delay' | 'condition' | 'split' | 'add_to_segment' | 'contact_update' | 'contact_delete'",
      )
      .option('--config <json>', 'new step config as JSON (replaces the stored config)'),
    ({ client, opts, args: [id, stepId] }) =>
      client.automations.updateStep(
        id,
        stepId,
        clean({ type: opts.type, config: parseJson(opts.config, '--config') }),
      ),
  );

  act(
    leaf(automations, 'delete-step <id> <stepId>', 'Delete a step from an automation'),
    ({ client, args: [id, stepId] }) => client.automations.deleteStep(id, stepId),
  );

  act(
    withPagination(leaf(automations, 'runs <id>', "List an automation's runs, newest first")).option(
      '--status <status>',
      "keep only runs in these statuses: 'running' | 'completed' | 'failed' | 'skipped' (repeatable or comma-separated); filtering happens before paging",
      collect,
    ),
    ({ client, opts, args: [id] }) =>
      client.automations.runs(id, clean({ ...pagination(opts), status: opts.status })),
  );

  act(
    leaf(automations, 'run <id> <runId>', 'Retrieve a single automation run'),
    ({ client, args: [id, runId] }) => client.automations.getRun(id, runId),
  );

  act(
    leaf(automations, 'stop <id>', 'Stop an automation (in-progress runs finish)'),
    ({ client, args: [id] }) => client.automations.stop(id),
  );

  act(
    leaf(automations, 'ai <id>', 'Author (or extend) the step graph from a natural-language prompt')
      .requiredOption('--prompt <text>', 'what the automation should do (max 2000 characters)')
      .option('--template-id <id>', 'a template the plan may send (repeatable or comma-separated; first 10 used)', collect)
      .option('--event <name>', 'an event name the plan may wait on (repeatable or comma-separated; first 10 used)', collect)
      .option('--attach-from <key>', 'extend an existing graph from this trigger key or step key instead of authoring a whole workflow')
      .option('--attach-type <type>', "connection type: 'default' (default) | 'condition_met' | 'condition_not_met' | 'event_received' | 'timeout'")
      .option('--attach-before <key>', 'insert before this existing step key'),
    ({ client, opts, args: [id] }) =>
      client.automations.createWithAi(
        id,
        clean({
          prompt: opts.prompt,
          template_ids: opts.templateId,
          events: opts.event,
          // Presence of `attach` is what switches the API from workflow mode to
          // append mode, so only build it when the user named a source step.
          attach: opts.attachFrom
            ? clean({ from: opts.attachFrom, type: opts.attachType, before: opts.attachBefore })
            : undefined,
        }),
      ),
  );

  act(leaf(automations, 'delete <id>', 'Delete an automation'), ({ client, args: [id] }) =>
    client.automations.remove(id),
  );
}

module.exports = { register };

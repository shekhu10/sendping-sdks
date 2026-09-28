'use strict';

const { collect, parseJson, clean, toInt, withPagination, pagination } = require('../helpers');

/** Flags shared by `campaigns create` and `campaigns update`. */
function withCampaignBodyFlags(cmd) {
  return cmd
    .option('--reply-to <address>', 'reply-to address (repeatable or comma-separated)', collect)
    .option('--preview-text <text>', 'inbox preview text (max 150 characters)')
    .option('--schedule-timezone <tz>', "IANA timezone the schedule + daily batching are evaluated in, e.g. 'America/New_York'")
    .option('--daily-batch-size <n>', 'max recipients fanned out per batch-day (1-100000)')
    .option('--unsubscribe-policy <policy>', "'account' (default) | 'domain' | 'ignore'")
    .option('--list-to', 'show a generated mailing-list address as the visible To')
    .option('--recurrence <interval>', "'daily' | 'weekly' | 'monthly'")
    .option('--recurrence-every <n>', 'periods between recurring sends (1-365, default 1)')
    .option('--ab-test <json>', 'A/B config as JSON, e.g. \'{"enabled":true,"subject_b":"B"}\'')
    .option('--followups <json>', 'follow-ups as a JSON array (max 5) of {condition,delay,html,subject?}');
}

/** Map the shared body flags onto the API field names. */
function campaignBody(opts) {
  return {
    reply_to: opts.replyTo,
    preview_text: opts.previewText,
    schedule_timezone: opts.scheduleTimezone,
    daily_batch_size: toInt(opts.dailyBatchSize, '--daily-batch-size'),
    unsubscribe_policy: opts.unsubscribePolicy,
    list_to: opts.listTo,
    recurrence: opts.recurrence,
    recurrence_every: toInt(opts.recurrenceEvery, '--recurrence-every'),
    ab_test: parseJson(opts.abTest, '--ab-test'),
    followups: parseJson(opts.followups, '--followups'),
  };
}

function register({ group, leaf, act }) {
  const campaigns = group('campaigns', "Manage campaigns (bulk sends to a domain's contact pool)");

  act(
    withCampaignBodyFlags(
      leaf(campaigns, 'create', 'Create a draft campaign')
        .requiredOption('--domain <domain>', 'the sending domain whose contact pool this campaign targets')
        .requiredOption('--from <from>', "sender, e.g. 'Acme <hi@yourdomain.com>'")
        .requiredOption('--subject <subject>', 'subject line')
        .option('--html <html>', 'HTML body')
        .option('--text <text>', 'plain-text body')
        .option('--name <name>', 'internal campaign name')
        .option('--segment-id <id>', 'target a segment instead of the whole pool')
        .option('--topic-id <id>', 'gate recipients by a topic subscription'),
    )
      .option('--send', 'send (or schedule) the campaign immediately on create')
      .option('--scheduled-at <when>', "with --send: ISO 8601 or a phrase like 'in 1 min' (max 30 days ahead)"),
    ({ client, opts }) =>
      client.campaigns.create(
        clean({
          domain: opts.domain,
          from: opts.from,
          subject: opts.subject,
          html: opts.html,
          text: opts.text,
          name: opts.name,
          segment_id: opts.segmentId,
          topic_id: opts.topicId,
          send: opts.send,
          scheduled_at: opts.scheduledAt,
          ...campaignBody(opts),
        }),
      ),
  );

  act(
    leaf(campaigns, 'send <id>', 'Send a campaign now, or schedule it')
      .option('--scheduled-at <when>', "ISO 8601 timestamp, or a phrase like 'in 1 min' (max 30 days ahead)")
      .option('--schedule-timezone <tz>', 'IANA timezone daily batching evaluates batch-days in'),
    ({ client, opts, args: [id] }) => {
      const payload = clean({
        scheduled_at: opts.scheduledAt,
        schedule_timezone: opts.scheduleTimezone,
      });
      return client.campaigns.send(id, Object.keys(payload).length ? payload : undefined);
    },
  );

  act(leaf(campaigns, 'get <id>', 'Retrieve a campaign'), ({ client, args: [id] }) =>
    client.campaigns.get(id),
  );

  act(withPagination(leaf(campaigns, 'list', 'List campaigns')), ({ client, opts }) =>
    client.campaigns.list(pagination(opts)),
  );

  act(
    withCampaignBodyFlags(
      leaf(campaigns, 'update <id>', 'Update a draft campaign')
        .option('--domain <domain>', 're-target another sending domain (clears segment and topic)')
        .option('--from <from>', 'sender')
        .option('--subject <subject>', 'subject line')
        .option('--html <html>', 'HTML body')
        .option('--text <text>', 'plain-text body')
        .option('--name <name>', 'internal campaign name')
        .option('--segment-id <id>', 're-target a segment')
        .option('--topic-id <id>', 're-target a topic gate'),
    ),
    ({ client, opts, args: [id] }) =>
      client.campaigns.update(
        id,
        clean({
          domain: opts.domain,
          from: opts.from,
          subject: opts.subject,
          html: opts.html,
          text: opts.text,
          name: opts.name,
          segment_id: opts.segmentId,
          topic_id: opts.topicId,
          ...campaignBody(opts),
        }),
      ),
  );

  act(
    leaf(
      campaigns,
      'cancel <id>',
      'Stop a campaign (back to draft, or terminal canceled if it is already queued)',
    ),
    ({ client, args: [id] }) => client.campaigns.cancel(id),
  );

  act(leaf(campaigns, 'stats <id>', 'Per-campaign analytics'), ({ client, args: [id] }) =>
    client.campaigns.stats(id),
  );

  act(
    leaf(
      campaigns,
      'engagement <id>',
      'Who opened, clicked and replied (not paginated; each list is capped at 500 rows)',
    ),
    ({ client, args: [id] }) => client.campaigns.engagement(id),
  );

  act(
    leaf(campaigns, 'ab <id>', 'A/B winner evaluation for an A/B campaign'),
    ({ client, args: [id] }) => client.campaigns.ab(id),
  );

  act(leaf(campaigns, 'delete <id>', 'Delete a campaign'), ({ client, args: [id] }) =>
    client.campaigns.remove(id),
  );
}

module.exports = { register };

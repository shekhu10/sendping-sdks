<?php

declare(strict_types=1);

// ---- audiences (incl. importSheet) ----
[$mb, $t] = make_client();
$mb->audiences->create(['name' => 'General']);
check_same('audiences.create: path', '/audiences', $t->lastPath());

$mb->audiences->importSheet('aud_1', ['url' => 'https://docs.google.com/spreadsheets/d/x', 'segment_name' => 'Sheet import']);
check_same('audiences.importSheet: path', '/audiences/aud_1/contacts/import-sheet', $t->lastPath());
check_same('audiences.importSheet: body', ['url' => 'https://docs.google.com/spreadsheets/d/x', 'segment_name' => 'Sheet import'], $t->lastJson());

$mb->audiences->update('aud_1', ['name' => 'Renamed']);
check_same('audiences.update: method', 'PATCH', $t->last()['method']);
$mb->audiences->remove('aud_1');
check_same('audiences.remove: method', 'DELETE', $t->last()['method']);

// ---- contact properties ----
$mb->contactProperties->create(['key' => 'plan', 'type' => 'string', 'fallback_value' => 'free']);
check_same('contactProperties.create: path', '/contact-properties', $t->lastPath());
$mb->contactProperties->list(['limit' => 10]);
check_same('contactProperties.list: path', '/contact-properties?limit=10', $t->lastPath());
$mb->contactProperties->update('prop_1', ['fallback_value' => 'pro']);
check_same('contactProperties.update: path', '/contact-properties/prop_1', $t->lastPath());
$mb->contactProperties->remove('prop_1');
check_same('contactProperties.remove: method', 'DELETE', $t->last()['method']);

// ---- segments (domain-required) ----
$mb->segments->create(['domain' => 'yourdomain.com', 'name' => 'VIP', 'filter' => ['status' => 'subscribed']]);
check_same('segments.create: path', '/segments', $t->lastPath());
check_same('segments.create: domain in body', ['domain' => 'yourdomain.com', 'name' => 'VIP', 'filter' => ['status' => 'subscribed']], $t->lastJson());

$mb->segments->list(['domain' => 'yourdomain.com', 'limit' => 5]);
check_same('segments.list: domain query required', '/segments?domain=yourdomain.com&limit=5', $t->lastPath());

$mb->segments->contacts('seg_1');
check_same('segments.contacts: path', '/segments/seg_1/contacts', $t->lastPath());
$mb->segments->contacts('seg_1', ['limit' => 50]);
check_same('segments.contacts: pagination', '/segments/seg_1/contacts?limit=50', $t->lastPath());
$mb->segments->update('seg_1', ['name' => 'VIP+']);
check_same('segments.update: method', 'PATCH', $t->last()['method']);
$mb->segments->remove('seg_1');
check_same('segments.remove: method', 'DELETE', $t->last()['method']);

// ---- topics (domain-required) ----
$mb->topics->create(['domain' => 'yourdomain.com', 'name' => 'Product updates', 'default_subscription' => 'opt_in']);
check_same('topics.create: path', '/topics', $t->lastPath());
check_same('topics.create: domain in body', ['domain' => 'yourdomain.com', 'name' => 'Product updates', 'default_subscription' => 'opt_in'], $t->lastJson());
$mb->topics->list(['domain' => 'yourdomain.com']);
check_same('topics.list: domain query', '/topics?domain=yourdomain.com', $t->lastPath());
$mb->topics->update('top_1', ['visibility' => 'private']);
check_same('topics.update: path', '/topics/top_1', $t->lastPath());
$mb->topics->remove('top_1');
check_same('topics.remove: method', 'DELETE', $t->last()['method']);

// ---- campaigns (domain-required; empty send payload → {}) ----
$mb->campaigns->create(['domain' => 'yourdomain.com', 'from' => 'a@yourdomain.com', 'subject' => 'S', 'html' => '<p>x</p>', 'segment_id' => 'seg_1']);
check_same('campaigns.create: path', '/campaigns', $t->lastPath());
check_same('campaigns.create: domain in body', 'yourdomain.com', $t->lastJson()['domain'] ?? null);

$mb->campaigns->send('cmp_1');
check_same('campaigns.send: path', '/campaigns/cmp_1/send', $t->lastPath());
check_same('campaigns.send: empty payload serializes as {}', '{}', $t->last()['body']);

$mb->campaigns->send('cmp_1', ['scheduled_at' => '2026-08-01T00:00:00Z']);
check_same('campaigns.send: scheduled body', ['scheduled_at' => '2026-08-01T00:00:00Z'], $t->lastJson());

$mb->campaigns->cancel('cmp_1');
check_same('campaigns.cancel: path', '/campaigns/cmp_1/cancel', $t->lastPath());
$mb->campaigns->stats('cmp_1');
check_same('campaigns.stats: path', '/campaigns/cmp_1/stats', $t->lastPath());
$mb->campaigns->engagement('cmp_1');
check_same('campaigns.engagement: method', 'GET', $t->last()['method']);
check_same('campaigns.engagement: path', '/campaigns/cmp_1/engagement', $t->lastPath());
$mb->campaigns->ab('cmp_1');
check_same('campaigns.ab: path', '/campaigns/cmp_1/ab', $t->lastPath());
$mb->campaigns->remove('cmp_1');
check_same('campaigns.remove: method', 'DELETE', $t->last()['method']);

// ---- templates ----
$mb->templates->create(['name' => 'Welcome', 'subject' => 'Hi {{first_name}}', 'html' => '<p>Hi</p>']);
check_same('templates.create: path', '/templates', $t->lastPath());
$mb->templates->duplicate('tmpl_1');
check_same('templates.duplicate: path', '/templates/tmpl_1/duplicate', $t->lastPath());
check_same('templates.duplicate: empty payload serializes as {}', '{}', $t->last()['body']);
$mb->templates->publish('tmpl_1');
check_same('templates.publish: path', '/templates/tmpl_1/publish', $t->lastPath());
check_same('templates.publish: no body', null, $t->last()['body']);
$mb->templates->update('tmpl_1', ['name' => 'Welcome v2']);
check_same('templates.update: method', 'PATCH', $t->last()['method']);
$mb->templates->remove('tmpl_1');
check_same('templates.remove: method', 'DELETE', $t->last()['method']);

// ---- automations (domain REQUIRED on create) ----
$mb->automations->create(['name' => 'Welcome series', 'domain' => 'yourdomain.com', 'trigger' => 'contact.created']);
check_same('automations.create: path', '/automations', $t->lastPath());
check_same('automations.create: body', ['name' => 'Welcome series', 'domain' => 'yourdomain.com', 'trigger' => 'contact.created'], $t->lastJson());

$mb->automations->addStep('auto_1', ['type' => 'send_email', 'config' => ['template_id' => 'tmpl_welcome']]);
check_same('automations.addStep: path', '/automations/auto_1/steps', $t->lastPath());

// A step update REPLACES the step, it does not merge into it: the API re-reads
// the whole body and rejects a missing 'type' with a 422 validation_error
// BEFORE it ever inspects 'config'. So a type-less PATCH is not "leave the type
// alone", it is an error every time — the key must be on the wire.
$mb->automations->updateStep('auto_1', 'step_2', ['type' => 'delay', 'config' => ['duration' => '3 days']]);
check_same('automations.updateStep: method', 'PATCH', $t->last()['method']);
check_same('automations.updateStep: path', '/automations/auto_1/steps/step_2', $t->lastPath());
check('automations.updateStep: type on the wire (a type-less body is a 422)', array_key_exists('type', $t->lastJson()));
check_same('automations.updateStep: body', ['type' => 'delay', 'config' => ['duration' => '3 days']], $t->lastJson());

$mb->automations->deleteStep('auto_1', 'step_2');
check_same('automations.deleteStep: method', 'DELETE', $t->last()['method']);
check_same('automations.deleteStep: path', '/automations/auto_1/steps/step_2', $t->lastPath());

$mb->automations->createWithAi('auto_1', ['prompt' => 'Welcome new signups over 3 days']);
check_same('automations.createWithAi: method', 'POST', $t->last()['method']);
check_same('automations.createWithAi: path', '/automations/auto_1/ai', $t->lastPath());
check_same('automations.createWithAi: body', ['prompt' => 'Welcome new signups over 3 days'], $t->lastJson());

$mb->automations->runs('auto_1', ['limit' => 25]);
check_same('automations.runs: path', '/automations/auto_1/runs?limit=25', $t->lastPath());

$mb->automations->runs('auto_1', ['status' => 'failed,running']);
check_same('automations.runs: status filter', '/automations/auto_1/runs?status=failed%2Crunning', $t->lastPath());

$mb->automations->getRun('auto_1', 'run_1');
check_same('automations.getRun: path', '/automations/auto_1/runs/run_1', $t->lastPath());

$mb->automations->stop('auto_1');
check_same('automations.stop: path', '/automations/auto_1/stop', $t->lastPath());
$mb->automations->update('auto_1', ['status' => 'enabled']);
check_same('automations.update: method', 'PATCH', $t->last()['method']);
$mb->automations->remove('auto_1');
check_same('automations.remove: method', 'DELETE', $t->last()['method']);

// ---- webhooks (HTTP endpoints; verify() is covered in WebhookVerifyTest) ----
$mb->webhooks->create(['endpoint' => 'https://yourapp.com/hooks', 'events' => ['email.delivered']]);
check_same('webhooks.create: path', '/webhooks', $t->lastPath());
$mb->webhooks->rotate('wh_1');
check_same('webhooks.rotate: path', '/webhooks/wh_1/rotate', $t->lastPath());
$mb->webhooks->test('wh_1');
check_same('webhooks.test: path', '/webhooks/wh_1/test', $t->lastPath());
// A FAILED test delivery is still HTTP 200 — it must not throw, and the real
// outcome is 'ok', never the status code.
$t->queue(200, ['object' => 'webhook_test', 'id' => 'wh_1', 'ok' => false, 'error' => 'lookup_failed']);
$failed = $mb->webhooks->test('wh_1');
check_same('webhooks.test: failed delivery reports ok=false', false, $failed['ok']);
check_same('webhooks.test: failed delivery names the reason', 'lookup_failed', $failed['error']);
check('webhooks.test: failed delivery carries no endpoint status', !isset($failed['status']));
$t->queue(200, ['object' => 'webhook_test', 'id' => 'wh_1', 'ok' => true, 'status' => 200]);
$delivered = $mb->webhooks->test('wh_1');
check_same('webhooks.test: successful delivery reports ok=true', true, $delivered['ok']);
check_same('webhooks.test: successful delivery carries the endpoint status', 200, $delivered['status']);
$mb->webhooks->update('wh_1', ['status' => 'disabled']);
check_same('webhooks.update: method', 'PATCH', $t->last()['method']);
$mb->webhooks->remove('wh_1');
check_same('webhooks.remove: method', 'DELETE', $t->last()['method']);

// ---- events (domain REQUIRED on send) ----
$mb->events->send(['event' => 'signup.completed', 'domain' => 'yourdomain.com', 'email' => 'user@example.com', 'payload' => ['plan' => 'pro']]);
check_same('events.send: path', '/events/send', $t->lastPath());
check_same('events.send: body', ['event' => 'signup.completed', 'domain' => 'yourdomain.com', 'email' => 'user@example.com', 'payload' => ['plan' => 'pro']], $t->lastJson());
// No options => no header at all.
check('events.send: no idempotency header by default', !array_filter(
    $t->last()['headers'],
    static fn (string $h): bool => str_starts_with($h, 'Idempotency-Key:')
));

// The $options parameter is still part of the signature (it is shared with
// every other resource) and a key given here is still forwarded — but only
// /emails and /emails/batch HONOUR the header, so this buys nothing. The
// docblock says so; the parameter stays so existing call sites keep working.
$mb->events->send(
    ['event' => 'signup.completed', 'domain' => 'yourdomain.com', 'email' => 'user@example.com'],
    ['idempotencyKey' => 'evt-1']
);
check('events.send: accepts and forwards an idempotency key', in_array('Idempotency-Key: evt-1', $t->last()['headers'], true));

$mb->events->create(['name' => 'signup.completed', 'schema' => ['plan' => 'string']]);
check_same('events.create: path', '/events', $t->lastPath());
$mb->events->create(['name' => 'signup.completed'], ['idempotencyKey' => 'evt-2']);
check('events.create: accepts and forwards an idempotency key', in_array('Idempotency-Key: evt-2', $t->last()['headers'], true));
$mb->events->list(['limit' => 10]);
check_same('events.list: path', '/events?limit=10', $t->lastPath());
$mb->events->update('evt_1', ['schema' => ['plan' => 'string']]);
check_same('events.update: method', 'PATCH', $t->last()['method']);
check_same('events.update: path', '/events/evt_1', $t->lastPath());
check_same('events.update: body', ['schema' => ['plan' => 'string']], $t->lastJson());
$mb->events->remove('evt_1');
check_same('events.remove: path', '/events/evt_1', $t->lastPath());

// ---- api keys (listing only; lifecycle is dashboard-only) ----
$mb->apiKeys->list();
check_same('apiKeys.list: path', '/api-keys', $t->lastPath());
$mb->apiKeys->list(['limit' => 5]);
check_same('apiKeys.list: pagination', '/api-keys?limit=5', $t->lastPath());
foreach (['create', 'update', 'remove', 'delete', 'revoke'] as $absent) {
    check(
        "apiKeys.$absent: absent (key lifecycle is dashboard-only)",
        !method_exists($mb->apiKeys, $absent)
    );
}

// ---- logs (method/status filters) ----
$mb->logs->list(['limit' => 100, 'method' => 'POST', 'status' => 429]);
check_same('logs.list: filters in query', '/logs?limit=100&method=POST&status=429', $t->lastPath());
$mb->logs->get('log_1');
check_same('logs.get: path', '/logs/log_1', $t->lastPath());

// ---- polls ----
$mb->polls->list(['limit' => 10]);
check_same('polls.list: path', '/polls?limit=10', $t->lastPath());
$mb->polls->get('em_1');
check_same('polls.get: path', '/polls/em_1', $t->lastPath());

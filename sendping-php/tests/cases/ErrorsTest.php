<?php

declare(strict_types=1);

use SendPing\Exceptions\SendPingException;

// ---- API error shape is surfaced on the exception ----
[$mb, $t] = make_client();
$t->queue(422, ['statusCode' => 422, 'name' => 'validation_error', 'message' => 'domain is required']);
$caught = null;
try {
    $mb->segments->create(['name' => 'VIP']);
} catch (SendPingException $e) {
    $caught = $e;
}
check('errors: SendPingException thrown on 422', $caught instanceof SendPingException);
check_same('errors: statusCode', 422, $caught?->getStatusCode());
check_same('errors: name', 'validation_error', $caught?->getName());
check_same('errors: message', 'domain is required', $caught?->getMessage());
// An ordinary error carries none of the additive fields.
check_same('errors: ordinary error has no limit', null, $caught?->getLimit());
check_same('errors: ordinary error has no reputation', null, $caught?->getReputation());
check_same('errors: ordinary error has no sent list', null, $caught?->getSent());
check_same('errors: ordinary error has no sent_count', null, $caught?->getSentCount());

// ---- plan/quota errors say WHICH quota was hit ----
[$mb, $t] = make_client();
$t->queue(429, [
    'statusCode' => 429,
    'name' => 'daily_quota_exceeded',
    'message' => 'Daily send quota reached.',
    'limit' => [
        'kind' => 'emails_daily', 'used' => 100, 'limit' => 100,
        'requested' => 3, 'remaining' => 0, 'period' => '24h',
        'plan' => ['id' => 'free', 'name' => 'Free'],
        'next_plan' => ['id' => 'pro', 'name' => 'Pro', 'amount' => 1400, 'currency' => 'USD'],
        'credits' => ['balance' => 0, 'needed' => 1, 'purchasable' => true,
                      'unit' => 1000, 'amount_per_unit_cents' => 100],
    ],
]);
$caught = null;
try {
    $mb->emails->send(['from' => 'a@acme.com', 'to' => 'b@example.com', 'subject' => 's']);
} catch (SendPingException $e) {
    $caught = $e;
}
check_same('errors: quota statusCode', 429, $caught?->getStatusCode());
check_same('errors: quota name', 'daily_quota_exceeded', $caught?->getName());
check_same('errors: quota kind', 'emails_daily', $caught?->getLimit()['kind'] ?? null);
check_same('errors: quota used', 100, $caught?->getLimit()['used'] ?? null);
check_same('errors: quota limit', 100, $caught?->getLimit()['limit'] ?? null);
check_same('errors: quota period', '24h', $caught?->getLimit()['period'] ?? null);
check_same('errors: quota next plan', 'Pro', $caught?->getLimit()['next_plan']['name'] ?? null);
check_same('errors: quota credits purchasable', true, $caught?->getLimit()['credits']['purchasable'] ?? null);
// The whole body stays reachable for anything newer than this SDK.
check_same('errors: quota body retained', 'daily_quota_exceeded', $caught?->getBody()['name'] ?? null);
check_same('errors: quota is not a reputation error', null, $caught?->getReputation());

// ---- reputation gates expose the gate detail ----
[$mb, $t] = make_client();
$t->queue(429, [
    'statusCode' => 429,
    'name' => 'reputation_limit_exceeded',
    'message' => 'Sending is rate limited.',
    'reputation' => [
        'retryable' => true, 'scope' => 'domain', 'status' => 'warming',
        'scope_key' => 'acme.com', 'hourly_limit' => 50, 'hourly_used' => 50,
        'retry_at' => '2026-08-08T12:00:00.000Z',
    ],
]);
$caught = null;
try {
    $mb->emails->send(['from' => 'a@acme.com', 'to' => 'b@example.com', 'subject' => 's']);
} catch (SendPingException $e) {
    $caught = $e;
}
check_same('errors: reputation retryable', true, $caught?->getReputation()['retryable'] ?? null);
check_same('errors: reputation scope', 'domain', $caught?->getReputation()['scope'] ?? null);
check_same('errors: reputation scope_key', 'acme.com', $caught?->getReputation()['scope_key'] ?? null);
check_same('errors: reputation retry_at', '2026-08-08T12:00:00.000Z', $caught?->getReputation()['retry_at'] ?? null);
check_same('errors: reputation is not a limit error', null, $caught?->getLimit());

// ---- a partial batch failure names the emails that already went out ----
[$mb, $t] = make_client();
$t->queue(429, [
    'statusCode' => 429,
    'name' => 'daily_quota_exceeded',
    'message' => 'Daily send quota reached.',
    'limit' => ['kind' => 'emails_daily', 'used' => 100, 'limit' => 100],
    'sent' => [['id' => 'em_1'], ['id' => 'em_2']],
    'sent_count' => 2,
]);
$caught = null;
try {
    $mb->batch->send([['from' => 'a@acme.com', 'to' => 'b@example.com', 'subject' => 's']],
        ['idempotencyKey' => 'batch-1']);
} catch (SendPingException $e) {
    $caught = $e;
}
check_same('errors: partial batch sent_count', 2, $caught?->getSentCount());
check_same('errors: partial batch sent ids', ['em_1', 'em_2'], array_column($caught?->getSent() ?? [], 'id'));
check_same('errors: partial batch limit kind', 'emails_daily', $caught?->getLimit()['kind'] ?? null);

// ---- sent_count falls back to the sent list when the body omits it ----
[$mb, $t] = make_client();
$t->queue(429, ['statusCode' => 429, 'name' => 'monthly_quota_exceeded',
                'message' => 'Monthly send quota reached.', 'sent' => [['id' => 'em_1']]]);
$caught = null;
try {
    $mb->emails->get('em_1');
} catch (SendPingException $e) {
    $caught = $e;
}
check_same('errors: sent_count falls back to the sent list', 1, $caught?->getSentCount());

// ---- an additive field of an unknown shape does not cost the caller the error ----
[$mb, $t] = make_client();
$t->queue(402, ['statusCode' => 402, 'name' => 'plan_limit_reached',
                'message' => 'Domain cap reached.', 'limit' => 'soon']);
$caught = null;
try {
    $mb->emails->get('em_1');
} catch (SendPingException $e) {
    $caught = $e;
}
check_same('errors: unknown-shape limit keeps the envelope', 402, $caught?->getStatusCode());
check_same('errors: unknown-shape limit keeps the name', 'plan_limit_reached', $caught?->getName());
check_same('errors: unknown-shape limit reads as absent', null, $caught?->getLimit());
check_same('errors: unknown-shape limit still in body', 'soon', $caught?->getBody()['limit'] ?? null);

// ---- non-JSON error body falls back to HTTP status defaults ----
[$mb, $t] = make_client();
$t->queue(500, 'Internal Server Error');
$caught = null;
try {
    $mb->emails->get('em_1');
} catch (SendPingException $e) {
    $caught = $e;
}
check('errors: exception on non-JSON 500', $caught instanceof SendPingException);
check_same('errors: fallback statusCode', 500, $caught?->getStatusCode());
check_same('errors: fallback name', 'application_error', $caught?->getName());
check_same('errors: fallback message', 'Request failed with status 500', $caught?->getMessage());

// ---- raw (binary) routes also raise parsed API errors ----
[$mb, $t] = make_client();
$t->queue(404, ['statusCode' => 404, 'name' => 'not_found', 'message' => 'Attachment not found']);
$caught = null;
try {
    $mb->emails->receiving->getAttachment('rcv_1', 'att_missing');
} catch (SendPingException $e) {
    $caught = $e;
}
check_same('errors: raw route name', 'not_found', $caught?->getName());
check_same('errors: raw route statusCode', 404, $caught?->getStatusCode());

// ---- empty API key rejected client-side ----
$caught = null;
try {
    \SendPing\SendPing::client('');
} catch (\InvalidArgumentException $e) {
    $caught = $e;
}
check('errors: empty API key throws InvalidArgumentException', $caught instanceof \InvalidArgumentException);

// ---- custom baseUrl (trailing slash trimmed) ----
$transport = new \SendPing\Tests\FakeTransport();
$mb = \SendPing\SendPing::client('mb_test_key', [
    'transport' => $transport,
    'baseUrl' => 'https://api.staging.sendping.co/',
]);
$mb->emails->get('em_1');
check_same('client: custom baseUrl', 'https://api.staging.sendping.co/emails/em_1', $transport->last()['url']);

// ---- default base URL ----
[$mb, $t] = make_client();
$mb->emails->get('em_1');
check('client: default base URL', str_starts_with($t->last()['url'], 'https://www.sendping.co/api/'));
check('client: user-agent header present', in_array('User-Agent: sendping-php/' . \SendPing\SendPing::VERSION, $t->last()['headers'], true));
check_same('client: version', '1.0.0', \SendPing\SendPing::VERSION);

// The API rejects a blank User-Agent with a 403 before authenticating, so every
// request — JSON and raw/binary alike — must carry a non-empty one.
$uaOf = static function (array $request): string {
    foreach ($request['headers'] as $header) {
        if (str_starts_with($header, 'User-Agent: ')) {
            return trim(substr($header, strlen('User-Agent: ')));
        }
    }
    return '';
};
check('client: user-agent is non-empty on JSON requests', $uaOf($t->last()) !== '');
$t->queue(200, 'RAWBYTES');
$mb->emails->receiving->getRaw('rcv_1');
check('client: user-agent is non-empty on raw requests', $uaOf($t->last()) !== '');

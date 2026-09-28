<?php

declare(strict_types=1);

namespace SendPing\Resources;

use SendPing\Client;

/**
 * Automations — multi-step workflows triggered by events.
 * DOMAIN-FIRST: 'domain' is REQUIRED on create; only `events->send()` calls
 * with the same 'domain' trigger the automation, so the same event name across
 * several products can never trigger the wrong one.
 */
class Automations extends Resource
{
    /**
     * Create an automation. POST /automations
     *
     * @param array $payload ['name' => …, 'domain' => REQUIRED,
     *                       'trigger' => 'contact.created' | 'sendping:schedule' |
     *                                    'email.opened' | 'email.clicked' |
     *                                    'email.replied' | 'email.bounced' |
     *                                    'email.delivered' | any custom event name,
     *                       'trigger_config' => ['at' => ISO 8601 instant,
     *                                            'timezone' => IANA name]
     *                                           (required with the
     *                                           'sendping:schedule' trigger;
     *                                           not accepted on any other),
     *                       'status' => 'enabled'|'disabled' (default 'disabled'),
     *                       'steps' => [['key' => …, 'type' => …, 'config' => …], …],
     *                       'connections' => [['from' => …, 'to' => …, 'type' => …], …]]
     */
    public function create(array $payload): array
    {
        return $this->client->request('POST', '/automations', $payload);
    }

    /** Retrieve an automation (steps, connections, enrollments). GET /automations/:id */
    public function get(string $id): array
    {
        return $this->client->request('GET', '/automations/' . Client::e($id));
    }

    /**
     * List automations. GET /automations
     *
     * @param array $params Cursor pagination: limit, after, before.
     */
    public function list(array $params = []): array
    {
        return $this->client->request('GET', '/automations' . $this->paginationQuery($params));
    }

    /**
     * Update an automation (name/status/domain/trigger_config/connections).
     * 'trigger_config' (['at' => …, 'timezone' => …]) updates the
     * 'sendping:schedule' trigger's schedule (only valid on automations with
     * that trigger). PATCH /automations/:id
     */
    public function update(string $id, array $payload): array
    {
        return $this->client->request('PATCH', '/automations/' . Client::e($id), $payload);
    }

    /**
     * Append a step to an automation. The automation must be disabled first
     * (stop it with {@see stop()}). POST /automations/:id/steps
     *
     * @param array $payload ['type' => 'delay'|'send_email'|'wait_for_event'|
     *                                  'condition'|'split'|'add_to_segment'|
     *                                  'contact_update'|'contact_delete',
     *                       'config' => …, 'key' => …]
     *                       The trigger is set on the automation, not added as
     *                       a step — type 'trigger' is a 422 here.
     */
    public function addStep(string $id, array $payload): array
    {
        return $this->client->request('POST', '/automations/' . Client::e($id) . '/steps', $payload);
    }

    /**
     * Update a step. The automation must be disabled first. The step is
     * REPLACED, not merged: the API re-validates the whole body and overwrites
     * type + config, so send 'type' and the complete 'config' every time —
     * anything left out of 'config' is dropped, not preserved.
     * PATCH /automations/:id/steps/:stepId
     *
     * @param array $payload ['type' => REQUIRED, same values as {@see addStep()};
     *                                  omitting it is a 422 validation_error,
     *                                  not "leave the type unchanged",
     *                       'config' => …]
     *                       A step's graph key is fixed at creation and is
     *                       IGNORED here — set it via addStep(), or delete and
     *                       re-add the step. Sending one changes nothing, and
     *                       the response echoes the EXISTING key back, so a
     *                       failed re-key is invisible.
     */
    public function updateStep(string $id, string $stepId, array $payload): array
    {
        return $this->client->request(
            'PATCH',
            '/automations/' . Client::e($id) . '/steps/' . Client::e($stepId),
            $payload
        );
    }

    /** Delete a step from an automation. DELETE /automations/:id/steps/:stepId */
    public function deleteStep(string $id, string $stepId): array
    {
        return $this->client->request(
            'DELETE',
            '/automations/' . Client::e($id) . '/steps/' . Client::e($stepId)
        );
    }

    /**
     * Build (or extend) an automation's steps with AI. The automation must be
     * stopped. Limited to 20 requests per minute per account.
     * POST /automations/:id/ai
     *
     * @param array $payload ['prompt' => REQUIRED (max 2000 chars),
     *                       'template_ids' => [ … ] (first 10 used),
     *                       'events' => [ … ] (first 10 used),
     *                       'attach' => ['from' => trigger or step key,
     *                                    'type' => 'default'|'condition_met'|
     *                                              'condition_not_met'|
     *                                              'event_received'|'timeout',
     *                                    'before' => step key]]
     *                       Without 'attach' the automation must have no steps
     *                       yet; with it, the generated steps are spliced in.
     */
    public function createWithAi(string $id, array $payload): array
    {
        return $this->client->request('POST', '/automations/' . Client::e($id) . '/ai', $payload);
    }

    /**
     * List an automation's runs. GET /automations/:id/runs
     *
     * @param array $params Cursor pagination (limit, after, before) plus an
     *                      optional 'status' filter — a comma-separated list of
     *                      run statuses ('running', 'completed', 'failed',
     *                      'skipped'), applied before pagination.
     */
    public function runs(string $id, array $params = []): array
    {
        return $this->client->request(
            'GET',
            '/automations/' . Client::e($id) . '/runs' . $this->paginationQuery($params, ['status'])
        );
    }

    /** Retrieve a single automation run (with its step trace). GET /automations/:id/runs/:runId */
    public function getRun(string $id, string $runId): array
    {
        return $this->client->request(
            'GET',
            '/automations/' . Client::e($id) . '/runs/' . Client::e($runId)
        );
    }

    /** Stop an automation — prevents new runs; in-progress runs finish. POST /automations/:id/stop */
    public function stop(string $id): array
    {
        return $this->client->request('POST', '/automations/' . Client::e($id) . '/stop');
    }

    /** Delete an automation. DELETE /automations/:id */
    public function remove(string $id): array
    {
        return $this->client->request('DELETE', '/automations/' . Client::e($id));
    }
}

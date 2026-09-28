<?php

declare(strict_types=1);

namespace SendPing\Exceptions;

/**
 * Thrown for every non-2xx API response (and transport-level failures).
 *
 * Carries the API error shape: `statusCode`, `name`, `message`.
 *
 * Branch on {@see getName()} together with {@see getStatusCode()}, never on the
 * message: message text is scrubbed of provider identifiers server-side and is
 * not a stable contract, and a handler may answer with a status other than the
 * one a name usually maps to.
 *
 * Some errors are a superset of that envelope. The whole parsed body is kept on
 * {@see getBody()}, with the common extras surfaced as accessors that return
 * null on an ordinary error:
 *
 * - {@see getLimit()} — plan/quota rejections (`plan_limit_reached`,
 *   `*_quota_exceeded`, `contact_limit_reached`, `ai_credits_exceeded`) say
 *   WHICH cap was hit and what would clear it.
 * - {@see getReputation()} — reputation gates (`reputation_paused`,
 *   `reputation_limit_exceeded`).
 * - {@see getSent()} / {@see getSentCount()} — a `POST /emails/batch` that
 *   failed part way through, naming the emails that DID go out.
 */
class SendPingException extends \Exception
{
    /**
     * @param array<string, mixed> $body The full parsed error body ([] when the
     *                                   response was not a JSON object).
     */
    public function __construct(
        string $message,
        private readonly int $statusCode = 0,
        private readonly string $errorName = 'application_error',
        private readonly array $body = [],
    ) {
        parent::__construct($message);
    }

    /**
     * Build an exception from a decoded API error body
     * (`{ statusCode, name, message }`), falling back to the HTTP status. The
     * whole body is retained, so the additive `limit` / `reputation` / `sent`
     * fields survive.
     *
     * @param array<string, mixed> $body
     */
    public static function fromResponse(int $httpStatus, array $body): self
    {
        $message = isset($body['message']) && is_string($body['message'])
            ? $body['message']
            : "Request failed with status {$httpStatus}";
        $statusCode = $httpStatus;
        $name = isset($body['name']) && is_string($body['name'])
            ? $body['name']
            : 'application_error';

        return new self($message, $statusCode, $name, $body);
    }

    /** The HTTP status code (0 for network-level errors). */
    public function getStatusCode(): int
    {
        return $this->statusCode;
    }

    /** The machine-readable API error name, e.g. 'validation_error'. */
    public function getName(): string
    {
        return $this->errorName;
    }

    /**
     * The full parsed error body — [] when the response was not a JSON object.
     * Read it for any additive field newer than this SDK version.
     *
     * @return array<string, mixed>
     */
    public function getBody(): array
    {
        return $this->body;
    }

    /** Original email for a failed or unconfirmed send; inspect before resending. */
    public function getId(): ?string
    {
        $value = $this->body['id'] ?? null;
        return is_string($value) ? $value : null;
    }

    /** @return null|list<array{id: string}> Reserved prefix, including uncertain sends. */
    public function getReserved(): ?array { return $this->arrayField('reserved'); }

    /** Number of never-attempted batch items, distinct from uncertain reserved items. */
    public function getUnsentCount(): ?int
    {
        $value = $this->body['unsent_count'] ?? null;
        return is_int($value) ? $value : null;
    }

    /**
     * The plan/quota cap this request hit, or null when the error is not a
     * limit error. `kind` says WHICH quota ran out; `next_plan` is null when
     * only Enterprise would fit, and `credits` is present only for the
     * email-quota kinds.
     *
     * @return null|array{
     *     kind: string, used: int, limit: int, requested?: int, remaining?: int,
     *     period?: string, plan?: array{id: string, name: string},
     *     next_plan?: null|array{id: string, name: string, amount: int, currency: string,
     *                            monthly_emails: int, daily_emails: int, domains: int,
     *                            contacts: int, ai_credits: int, automation_runs: int},
     *     credits?: array{balance: int, needed: int, purchasable: bool,
     *                     unit: int, amount_per_unit_cents: int}
     * }
     */
    public function getLimit(): ?array
    {
        return $this->arrayField('limit');
    }

    /**
     * The reputation-gate detail on `reputation_paused` /
     * `reputation_limit_exceeded`, else null.
     *
     * @return null|array{
     *     retryable: bool, scope?: string, status?: string, scope_key?: string,
     *     hourly_limit?: int, daily_limit?: int, hourly_used?: int, daily_used?: int,
     *     retry_at?: string, support_email?: string
     * }
     */
    public function getReputation(): ?array
    {
        return $this->arrayField('reputation');
    }

    /**
     * The emails that were already sent before a batch failed part way through
     * (`POST /emails/batch` with an `idempotencyKey`), else null. Do NOT resend
     * these.
     *
     * @return null|list<array{id: string}>
     */
    public function getSent(): ?array
    {
        $value = $this->body['sent'] ?? null;

        return is_array($value) ? $value : null;
    }

    /**
     * How many emails went out before a batch failed part way through, else
     * null. Falls back to {@see getSent()}'s length when the body carried the
     * list but not the count.
     */
    public function getSentCount(): ?int
    {
        $count = $this->body['sent_count'] ?? null;
        if (is_int($count)) {
            return $count;
        }
        $sent = $this->getSent();

        return $sent === null ? null : count($sent);
    }

    /** @return null|array<string, mixed> */
    private function arrayField(string $key): ?array
    {
        $value = $this->body[$key] ?? null;

        return is_array($value) ? $value : null;
    }
}

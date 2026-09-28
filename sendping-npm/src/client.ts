import type { SendPingError, Result, RequestOptions } from './types';

export const DEFAULT_BASE_URL = 'https://www.sendping.co/api';

/** Keep in sync with package.json "version". */
export const VERSION = '1.0.0';
export const USER_AGENT = `sendping-node/${VERSION}`;

/**
 * Max length of an `Idempotency-Key` accepted by the API (1–255 characters
 * after trimming — the storage column width). A longer or empty key is
 * rejected with `400 invalid_idempotency_key`.
 */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

export interface ClientConfig {
  baseUrl?: string;
  /** Override the fetch implementation (e.g. for tests or older runtimes). */
  fetch?: typeof fetch;
  /** Per-request timeout in milliseconds. Default 30000 (30s). 0 disables it. */
  timeoutMs?: number;
  /**
   * Max automatic retries on a rate-limit (429) or service-unavailable (503)
   * response when no partial/uncertain work is reported. Generic 503 writes
   * need send idempotency or a documented pre-application rejection. Honors `Retry-After`,
   * else exponential backoff. Default 2 (→ up to 3 attempts). 0 disables retries.
   */
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([429, 503]);
const PRE_APPLICATION_ERRORS = new Set(['service_unavailable', 'sending_service_unavailable',
  'sending_configuration_unavailable', 'contacts_busy', 'contacts_timeout']);

function retryAllowed(status: number, body: unknown, method: string, path: string, key?: string): boolean {
  const error = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  if ((typeof error.id === 'string' && error.id.length > 0)
    || (typeof error.sent_count === 'number' && error.sent_count > 0)
    || (Array.isArray(error.sent) && error.sent.length > 0)
    || (Array.isArray(error.reserved) && error.reserved.length > 0)
    || error.name === 'batch_incomplete') return false;
  if (status !== 503 || method === 'GET' || method === 'HEAD') return true;
  return PRE_APPLICATION_ERRORS.has(String(error.name)) || (method === 'POST' && !!key?.trim()
    && /^\/emails(?:\/batch|\/receiving\/[^/]+\/(?:reply|forward))?$/.test(path));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) → ms, capped at 30s. */
function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.min(Math.max(0, secs * 1000), 30_000);
  const when = Date.parse(header);
  if (!Number.isNaN(when)) return Math.min(Math.max(0, when - Date.now()), 30_000);
  return null;
}

/** Decode a response body as JSON, falling back to the raw text. */
function parseBody(text: string): unknown {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Normalize an error response into {@link SendPingError}.
 *
 * The API's envelope is `{ statusCode, name, message }`, but some errors carry
 * additive fields — `limit` on plan/quota rejections, `reputation` on
 * reputation gates, `sent`/`sent_count` on a partial batch failure — which are
 * preserved verbatim. One non-envelope shape also exists: the CSRF gate answers
 * `{"error":"csrf_failed"|"csrf_origin"}`. A Bearer request never trips it, but
 * the `error` string is lifted into `name` anyway so any such body can still be
 * branched on rather than collapsing to `application_error`.
 *
 * `sent_count` falls back to `sent.length` when the body names the emails that
 * went out but omits the count, so a caller deciding what NOT to resend never
 * has to compute it. It stays absent on errors that carry no `sent` list.
 */
function toError(parsed: unknown, status: number): SendPingError {
  const body = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const { statusCode, name, message, error, ...rest } = body;
  const sent = rest.sent;
  if (Array.isArray(sent) && typeof rest.sent_count !== 'number') {
    rest.sent_count = sent.length;
  }
  return {
    ...rest,
    // Trust the transport status; `statusCode` in the body always mirrors it.
    statusCode: status,
    name: typeof name === 'string' ? name : typeof error === 'string' ? error : 'application_error',
    message: typeof message === 'string' ? message : `Request failed with status ${status}`,
  };
}

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(apiKey: string, config: ClientConfig = {}) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('SendPing: an API key is required, e.g. new SendPing("mb_...").');
    }
    this.apiKey = apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const f = config.fetch ?? (globalThis.fetch as typeof fetch | undefined);
    if (!f) {
      throw new Error('SendPing: no global fetch available. Use Node 18+ or pass { fetch } in the options.');
    }
    this.fetchImpl = f;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || !Number.isFinite(config.maxRetries ?? DEFAULT_MAX_RETRIES)) {
      throw new RangeError('SendPing: timeoutMs and maxRetries must be finite numbers.');
    }
    this.maxRetries = Math.max(0, Math.floor(config.maxRetries ?? DEFAULT_MAX_RETRIES));
  }

  /** Issue the fetch with a timeout, retrying only 429/503 (Retry-After aware). */
  private async send(path: string, init: RequestInit, raw = false): Promise<{status: number; ok: boolean; body: string | ArrayBuffer}> {
    for (let attempt = 0; ; attempt++) {
      const signal = this.timeoutMs > 0 ? AbortSignal.timeout(this.timeoutMs) : undefined;
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal, redirect: 'manual' });
      // Consume every response under the same attempt's timeout. This closes
      // retry bodies and keeps body-read failures inside the Result boundary.
      const body = raw && res.ok ? await res.arrayBuffer() : await res.text();
      const key = (init.headers as Record<string, string>)['Idempotency-Key'];
      if (!RETRYABLE_STATUS.has(res.status) || attempt >= this.maxRetries
        || !retryAllowed(res.status, parseBody(String(body)), init.method!, path, key)) {
        return { status: res.status, ok: res.ok, body };
      }
      const wait = retryAfterMs(res.headers.get('retry-after')) ?? Math.min(30_000, 500 * 2 ** attempt);
      await sleep(wait);
    }
  }

  async request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<Result<T>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    };
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    let res: Awaited<ReturnType<HttpClient['send']>>;
    try {
      res = await this.send(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      return { data: null, error: { statusCode: 0, name: 'network_error', message: (err as Error).message } };
    }

    const parsed = parseBody(res.body as string);
    if (!res.ok) return { data: null, error: toError(parsed, res.status) };
    return { data: parsed as T, error: null };
  }

  /**
   * Like `request`, but for endpoints that return plain text rather than JSON
   * (e.g. a domain's DNS records as CSV). Errors are still the JSON envelope.
   */
  async requestText(method: string, path: string): Promise<Result<string>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'User-Agent': USER_AGENT,
    };

    let res: Awaited<ReturnType<HttpClient['send']>>;
    try {
      res = await this.send(path, { method, headers });
    } catch (err) {
      return { data: null, error: { statusCode: 0, name: 'network_error', message: (err as Error).message } };
    }

    const text = res.body as string;
    if (!res.ok) return { data: null, error: toError(parseBody(text), res.status) };
    return { data: text, error: null };
  }

  /**
   * Like `request`, but for endpoints that stream raw binary bytes (e.g. a
   * received-email attachment download). On success returns the response body
   * as an ArrayBuffer; on error parses the JSON error body like `request`.
   */
  async requestRaw(method: string, path: string, options: RequestOptions = {}): Promise<Result<ArrayBuffer>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'User-Agent': USER_AGENT,
    };
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    let res: Awaited<ReturnType<HttpClient['send']>>;
    try {
      res = await this.send(path, { method, headers }, true);
    } catch (err) {
      return { data: null, error: { statusCode: 0, name: 'network_error', message: (err as Error).message } };
    }

    if (!res.ok) return { data: null, error: toError(parseBody(res.body as string), res.status) };
    return { data: res.body as ArrayBuffer, error: null };
  }
}

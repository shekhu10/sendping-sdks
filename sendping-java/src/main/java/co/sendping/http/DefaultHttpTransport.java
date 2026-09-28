package co.sendping.http;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;

/**
 * Default {@link HttpTransport} backed by {@code java.net.http.HttpClient} (Java 11+).
 *
 * <p>Every request carries a configurable timeout (default 30s, applied as both the
 * client connect timeout and the per-request timeout; a non-positive/null value means
 * "no timeout"). The single {@link #execute} chokepoint also performs bounded automatic
 * retries — up to {@code maxRetries} extra attempts (default 2, so 3 total) — but ONLY
 * on eligible HTTP {@code 429} and {@code 503} responses. Partial work stops retries;
 * writes need a pre-processing rejection or a supported operation key.
 * Network errors, timeouts and other 5xx statuses
 * are never retried. Between retries it honors a {@code Retry-After} header (delta-seconds
 * or HTTP-date, capped at 30s), falling back to exponential backoff
 * {@code min(30s, 0.5s * 2^attempt)}.
 */
public final class DefaultHttpTransport implements HttpTransport {
    /** Default connect + per-request timeout. A non-positive/null value disables timeouts. */
    public static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(30);
    /** Default number of automatic retries (total attempts = maxRetries + 1). */
    public static final int DEFAULT_MAX_RETRIES = 2;
    /** Upper bound on any single wait between retries. */
    private static final long MAX_BACKOFF_MS = 30_000L;

    private final HttpClient client;
    private final Duration requestTimeout;
    private final int maxRetries;

    /** Default transport: 30s timeout, up to 2 retries on 429/503. */
    public DefaultHttpTransport() {
        this(DEFAULT_TIMEOUT, DEFAULT_MAX_RETRIES);
    }

    /**
     * @param timeout    connect + per-request timeout; {@code null} or non-positive disables it
     * @param maxRetries extra attempts on 429/503 (0 disables retries)
     */
    public DefaultHttpTransport(Duration timeout, int maxRetries) {
        this(buildClient(timeout), timeout, maxRetries);
    }

    /** Kept for back-compat / tests that inject a client; defaults to {@value #DEFAULT_MAX_RETRIES} retries. */
    public DefaultHttpTransport(HttpClient client, Duration requestTimeout) {
        this(client, requestTimeout, DEFAULT_MAX_RETRIES);
    }

    public DefaultHttpTransport(HttpClient client, Duration requestTimeout, int maxRetries) {
        this.client = client;
        this.requestTimeout = requestTimeout;
        this.maxRetries = Math.max(0, maxRetries);
    }

    private static HttpClient buildClient(Duration timeout) {
        HttpClient.Builder b = HttpClient.newBuilder();
        if (isPositive(timeout)) b.connectTimeout(timeout);
        return b.build();
    }

    private static boolean isPositive(Duration d) {
        return d != null && !d.isZero() && !d.isNegative();
    }

    @Override
    public HttpResult execute(String method, String url, Map<String, String> headers, String body) throws Exception {
        for (int attempt = 0; ; attempt++) {
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .method(method, body == null
                            ? HttpRequest.BodyPublishers.noBody()
                            : HttpRequest.BodyPublishers.ofString(body));
            if (isPositive(requestTimeout)) {
                builder.timeout(requestTimeout);
            }
            for (Map.Entry<String, String> e : headers.entrySet()) {
                builder.header(e.getKey(), e.getValue());
            }

            HttpResponse<byte[]> res = client.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
            int status = res.statusCode();

            if (!isRetryable(status) || attempt >= maxRetries || !retryAllowed(method, url, headers, status, res.body())) {
                return new HttpResult(status, res.body());
            }

            long wait = waitMs(res.headers().firstValue("Retry-After").orElse(null), attempt);
            if (wait > 0) {
                Thread.sleep(wait);
            }
        }
    }

    private static boolean retryAllowed(String method, String url, Map<String, String> headers, int status, byte[] raw) {
        Map<?, ?> body = java.util.Collections.emptyMap();
        try {
            Object parsed = co.sendping.json.Json.parse(new String(raw, java.nio.charset.StandardCharsets.UTF_8));
            if (parsed instanceof Map) body = (Map<?, ?>) parsed;
        } catch (RuntimeException ignored) { }
        Object count = body.get("sent_count");
        if ((body.get("id") instanceof String && !((String) body.get("id")).isEmpty())
                || (count instanceof Number && ((Number) count).doubleValue() > 0)
                || (body.get("sent") instanceof java.util.List && !((java.util.List<?>) body.get("sent")).isEmpty())
                || (body.get("reserved") instanceof java.util.List && !((java.util.List<?>) body.get("reserved")).isEmpty())
                || "batch_incomplete".equals(body.get("name"))) return false;
        if (status != 503 || "GET".equals(method) || "HEAD".equals(method)) return true;
        if (java.util.Arrays.asList("service_unavailable", "sending_service_unavailable", "sending_configuration_unavailable",
                "contacts_busy", "contacts_timeout").contains(body.get("name"))) return true;
        String key = headers.entrySet().stream().filter(e -> "Idempotency-Key".equalsIgnoreCase(e.getKey()))
                .map(Map.Entry::getValue).findFirst().orElse("");
        return "POST".equals(method) && !key.trim().isEmpty() && URI.create(url).getRawPath().matches(".*/emails(?:/batch|/receiving/[^/]+/(?:reply|forward))?$");
    }

    /** Only 429 (Too Many Requests) and 503 (Service Unavailable) are retried. */
    public static boolean isRetryable(int status) {
        return status == 429 || status == 503;
    }

    /**
     * Milliseconds to wait before the retry after {@code attempt} (0-based): the parsed
     * {@code Retry-After} header when present/parseable, otherwise exponential backoff.
     */
    public static long waitMs(String retryAfter, int attempt) {
        Long fromHeader = parseRetryAfterMs(retryAfter);
        return fromHeader != null ? fromHeader : backoffMs(attempt);
    }

    /** Exponential backoff {@code min(30_000, 500 * 2^attempt)} millis. */
    public static long backoffMs(int attempt) {
        int a = Math.max(0, attempt);
        long ms = a >= 16 ? MAX_BACKOFF_MS : (500L << a);
        return Math.min(MAX_BACKOFF_MS, ms);
    }

    /**
     * Parse a {@code Retry-After} value to millis. Accepts delta-seconds (integer or
     * decimal) or an HTTP-date; caps the result at 30s and treats a negative delta as 0.
     * Returns {@code null} when the header is absent or unparseable.
     */
    public static Long parseRetryAfterMs(String header) {
        if (header == null) return null;
        String h = header.trim();
        if (h.isEmpty()) return null;

        if (h.matches("-?\\d+(\\.\\d+)?")) {
            double seconds = Double.parseDouble(h);
            return capMs(Math.round(seconds * 1000.0));
        }

        try {
            ZonedDateTime when = ZonedDateTime.parse(h, DateTimeFormatter.RFC_1123_DATE_TIME);
            long deltaMs = Duration.between(ZonedDateTime.now(when.getZone()), when).toMillis();
            return capMs(deltaMs);
        } catch (RuntimeException ignored) {
            // Not an HTTP-date either.
        }
        return null;
    }

    private static long capMs(long ms) {
        if (ms < 0) return 0L;
        return Math.min(MAX_BACKOFF_MS, ms);
    }
}

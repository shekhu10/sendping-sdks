package co.sendping.tests;

import co.sendping.http.DefaultHttpTransport;

import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;

/**
 * Unit coverage for the HTTP-core robustness policy: which statuses retry,
 * exponential backoff, and Retry-After parsing (delta-seconds / HTTP-date /
 * caps / negatives / fallback).
 */
public final class HttpCoreTest {
    public static void run() {
        Check.suite("HttpCore");

        // Only 429 and 503 are retryable — nothing else, including other 5xx.
        Check.isTrue("429 retryable", DefaultHttpTransport.isRetryable(429));
        Check.isTrue("503 retryable", DefaultHttpTransport.isRetryable(503));
        Check.isTrue("200 not retryable", !DefaultHttpTransport.isRetryable(200));
        Check.isTrue("500 not retryable", !DefaultHttpTransport.isRetryable(500));
        Check.isTrue("502 not retryable", !DefaultHttpTransport.isRetryable(502));
        Check.isTrue("504 not retryable", !DefaultHttpTransport.isRetryable(504));
        Check.isTrue("429->1 not retryable", !DefaultHttpTransport.isRetryable(430));

        // Exponential backoff = min(30_000, 500 * 2^attempt).
        Check.eq("backoff attempt 0", 500L, DefaultHttpTransport.backoffMs(0));
        Check.eq("backoff attempt 1", 1000L, DefaultHttpTransport.backoffMs(1));
        Check.eq("backoff attempt 2", 2000L, DefaultHttpTransport.backoffMs(2));
        Check.eq("backoff attempt 6 capped", 30_000L, DefaultHttpTransport.backoffMs(6));
        Check.eq("backoff huge attempt capped", 30_000L, DefaultHttpTransport.backoffMs(999));

        // Retry-After: integer seconds.
        Check.eq("retry-after 2s", 2000L, DefaultHttpTransport.parseRetryAfterMs("2"));
        // Retry-After: decimal seconds.
        Check.eq("retry-after 1.5s", 1500L, DefaultHttpTransport.parseRetryAfterMs("1.5"));
        // Retry-After: capped at 30s.
        Check.eq("retry-after 120s capped", 30_000L, DefaultHttpTransport.parseRetryAfterMs("120"));
        // Retry-After: negative treated as 0.
        Check.eq("retry-after negative -> 0", 0L, DefaultHttpTransport.parseRetryAfterMs("-5"));
        // Absent / blank / unparseable -> null (caller falls back to backoff).
        Check.isNull("retry-after null", DefaultHttpTransport.parseRetryAfterMs(null));
        Check.isNull("retry-after blank", DefaultHttpTransport.parseRetryAfterMs("   "));
        Check.isNull("retry-after garbage", DefaultHttpTransport.parseRetryAfterMs("soon"));
        // A Java double suffix like "10d" must NOT be mistaken for 10 seconds.
        Check.isNull("retry-after 10d not a number", DefaultHttpTransport.parseRetryAfterMs("10d"));

        // Retry-After: HTTP-date in the future waits a positive, capped amount.
        String future = ZonedDateTime.now().plusSeconds(10).format(DateTimeFormatter.RFC_1123_DATE_TIME);
        Long dateMs = DefaultHttpTransport.parseRetryAfterMs(future);
        Check.isTrue("retry-after http-date future > 0", dateMs != null && dateMs > 0 && dateMs <= 30_000L);
        // Retry-After: HTTP-date in the past clamps to 0.
        String past = ZonedDateTime.now().minusSeconds(30).format(DateTimeFormatter.RFC_1123_DATE_TIME);
        Check.eq("retry-after http-date past -> 0", 0L, DefaultHttpTransport.parseRetryAfterMs(past));

        // waitMs uses the header when present, else exponential backoff for the attempt.
        Check.eq("waitMs uses header", 2000L, DefaultHttpTransport.waitMs("2", 0));
        Check.eq("waitMs falls back to backoff", 2000L, DefaultHttpTransport.waitMs(null, 2));
    }
}

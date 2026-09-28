package co.sendping.http;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** Percent-encoding helpers for path segments and query values. */
public final class Urls {
    private Urls() {}

    /**
     * Percent-encode a value for use as a URL path segment or query value, so
     * an id like {@code "../api-keys"} can never traverse to a different
     * endpoint (mirrors the Node SDK's encoding of every interpolated id).
     */
    public static String encode(String value) {
        return URLEncoder.encode(String.valueOf(value), StandardCharsets.UTF_8).replace("+", "%20");
    }
}

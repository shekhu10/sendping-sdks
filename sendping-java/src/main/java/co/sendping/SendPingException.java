package co.sendping;

import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Thrown for every non-2xx API response (and for transport failures, with
 * {@code statusCode == 0} and {@code name == "network_error"}).
 *
 * <p>Mirrors the API's error envelope {@code { statusCode, name, message }}.
 * Some errors add fields on top of it, reachable via {@link #getBody()} or the
 * dotted-path {@link #get(String)}:
 *
 * <ul>
 *   <li>{@code limit} — on plan/quota errors ({@code plan_limit_reached},
 *       {@code daily_quota_exceeded}, {@code monthly_quota_exceeded},
 *       {@code contact_limit_reached}, {@code ai_credits_exceeded},
 *       {@code automation_quota_exceeded}). See {@link #getLimit()}.</li>
 *   <li>{@code reputation} — on reputation-gate errors. See
 *       {@link #getReputation()}.</li>
 *   <li>{@code sent} + {@code sent_count} — on a partial
 *       {@code POST /emails/batch} failure made with an {@code Idempotency-Key}.
 *       See {@link #getSent()} / {@link #getSentCount()}.</li>
 * </ul>
 *
 * <p>Always branch on {@link #getName()} together with {@link #getStatusCode()},
 * never on {@link #getMessage()}: message text is scrubbed of provider
 * identifiers server-side and is not a stable contract, and a handler may
 * return a status that differs from the name's usual one (for example
 * {@code validation_error} is 403 for a missing {@code User-Agent} and 409 for
 * a duplicate contact-property key).
 */
public class SendPingException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    private final int statusCode;
    private final String name;
    /**
     * Parsed JSON — only Strings, Booleans, Numbers, Lists and Maps, all of
     * which serialize; the declared interface type is what {@code -Xlint:serial}
     * flags, not the actual contents.
     */
    @SuppressWarnings("serial")
    private final Map<String, Object> body;

    public SendPingException(int statusCode, String name, String message) {
        this(statusCode, name, message, null);
    }

    /**
     * @param body the full parsed error body, or {@code null} when the response
     *             was not a JSON object
     */
    public SendPingException(int statusCode, String name, String message, Map<String, Object> body) {
        super(message);
        this.statusCode = statusCode;
        this.name = name == null ? "application_error" : name;
        this.body = body == null
                ? Collections.<String, Object>emptyMap()
                : Collections.unmodifiableMap(body);
    }

    /** HTTP status of the failed request (0 for transport/network failures). */
    public int getStatusCode() { return statusCode; }

    /** Machine-readable error name, e.g. {@code validation_error}. */
    public String getName() { return name; }

    /**
     * The full parsed error body — never {@code null}, but empty when the
     * response was not a JSON object. Use it to read the additive
     * {@code limit} / {@code reputation} / {@code sent} fields.
     */
    public Map<String, Object> getBody() { return body; }

    /** Original logical email for a failed/unconfirmed send. Inspect before resending. */
    public String getId() { return body.get("id") instanceof String ? (String) body.get("id") : null; }

    /** Reserved prefix, including unconfirmed provider handoffs. */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getReserved() {
        Object value = body.get("reserved");
        return value instanceof List ? (List<Map<String, Object>>) value : null;
    }

    /** Count of never-attempted items, not unconfirmed reserved items. */
    public Integer getUnsentCount() {
        Object value = body.get("unsent_count");
        return value instanceof Number ? ((Number) value).intValue() : null;
    }

    /**
     * Navigate {@link #getBody()} with a dotted path; numeric segments index
     * into lists (e.g. {@code "limit.next_plan.id"}, {@code "sent.0.id"}).
     * Returns {@code null} when any segment is missing.
     */
    public Object get(String path) {
        Object cur = body;
        if (path == null || path.isEmpty()) return cur;
        for (String seg : path.split("\\.")) {
            if (cur instanceof Map) {
                cur = ((Map<?, ?>) cur).get(seg);
            } else if (cur instanceof List) {
                try {
                    int idx = Integer.parseInt(seg);
                    List<?> l = (List<?>) cur;
                    cur = (idx >= 0 && idx < l.size()) ? l.get(idx) : null;
                } catch (NumberFormatException e) {
                    return null;
                }
            } else {
                return null;
            }
            if (cur == null) return null;
        }
        return cur;
    }

    /**
     * The plan/quota {@code limit} object when this is a limit error, else
     * {@code null}. Carries {@code kind}, {@code used}, {@code limit},
     * {@code remaining}, {@code plan} and {@code next_plan}.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getLimit() {
        Object v = body.get("limit");
        return v instanceof Map ? (Map<String, Object>) v : null;
    }

    /**
     * The reputation-gate detail on {@code reputation_paused} /
     * {@code reputation_limit_exceeded}, else {@code null}. Carries at least
     * {@code retryable} and {@code scope}
     * ({@code "tenant"} | {@code "domain"} | {@code "platform"}).
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getReputation() {
        Object v = body.get("reputation");
        return v instanceof Map ? (Map<String, Object>) v : null;
    }

    /**
     * The emails that were already sent before a {@code POST /emails/batch}
     * failed part way through (with or without an {@code Idempotency-Key}),
     * else {@code null}. Do NOT resend these.
     */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getSent() {
        Object v = body.get("sent");
        return v instanceof List ? (List<Map<String, Object>>) v : null;
    }

    /**
     * How many emails went out before a batch failed part way through, else
     * {@code null}. Falls back to {@link #getSent()}'s size when the body
     * carried the list but not the count.
     */
    public Integer getSentCount() {
        Object v = body.get("sent_count");
        if (v instanceof Number) return ((Number) v).intValue();
        List<Map<String, Object>> sent = getSent();
        return sent == null ? null : sent.size();
    }

    @Override
    public String toString() {
        return "SendPingException{statusCode=" + statusCode + ", name=" + name
                + ", message=" + getMessage() + "}";
    }
}

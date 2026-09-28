package co.sendping;

import co.sendping.json.Json;

import java.util.List;
import java.util.Map;

/**
 * A successful API response. Wraps the raw JSON body plus a tolerantly parsed
 * tree, with dotted-path helper getters:
 *
 * <pre>{@code
 * SendPingResponse res = sendping.emails().send(req);
 * String id = res.getString("id");
 * Boolean hasMore = res.getBoolean("has_more");
 * String firstEmail = res.getString("data.0.id"); // list index by number
 * }</pre>
 *
 * <p>Non-2xx responses never reach this class — they throw
 * {@link SendPingException} instead.
 */
public final class SendPingResponse {
    private final int statusCode;
    private final String raw;
    private final Object json;

    public SendPingResponse(int statusCode, String raw) {
        this.statusCode = statusCode;
        this.raw = raw == null ? "" : raw;
        Object parsed = null;
        if (!this.raw.isEmpty()) {
            try {
                parsed = Json.parse(this.raw);
            } catch (RuntimeException ignored) {
                // Non-JSON body — raw() still returns it verbatim.
            }
        }
        this.json = parsed;
    }

    /** HTTP status code (always 2xx). */
    public int statusCode() { return statusCode; }

    /** The exact response body as sent by the server. */
    public String raw() { return raw; }

    /** The parsed JSON tree (Map / List / String / Long / Double / Boolean / null). */
    public Object json() { return json; }

    /**
     * Navigate the parsed tree with a dotted path; numeric segments index into
     * lists (e.g. {@code "data.0.id"}). Returns {@code null} when any segment
     * is missing.
     */
    public Object get(String path) {
        Object cur = json;
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

    public String getString(String path) {
        Object v = get(path);
        return v == null ? null : String.valueOf(v);
    }

    public Integer getInt(String path) {
        Object v = get(path);
        return v instanceof Number ? ((Number) v).intValue() : null;
    }

    public Long getLong(String path) {
        Object v = get(path);
        return v instanceof Number ? ((Number) v).longValue() : null;
    }

    public Double getDouble(String path) {
        Object v = get(path);
        return v instanceof Number ? ((Number) v).doubleValue() : null;
    }

    public Boolean getBoolean(String path) {
        Object v = get(path);
        return v instanceof Boolean ? (Boolean) v : null;
    }

    @SuppressWarnings("unchecked")
    public List<Object> getList(String path) {
        Object v = get(path);
        return v instanceof List ? (List<Object>) v : null;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> getMap(String path) {
        Object v = get(path);
        return v instanceof Map ? (Map<String, Object>) v : null;
    }

    /** The whole body as a map (or {@code null} when the body is not a JSON object). */
    @SuppressWarnings("unchecked")
    public Map<String, Object> asMap() {
        return json instanceof Map ? (Map<String, Object>) json : null;
    }

    /** The whole body as a list (or {@code null} when the body is not a JSON array). */
    @SuppressWarnings("unchecked")
    public List<Object> asList() {
        return json instanceof List ? (List<Object>) json : null;
    }

    @Override
    public String toString() { return raw; }
}

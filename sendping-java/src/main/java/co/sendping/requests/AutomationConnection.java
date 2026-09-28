package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * A typed edge between two automation step keys.
 *
 * <p>{@code from} is the trigger key (default {@code "trigger"}) or an existing
 * step key; {@code to} is a step key. Dangling keys and cycles are both
 * rejected at write time with a {@code 422 validation_error}.
 */
public final class AutomationConnection implements JsonPayload {
    private final String from;
    private final String to;
    private final String type;

    private AutomationConnection(String from, String to, String type) {
        this.from = from;
        this.to = to;
        this.type = type;
    }

    /** A plain (linear) edge — the API defaults the type to {@code "next"}. */
    public static AutomationConnection of(String from, String to) {
        return new AutomationConnection(from, to, null);
    }

    /**
     * @param type the edge kind. The API accepts exactly {@code "next"} (or its
     *     documented alias {@code "default"}), {@code "condition_met"},
     *     {@code "condition_not_met"}, {@code "event_received"} and
     *     {@code "timeout"} — anything else is a {@code 422 validation_error}.
     *     Use {@code condition_met} / {@code condition_not_met} for the two
     *     branches out of a {@code condition} step, and
     *     {@code event_received} / {@code timeout} for the two out of a
     *     {@code wait} step.
     */
    public static AutomationConnection of(String from, String to, String type) {
        return new AutomationConnection(from, to, type);
    }

    @Override
    public Map<String, Object> toMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("from", from);
        m.put("to", to);
        if (type != null) m.put("type", type);
        return m;
    }
}

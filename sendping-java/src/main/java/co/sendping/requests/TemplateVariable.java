package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.LinkedHashMap;
import java.util.Map;

/** A template variable definition accepted on template create/update. */
public final class TemplateVariable implements JsonPayload {
    private final String key;
    private final String type;
    private final Object fallbackValue;
    private final boolean hasFallback;

    private TemplateVariable(String key, String type, Object fallbackValue, boolean hasFallback) {
        this.key = key;
        this.type = type;
        this.fallbackValue = fallbackValue;
        this.hasFallback = hasFallback;
    }

    public static TemplateVariable of(String key) {
        return new TemplateVariable(key, null, null, false);
    }

    /** {@code type} is {@code "string"} or {@code "number"}. */
    public static TemplateVariable of(String key, String type) {
        return new TemplateVariable(key, type, null, false);
    }

    public static TemplateVariable of(String key, String type, Object fallbackValue) {
        return new TemplateVariable(key, type, fallbackValue, true);
    }

    @Override
    public Map<String, Object> toMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", key);
        if (type != null) m.put("type", type);
        if (hasFallback) m.put("fallback_value", fallbackValue);
        return m;
    }
}

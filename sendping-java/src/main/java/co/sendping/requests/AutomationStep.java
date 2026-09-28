package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * An automation step input, used inline on automation create and as the body
 * of {@code POST /automations/:id/steps}. {@code key} is the handle
 * connections reference.
 *
 * <p>Create paths ONLY. Editing an existing step takes
 * {@link UpdateAutomationStepRequest} instead, which has no {@code key}
 * because {@code PATCH /automations/:id/steps/:stepId} ignores one.
 */
public final class AutomationStep implements JsonPayload {
    private final Map<String, Object> body;

    private AutomationStep(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        /** Step type, e.g. {@code trigger}, {@code send_email}, {@code wait}, {@code condition}. */
        public Builder type(String type) { m.put("type", type); return this; }
        /**
         * Handle used by connections to reference this step. Defaults to the
         * step id when omitted, and is CREATE-ONLY: {@code PATCH
         * /automations/:id/steps/:stepId} forwards only {@code type} and
         * {@code config} to storage, so a key sent there is silently dropped.
         * Delete and re-add the step to re-key it.
         */
        public Builder key(String key) { m.put("key", key); return this; }

        /** Set one config entry. */
        @SuppressWarnings("unchecked")
        public Builder config(String key, Object value) {
            ((Map<String, Object>) m.computeIfAbsent("config", k -> new LinkedHashMap<String, Object>()))
                    .put(key, value);
            return this;
        }

        public Builder config(Map<String, Object> config) {
            m.put("config", new LinkedHashMap<>(config));
            return this;
        }

        public AutomationStep build() { return new AutomationStep(new LinkedHashMap<>(m)); }
    }
}

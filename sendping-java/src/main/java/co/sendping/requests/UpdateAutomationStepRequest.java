package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Body of {@code PATCH /automations/:id/steps/:stepId}. The automation must be
 * DISABLED first, and the trigger is set on the automation rather than edited
 * as a step (both are 422s).
 *
 * <p>{@code type} is REQUIRED even when only the config is changing: the route
 * runs the same validator as {@code addStep}, which rejects a body
 * without one as {@code validation_error} ("type must be one of: …"). A step is
 * therefore replaced type-and-config together, never config alone — always
 * resend the step's current type.
 *
 * <p>Unlike {@link AutomationStep} this deliberately has NO {@code key} setter.
 * The route forwards only {@code type} and {@code config} to storage, so the
 * step's graph {@code key} and {@code position} are stable and a {@code key} in
 * this body is a SILENT no-op — the call still returns 200 and echoes back the
 * STORED key, so a re-key looks like it worked when nothing changed. Delete the
 * step and re-add it with the new key to actually re-key it, repointing the
 * connections that reference the old one.
 */
public final class UpdateAutomationStepRequest implements JsonPayload {
    private final Map<String, Object> body;

    private UpdateAutomationStepRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        /**
         * The type the step should have AFTER the update — resend its current
         * type when you are only changing {@code config}. Required.
         */
        public Builder type(String type) { m.put("type", type); return this; }

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

        public UpdateAutomationStepRequest build() {
            return new UpdateAutomationStepRequest(new LinkedHashMap<>(m));
        }
    }
}

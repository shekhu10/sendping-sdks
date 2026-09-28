package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Body of {@code PATCH /automations/:id}.
 *
 * <p>Changing the {@code domain}, {@code trigger}, {@code trigger_config} or
 * {@code connections} requires the automation to be DISABLED first — each is a
 * {@code 422 validation_error} on an enabled one.
 */
public final class UpdateAutomationRequest implements JsonPayload {
    private final Map<String, Object> body;

    private UpdateAutomationRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        public Builder name(String name) { m.put("name", name); return this; }
        /** {@code "enabled"} or {@code "disabled"}. */
        public Builder status(String status) { m.put("status", status); return this; }
        /** Re-point at another of your domains (disabled automations only). */
        public Builder domain(String domain) { m.put("domain", domain); return this; }

        /**
         * Change the event that starts a run (disabled automations only). Same
         * vocabulary as {@link CreateAutomationRequest.Builder#trigger(String)}:
         * {@code contact.created}, the built-in {@code sendping:schedule}
         * (which also needs {@link #triggerConfig(String, String)}), an
         * engagement event, or any custom event name you send via
         * {@code events().send(...)}. Any other {@code sendping:} name is
         * rejected.
         */
        public Builder trigger(String trigger) { m.put("trigger", trigger); return this; }

        /**
         * Rename the trigger node that {@link #connection(AutomationConnection)
         * connections} reference (default {@code "trigger"}). The API reads it
         * only while applying a trigger change, so pass
         * {@link #trigger(String)} alongside it — on its own it is ignored.
         */
        public Builder triggerKey(String triggerKey) { m.put("trigger_key", triggerKey); return this; }

        /**
         * Update the {@code sendping:schedule} trigger's schedule. Only
         * valid on automations with that trigger.
         *
         * @param at ISO 8601 instant the automation fires (future, at most 366 days ahead)
         * @param timezone IANA timezone the schedule was picked in, e.g. {@code "America/New_York"}
         */
        public Builder triggerConfig(String at, String timezone) {
            Map<String, Object> config = new LinkedHashMap<>();
            config.put("at", at);
            config.put("timezone", timezone);
            m.put("trigger_config", config);
            return this;
        }

        @SuppressWarnings("unchecked")
        public Builder connection(AutomationConnection connection) {
            ((List<Object>) m.computeIfAbsent("connections", k -> new ArrayList<>())).add(connection);
            return this;
        }

        public Builder connections(List<AutomationConnection> connections) {
            m.put("connections", new ArrayList<>(connections));
            return this;
        }

        public UpdateAutomationRequest build() { return new UpdateAutomationRequest(new LinkedHashMap<>(m)); }
    }
}

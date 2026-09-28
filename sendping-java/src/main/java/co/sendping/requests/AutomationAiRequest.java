package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Body of {@code POST /automations/:id/ai} ("Create with AI") — describes the
 * workflow in natural language and lets the server build the steps.
 *
 * <p>The automation must be STOPPED first ({@code 422} otherwise), the prompt
 * is capped at 2000 characters, and only the first 10 {@code template_ids} and
 * {@code events} hints are used. Without {@link Builder#attach} the call runs
 * in <em>workflow</em> mode and requires an automation with zero steps; with
 * it, the generated steps are appended at that point instead.
 *
 * <p>This route also carries its own limit of 20 requests per 60 s per account
 * ({@code rate_limit_exceeded} 429) and spends AI credits
 * ({@code ai_credits_exceeded} 429).
 */
public final class AutomationAiRequest implements JsonPayload {
    private final Map<String, Object> body;

    private AutomationAiRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        /** What the automation should do. Required; max 2000 characters. */
        public Builder prompt(String prompt) { m.put("prompt", prompt); return this; }

        /** Templates the generated send steps may use (first 10 kept). */
        public Builder templateIds(String... templateIds) {
            m.put("template_ids", Arrays.asList(templateIds));
            return this;
        }

        public Builder templateIds(List<String> templateIds) {
            m.put("template_ids", new ArrayList<>(templateIds));
            return this;
        }

        /** Event names the generated wait/branch steps may use (first 10 kept). */
        public Builder events(String... events) {
            m.put("events", Arrays.asList(events));
            return this;
        }

        public Builder events(List<String> events) {
            m.put("events", new ArrayList<>(events));
            return this;
        }

        /**
         * Append the generated steps after an existing step instead of
         * building a whole workflow.
         *
         * @param from the trigger key or an existing step key
         * @param type edge type — {@code default}, {@code condition_met},
         *             {@code condition_not_met}, {@code event_received} or
         *             {@code timeout}; {@code null} means {@code default}
         * @param before optional existing step key to insert ahead of
         */
        public Builder attach(String from, String type, String before) {
            Map<String, Object> attach = new LinkedHashMap<>();
            attach.put("from", from);
            if (type != null) attach.put("type", type);
            if (before != null) attach.put("before", before);
            m.put("attach", attach);
            return this;
        }

        public AutomationAiRequest build() { return new AutomationAiRequest(new LinkedHashMap<>(m)); }
    }
}

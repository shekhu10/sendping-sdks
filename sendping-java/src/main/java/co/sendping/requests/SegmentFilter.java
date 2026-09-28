package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A segment's filter: subscription {@code status} ({@code all} |
 * {@code subscribed} | {@code unsubscribed} | {@code members_only}), an
 * {@code email_contains} substring, custom-property predicates ({@code eq} |
 * {@code contains} | {@code exists}) and an optional campaign-engagement
 * predicate.
 */
public final class SegmentFilter implements JsonPayload {
    private final Map<String, Object> body;

    private SegmentFilter(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        /**
         * {@code "all"}, {@code "subscribed"}, {@code "unsubscribed"} or
         * {@code "members_only"} — anything else is a
         * {@code 422 validation_error}. {@code members_only} keeps just the
         * explicitly added members and ignores the rest of the filter; it is
         * also what the CSV and Google-Sheet importers create.
         */
        public Builder status(String status) { m.put("status", status); return this; }
        public Builder emailContains(String emailContains) { m.put("email_contains", emailContains); return this; }

        /** Add a custom-property predicate. {@code value} is required for eq/contains. */
        @SuppressWarnings("unchecked")
        public Builder propertyFilter(String key, String operator, Object value) {
            Map<String, Object> f = new LinkedHashMap<>();
            f.put("key", key);
            f.put("operator", operator);
            if (value != null) f.put("value", value);
            ((List<Object>) m.computeIfAbsent("property_filters", k -> new ArrayList<>())).add(f);
            return this;
        }

        /** Add an {@code exists} predicate (no value). */
        public Builder propertyExists(String key) { return propertyFilter(key, "exists", null); }

        /**
         * Narrow the segment to contacts who did (or did not) engage with ONE
         * campaign. Both arguments are required together — the API answers
         * {@code 422 validation_error} for an engagement predicate missing
         * either half.
         *
         * @param event      {@code "clicked"}, {@code "not_clicked"},
         *                   {@code "opened"} or {@code "not_opened"}
         * @param campaignId the campaign the engagement is measured against
         */
        public Builder engagement(String event, String campaignId) {
            Map<String, Object> engagement = new LinkedHashMap<>();
            engagement.put("event", event);
            engagement.put("campaign_id", campaignId);
            m.put("engagement", engagement);
            return this;
        }

        /**
         * Drop the engagement predicate (sends {@code "engagement": null}).
         * On a patch this is the only way to clear a stored one — omitting the
         * key leaves it in place.
         */
        public Builder clearEngagement() { m.put("engagement", null); return this; }

        public SegmentFilter build() { return new SegmentFilter(new LinkedHashMap<>(m)); }
    }
}

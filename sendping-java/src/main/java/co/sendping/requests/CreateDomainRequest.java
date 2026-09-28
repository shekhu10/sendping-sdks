package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** Body of {@code POST /domains}. */
public final class CreateDomainRequest implements JsonPayload {
    private final Map<String, Object> body;

    private CreateDomainRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        public Builder name(String name) { m.put("name", name); return this; }
        public Builder region(String region) { m.put("region", region); return this; }
        /** MAIL FROM subdomain (Return-Path); defaults to {@code send}. */
        public Builder customReturnPath(String customReturnPath) { m.put("custom_return_path", customReturnPath); return this; }
        public Builder openTracking(boolean openTracking) { m.put("open_tracking", openTracking); return this; }
        public Builder clickTracking(boolean clickTracking) { m.put("click_tracking", clickTracking); return this; }
        /** Custom tracking host label, e.g. {@code email} → email.&lt;domain&gt;. */
        public Builder trackingSubdomain(String trackingSubdomain) { m.put("tracking_subdomain", trackingSubdomain); return this; }
        /** Outbound TLS policy: {@code opportunistic} or {@code enforced}. */
        public Builder tls(String tls) { m.put("tls", tls); return this; }

        /** Enable/disable inbound receiving for this domain. */
        @SuppressWarnings("unchecked")
        public Builder receiving(boolean enabled) {
            ((Map<String, Object>) m.computeIfAbsent("capabilities", k -> new LinkedHashMap<String, Object>()))
                    .put("receiving", enabled ? "enabled" : "disabled");
            return this;
        }

        public CreateDomainRequest build() { return new CreateDomainRequest(new LinkedHashMap<>(m)); }
    }
}

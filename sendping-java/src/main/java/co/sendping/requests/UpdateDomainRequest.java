package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Body of {@code PATCH /domains/:id}. Every field is optional; an empty patch
 * is accepted as a no-op. The response is the slim
 * {@code { "object": "domain", "id": … }} ack, not the full domain.
 */
public final class UpdateDomainRequest implements JsonPayload {
    private final Map<String, Object> body;

    private UpdateDomainRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        public Builder openTracking(boolean openTracking) { m.put("open_tracking", openTracking); return this; }
        public Builder clickTracking(boolean clickTracking) { m.put("click_tracking", clickTracking); return this; }
        public Builder trackingSubdomain(String trackingSubdomain) { m.put("tracking_subdomain", trackingSubdomain); return this; }
        /** MAIL FROM subdomain (Return-Path) — a single DNS label such as {@code send} or {@code mail}. */
        public Builder customReturnPath(String customReturnPath) { m.put("custom_return_path", customReturnPath); return this; }
        /** Enable/disable the custom open/click tracking host for this domain. */
        public Builder customTracking(boolean customTracking) { m.put("custom_tracking", customTracking); return this; }
        /** Outbound TLS policy: {@code opportunistic} or {@code enforced}. */
        public Builder tls(String tls) { m.put("tls", tls); return this; }

        /** Enable/disable inbound receiving for this domain. */
        @SuppressWarnings("unchecked")
        public Builder receiving(boolean enabled) {
            ((Map<String, Object>) m.computeIfAbsent("capabilities", k -> new LinkedHashMap<String, Object>()))
                    .put("receiving", enabled ? "enabled" : "disabled");
            return this;
        }

        public UpdateDomainRequest build() { return new UpdateDomainRequest(new LinkedHashMap<>(m)); }
    }
}

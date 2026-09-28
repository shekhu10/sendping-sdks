package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** Body of {@code POST /domains/claim} — claim a domain already verified elsewhere. */
public final class ClaimDomainRequest implements JsonPayload {
    private final Map<String, Object> body;

    private ClaimDomainRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        public Builder name(String name) { m.put("name", name); return this; }
        public Builder region(String region) { m.put("region", region); return this; }

        public ClaimDomainRequest build() { return new ClaimDomainRequest(new LinkedHashMap<>(m)); }
    }
}

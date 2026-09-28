package co.sendping.requests;

import co.sendping.json.JsonPayload;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Body of {@code POST /webhooks}. The plaintext {@code signing_secret} is
 * returned ONCE, only on create (and on rotate).
 *
 * <p>The endpoint must be {@code https://} and must not resolve to a private,
 * loopback or link-local address — {@code http://} is rejected with
 * {@code Endpoint URL rejected: requires_https}.
 */
public final class CreateWebhookRequest implements JsonPayload {
    private final Map<String, Object> body;

    private CreateWebhookRequest(Map<String, Object> body) { this.body = body; }

    public static Builder builder() { return new Builder(); }

    @Override
    public Map<String, Object> toMap() { return Collections.unmodifiableMap(body); }

    public static final class Builder {
        private final Map<String, Object> m = new LinkedHashMap<>();

        /** HTTPS URL to deliver to. Required. */
        public Builder endpoint(String endpoint) { m.put("endpoint", endpoint); return this; }
        /**
         * Event names to deliver. Required, at least one; an unrecognised name
         * is a {@code 422 validation_error}. The full vocabulary is:
         *
         * <p>{@code email.sent}, {@code email.delivered},
         * {@code email.delivery_delayed}, {@code email.bounced},
         * {@code email.complained}, {@code email.opened}, {@code email.clicked},
         * {@code email.failed}, {@code email.scheduled},
         * {@code email.suppressed}, {@code email.received},
         * {@code email.replied}, {@code email.unsubscribed},
         * {@code contact.created}, {@code contact.updated},
         * {@code contact.deleted}, {@code domain.created},
         * {@code domain.updated}, {@code domain.deleted}.
         *
         * <p>Short aliases such as {@code opened} / {@code clicked} /
         * {@code bounced} / {@code unsubscribed} are accepted and stored in
         * their canonical {@code email.*} form. Note there is no
         * {@code contact.unsubscribed} — unsubscribes are
         * {@code email.unsubscribed}.
         */
        public Builder events(String... events) { m.put("events", Arrays.asList(events)); return this; }
        /** Optional caller-supplied signing secret. When omitted, SendPing generates one. */
        public Builder secret(String secret) { m.put("secret", secret); return this; }

        public CreateWebhookRequest build() { return new CreateWebhookRequest(new LinkedHashMap<>(m)); }
    }
}

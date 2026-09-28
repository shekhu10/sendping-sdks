package co.sendping;

import co.sendping.http.ApiClient;
import co.sendping.http.DefaultHttpTransport;
import co.sendping.http.HttpTransport;
import co.sendping.resources.ApiKeys;
import co.sendping.resources.Audiences;
import co.sendping.resources.Automations;
import co.sendping.resources.Batch;
import co.sendping.resources.Campaigns;
import co.sendping.resources.ContactProperties;
import co.sendping.resources.Contacts;
import co.sendping.resources.Domains;
import co.sendping.resources.Emails;
import co.sendping.resources.Events;
import co.sendping.resources.Logs;
import co.sendping.resources.Polls;
import co.sendping.resources.Segments;
import co.sendping.resources.Templates;
import co.sendping.resources.Topics;
import co.sendping.resources.Webhooks;

import java.time.Duration;

/**
 * The SendPing API client.
 *
 * <pre>{@code
 * SendPing sendping = new SendPing("mb_xxxxxxxxx");
 *
 * SendEmailRequest req = SendEmailRequest.builder()
 *     .from("Acme <hi@yourdomain.com>")
 *     .to("a@b.com")
 *     .subject("hello")
 *     .html("<p>hi</p>")
 *     .build();
 *
 * SendPingResponse res = sendping.emails().send(req);
 * String id = res.getString("id");
 * }</pre>
 *
 * <p>Every method returns a {@link SendPingResponse} (binary downloads
 * return {@code byte[]}); non-2xx responses throw {@link SendPingException}.
 *
 * <p>Every request carries {@code Authorization: Bearer <your mb_ key>} and a
 * non-empty {@code User-Agent} — the API rejects a request without the latter
 * with HTTP 403 {@code validation_error}, before it even authenticates.
 */
public class SendPing {
    public static final String DEFAULT_BASE_URL = "https://www.sendping.co/api";
    public static final String VERSION = "1.0.0";
    public static final String USER_AGENT = "sendping-java/" + VERSION;

    /**
     * Longest {@code Idempotency-Key} the API accepts. The accepted range is
     * <strong>1&ndash;255</strong> characters measured after the server trims the
     * value (the storage column is {@code VARCHAR(255)}) — not 256. Anything
     * outside it is a {@code 400 invalid_idempotency_key}.
     *
     * <p>The header is honoured by {@code POST /emails} and
     * {@code POST /emails/batch}, plus received-email reply/forward. Every other endpoint ignores it, so a
     * retry there creates a second resource.
     *
     * <p>This SDK does not check the length itself — the server is the
     * authority. The constant is exported so the rule is discoverable.
     */
    public static final int IDEMPOTENCY_KEY_MAX_LENGTH = 255;

    private final Emails emails;
    private final Batch batch;
    private final Domains domains;
    private final Audiences audiences;
    private final Contacts contacts;
    private final ContactProperties contactProperties;
    private final Campaigns campaigns;
    private final Segments segments;
    private final Topics topics;
    private final Templates templates;
    private final Automations automations;
    private final Webhooks webhooks;
    private final Logs logs;
    private final Events events;
    private final ApiKeys apiKeys;
    private final Polls polls;

    public SendPing(String apiKey) {
        this(apiKey, DEFAULT_BASE_URL);
    }

    /** Override the API host, e.g. for a self-hosted deployment. */
    public SendPing(String apiKey, String baseUrl) {
        this(apiKey, baseUrl, new DefaultHttpTransport());
    }

    /**
     * Override the API host and the HTTP-core robustness policy.
     *
     * @param timeout    per-request (and connect) timeout; {@code null} or a non-positive
     *                   value means "no timeout". Defaults to 30 seconds.
     * @param maxRetries extra automatic attempts on HTTP 429/503 (0 disables retries).
     *                   Defaults to 2 (up to 3 total attempts).
     */
    public SendPing(String apiKey, String baseUrl, Duration timeout, int maxRetries) {
        this(apiKey, baseUrl, new DefaultHttpTransport(timeout, maxRetries));
    }

    /** Inject a custom {@link HttpTransport} (used by the test suite). */
    public SendPing(String apiKey, String baseUrl, HttpTransport transport) {
        ApiClient api = new ApiClient(apiKey, baseUrl, USER_AGENT, transport);
        this.emails = new Emails(api);
        this.batch = new Batch(api);
        this.domains = new Domains(api);
        this.audiences = new Audiences(api);
        this.contacts = new Contacts(api);
        this.contactProperties = new ContactProperties(api);
        this.campaigns = new Campaigns(api);
        this.segments = new Segments(api);
        this.topics = new Topics(api);
        this.templates = new Templates(api);
        this.automations = new Automations(api);
        this.webhooks = new Webhooks(api);
        this.logs = new Logs(api);
        this.events = new Events(api);
        this.apiKeys = new ApiKeys(api);
        this.polls = new Polls(api);
    }

    /** Sent email (send / batch / list / get / attachments / reschedule / cancel) + {@code emails().receiving()}. */
    public Emails emails() { return emails; }

    /** Batch send — alias surface for {@code POST /emails/batch}. */
    public Batch batch() { return batch; }

    /** Sending/receiving domains, incl. claims and one-click DNS applies. */
    public Domains domains() { return domains; }

    public Audiences audiences() { return audiences; }

    /** Domain-first contacts (flat + nested APIs, batch/CSV import, segments, topics). */
    public Contacts contacts() { return contacts; }

    /** Custom contact properties (merge tags). */
    public ContactProperties contactProperties() { return contactProperties; }

    /** Domain-first campaigns (bulk sends, A/B, follow-ups, recurrence). */
    public Campaigns campaigns() { return campaigns; }

    /** Domain-first segments. */
    public Segments segments() { return segments; }

    /** Domain-first topics (granular subscription preferences). */
    public Topics topics() { return topics; }

    public Templates templates() { return templates; }

    /** Domain-first automations (steps, connections, runs). */
    public Automations automations() { return automations; }

    /** Webhooks, incl. the local {@code verifyWebhookSignature} helper. */
    public Webhooks webhooks() { return webhooks; }

    /** API request logs (read-only). */
    public Logs logs() { return logs; }

    /** Custom automation events — {@code domain} is REQUIRED on send. */
    public Events events() { return events; }

    public ApiKeys apiKeys() { return apiKeys; }

    /** Read-only in-email poll results. */
    public Polls polls() { return polls; }
}

package co.sendping.resources;

import co.sendping.ListParams;
import co.sendping.SendPingResponse;
import co.sendping.http.ApiClient;
import co.sendping.http.Query;
import co.sendping.requests.ForwardEmailRequest;
import co.sendping.requests.ListEmailsParams;
import co.sendping.requests.ListReceivedEmailsParams;
import co.sendping.requests.ReplyEmailRequest;
import co.sendping.requests.SendEmailRequest;

import java.util.Collections;
import java.util.List;
import java.util.Map;

/** Sent email — {@code sendping.emails()} — plus the inbound sub-resource {@code emails().receiving()}. */
public final class Emails extends Resource {
    private final Receiving receiving;

    public Emails(ApiClient api) {
        super(api);
        this.receiving = new Receiving(api);
    }

    /** Inbound (received) email sub-resource. */
    public Receiving receiving() { return receiving; }

    /** Send a single email. {@code POST /emails} */
    public SendPingResponse send(SendEmailRequest request) {
        return api.request("POST", "/emails", request);
    }

    /**
     * Send a single email with an {@code Idempotency-Key}, so a retry replays
     * the first response instead of sending twice.
     *
     * <p>The key must be <strong>1–255 characters</strong> after trimming
     * (anything else is a {@code 400 invalid_idempotency_key}). It is bound to
     * the request body: reusing it with a different payload is a
     * {@code 409 invalid_idempotent_request}, and reusing it while the first
     * call is still in flight is {@code 409 concurrent_idempotent_requests}.
     *
     * <p>{@code POST /emails} and {@code POST /emails/batch} are the only
     * endpoints that read this header.
     */
    public SendPingResponse send(SendEmailRequest request, String idempotencyKey) {
        return api.request("POST", "/emails", request, idempotencyKey);
    }

    /**
     * Send up to 100 emails in one request. {@code POST /emails/batch} (alias of {@code batch().send}).
     *
     * <p>A batch over 40 emails is QUEUED ({@code 202}) rather than sent
     * inline — see {@link co.sendping.resources.Batch#sendEmails(java.util.List)}.
     *
     * @deprecated use {@code batch().sendEmails(...)} — batch items reject
     *     {@code attachments} and {@code scheduled_at} (send those individually
     *     via {@link #send}), which {@code BatchEmailRequest} enforces at
     *     compile time.
     */
    @Deprecated
    public SendPingResponse batch(List<SendEmailRequest> requests) {
        return api.request("POST", "/emails/batch", requests);
    }

    /** @deprecated use {@code batch().sendEmails(requests, idempotencyKey)} — see {@link #batch(List)}. */
    @Deprecated
    public SendPingResponse batch(List<SendEmailRequest> requests, String idempotencyKey) {
        return api.request("POST", "/emails/batch", requests, idempotencyKey);
    }

    /** List sent emails (trimmed items — no status/html/text/events). {@code GET /emails} */
    public SendPingResponse list() { return list((ListParams) null); }

    public SendPingResponse list(ListParams params) {
        return api.request("GET", "/emails" + paginate(params));
    }

    /**
     * List sent emails with optional server-side {@code campaign_id} /
     * {@code automation_id} / {@code source} / {@code domain_id} /
     * {@code status} / {@code search} / {@code folder} filters —
     * {@code folder} is one of {@code outbox}, {@code sent},
     * {@code scheduled} or {@code failed}. {@code GET /emails}
     */
    public SendPingResponse list(ListEmailsParams params) {
        Query q = new Query();
        if (params != null) {
            q.add("limit", params.getLimit())
             .add("after", params.getAfter())
             .add("before", params.getBefore())
             .add("campaign_id", params.getCampaignId())
             .add("automation_id", params.getAutomationId())
             .add("source", params.getSource())
             .add("domain_id", params.getDomainId())
             .add("status", params.getStatus())
             .add("search", params.getSearch())
             .add("folder", params.getFolder());
        }
        return api.request("GET", "/emails" + q);
    }

    /**
     * Per-source send metrics — one row per campaign / automation, plus an
     * {@code "api"} roll-up (one-off API-key sends, including mail sent before
     * the send origin was recorded) and an {@code "individual"} roll-up
     * (dashboard-composed one-offs). {@code id}/{@code name}/{@code subject}/
     * {@code status} are {@code null} for both roll-up rows. Not paginated.
     * {@code GET /emails/sources}
     */
    public SendPingResponse sources() {
        return api.request("GET", "/emails/sources");
    }

    /** Retrieve a sent email and its events. {@code GET /emails/:id} */
    public SendPingResponse get(String id) {
        return api.request("GET", "/emails/" + enc(id));
    }

    /** List a sent email's attachments. {@code GET /emails/:id/attachments} */
    public SendPingResponse listAttachments(String id) {
        return api.request("GET", "/emails/" + enc(id) + "/attachments");
    }

    /** Retrieve one attachment's metadata. {@code GET /emails/:id/attachments/:attachmentId} */
    public SendPingResponse getAttachment(String id, String attachmentId) {
        return api.request("GET", "/emails/" + enc(id) + "/attachments/" + enc(attachmentId));
    }

    /** Reschedule a scheduled email. {@code PATCH /emails/:id} */
    public SendPingResponse update(String id, String scheduledAt) {
        return api.request("PATCH", "/emails/" + enc(id),
                Collections.singletonMap("scheduled_at", scheduledAt));
    }

    /** Cancel a scheduled email. {@code POST /emails/:id/cancel} */
    public SendPingResponse cancel(String id) {
        return api.request("POST", "/emails/" + enc(id) + "/cancel");
    }

    /** Inbound (received) email — {@code sendping.emails().receiving()}. */
    public static final class Receiving extends Resource {
        Receiving(ApiClient api) { super(api); }

        /**
         * List received emails. Called with no pagination params the route
         * returns up to 1000 rows in one response; supplying a {@code limit}
         * or a cursor restores normal 1–100 paging.
         * {@code GET /emails/receiving}
         */
        public SendPingResponse list() { return list((ListParams) null); }

        public SendPingResponse list(ListParams params) {
            return api.request("GET", "/emails/receiving" + paginate(params));
        }

        /**
         * List received emails with an optional {@code received_for} filter
         * (only messages received for that address). {@code GET /emails/receiving}
         */
        public SendPingResponse list(ListReceivedEmailsParams params) {
            Query q = new Query();
            if (params != null) {
                q.add("limit", params.getLimit())
                 .add("after", params.getAfter())
                 .add("before", params.getBefore())
                 .add("received_for", params.getReceivedFor());
            }
            return api.request("GET", "/emails/receiving" + q);
        }

        /**
         * Per-address inbound stats (totals, replies, last received).
         * Not paginated. {@code GET /emails/receiving/addresses}
         */
        public SendPingResponse listAddresses() {
            return api.request("GET", "/emails/receiving/addresses");
        }

        /** Retrieve a received email. {@code GET /emails/receiving/:id} */
        public SendPingResponse get(String id) {
            return api.request("GET", "/emails/receiving/" + enc(id));
        }

        /**
         * List a received email's attachments. With no pagination params the
         * route skips paging and answers with every attachment — capped at
         * <strong>1,000</strong>, with {@code has_more} true if that ceiling
         * bites; pass {@link ListParams} to page.
         * {@code GET /emails/receiving/:id/attachments}
         */
        public SendPingResponse listAttachments(String id) {
            return listAttachments(id, null);
        }

        public SendPingResponse listAttachments(String id, ListParams params) {
            return api.request("GET", "/emails/receiving/" + enc(id) + "/attachments" + paginate(params));
        }

        /**
         * Download one attachment as raw bytes (the route streams the binary
         * file, not JSON). {@code GET /emails/receiving/:id/attachments/:attachmentId}
         */
        public byte[] getAttachment(String id, String attachmentId) {
            return api.requestRaw("GET", "/emails/receiving/" + enc(id) + "/attachments/" + enc(attachmentId));
        }

        /** Download the original RFC822/MIME message as raw bytes. {@code GET /emails/receiving/:id/raw} */
        public byte[] getRaw(String id) {
            return api.requestRaw("GET", "/emails/receiving/" + enc(id) + "/raw");
        }

        /** Forward a received email. {@code POST /emails/receiving/:id/forward} */
        public SendPingResponse forward(String id, ForwardEmailRequest request) {
            return forward(id, request, null);
        }

        /** Forward with a stable operation key; reuse it only for the same request. */
        public SendPingResponse forward(String id, ForwardEmailRequest request, String idempotencyKey) {
            return api.request("POST", "/emails/receiving/" + enc(id) + "/forward", request, idempotencyKey);
        }

        /** Reply to a received email's sender, threaded. {@code POST /emails/receiving/:id/reply} */
        public SendPingResponse reply(String id, ReplyEmailRequest request) {
            return reply(id, request, null);
        }

        /** Reply with a stable operation key; reuse it only for the same request. */
        public SendPingResponse reply(String id, ReplyEmailRequest request, String idempotencyKey) {
            return api.request("POST", "/emails/receiving/" + enc(id) + "/reply", request, idempotencyKey);
        }

        /** Delete a received email. {@code DELETE /emails/receiving/:id} */
        public SendPingResponse remove(String id) {
            return api.request("DELETE", "/emails/receiving/" + enc(id));
        }
    }
}

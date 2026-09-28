package co.sendping.resources;

import co.sendping.SendPingResponse;
import co.sendping.http.ApiClient;
import co.sendping.requests.BatchEmailRequest;
import co.sendping.requests.SendEmailRequest;

import java.util.List;

/** Batch send — {@code sendping.batch().send(...)}. */
public final class Batch extends Resource {
    public Batch(ApiClient api) { super(api); }

    /**
     * Send up to 100 emails in one request. {@code POST /emails/batch}
     *
     * @deprecated use {@link #sendEmails(List)} — batch items reject
     *     {@code attachments} and {@code scheduled_at} (send those individually
     *     via {@code emails().send}), which {@link BatchEmailRequest} enforces
     *     at compile time.
     */
    @Deprecated
    public SendPingResponse send(List<SendEmailRequest> requests) {
        return api.request("POST", "/emails/batch", requests);
    }

    /** @deprecated use {@link #sendEmails(List, String)} — see {@link #send(List)}. */
    @Deprecated
    public SendPingResponse send(List<SendEmailRequest> requests, String idempotencyKey) {
        return api.request("POST", "/emails/batch", requests, idempotencyKey);
    }

    /**
     * Send up to 100 emails in one request. Batch items reject
     * {@code attachments} and {@code scheduled_at} — send those individually
     * via {@code emails().send}. {@code POST /emails/batch}
     *
     * <p><strong>Two success shapes, chosen by batch SIZE alone.</strong> Up to
     * 40 emails are sent while the request is open ({@code 200}); that body has
     * no {@code queued} key at all. A batch of 41–100 is ACCEPTED AND QUEUED
     * ({@code 202}): the body then carries {@code queued: true} and
     * {@code queued_count}, the ids are real ({@code emails().get(id)} works),
     * but every row starts at {@code scheduled} and NOTHING has been
     * transmitted — the worker sends on its next tick, so poll
     * {@code emails().get(id)} for the real outcome. A batch carrying any
     * {@code @test.sendping.co} simulator recipient (in {@code to}, {@code cc} or
     * {@code bcc}) stays inline at any size.
     *
     * <pre>{@code
     * SendPingResponse res = sendping.batch().sendEmails(requests);
     * if (res.statusCode() == 202) {                 // accepted, not sent
     *     Integer n = res.getInt("queued_count");    // null on the inline path
     * }
     * }</pre>
     *
     * <p>Branch on {@code res.statusCode() == 202} (or
     * {@code Boolean.TRUE.equals(res.getBoolean("queued"))}), never on a bare
     * {@code res.getBoolean("queued")}: it is a boxed {@code Boolean} and is
     * {@code null} for every inline batch, so unboxing it there throws.
     */
    public SendPingResponse sendEmails(List<BatchEmailRequest> requests) {
        return api.request("POST", "/emails/batch", requests);
    }

    /**
     * Like {@link #sendEmails(List)}, with an {@code Idempotency-Key} so a
     * retry replays the first response instead of re-sending.
     *
     * <p>The key must be <strong>1–255 characters</strong> after trimming
     * (anything else is a {@code 400 invalid_idempotency_key}) and is bound to
     * the request body.
     *
     * <p>When a batch fails partway the error body always carries {@code sent}
     * (the ids already sent) and {@code sent_count}, with or without a key; read
     * them from {@link co.sendping.SendPingException#getBody()}. The key
     * changes the STATUS, not the data: a keyless partial is downgraded to
     * {@code 422} precisely so no client auto-retries and re-sends the prefix.
     *
     * <p>A queued batch ({@code 202} — see {@link #sendEmails(List)} for when
     * size sends it down that path) records its answer under the key inside the
     * same transaction as the rows, so a retry replays the {@code 202} rather
     * than enqueuing a second copy.
     */
    public SendPingResponse sendEmails(List<BatchEmailRequest> requests, String idempotencyKey) {
        return api.request("POST", "/emails/batch", requests, idempotencyKey);
    }
}

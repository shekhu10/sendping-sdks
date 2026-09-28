package co.sendping.tests;

import co.sendping.SendPing;
import co.sendping.SendPingException;
import co.sendping.SendPingResponse;
import co.sendping.ListParams;
import co.sendping.requests.Attachment;
import co.sendping.requests.ForwardEmailRequest;
import co.sendping.requests.SendEmailRequest;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;

/** Emails + batch + receiving + error handling, against the stub transport. */
public final class EmailsTest {
    public static void run() {
        Check.suite("EmailsTest");
        StubTransport t = new StubTransport();
        SendPing mb = new SendPing("mb_test_key", "https://api.test", t);

        // --- send: method / path / auth / body / parsed response ---
        t.respond(200, "{\"id\":\"em_1\"}");
        SendEmailRequest req = SendEmailRequest.builder()
                .from("Acme <hi@yourdomain.com>")
                .to("a@b.com")
                .subject("hello")
                .html("<p>hi</p>")
                .build();
        SendPingResponse res = mb.emails().send(req);
        Check.eq("send method", "POST", t.lastMethod);
        Check.eq("send url", "https://api.test/emails", t.lastUrl);
        Check.eq("send auth header", "Bearer mb_test_key", t.lastHeaders.get("Authorization"));
        Check.eq("send content-type", "application/json", t.lastHeaders.get("Content-Type"));
        Check.eq("send user-agent", "sendping-java/" + SendPing.VERSION, t.lastHeaders.get("User-Agent"));
        Check.eq("send body",
                "{\"from\":\"Acme <hi@yourdomain.com>\",\"to\":[\"a@b.com\"],\"subject\":\"hello\",\"html\":\"<p>hi</p>\"}",
                t.lastBody);
        Check.eq("send response id", "em_1", res.getString("id"));

        // --- send with idempotency key ---
        mb.emails().send(req, "order-123");
        Check.eq("idempotency header", "order-123", t.lastHeaders.get("Idempotency-Key"));

        // The documented bound is 1-255 characters, measured AFTER the server
        // trims the value (api_idempotency.key is VARCHAR(255)) -- 255, not 256.
        // The constant is exported so the rule is discoverable; the key is sent
        // verbatim and the SERVER rejects an out-of-range one with
        // 400 invalid_idempotency_key, so nothing is checked here.
        Check.eq("idempotency key max length", 255, SendPing.IDEMPOTENCY_KEY_MAX_LENGTH);
        String tooLong = "k".repeat(SendPing.IDEMPOTENCY_KEY_MAX_LENGTH + 1);
        mb.emails().send(req, tooLong);
        Check.eq("over-long idempotency key is left to the server", tooLong,
                t.lastHeaders.get("Idempotency-Key"));

        // --- attachments + escaping ---
        mb.emails().send(SendEmailRequest.builder()
                .from("a@b.com").to("c@d.com").subject("q\"uote\nline")
                .attachment(Attachment.builder().filename("inv.pdf").path("https://x/y.pdf").build())
                .build());
        Check.contains("attachment serialized", t.lastBody,
                "\"attachments\":[{\"filename\":\"inv.pdf\",\"path\":\"https://x/y.pdf\"}]");
        Check.contains("string escaping", t.lastBody, "\"subject\":\"q\\\"uote\\nline\"");

        // --- batch (both surfaces) ---
        t.respond(200, "{\"data\":[{\"id\":\"em_1\"},{\"id\":\"em_2\"}]}");
        List<SendEmailRequest> payloads = Arrays.asList(
                SendEmailRequest.builder().from("a@b.com").to("x@y.com").subject("one").build(),
                SendEmailRequest.builder().from("a@b.com").to("z@y.com").subject("two").build());
        SendPingResponse batchRes = mb.batch().send(payloads);
        Check.eq("batch url", "https://api.test/emails/batch", t.lastUrl);
        Check.isTrue("batch body is a JSON array", t.lastBody.startsWith("[") && t.lastBody.endsWith("]"));
        Check.contains("batch body has both", t.lastBody, "\"subject\":\"two\"");
        Check.eq("batch second id via path", "em_2", batchRes.getString("data.1.id"));
        mb.emails().batch(payloads);
        Check.eq("emails().batch alias url", "https://api.test/emails/batch", t.lastUrl);

        // --- batch over 40 is ACCEPTED AND QUEUED (202), not sent ---
        // Size alone routes the request (app/api/emails/batch/route.ts
        // BATCH_SYNC_MAX = 40). The inline 200 above omits `queued` entirely,
        // so getBoolean returns null there and a bare unboxed read would throw
        // — the javadoc tells callers to branch on statusCode()/Boolean.TRUE
        // instead, and 2xx never throws, so the 202 reaches them intact.
        Check.isNull("inline 200 has no queued key", batchRes.getBoolean("queued"));
        Check.eq("inline 200 leaves statusCode at 200", 200, batchRes.statusCode());
        t.respond(202, "{\"data\":[{\"id\":\"em_1\"}],\"queued\":true,\"queued_count\":41}");
        SendPingResponse queuedRes = mb.batch().sendEmails(java.util.Collections.emptyList());
        Check.eq("queued batch surfaces 202", 202, queuedRes.statusCode());
        Check.eq("queued batch queued flag", Boolean.TRUE, queuedRes.getBoolean("queued"));
        Check.eq("queued batch queued_count", 41, queuedRes.getInt("queued_count"));
        t.respond(200, "{}");

        // --- list with pagination ---
        t.respond(200, "{\"object\":\"list\",\"has_more\":true,\"data\":[{\"id\":\"em_9\"}]}");
        SendPingResponse listRes = mb.emails().list(ListParams.builder().limit(20).after("cur_1").build());
        Check.eq("list url", "https://api.test/emails?limit=20&after=cur_1", t.lastUrl);
        Check.eq("list has_more", Boolean.TRUE, listRes.getBoolean("has_more"));
        Check.eq("list data.0.id", "em_9", listRes.getString("data.0.id"));

        // --- id path-encoding (no traversal) ---
        t.respond(200, "{}");
        mb.emails().get("em 1/../x");
        Check.eq("get encodes id", "https://api.test/emails/em%201%2F..%2Fx", t.lastUrl);

        // --- attachments metadata, reschedule, cancel ---
        mb.emails().getAttachment("em_1", "att_1");
        Check.eq("getAttachment url", "https://api.test/emails/em_1/attachments/att_1", t.lastUrl);
        mb.emails().update("em_1", "2026-08-05T11:52:01Z");
        Check.eq("update method", "PATCH", t.lastMethod);
        Check.eq("update body", "{\"scheduled_at\":\"2026-08-05T11:52:01Z\"}", t.lastBody);
        mb.emails().cancel("em_1");
        Check.eq("cancel url", "https://api.test/emails/em_1/cancel", t.lastUrl);
        Check.isNull("cancel has no body", t.lastBody);

        // --- receiving: binary + JSON routes ---
        byte[] pdf = new byte[] {37, 80, 68, 70, 0, 1, 2};
        t.respondBytes(200, pdf);
        byte[] got = mb.emails().receiving().getAttachment("re_1", "att_9");
        Check.eq("receiving attachment url", "https://api.test/emails/receiving/re_1/attachments/att_9", t.lastUrl);
        Check.isTrue("receiving attachment bytes", Arrays.equals(pdf, got));
        Check.isNull("raw request sends no content-type", t.lastHeaders.get("Content-Type"));
        byte[] raw = mb.emails().receiving().getRaw("re_1");
        Check.eq("receiving raw url", "https://api.test/emails/receiving/re_1/raw", t.lastUrl);
        Check.isTrue("receiving raw bytes", Arrays.equals(pdf, raw));

        t.respond(200, "{\"id\":\"em_f\"}");
        mb.emails().receiving().forward("re_1", ForwardEmailRequest.builder()
                .from("you@yourdomain.com").to("team@you.com").build());
        Check.eq("forward url", "https://api.test/emails/receiving/re_1/forward", t.lastUrl);
        Check.eq("forward body", "{\"from\":\"you@yourdomain.com\",\"to\":[\"team@you.com\"]}", t.lastBody);
        mb.emails().receiving().remove("re_1");
        Check.eq("receiving remove method", "DELETE", t.lastMethod);

        // --- non-2xx throws SendPingException(statusCode, name, message) ---
        t.respond(422, "{\"statusCode\":422,\"name\":\"validation_error\",\"message\":\"missing to\"}");
        try {
            mb.emails().send(req);
            Check.isTrue("422 throws", false);
        } catch (SendPingException e) {
            Check.eq("error statusCode", 422, e.getStatusCode());
            Check.eq("error name", "validation_error", e.getName());
            Check.eq("error message", "missing to", e.getMessage());
        }

        // --- non-JSON error body falls back gracefully ---
        t.respond(500, "gateway exploded");
        try {
            mb.emails().get("em_1");
            Check.isTrue("500 throws", false);
        } catch (SendPingException e) {
            Check.eq("fallback statusCode", 500, e.getStatusCode());
            Check.eq("fallback name", "application_error", e.getName());
        }
        t.respond(200, "{}");
    }

    public static void main(String[] args) {
        run();
        Check.finish();
    }
}

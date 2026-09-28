package co.sendping.tests;

import co.sendping.SendPing;
import co.sendping.SendPingResponse;
import co.sendping.requests.CreateWebhookRequest;
import co.sendping.requests.SendEventRequest;
import co.sendping.resources.VerifyWebhookResult;
import co.sendping.resources.Webhooks;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/** Webhook CRUD + local Svix-style signature verification + events.send. */
public final class WebhooksTest {

    private static String sign(String id, String ts, String payload, byte[] key) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return Base64.getEncoder().encodeToString(
                mac.doFinal((id + "." + ts + "." + payload).getBytes(StandardCharsets.UTF_8)));
    }

    private static Map<String, String> headers(String id, String ts, String sig) {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("svix-id", id);
        h.put("svix-timestamp", ts);
        h.put("svix-signature", sig);
        return h;
    }

    public static void run() throws Exception {
        Check.suite("WebhooksTest");
        StubTransport t = new StubTransport();
        SendPing mb = new SendPing("mb_test_key", "https://api.test", t);

        // --- CRUD surface ---
        t.respond(200, "{\"object\":\"webhook\",\"id\":\"wh_1\",\"signing_secret\":\"whsec_abc\"}");
        SendPingResponse created = mb.webhooks().create(CreateWebhookRequest.builder()
                .endpoint("https://yourapp.com/hooks")
                .events("email.delivered", "email.bounced")
                .build());
        Check.eq("webhook create url", "https://api.test/webhooks", t.lastUrl);
        Check.eq("webhook create body",
                "{\"endpoint\":\"https://yourapp.com/hooks\",\"events\":[\"email.delivered\",\"email.bounced\"]}",
                t.lastBody);
        Check.eq("webhook secret returned once", "whsec_abc", created.getString("signing_secret"));
        mb.webhooks().rotate("wh_1");
        Check.eq("rotate url", "https://api.test/webhooks/wh_1/rotate", t.lastUrl);
        mb.webhooks().test("wh_1");
        Check.eq("test url", "https://api.test/webhooks/wh_1/test", t.lastUrl);

        // --- verify: raw-string secret, exact payload ---
        String payload = "{\"type\":\"email.delivered\",\"data\":{\"id\":\"em_1\"}}";
        String id = "msg_123";
        String now = String.valueOf(System.currentTimeMillis() / 1000L);
        String rawSecret = "topsecret-key";
        String sig = sign(id, now, payload, rawSecret.getBytes(StandardCharsets.UTF_8));

        VerifyWebhookResult ok = Webhooks.verifyWebhookSignature(
                payload, headers(id, now, "v1," + sig), rawSecret);
        Check.isTrue("valid signature (raw secret)", ok.isValid());
        Check.isNull("valid has no reason", ok.getReason());

        // --- verify: whsec_ base64 secret derives the same key ---
        String whsec = "whsec_" + Base64.getEncoder().encodeToString(rawSecret.getBytes(StandardCharsets.UTF_8));
        Check.isTrue("valid signature (whsec_ secret)",
                Webhooks.verifyWebhookSignature(payload, headers(id, now, "v1," + sig), whsec).isValid());

        // --- verify: the whsec_ suffix must decode as leniently as the signer ---
        // The `secret` field on POST /webhooks is stored verbatim, so a caller
        // can hand us any base64 spelling. Node's Buffer.from(suffix,'base64')
        // at the signer (lib/crypto.ts secretToKey) ignores out-of-alphabet
        // characters, needs no padding, reads "-"/"_" as "+"/"/", and drops a
        // lone 1-char remainder. Java's Base64.getDecoder() throws on three of
        // those four, and the raw-UTF-8 fallback then derived a DIFFERENT key
        // than the signer — every authentic delivery came back no_match.
        // Each fixture below signs with the RAW KEY BYTES, so a failure here
        // means the SDK derived a different key, not that the HMAC drifted.
        byte[] keyBytes = {(byte) 0xfb, (byte) 0xff, (byte) 0xbe, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13};
        String keySig = sign(id, now, payload, keyBytes); // 0xfb/0xff/0xbe force "+" and "/"
        Check.isTrue("whsec_ url-safe alphabet derives the signer's key",
                Webhooks.verifyWebhookSignature(payload, headers(id, now, "v1," + keySig),
                        "whsec_" + Base64.getUrlEncoder().withoutPadding().encodeToString(keyBytes)).isValid());
        Check.isTrue("whsec_ unpadded standard alphabet derives the signer's key",
                Webhooks.verifyWebhookSignature(payload, headers(id, now, "v1," + keySig),
                        "whsec_" + Base64.getEncoder().withoutPadding().encodeToString(keyBytes)).isValid());
        Check.isTrue("whsec_ url-safe WITH padding derives the signer's key",
                Webhooks.verifyWebhookSignature(payload, headers(id, now, "v1," + keySig),
                        "whsec_" + Base64.getUrlEncoder().encodeToString(keyBytes)).isValid());

        // A 12-byte key encodes to 16 chars; one extra alphabet char makes the
        // suffix length 1 mod 4. Node drops that char and returns the 12 bytes.
        byte[] shortKey = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
        String shortSig = sign(id, now, payload, shortKey);
        Check.isTrue("whsec_ lone trailing char is dropped, not fatal",
                Webhooks.verifyWebhookSignature(payload, headers(id, now, "v1," + shortSig),
                        "whsec_" + Base64.getEncoder().withoutPadding().encodeToString(shortKey) + "D").isValid());

        // Whitespace inside the suffix (a wrapped copy-paste) is ignored, not fatal.
        byte[] junkKey = {1, 2, 3, 4, 5, 6, 7, 8, 9};
        String junkSig = sign(id, now, payload, junkKey);
        String junkEnc = Base64.getEncoder().withoutPadding().encodeToString(junkKey);
        Check.isTrue("whsec_ out-of-alphabet characters are ignored, not fatal",
                Webhooks.verifyWebhookSignature(payload, headers(id, now, "v1," + junkSig),
                        "whsec_" + junkEnc.substring(0, 4) + " " + junkEnc.substring(4, 8)
                                + "\n" + junkEnc.substring(8)).isValid());

        // A suffix that decodes to no bytes at all still falls back to the raw
        // UTF-8 bytes of the whole whsec_ string, exactly as the signer does.
        String emptySuffix = "whsec_A";
        Check.isTrue("whsec_ suffix decoding to no bytes falls back to raw UTF-8",
                Webhooks.verifyWebhookSignature(payload, headers(id, now,
                        "v1," + sign(id, now, payload, emptySuffix.getBytes(StandardCharsets.UTF_8))),
                        emptySuffix).isValid());

        // --- multiple space-separated signatures: any match wins ---
        Check.isTrue("any-of-many signatures matches",
                Webhooks.verifyWebhookSignature(payload,
                        headers(id, now, "v1,bogus= v1," + sig), rawSecret).isValid());

        // --- case-insensitive header names + untagged signature accepted ---
        Map<String, String> mixed = new LinkedHashMap<>();
        mixed.put("Svix-Id", id);
        mixed.put("SVIX-TIMESTAMP", now);
        mixed.put("Svix-Signature", sig); // no v1, prefix
        Check.isTrue("case-insensitive headers",
                Webhooks.verifyWebhookSignature(payload, mixed, rawSecret).isValid());

        // --- tampered payload fails ---
        VerifyWebhookResult tampered = Webhooks.verifyWebhookSignature(
                payload + " ", headers(id, now, "v1," + sig), rawSecret);
        Check.isTrue("tampered payload invalid", !tampered.isValid());
        Check.eq("tampered reason", "no_match", tampered.getReason());

        // --- wrong secret fails ---
        Check.eq("wrong secret reason", "no_match",
                Webhooks.verifyWebhookSignature(payload, headers(id, now, "v1," + sig), "other").getReason());

        // --- stale timestamp fails, unless tolerance is disabled ---
        String stale = String.valueOf(System.currentTimeMillis() / 1000L - 3600);
        String staleSig = sign(id, stale, payload, rawSecret.getBytes(StandardCharsets.UTF_8));
        Check.eq("stale timestamp reason", "timestamp_out_of_tolerance",
                Webhooks.verifyWebhookSignature(payload, headers(id, stale, "v1," + staleSig), rawSecret).getReason());
        Check.isTrue("tolerance 0 disables freshness check",
                Webhooks.verifyWebhookSignature(payload, headers(id, stale, "v1," + staleSig), rawSecret, 0).isValid());

        // --- garbage timestamp / missing headers / missing secret ---
        Check.eq("invalid timestamp reason", "invalid_timestamp",
                Webhooks.verifyWebhookSignature(payload, headers(id, "soon", "v1,x"), rawSecret).getReason());
        Map<String, String> missing = new LinkedHashMap<>();
        missing.put("svix-id", id);
        Check.eq("missing headers reason", "missing_headers",
                Webhooks.verifyWebhookSignature(payload, missing, rawSecret).getReason());
        Check.eq("missing secret reason", "missing_secret",
                Webhooks.verifyWebhookSignature(payload, headers(id, now, "v1," + sig), "").getReason());

        // --- instance alias delegates to the same logic ---
        Check.isTrue("instance verify alias",
                mb.webhooks().verify(payload, headers(id, now, "v1," + sig), rawSecret).isValid());

        // --- events.send: domain is REQUIRED and carried in the body ---
        t.respond(200, "{\"object\":\"event\",\"id\":\"evt_1\",\"enrolled\":1}");
        mb.events().send(SendEventRequest.builder()
                .event("signup.completed")
                .domain("yourdomain.com")
                .email("user@example.com")
                .payload("plan", "pro")
                .build());
        Check.eq("event send url", "https://api.test/events/send", t.lastUrl);
        Check.eq("event send body",
                "{\"event\":\"signup.completed\",\"domain\":\"yourdomain.com\","
                        + "\"email\":\"user@example.com\",\"payload\":{\"plan\":\"pro\"}}",
                t.lastBody);
        // The plain send must NOT set Idempotency-Key: /events/send ignores the
        // header, so advertising it would imply a dedupe the API never does.
        mb.events().send(SendEventRequest.builder()
                .name("signup.completed").domain("yourdomain.com").contactId("c_1").build());
        Check.isNull("event send sends no Idempotency-Key", t.lastHeaders.get("Idempotency-Key"));
    }

    public static void main(String[] args) throws Exception {
        run();
        Check.finish();
    }
}

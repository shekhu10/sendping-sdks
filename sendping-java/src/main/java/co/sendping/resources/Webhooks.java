package co.sendping.resources;

import co.sendping.ListParams;
import co.sendping.SendPingResponse;
import co.sendping.http.ApiClient;
import co.sendping.requests.CreateWebhookRequest;
import co.sendping.requests.UpdateWebhookRequest;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Map;

/** Webhooks — {@code sendping.webhooks()} — including local Svix-style signature verification. */
public final class Webhooks extends Resource {
    public Webhooks(ApiClient api) { super(api); }

    /** Create a webhook. The signing secret is shown ONCE, only here. {@code POST /webhooks} */
    public SendPingResponse create(CreateWebhookRequest request) {
        return api.request("POST", "/webhooks", request);
    }

    /** {@code GET /webhooks/:id} */
    public SendPingResponse get(String id) {
        return api.request("GET", "/webhooks/" + enc(id));
    }

    /**
     * List webhooks. Unlike domains/api-keys/topics this route always applies a
     * limit — with no pagination params you get the first 20.
     * {@code GET /webhooks}
     */
    public SendPingResponse list() { return list(null); }

    public SendPingResponse list(ListParams params) {
        return api.request("GET", "/webhooks" + paginate(params));
    }

    /** Returns the slim ack {@code { object: 'webhook', id }}. {@code PATCH /webhooks/:id} */
    public SendPingResponse update(String id, UpdateWebhookRequest request) {
        return api.request("PATCH", "/webhooks/" + enc(id), request);
    }

    /**
     * Rotate the signing secret — the new plaintext {@code signing_secret} is
     * returned ONCE; the old secret stops verifying immediately.
     * {@code POST /webhooks/:id/rotate}
     */
    public SendPingResponse rotate(String id) {
        return api.request("POST", "/webhooks/" + enc(id) + "/rotate");
    }

    /**
     * Send a synchronous, single-attempt test delivery and return the
     * endpoint's live result.
     *
     * <p><strong>A failed delivery is still HTTP 200</strong> — this method
     * does not throw for one. Inspect {@code ok} on the response
     * ({@code res.getBoolean("ok")}) and read {@code error} when it is false.
     * {@code POST /webhooks/:id/test}
     */
    public SendPingResponse test(String id) {
        return api.request("POST", "/webhooks/" + enc(id) + "/test");
    }

    /** {@code DELETE /webhooks/:id} */
    public SendPingResponse remove(String id) {
        return api.request("DELETE", "/webhooks/" + enc(id));
    }

    /** Instance alias of {@link #verifyWebhookSignature(String, Map, String)}. */
    public VerifyWebhookResult verify(String payload, Map<String, String> headers, String secret) {
        return verifyWebhookSignature(payload, headers, secret);
    }

    /** Instance alias of {@link #verifyWebhookSignature(String, Map, String, long)}. */
    public VerifyWebhookResult verify(String payload, Map<String, String> headers, String secret, long toleranceSec) {
        return verifyWebhookSignature(payload, headers, secret, toleranceSec);
    }

    /** Verify with the default 5-minute timestamp tolerance. */
    public static VerifyWebhookResult verifyWebhookSignature(String payload, Map<String, String> headers, String secret) {
        return verifyWebhookSignature(payload, headers, secret, 300);
    }

    /**
     * Verify a webhook delivery's Svix-style signature against your endpoint's
     * signing secret. Mirrors the backend signing scheme:
     * {@code "<svix-id>.<svix-timestamp>.<body>"} → base64 HMAC-SHA256, tagged
     * {@code v1,}.
     *
     * <p>{@code payload} MUST be the exact raw request body string the server
     * sent — do not re-serialize parsed JSON (whitespace differences break the
     * signature). {@code headers} must contain the {@code svix-id},
     * {@code svix-timestamp} and {@code svix-signature} headers (read
     * case-insensitively). A signature header may carry multiple
     * space-separated signatures; any one matching makes the delivery valid.
     * A {@code whsec_}-prefixed secret is base64-decoded exactly as leniently
     * as the signer decodes it — unpadded, junk-bearing and URL-safe
     * ({@code -}/{@code _}) spellings all derive the same key, a {@code =}
     * truncates the suffix rather than padding it, and a non-ASCII character
     * decodes as the low byte of its UTF-16 code unit rather than being skipped
     * (see {@link #b64Lenient(String)}). A secret without the prefix, or one whose
     * suffix decodes to nothing, is used as the raw UTF-8 bytes of the WHOLE
     * secret string.
     *
     * <p>This is a pure local computation — it makes no HTTP request.
     *
     * @param toleranceSec max allowed clock skew in seconds (0 disables the check)
     */
    public static VerifyWebhookResult verifyWebhookSignature(
            String payload, Map<String, String> headers, String secret, long toleranceSec) {
        String id = readHeader(headers, "svix-id");
        String timestamp = readHeader(headers, "svix-timestamp");
        String sigHeader = readHeader(headers, "svix-signature");
        if (isBlank(id) || isBlank(timestamp) || isBlank(sigHeader)) {
            return new VerifyWebhookResult(false, "missing_headers");
        }
        if (isBlank(secret)) {
            return new VerifyWebhookResult(false, "missing_secret");
        }

        // Optional timestamp freshness check (default 5-minute tolerance; 0 disables).
        if (toleranceSec > 0) {
            long ts;
            try {
                ts = Long.parseLong(timestamp.trim());
            } catch (NumberFormatException e) {
                return new VerifyWebhookResult(false, "invalid_timestamp");
            }
            long skew = Math.abs(System.currentTimeMillis() / 1000L - ts);
            if (skew > toleranceSec) {
                return new VerifyWebhookResult(false, "timestamp_out_of_tolerance");
            }
        }

        String signed = id + "." + timestamp + "." + (payload == null ? "" : payload);
        String expected;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secretToKey(secret), "HmacSHA256"));
            expected = Base64.getEncoder().encodeToString(mac.doFinal(signed.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }

        // The header may contain multiple space-separated `v1,<sig>` entries; any match wins.
        for (String part : sigHeader.split(" ")) {
            String trimmed = part.trim();
            if (trimmed.isEmpty()) continue;
            String sig = trimmed.startsWith("v1,") ? trimmed.substring(3) : trimmed;
            if (MessageDigest.isEqual(
                    sig.getBytes(StandardCharsets.UTF_8),
                    expected.getBytes(StandardCharsets.UTF_8))) {
                return new VerifyWebhookResult(true, null);
            }
        }
        return new VerifyWebhookResult(false, "no_match");
    }

    /** Base64 alphabet, plus the URL-safe spellings of the last two characters. */
    private static final String B64_ALPHABET =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/-_";

    /**
     * Decode base64 the way the signer does, not the way Java does.
     *
     * <p>The backend derives its key with Node's {@code Buffer.from(suffix,
     * 'base64')} (lib/crypto.ts {@code secretToKey}). That decoder is NOT the
     * RFC, and reading it as the RFC is precisely how this bug shipped twice.
     * Five of its behaviours matter, and each one has a conformance vector:
     *
     * <ol>
     *   <li>{@code =} TERMINATES the input — everything from the first
     *       {@code =} onward is DISCARDED. It is not "padding to be stripped":
     *       {@code "YWJj====ZA"} decodes to {@code "abc"}, never
     *       {@code "abcd"}, and {@code "Y=WJj"} decodes to nothing at all.</li>
     *   <li>Out-of-alphabet characters are SKIPPED, never fatal — whitespace,
     *       punctuation and non-ASCII alike ({@code "YW!Jj"} is {@code "abc"}).</li>
     *   <li>{@code -} and {@code _} are the URL-safe spellings of {@code +} and
     *       {@code /} and must be TRANSLATED, not dropped — dropping them
     *       silently reshapes the whole byte stream.</li>
     *   <li>A trailing group of ONE character carries no whole byte and is
     *       discarded (2 chars -&gt; 1 byte, 3 -&gt; 2, 4 -&gt; 3).</li>
     *   <li>The decoded UNIT is the LOW 8 BITS of each UTF-16 CODE UNIT, not the
     *       codepoint: Node masks every code unit with {@code 0xFF} before the
     *       table lookup, so a non-ASCII character is not junk to be skipped —
     *       it MASQUERADES as the ASCII character it aliases. {@code "YWŁj"}
     *       keys on {@code 616023} because U+0141 masks to {@code 0x41} 'A';
     *       {@code "YWJjĽZA"} keys on {@code 616263} because U+013D masks to
     *       {@code 0x3D} '=' and TERMINATES. Astral characters contribute their
     *       two SURROGATE halves, not their UTF-8 bytes: U+1D441 is
     *       {@code 0xD835}/{@code 0xDC41}, masking to '5' and 'A'.</li>
     * </ol>
     *
     * <p>Java agrees with none of these unaided. {@code Base64.getDecoder()}
     * throws on {@code -}/{@code _}, on any other out-of-alphabet character and
     * on a trailing 1-character group; {@code getMimeDecoder()} skips junk but
     * treats {@code =} as padding it may decode straight past, and both read the
     * character, never its low byte. So the mask, the cut at the first
     * {@code =}, the alphabet filter and the URL-safe translation are all done
     * HERE, by hand, before Java's decoder is allowed near the input.
     *
     * <p>Why this matters more than it looks: the {@code secret} field on
     * {@code POST /webhooks} is stored verbatim with no shape validation, so a
     * customer really can hold a secret of any shape above. A key that differs
     * from the signer's does not fail loudly — verification just returns
     * {@code no_match}, and a correctly configured endpoint silently treats
     * every genuine delivery as forged.
     */
    private static byte[] b64Lenient(String text) {
        StringBuilder cleaned = new StringBuilder(text.length());
        for (int i = 0; i < text.length(); i++) {
            // Rule 5, and it MUST come first: mask to the low 8 bits of the
            // UTF-16 code unit. `charAt` deliberately walks code UNITS, so an
            // astral character arrives as its two surrogates and contributes
            // both their low bytes — iterating codePoints would collapse it to
            // one wrong unit. Masking after the `=` cut or the alphabet filter
            // is the bug: U+013D would be skipped as junk instead of
            // terminating, and U+0141 dropped instead of aliasing 'A'.
            char c = (char) (text.charAt(i) & 0xFF);

            // Rule 1: `=` TERMINATES — the remainder of the suffix is gone, not
            // padding to be stripped. Filtering it away as junk and decoding on
            // is the shared root-cause bug every SDK carried.
            if (c == '=') break;

            // Rules 2 and 3: keep alphabet characters only, translating the
            // URL-safe spellings instead of discarding them.
            if (B64_ALPHABET.indexOf(c) < 0) continue;
            cleaned.append(c == '-' ? '+' : c == '_' ? '/' : c);
        }

        // Rule 4: a single leftover character encodes no whole byte; Node
        // discards it rather than failing the decode. Java's MIME decoder would
        // throw ("Last unit does not have enough valid bits") and lose the key.
        if (cleaned.length() % 4 == 1) cleaned.setLength(cleaned.length() - 1);
        try {
            // The MIME decoder, unlike getDecoder(), tolerates absent padding.
            return Base64.getMimeDecoder().decode(cleaned.toString());
        } catch (IllegalArgumentException ignored) { // defensive — input is pre-cleaned
            return new byte[0];
        }
    }

    /**
     * Derive the HMAC key from a secret, mirroring the server's
     * {@code secretToKey} (lib/crypto.ts) exactly.
     *
     * <p>A {@code whsec_}-prefixed secret keys on the leniently decoded suffix
     * (see {@link #b64Lenient(String)}). Everything else — no prefix, or a
     * suffix that decodes to ZERO bytes — keys on the raw UTF-8 bytes of the
     * WHOLE secret, {@code whsec_} prefix INCLUDED. That last clause is easy to
     * miss and easy to get subtly wrong (keying on the bare suffix, or on the
     * empty decode, both look reasonable); it is reached by every secret whose
     * suffix is one alphabet character, is empty, or begins with {@code =}, and
     * getting it wrong costs the customer every genuine delivery.
     *
     * <p>The fallback takes the secret's REAL UTF-8 bytes — the {@code 0xFF}
     * masking of {@link #b64Lenient(String)} belongs to the base64 table lookup
     * only, so {@code "whsec_š"} falls back to the 8 bytes of {@code "whsec_š"},
     * not to the masked {@code 0x61}.
     */
    private static byte[] secretToKey(String secret) {
        if (secret.startsWith("whsec_")) {
            byte[] decoded = b64Lenient(secret.substring("whsec_".length()));
            if (decoded.length > 0) return decoded;
        }
        return secret.getBytes(StandardCharsets.UTF_8);
    }

    /** Case-insensitively read a single header value. */
    private static String readHeader(Map<String, String> headers, String name) {
        if (headers == null) return null;
        for (Map.Entry<String, String> e : headers.entrySet()) {
            if (e.getKey() != null && e.getKey().equalsIgnoreCase(name)) return e.getValue();
        }
        return null;
    }

    private static boolean isBlank(String s) { return s == null || s.isEmpty(); }
}

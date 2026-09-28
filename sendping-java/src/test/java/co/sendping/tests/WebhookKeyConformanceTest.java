package co.sendping.tests;

import co.sendping.resources.VerifyWebhookResult;
import co.sendping.resources.Webhooks;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Conformance corpus for {@code whsec_} HMAC key derivation.
 *
 * <p>WHY THIS SUITE EXISTS. The server derives a webhook's key with Node's
 * {@code Buffer.from(suffix, 'base64')} (sendping_webapp/lib/crypto.ts
 * {@code secretToKey}). Reproducing that byte for byte is not optional and not
 * cosmetic: a key that differs from the signer's does not fail loudly. Verify
 * simply returns {@code no_match}, so a correctly configured customer endpoint
 * silently treats every genuine delivery as forged, forever, with nothing in
 * any log to say why. That failure has shipped twice — 4.0.0 fixed strict
 * decoding in two SDKs, 5.0.0 fixed the rest by porting one of them and
 * inherited its residual divergence, because nobody had vectors.
 *
 * <p>So these 41 vectors are generated FROM NODE ITSELF by
 * {@code scripts/webhook-b64-corpus.mjs}, never from anyone's reading of a
 * base64 RFC — reading the RFC is how the bug happened. They are INLINED rather
 * than read from that path so a published tarball's tests stay self-contained;
 * regenerate the corpus and re-paste the table when the spec moves.
 *
 * <p>Between them the vectors pin all five of Node's real rules ({@code =}
 * terminates rather than pads, out-of-alphabet characters are skipped rather
 * than fatal, {@code -}/{@code _} translate rather than drop, a lone trailing
 * character carries no byte, and the decoded unit is the LOW 8 BITS of each
 * UTF-16 code unit rather than the codepoint) plus the caller-side rule that an
 * empty decode falls back to the UTF-8 bytes of the WHOLE secret, {@code whsec_}
 * prefix included. Every shape here is reachable in production: the
 * {@code secret} field on {@code POST /webhooks} is stored verbatim with no
 * shape validation.
 *
 * <p>The counts below (41 vectors, 10 raw-fallback, 10 rule-5) are asserted, not
 * documented. An ASCII-only table is exactly what let rule 5 hide: the previous
 * 31 vectors passed 31/31 in every SDK while all seven derived the wrong key for
 * more than half of all inputs carrying a codepoint above 0xFF. Pinning the
 * counts means a lossy re-paste fails loudly instead of testing less.
 */
public final class WebhookKeyConformanceTest {

    // BODY / ID are fixed by the corpus; the timestamp travels with the
    // Node-generated signatures below.
    private static final String CORPUS_BODY = "{\"type\":\"email.delivered\",\"data\":{\"id\":\"em_1\"}}";
    private static final String CORPUS_ID = "msg_conformance";
    private static final String CORPUS_TS = "1787200000";

    /** name, secret, key_hex, key_is_raw_fallback, Node-generated signature. */
    private static final String[][] VECTORS = {
        {"std_padded", "whsec_YWJjZA==", "61626364", "false", "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg="},
        {"std_unpadded", "whsec_YWJjZA", "61626364", "false", "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg="},
        {"std_exact4", "whsec_YWJj", "616263", "false", "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk="},
        {"short_1", "whsec_Y", "77687365635f59", "true", "v1,ZMKGqdkd7rDYPj+XX10aKkkyV1NMbcTZ7tFWT6FOwdI="},
        {"short_2", "whsec_YW", "61", "false", "v1,xnhr17yqBov566EgLaHShB0U7fh87lB6A7uiu7MAgLo="},
        {"short_3", "whsec_YWJ", "6162", "false", "v1,Fen63yOpcFJsYPJGDIVlJAcEyTdJLIHURAdGZghc0kI="},
        {"interior_eq", "whsec_YWJjZA==ZXh0cmE", "61626364", "false", "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg="},
        {"single_eq_mid", "whsec_SGVsbG8=V29ybGQ", "48656c6c6f", "false", "v1,CZX45uWtP5WJeQEwRlfXHLHcHVZCe/8kJBOVyFNtg5Y="},
        {"eq_at_pos1", "whsec_Y=WJj", "77687365635f593d574a6a", "true", "v1,UIfA+R8GMffinY6yCKf04G/2VJDSROFMoPH2eyquI0s="},
        {"leading_eq", "whsec_=YWJj", "77687365635f3d59574a6a", "true", "v1,bCBBdBeVJ0HXeLD7IFOD+yuxa6OmPlOE1aglni87vcg="},
        {"only_eq", "whsec_=", "77687365635f3d", "true", "v1,+Kwou17QNljxc57ZDXLHUV65F24WTp2IJ2Wrt4QX7GU="},
        {"urlsafe", "whsec_a-b_cd", "6be6ff71", "false", "v1,fkOORhSnL1g+us9oP06M38Upg0O0DWHEjNrEp14Db3o="},
        {"urlsafe_long", "whsec_SGVsbG8td29ybGRfMTIz", "48656c6c6f2d776f726c645f313233", "false", "v1,MQuwMf+xxNaiL4iSVxVAfo2ipZyhiRQ2nECOhs+/9cc="},
        {"space", "whsec_YW Jj", "616263", "false", "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk="},
        {"newline", "whsec_YW\nJj", "616263", "false", "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk="},
        {"tab", "whsec_YW\tJj", "616263", "false", "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk="},
        {"crlf", "whsec_YWJj\r\nZA", "61626364", "false", "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg="},
        {"junk_bang", "whsec_YW!Jj", "616263", "false", "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk="},
        {"junk_at", "whsec_YW@#Jj", "616263", "false", "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk="},
        {"junk_unicode", "whsec_YW\u00e9Jj", "616263", "false", "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk="},
        {"all_junk", "whsec_!!!!", "77687365635f21212121", "true", "v1,58LmcOHpECIN1Kd9LCIwLIMvCWoASpvHQmdFktsf+gU="},
        {"empty", "whsec_", "77687365635f", "true", "v1,aPFabYSxb1mJ7chEB+03S8aHnrX0lOYMM3NlpX8jlD0="},
        {"urlsafe_junk_eq", "whsec_a-b_c=d!e", "6be6ff", "false", "v1,tCZ7/6V9FvVbB2YgSNYiDUQHBdTKAOdTBdvcu5juq4k="},
        {"real_shape", "whsec_cg6z29GIzlSydvyOkBWpEsGcKujWfHKh", "720eb3dbd188ce54b276fc8e9015a912c19c2ae8d67c72a1", "false", "v1,9ibSgi4IvJt6jD8z6VsRB20hKehvwsMa2ytnUAiUTrM="},
        {"long_mixed", "whsec_QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVph-_YmNkZQ==", "4142434445464748494a4b4c4d4e4f505152535455565758595a61fbf626364650", "false", "v1,wWHwga20dee3TMzivzmoRroQs9kbOe7nExI/9q8Arkc="},
        {"plus_slash", "whsec_a+b/cd", "6be6ff71", "false", "v1,fkOORhSnL1g+us9oP06M38Upg0O0DWHEjNrEp14Db3o="},
        {"mixed_alpha", "whsec_a-b/c_d+e", "6be6ff73f77e", "false", "v1,dexpl11tMd2WSNauNI5gjPiV1e53krdgh0erdyvdgoI="},
        {"many_eq", "whsec_YWJj====ZA", "616263", "false", "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk="},
        {"eq_then_pad", "whsec_YWJjZA===", "61626364", "false", "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg="},
        {"nonascii_only", "whsec_\u00e9\u00fc\u00f1", "77687365635fc3a9c3bcc3b1", "true", "v1,EFNGWPcyr/96NM1jNdYvBKQ7cDfDlPpx1D8QnQV0bX4="},
        {"digits", "whsec_MTIzNDU2Nzg5MA", "31323334353637383930", "false", "v1,RAjKzOdb0xlpZlm64AFX2dHxtKQ45vjn7ccB2VgrYxo="},
        {"hi_masks_to_A", "whsec_YW\u0141j", "616023", "false", "v1,VL40mx0DtTM2Ikt2oCpzCyFMH7ScXmNlILOohrV8QNM="},
        {"hi_masks_to_eq", "whsec_YWJj\u013dZA", "616263", "false", "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk="},
        {"hi_masks_to_a", "whsec_\u0161\u0161", "69", "false", "v1,qH+B7OwJNP75A4fe3wfM9VmT2/NDw3CmQzM4wFLDa6Y="},
        {"hi_masks_to_4", "whsec_YWJ\u1234", "616278", "false", "v1,DaONzoMXkQD31ZqPmBOAOGJgLUGdfvTQ8laGoBzdhz0="},
        {"hi_masks_to_nul", "whsec_\u0100\u0100\u0100\u0100", "77687365635fc480c480c480c480", "true", "v1,JVTFqibx23iRpUpvctjVuWsso1nYD2MtGUBfIwaOc/Y="},
        {"fullwidth", "whsec_\uff39\uff37\uff2a\uff4a", "f7b2", "false", "v1,1KN9k08myfWQt8J2QP1T1iecIEckkiLWohn3HwjKCho="},
        {"astral_pair", "whsec_\ud835\udc41", "e4", "false", "v1,VlIqZd+gIP90ykvTun54mNp62zzcFqpPgTSR1MNDcyM="},
        {"astral_emoji", "whsec_\ud83c\udf89", "77687365635ff09f8e89", "true", "v1,wMaEB8aUXtVZo6CX0fOjkc2gWXqwvU10RIxi4KzRX6k="},
        {"cjk_skipped", "whsec_\u4e2d\u6587", "77687365635fe4b8ade69687", "true", "v1,uK9WdHrxDFXtkfPvRaB5k/JBwL3EoYA762+/mb/V6yk="},
        {"mixed_hi_lo", "whsec_YW\u0141j\u013dZA\u0161\u0161", "616023", "false", "v1,VL40mx0DtTM2Ikt2oCpzCyFMH7ScXmNlILOohrV8QNM="},
    };

    private static byte[] hex(String h) {
        byte[] out = new byte[h.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(h.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    private static String toHex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

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
        Check.suite("WebhookKeyConformanceTest");
        Check.eq("corpus vector count", 41, VECTORS.length);

        // Rule 5 — the unit is the low 8 bits of each UTF-16 CODE UNIT — is the
        // one an ASCII table cannot see, so name the vectors that carry it
        // instead of trusting the total. U+0141 must alias 'A', U+013D must
        // TERMINATE as '=', a surrogate PAIR must contribute two masked halves
        // rather than its UTF-8 bytes, and masking has to be able to yield
        // NOTHING too — U+0100 masks to NUL (skipped) and U+4E2D masks to '-'
        // whose lone group carries no byte, both landing on the raw fallback.
        // Dropping any of these re-opens the silent no_match.
        for (String name : new String[]{
                "hi_masks_to_A", "hi_masks_to_eq", "hi_masks_to_a", "hi_masks_to_4",
                "hi_masks_to_nul", "fullwidth", "astral_pair", "astral_emoji",
                "cjk_skipped", "mixed_hi_lo"}) {
            boolean present = false;
            for (String[] v : VECTORS) if (v[0].equals(name)) present = true;
            Check.isTrue("rule-5 vector present: " + name, present);
        }

        // (A) Node's OWN signatures, replayed at the corpus's fixed timestamp.
        // Tolerance is 0 here deliberately: these bytes came off a real Node
        // signer at a frozen `ts`, and the point of the check is agreement with
        // that signer, not clock skew. Freshness has its own coverage in
        // WebhooksTest (stale / tolerance-0 / invalid_timestamp), and part (B)
        // below re-exercises the default tolerance-enforcing entry point.
        for (String[] v : VECTORS) {
            VerifyWebhookResult r = Webhooks.verifyWebhookSignature(
                    CORPUS_BODY, headers(CORPUS_ID, CORPUS_TS, v[4]), v[1], 0);
            Check.isTrue("node-signed vector verifies: " + v[0], r.isValid());
        }

        // (B) The derived key equals key_hex EXACTLY. Signing the same content
        // with the corpus's expected key bytes and verifying through the public
        // API is an equality assertion on the key: any divergence, in any byte,
        // changes the HMAC and lands as no_match. Signed at "now" so the
        // default 5-minute tolerance path runs over every vector too.
        String now = String.valueOf(System.currentTimeMillis() / 1000L);
        for (String[] v : VECTORS) {
            String sig = "v1," + sign(CORPUS_ID, now, CORPUS_BODY, hex(v[2]));
            Check.isTrue("key_hex matches derived key: " + v[0],
                    Webhooks.verifyWebhookSignature(
                            CORPUS_BODY, headers(CORPUS_ID, now, sig), v[1]).isValid());
        }

        // (C) The raw-UTF-8 fallback, asserted on its own terms. When the
        // suffix decodes to ZERO bytes the key is the whole secret INCLUDING
        // the whsec_ prefix — the clause every SDK got wrong, because keying on
        // the bare suffix looks just as reasonable. First confirm the inlined
        // key_hex really is that string (so this branch cannot quietly assert
        // the wrong thing), then confirm the bare-suffix key is REJECTED.
        int rawSeen = 0;
        for (String[] v : VECTORS) {
            if (!"true".equals(v[3])) continue;
            rawSeen++;
            Check.eq("raw fallback keys on the WHOLE secret: " + v[0],
                    v[2], toHex(v[1].getBytes(StandardCharsets.UTF_8)));
            String suffix = v[1].substring("whsec_".length());
            if (suffix.isEmpty()) continue; // no key to sign with; nothing to reject
            String wrong = "v1," + sign(CORPUS_ID, now, CORPUS_BODY,
                    suffix.getBytes(StandardCharsets.UTF_8));
            Check.eq("raw fallback rejects a prefix-less key: " + v[0], "no_match",
                    Webhooks.verifyWebhookSignature(
                            CORPUS_BODY, headers(CORPUS_ID, now, wrong), v[1]).getReason());
        }
        Check.eq("raw-fallback vectors exercised", 10, rawSeen);
    }

    public static void main(String[] args) throws Exception {
        run();
        Check.finish();
    }
}

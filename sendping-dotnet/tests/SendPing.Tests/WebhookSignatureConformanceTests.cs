using System.Security.Cryptography;
using System.Text;
using Xunit;

namespace SendPing.Tests;

/// <summary>
/// Conformance vectors for `whsec_` key derivation, generated FROM NODE by
/// scripts/webhook-b64-corpus.mjs and inlined here (never read from that path)
/// so a published tarball's tests stay self-contained.
///
/// WHY THESE EXIST. The backend derives a webhook's HMAC key with Node's
/// `Buffer.from(suffix, 'base64')` (sendping_webapp/lib/crypto.ts
/// secretToKey), and POST /webhooks stores a caller-supplied `secret` verbatim
/// with no shape validation — so every shape below is one a customer can
/// actually save. A key that differs from the signer's does not fail loudly:
/// verification returns `no_match`, and a correctly configured endpoint
/// silently treats every genuine delivery as forged. That failure has shipped
/// three times, every time because someone reasoned from a base64 RFC instead
/// of from what Node does.
///
/// The last round is the reason the tail of this table looks the way it does.
/// Node indexes its alphabet by the LOW 8 BITS of each UTF-16 code unit, so
/// 'Ł' (U+0141) decodes as 'A', 'Ľ' (U+013D) decodes as the '=' that ends the
/// input, and an astral character (U+1D441) contributes its two SURROGATES'
/// low bytes ('5', 'A') rather than its UTF-8 bytes. Nothing below 0x0100 can
/// expose that: an ASCII-only corpus scored a clean 31/31 against a decoder
/// that got every one of those wrong.
/// </summary>
public class WebhookSignatureConformanceTests
{
    // The corpus signs a fixed body/id at a FIXED timestamp, so the vector
    // signatures are replayed with toleranceSeconds: 0 — the documented public
    // way to skip the freshness check. Freshness is covered separately in
    // WebhookSignatureTests; what is under test here is only key derivation.
    // The default-tolerance path is still exercised below by re-signing each
    // vector with its expected key at the current time.
    private const string Body = "{\"type\":\"email.delivered\",\"data\":{\"id\":\"em_1\"}}";
    private const string Id = "msg_conformance";
    private const string Ts = "1787200000";

    /// <summary>name, secret, expected key as hex, raw-fallback flag, Node's signature.</summary>
    public static TheoryData<string, string, string, bool, string> Corpus()
    {
        var data = new TheoryData<string, string, string, bool, string>();
        foreach (var row in Vectors)
        {
            data.Add((string)row[0], (string)row[1], (string)row[2], (bool)row[3], (string)row[4]);
        }
        return data;
    }

    private static readonly object[][] Vectors =
    [
        new object[] { "std_padded", "whsec_YWJjZA==", "61626364", false, "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg=" },
        new object[] { "std_unpadded", "whsec_YWJjZA", "61626364", false, "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg=" },
        new object[] { "std_exact4", "whsec_YWJj", "616263", false, "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
        new object[] { "short_1", "whsec_Y", "77687365635f59", true, "v1,ZMKGqdkd7rDYPj+XX10aKkkyV1NMbcTZ7tFWT6FOwdI=" },
        new object[] { "short_2", "whsec_YW", "61", false, "v1,xnhr17yqBov566EgLaHShB0U7fh87lB6A7uiu7MAgLo=" },
        new object[] { "short_3", "whsec_YWJ", "6162", false, "v1,Fen63yOpcFJsYPJGDIVlJAcEyTdJLIHURAdGZghc0kI=" },
        new object[] { "interior_eq", "whsec_YWJjZA==ZXh0cmE", "61626364", false, "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg=" },
        new object[] { "single_eq_mid", "whsec_SGVsbG8=V29ybGQ", "48656c6c6f", false, "v1,CZX45uWtP5WJeQEwRlfXHLHcHVZCe/8kJBOVyFNtg5Y=" },
        new object[] { "eq_at_pos1", "whsec_Y=WJj", "77687365635f593d574a6a", true, "v1,UIfA+R8GMffinY6yCKf04G/2VJDSROFMoPH2eyquI0s=" },
        new object[] { "leading_eq", "whsec_=YWJj", "77687365635f3d59574a6a", true, "v1,bCBBdBeVJ0HXeLD7IFOD+yuxa6OmPlOE1aglni87vcg=" },
        new object[] { "only_eq", "whsec_=", "77687365635f3d", true, "v1,+Kwou17QNljxc57ZDXLHUV65F24WTp2IJ2Wrt4QX7GU=" },
        new object[] { "urlsafe", "whsec_a-b_cd", "6be6ff71", false, "v1,fkOORhSnL1g+us9oP06M38Upg0O0DWHEjNrEp14Db3o=" },
        new object[] { "urlsafe_long", "whsec_SGVsbG8td29ybGRfMTIz", "48656c6c6f2d776f726c645f313233", false, "v1,MQuwMf+xxNaiL4iSVxVAfo2ipZyhiRQ2nECOhs+/9cc=" },
        new object[] { "space", "whsec_YW Jj", "616263", false, "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
        new object[] { "newline", "whsec_YW\nJj", "616263", false, "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
        new object[] { "tab", "whsec_YW\tJj", "616263", false, "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
        new object[] { "crlf", "whsec_YWJj\r\nZA", "61626364", false, "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg=" },
        new object[] { "junk_bang", "whsec_YW!Jj", "616263", false, "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
        new object[] { "junk_at", "whsec_YW@#Jj", "616263", false, "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
        new object[] { "junk_unicode", "whsec_YWéJj", "616263", false, "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
        new object[] { "all_junk", "whsec_!!!!", "77687365635f21212121", true, "v1,58LmcOHpECIN1Kd9LCIwLIMvCWoASpvHQmdFktsf+gU=" },
        new object[] { "empty", "whsec_", "77687365635f", true, "v1,aPFabYSxb1mJ7chEB+03S8aHnrX0lOYMM3NlpX8jlD0=" },
        new object[] { "urlsafe_junk_eq", "whsec_a-b_c=d!e", "6be6ff", false, "v1,tCZ7/6V9FvVbB2YgSNYiDUQHBdTKAOdTBdvcu5juq4k=" },
        new object[] { "real_shape", "whsec_cg6z29GIzlSydvyOkBWpEsGcKujWfHKh", "720eb3dbd188ce54b276fc8e9015a912c19c2ae8d67c72a1", false, "v1,9ibSgi4IvJt6jD8z6VsRB20hKehvwsMa2ytnUAiUTrM=" },
        new object[] { "long_mixed", "whsec_QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVph-_YmNkZQ==", "4142434445464748494a4b4c4d4e4f505152535455565758595a61fbf626364650", false, "v1,wWHwga20dee3TMzivzmoRroQs9kbOe7nExI/9q8Arkc=" },
        new object[] { "plus_slash", "whsec_a+b/cd", "6be6ff71", false, "v1,fkOORhSnL1g+us9oP06M38Upg0O0DWHEjNrEp14Db3o=" },
        new object[] { "mixed_alpha", "whsec_a-b/c_d+e", "6be6ff73f77e", false, "v1,dexpl11tMd2WSNauNI5gjPiV1e53krdgh0erdyvdgoI=" },
        new object[] { "many_eq", "whsec_YWJj====ZA", "616263", false, "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
        new object[] { "eq_then_pad", "whsec_YWJjZA===", "61626364", false, "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg=" },
        new object[] { "nonascii_only", "whsec_éüñ", "77687365635fc3a9c3bcc3b1", true, "v1,EFNGWPcyr/96NM1jNdYvBKQ7cDfDlPpx1D8QnQV0bX4=" },
        new object[] { "digits", "whsec_MTIzNDU2Nzg5MA", "31323334353637383930", false, "v1,RAjKzOdb0xlpZlm64AFX2dHxtKQ45vjn7ccB2VgrYxo=" },
        new object[] { "hi_masks_to_A", "whsec_YWŁj", "616023", false, "v1,VL40mx0DtTM2Ikt2oCpzCyFMH7ScXmNlILOohrV8QNM=" },
        new object[] { "hi_masks_to_eq", "whsec_YWJjĽZA", "616263", false, "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
        new object[] { "hi_masks_to_a", "whsec_šš", "69", false, "v1,qH+B7OwJNP75A4fe3wfM9VmT2/NDw3CmQzM4wFLDa6Y=" },
        new object[] { "hi_masks_to_4", "whsec_YWJሴ", "616278", false, "v1,DaONzoMXkQD31ZqPmBOAOGJgLUGdfvTQ8laGoBzdhz0=" },
        new object[] { "hi_masks_to_nul", "whsec_ĀĀĀĀ", "77687365635fc480c480c480c480", true, "v1,JVTFqibx23iRpUpvctjVuWsso1nYD2MtGUBfIwaOc/Y=" },
        new object[] { "fullwidth", "whsec_ＹＷＪｊ", "f7b2", false, "v1,1KN9k08myfWQt8J2QP1T1iecIEckkiLWohn3HwjKCho=" },
        new object[] { "astral_pair", "whsec_𝑁", "e4", false, "v1,VlIqZd+gIP90ykvTun54mNp62zzcFqpPgTSR1MNDcyM=" },
        new object[] { "astral_emoji", "whsec_🎉", "77687365635ff09f8e89", true, "v1,wMaEB8aUXtVZo6CX0fOjkc2gWXqwvU10RIxi4KzRX6k=" },
        new object[] { "cjk_skipped", "whsec_中文", "77687365635fe4b8ade69687", true, "v1,uK9WdHrxDFXtkfPvRaB5k/JBwL3EoYA762+/mb/V6yk=" },
        new object[] { "mixed_hi_lo", "whsec_YWŁjĽZAšš", "616023", false, "v1,VL40mx0DtTM2Ikt2oCpzCyFMH7ScXmNlILOohrV8QNM=" },
    ];

    private static string Sign(string id, string timestamp, string payload, byte[] key)
    {
        using var hmac = new HMACSHA256(key);
        return "v1," + Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes($"{id}.{timestamp}.{payload}")));
    }

    [Theory]
    [MemberData(nameof(Corpus))]
    public void Verify_DerivesTheSignersKey_ForEveryCorpusVector(string name, string secret, string keyHex, bool rawFallback, string sig)
    {
        // 1. Node's own signature over the fixed body must verify. This is the
        //    end-to-end claim: our key equals the key the server signed with.
        var replay = WebhookSignature.Verify(Body, Id, Ts, sig, secret, toleranceSeconds: 0);
        Assert.True(replay.Valid, $"vector `{name}` (secret `{secret}`) rejected Node's own signature: {replay.Reason}");

        // 2. Pin the derived key to the exact bytes, not merely to "something
        //    that happens to match one signature": re-sign at the current time
        //    with the expected key and require the default freshness path to
        //    accept it.
        var expectedKey = Convert.FromHexString(keyHex);
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        var fresh = WebhookSignature.Verify(Body, Id, now, Sign(Id, now, Body, expectedKey), secret);
        Assert.True(fresh.Valid, $"vector `{name}` derived a key other than {keyHex}: {fresh.Reason}");

        // 3. Negative control, so the two assertions above cannot pass
        //    vacuously: a key one byte longer must NOT verify.
        var wrongKey = expectedKey.Append((byte)0x2a).ToArray();
        var wrong = WebhookSignature.Verify(Body, Id, now, Sign(Id, now, Body, wrongKey), secret);
        Assert.False(wrong.Valid, $"vector `{name}` accepted a signature made with the wrong key");

        // 4. For the shapes whose suffix decodes to zero bytes, the signer
        //    keeps the WHOLE secret — `whsec_` prefix included — as UTF-8.
        //    Stripping the prefix or returning an empty key here is its own
        //    silent no_match, so state that identity explicitly.
        if (rawFallback)
        {
            Assert.Equal(Convert.ToHexString(Encoding.UTF8.GetBytes(secret)).ToLowerInvariant(), keyHex);
        }
    }

    [Fact]
    public void Corpus_StillCoversEveryShape()
    {
        // Guards the inlining itself: a re-embed that silently drops vectors —
        // especially the raw-fallback ones, the path every SDK got wrong —
        // would otherwise turn this suite green by testing less.
        Assert.Equal(41, Vectors.Length);
        Assert.Equal(10, Vectors.Count(v => (bool)v[3]));

        // Count alone is a weak pin, because the ten shapes above 0x00FF are
        // the ones a re-embed is most likely to mangle or quietly transliterate
        // away — and they are exactly the ones an ASCII corpus cannot replace.
        // Name them, so dropping one is a failure rather than a smaller number
        // that still adds up.
        string[] codeUnitShapes =
        [
            "hi_masks_to_A", "hi_masks_to_eq", "hi_masks_to_a", "hi_masks_to_4", "hi_masks_to_nul",
            "fullwidth", "astral_pair", "astral_emoji", "cjk_skipped", "mixed_hi_lo",
        ];
        var names = Vectors.Select(v => (string)v[0]).ToHashSet();
        foreach (var shape in codeUnitShapes)
        {
            Assert.Contains(shape, names);
        }
    }
}

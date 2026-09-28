using System.Security.Cryptography;
using System.Text;
using Xunit;

namespace SendPing.Tests;

public class WebhookSignatureTests
{
    private static string Sign(string id, string timestamp, string payload, byte[] key)
    {
        using var hmac = new HMACSHA256(key);
        return Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes($"{id}.{timestamp}.{payload}")));
    }

    private static string Now() => DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();

    [Fact]
    public void Verify_ValidSignature_WithWhsecSecret()
    {
        var rawKey = new byte[32];
        RandomNumberGenerator.Fill(rawKey);
        var secret = "whsec_" + Convert.ToBase64String(rawKey);

        var payload = """{"type":"email.delivered","data":{"id":"em_1"}}""";
        var id = "msg_abc";
        var ts = Now();
        var signature = "v1," + Sign(id, ts, payload, rawKey);

        var result = WebhookSignature.Verify(payload, new Dictionary<string, string>
        {
            // Mixed-case header names must be read case-insensitively.
            ["Svix-Id"] = id,
            ["SVIX-TIMESTAMP"] = ts,
            ["svix-signature"] = signature,
        }, secret);

        Assert.True(result.Valid);
        Assert.Null(result.Reason);
    }

    [Fact]
    public void Verify_ValidSignature_WithRawUtf8Secret()
    {
        var secret = "plain-secret";
        var payload = "{}";
        var id = "msg_1";
        var ts = Now();
        var signature = "v1," + Sign(id, ts, payload, Encoding.UTF8.GetBytes(secret));

        var result = WebhookSignature.Verify(payload, id, ts, signature, secret);

        Assert.True(result.Valid);
    }

    [Fact]
    public void Verify_MultipleSpaceSeparatedSignatures_AnyMatchWins()
    {
        var secret = "plain-secret";
        var payload = "{}";
        var id = "msg_1";
        var ts = Now();
        var good = "v1," + Sign(id, ts, payload, Encoding.UTF8.GetBytes(secret));
        var header = "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= " + good;

        var result = WebhookSignature.Verify(payload, id, ts, header, secret);

        Assert.True(result.Valid);
    }

    [Fact]
    public void Verify_TamperedPayload_ReturnsNoMatch()
    {
        var secret = "plain-secret";
        var id = "msg_1";
        var ts = Now();
        var signature = "v1," + Sign(id, ts, "{}", Encoding.UTF8.GetBytes(secret));

        var result = WebhookSignature.Verify("""{"tampered":true}""", id, ts, signature, secret);

        Assert.False(result.Valid);
        Assert.Equal("no_match", result.Reason);
    }

    [Fact]
    public void Verify_MissingHeaders_ReturnsMissingHeaders()
    {
        var result = WebhookSignature.Verify("{}", new Dictionary<string, string>(), "secret");

        Assert.False(result.Valid);
        Assert.Equal("missing_headers", result.Reason);
    }

    [Fact]
    public void Verify_StaleTimestamp_ReturnsOutOfTolerance_UnlessDisabled()
    {
        var secret = "plain-secret";
        var payload = "{}";
        var id = "msg_1";
        var stale = DateTimeOffset.UtcNow.AddHours(-1).ToUnixTimeSeconds().ToString();
        var signature = "v1," + Sign(id, stale, payload, Encoding.UTF8.GetBytes(secret));

        var strict = WebhookSignature.Verify(payload, id, stale, signature, secret);
        Assert.False(strict.Valid);
        Assert.Equal("timestamp_out_of_tolerance", strict.Reason);

        var relaxed = WebhookSignature.Verify(payload, id, stale, signature, secret, toleranceSeconds: 0);
        Assert.True(relaxed.Valid);
    }

    [Fact]
    public void Verify_NonNumericTimestamp_ReturnsInvalidTimestamp()
    {
        var result = WebhookSignature.Verify("{}", "msg_1", "not-a-number", "v1,abc", "secret");

        Assert.False(result.Valid);
        Assert.Equal("invalid_timestamp", result.Reason);
    }

    [Fact]
    public void Verify_WhsecSuffixDecodedLeniently_MatchesTheSignersKey()
    {
        // The signer derives its key with Node's Buffer.from(suffix, 'base64'),
        // which accepts the URL-safe alphabet, needs no padding, and ignores
        // characters outside the alphabet. POST /webhooks stores a
        // caller-supplied `secret` verbatim, so those spellings reach real
        // handlers. Decoding strictly here keyed the HMAC with the literal
        // "whsec_…" string instead and every genuine delivery read no_match.
        // All four spellings below decode to this same 16-byte key under Node.
        var rawKey = Convert.FromHexString("fbffbe0102030405060708090a0b0c0d");
        var payload = """{"type":"email.delivered","data":{"id":"em_1"}}""";
        var id = "msg_abc";
        var ts = Now();
        var signature = "v1," + Sign(id, ts, payload, rawKey);

        foreach (var suffix in new[]
        {
            "+/++AQIDBAUGBwgJCgsMDQ==",   // canonical, padded
            "+/++AQIDBAUGBwgJCgsMDQ",     // no '=' padding
            "-_--AQIDBAUGBwgJCgsMDQ",     // URL-safe '-' / '_' spellings
            "+/++AQIDBAUGBwgJ CgsMDQ\n",  // out-of-alphabet characters ignored
        })
        {
            var result = WebhookSignature.Verify(payload, id, ts, signature, "whsec_" + suffix);

            Assert.True(result.Valid, $"secret spelling `whsec_{suffix}` derived the wrong key: {result.Reason}");
        }
    }

    [Fact]
    public void Verify_WhsecSuffixDecodingToNoBytes_FallsBackToRawUtf8()
    {
        // The signer falls back to the raw UTF-8 of the WHOLE string — prefix
        // included — when the suffix decodes to zero bytes, so the lenient
        // decoder must not swallow these into an empty key.
        var payload = "{}";
        var id = "msg_1";
        var ts = Now();

        foreach (var secret in new[] { "whsec_", "whsec_!" })
        {
            var signature = "v1," + Sign(id, ts, payload, Encoding.UTF8.GetBytes(secret));

            var result = WebhookSignature.Verify(payload, id, ts, signature, secret);

            Assert.True(result.Valid, $"secret `{secret}` did not fall back to raw UTF-8: {result.Reason}");
        }
    }
}

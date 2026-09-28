using System.Security.Cryptography;
using System.Text;

namespace SendPing;

/// <summary>
/// Verifies SendPing webhook delivery signatures (Svix-style scheme:
/// base64 HMAC-SHA256 over <c>{svix-id}.{svix-timestamp}.{raw body}</c>,
/// tagged <c>v1,</c> in the <c>svix-signature</c> header).
/// Pure local computation — makes no HTTP request.
/// </summary>
public static class WebhookSignature
{
    /// <summary>
    /// Verify a delivery given its raw body and headers.
    /// <paramref name="payload"/> MUST be the exact raw request body string the
    /// server sent — do not re-serialize the parsed JSON, whitespace differences
    /// break the signature. <paramref name="headers"/> is read case-insensitively
    /// for <c>svix-id</c> / <c>svix-timestamp</c> / <c>svix-signature</c>.
    /// </summary>
    /// <param name="payload">The exact raw request body string as received.</param>
    /// <param name="headers">The delivery's headers; svix-id / svix-timestamp / svix-signature are read case-insensitively.</param>
    /// <param name="secret">Your endpoint's signing secret (typically <c>whsec_…</c>).</param>
    /// <param name="toleranceSeconds">Max allowed clock skew in seconds (default 300). Pass 0 to skip the check.</param>
    public static VerifyWebhookResult Verify(string payload, IReadOnlyDictionary<string, string> headers, string secret, int toleranceSeconds = 300)
    {
        ArgumentNullException.ThrowIfNull(headers);
        return Verify(
            payload,
            ReadHeader(headers, "svix-id"),
            ReadHeader(headers, "svix-timestamp"),
            ReadHeader(headers, "svix-signature"),
            secret,
            toleranceSeconds);
    }

    /// <summary>Verify a delivery given the three svix header values directly.</summary>
    public static VerifyWebhookResult Verify(string payload, string? svixId, string? svixTimestamp, string? svixSignature, string secret, int toleranceSeconds = 300)
    {
        ArgumentNullException.ThrowIfNull(payload);

        if (string.IsNullOrEmpty(svixId) || string.IsNullOrEmpty(svixTimestamp) || string.IsNullOrEmpty(svixSignature))
        {
            return Invalid("missing_headers");
        }
        if (string.IsNullOrEmpty(secret))
        {
            return Invalid("missing_secret");
        }

        // Optional timestamp freshness check (default 5-minute tolerance; 0 disables).
        if (toleranceSeconds > 0)
        {
            if (!long.TryParse(svixTimestamp, out var timestamp))
            {
                return Invalid("invalid_timestamp");
            }
            var skew = Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - timestamp);
            if (skew > toleranceSeconds)
            {
                return Invalid("timestamp_out_of_tolerance");
            }
        }

        var signedContent = $"{svixId}.{svixTimestamp}.{payload}";
        string expected;
        using (var hmac = new HMACSHA256(SecretToKey(secret)))
        {
            expected = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(signedContent)));
        }

        // The header may contain multiple space-separated `v1,<sig>` entries; any match wins.
        foreach (var part in svixSignature.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var candidate = part.StartsWith("v1,", StringComparison.Ordinal) ? part["v1,".Length..] : part;
            if (FixedTimeEquals(candidate, expected))
            {
                return new VerifyWebhookResult { Valid = true };
            }
        }
        return Invalid("no_match");
    }

    /// <summary>
    /// Derive the HMAC key from the signing secret, mirroring the backend's
    /// own <c>secretToKey</c> (sendping_webapp/lib/crypto.ts) byte for byte:
    /// base64-decode the part after <c>whsec_</c>, and fall back to the raw
    /// UTF-8 bytes of the WHOLE string when there is no prefix or the suffix
    /// decodes to nothing.
    /// </summary>
    private static byte[] SecretToKey(string secret)
    {
        const string prefix = "whsec_";
        if (secret.StartsWith(prefix, StringComparison.Ordinal))
        {
            var decoded = DecodeBase64LikeNode(secret.AsSpan(prefix.Length));
            if (decoded.Length > 0)
            {
                return decoded;
            }
            // Zero bytes is not an error to the signer. It keeps the WHOLE
            // secret — `whsec_` prefix included — as the key, so shapes like
            // `whsec_`, `whsec_=`, `whsec_Y` and `whsec_éüñ` all land here.
            // Falling through with the prefix stripped, or with an empty key,
            // is its own silent no_match; that is why this branch lives in the
            // caller rather than inside the decoder, which only ever reports
            // how many bytes it produced.
        }
        return Encoding.UTF8.GetBytes(secret);
    }

    /// <summary>
    /// Decode a base64 string the way Node's <c>Buffer.from(s, 'base64')</c>
    /// does — the decoder the server signs with. It is far more forgiving than
    /// <see cref="Convert.FromBase64String(string)"/>, and the difference is
    /// reachable in production: POST /webhooks stores a caller-supplied
    /// <c>secret</c> verbatim with no shape validation, so a customer can save
    /// any of the spellings handled below. Deriving a key that differs from the
    /// signer's does not fail loudly — verification just returns
    /// <c>no_match</c>, and a correctly configured endpoint silently treats
    /// every genuine delivery as forged.
    /// </summary>
    private static byte[] DecodeBase64LikeNode(ReadOnlySpan<char> suffix)
    {
        var sb = new StringBuilder(suffix.Length);
        foreach (var unit in suffix)
        {
            // 5. The alphabet is indexed by the LOW 8 BITS of each UTF-16 code
            //    unit, not by the codepoint — Node masks with 0xFF before the
            //    table lookup, so 'Ł' (U+0141) IS 'A' to the decoder and 'Ľ'
            //    (U+013D) IS the '=' that ends the input. The mask has to run
            //    AHEAD of every rule below: split on '=' first and U+013D never
            //    gets the chance to terminate anything.
            //
            //    Iterating `char` is the whole trick on .NET — strings already
            //    ARE UTF-16, so an astral character like '𝑁' (U+1D441)
            //    arrives as its two surrogates D835/DC41 and contributes '5'
            //    then 'A': two units, not the four bytes of its UTF-8 form.
            //    Switch this loop to EnumerateRunes/codepoints and every
            //    non-Latin-1 secret derives a key the signer never used.
            var ch = (char)(unit & 0xFF);

            // 1. '=' TERMINATES the input. It is not padding to be stripped:
            //    everything from the first '=' onward is discarded, so Node
            //    reads "YWJj====ZA" as "abc", never "abcd". Filtering '=' out
            //    and decoding what follows is the bug this SDK shipped — it
            //    turned the 4-byte key of `whsec_YWJjZA==ZXh0cmE` into a
            //    9-byte one.
            if (ch == '=') break;

            // 2. '-' and '_' are the URL-safe spellings of '+' and '/'. They
            //    must be TRANSLATED, not dropped — dropping them silently
            //    shortens the key instead of changing it.
            if (ch == '-') sb.Append('+');
            else if (ch == '_') sb.Append('/');
            // 3. Anything outside the alphabet is SKIPPED, never fatal:
            //    whitespace, punctuation and non-ASCII alike ("YW!Jj" is "abc").
            else if (char.IsAsciiLetterOrDigit(ch) || ch == '+' || ch == '/') sb.Append(ch);
        }

        // 4. A trailing group of ONE character carries no whole byte, so Node
        //    discards it (2 chars -> 1 byte, 3 -> 2, 4 -> 3). Re-pad every
        //    other remainder, because Convert.FromBase64String demands a
        //    multiple of 4; on the groups that DO carry bytes the two decoders
        //    agree, which is why the final decode can stay a framework call.
        var remainder = sb.Length % 4;
        if (remainder == 1)
        {
            sb.Length -= 1;
        }
        else if (remainder != 0)
        {
            sb.Append('=', 4 - remainder);
        }

        // Every surviving character is now in the standard alphabet and the
        // length is a multiple of 4, so this cannot throw.
        return sb.Length == 0 ? Array.Empty<byte>() : Convert.FromBase64String(sb.ToString());
    }

    /// <summary>Constant-time compare of two base64 signature strings.</summary>
    private static bool FixedTimeEquals(string a, string b)
        => CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));

    /// <summary>Case-insensitively read a single header value.</summary>
    private static string? ReadHeader(IReadOnlyDictionary<string, string> headers, string name)
    {
        if (headers.TryGetValue(name, out var direct))
        {
            return direct;
        }
        foreach (var pair in headers)
        {
            if (string.Equals(pair.Key, name, StringComparison.OrdinalIgnoreCase))
            {
                return pair.Value;
            }
        }
        return null;
    }

    private static VerifyWebhookResult Invalid(string reason) => new() { Valid = false, Reason = reason };
}

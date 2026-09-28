<?php

declare(strict_types=1);

namespace SendPing;

/**
 * Pure Svix-style webhook signature verification — a local computation, no
 * HTTP request. Also reachable as `$sendping->webhooks->verify(...)`.
 *
 * Signing scheme: `{id}.{timestamp}.{body}` → base64 HMAC-SHA256, tagged `v1,`.
 */
final class WebhookSignature
{
    /**
     * Verify a webhook delivery's signature against your endpoint's signing secret.
     *
     * `$payload` MUST be the exact raw request body string the server sent (do
     * not re-serialize parsed JSON — whitespace differences break the signature).
     * `$headers` accepts the svix-id / svix-timestamp / svix-signature headers,
     * read case-insensitively (values may be strings or arrays of strings). A
     * signature header may carry multiple space-separated `v1,<sig>` entries;
     * any one matching makes the delivery valid.
     *
     * @param string $payload The exact raw request body.
     * @param array  $headers The delivery headers (name => value|value[]).
     * @param string $secret  The endpoint's signing secret ('whsec_…' or raw).
     * @param array  $options 'toleranceSec' (int) — max allowed clock skew in
     *                        seconds (default 300; pass 0 to skip the check).
     *
     * @return array{valid: bool, reason?: string}
     */
    public static function verify(string $payload, array $headers, string $secret, array $options = []): array
    {
        $id = self::readHeader($headers, 'svix-id');
        $timestamp = self::readHeader($headers, 'svix-timestamp');
        $sigHeader = self::readHeader($headers, 'svix-signature');
        if ($id === null || $id === '' || $timestamp === null || $timestamp === '' || $sigHeader === null || $sigHeader === '') {
            return ['valid' => false, 'reason' => 'missing_headers'];
        }
        if ($secret === '') {
            return ['valid' => false, 'reason' => 'missing_secret'];
        }

        // Optional timestamp freshness check (default 5-minute tolerance; 0 disables).
        $toleranceSec = array_key_exists('toleranceSec', $options) ? (int) $options['toleranceSec'] : 300;
        if ($toleranceSec > 0) {
            if (!is_numeric($timestamp)) {
                return ['valid' => false, 'reason' => 'invalid_timestamp'];
            }
            $skew = abs(time() - (int) floor((float) $timestamp));
            if ($skew > $toleranceSec) {
                return ['valid' => false, 'reason' => 'timestamp_out_of_tolerance'];
            }
        }

        $signed = $id . '.' . $timestamp . '.' . $payload;
        $expected = base64_encode(hash_hmac('sha256', $signed, self::secretToKey($secret), true));

        // The header may contain multiple space-separated `v1,<sig>` entries; any match wins.
        foreach (explode(' ', $sigHeader) as $part) {
            $trimmed = trim($part);
            if ($trimmed === '') {
                continue;
            }
            $sig = str_starts_with($trimmed, 'v1,') ? substr($trimmed, 3) : $trimmed;
            if (hash_equals($expected, $sig)) {
                return ['valid' => true];
            }
        }
        return ['valid' => false, 'reason' => 'no_match'];
    }

    /** Case-insensitively read a single header value (first if it's an array). */
    private static function readHeader(array $headers, string $name): ?string
    {
        foreach ($headers as $key => $value) {
            if (strtolower((string) $key) === $name) {
                if (is_array($value)) {
                    return isset($value[0]) ? (string) $value[0] : null;
                }
                return (string) $value;
            }
        }
        return null;
    }

    /**
     * Derive the HMAC key from a `whsec_`-prefixed secret (base64-decode the
     * suffix); a secret without the prefix is used as raw UTF-8 bytes.
     *
     * This has to reproduce the server's own secretToKey
     * (sendping_webapp/lib/crypto.ts) BYTE FOR BYTE, because a key that
     * differs from the signer's does not fail loudly: verify just reports
     * `no_match`, so a correctly configured endpoint silently treats every
     * genuine delivery as forged.
     *
     * Two rules live here, and both have shipped broken:
     *
     *  - The decode is LENIENT (see nodeBase64Decode). Decoding strictly
     *    returned false for a caller-supplied secret whose suffix was not valid
     *    standard base64 — POST /webhooks accepts one verbatim, with no shape
     *    validation — fell back to the raw string as the key, and rejected
     *    every genuine delivery.
     *  - An EMPTY decode falls back to the whole secret, `whsec_` prefix
     *    INCLUDED, not to the suffix. `whsec_Y` therefore signs with the seven
     *    UTF-8 bytes `whsec_Y`, because one leftover base64 character carries
     *    no whole byte.
     */
    private static function secretToKey(string $secret): string
    {
        if (str_starts_with($secret, 'whsec_')) {
            $decoded = self::nodeBase64Decode(substr($secret, strlen('whsec_')));
            if ($decoded !== '') {
                return $decoded;
            }
        }
        return $secret;
    }

    /**
     * Decode base64 the way Node's `Buffer.from(str, 'base64')` does — which is
     * NOT what any base64 RFC says, and not what PHP's base64_decode does in
     * either mode. Following the RFC is precisely how the key-derivation bugs
     * got written, so these rules are empirical:
     *
     *  5. THE UNIT IS THE LOW 8 BITS OF EACH UTF-16 CODE UNIT, not the
     *     codepoint and not the UTF-8 byte. Node masks every code unit with
     *     0xFF before the table lookup, so `Ł` (U+0141) is read as `A` and `Ľ`
     *     (U+013D) is read as `=` and terminates the value. It runs FIRST,
     *     ahead of rules 1-4, because rule 1 has to see the masked bytes or
     *     U+013D never terminates anything. See utf16CodeUnitLowBytes.
     *  1. `=` TERMINATES the input. Everything from the first `=` onward is
     *     DISCARDED; it is not "padding to be stripped". `YWJj====ZA` decodes
     *     to `abc`, NOT `abcd`. PHP's non-strict base64_decode strips the `=`
     *     and keeps going, which is exactly the divergence this fixes.
     *  2. Characters outside the alphabet are SKIPPED, never fatal — whitespace,
     *     punctuation and masked-away code units are ignored (`YW!Jj` is `abc`).
     *     The filter below is byte-wise with no /u modifier, which is correct
     *     only because rule 5 already flattened the string to one byte per code
     *     unit; running it on raw UTF-8 would drop `Ł` instead of reading `A`.
     *  3. `-` and `_` are the URL-safe spellings of `+` and `/` and are
     *     TRANSLATED, not dropped. This too is post-mask: `中` (U+4E2D) masks to
     *     0x2D `-`, so it becomes `+` rather than being discarded.
     *  4. A trailing group of ONE character contributes no byte (2 chars -> 1
     *     byte, 3 -> 2, 4 -> 3). We drop it before decoding so that the string
     *     handed to base64_decode is always a clean, strictly decodable one.
     */
    private static function nodeBase64Decode(string $input): string
    {
        $input = self::utf16CodeUnitLowBytes($input);

        $terminator = strpos($input, '=');
        if ($terminator !== false) {
            $input = substr($input, 0, $terminator);
        }

        $chars = preg_replace('#[^A-Za-z0-9+/]#', '', strtr($input, '-_', '+/')) ?? '';
        if (strlen($chars) % 4 === 1) {
            $chars = substr($chars, 0, -1);
        }

        $decoded = base64_decode($chars, true);
        return $decoded === false ? '' : $decoded;
    }

    /**
     * Flatten a UTF-8 PHP string to ONE BYTE PER UTF-16 CODE UNIT — the low 8
     * bits of each — which is the alphabet-lookup unit Node actually uses.
     *
     * A JS string is UTF-16, and Node's base64 decoder masks each code unit
     * with 0xFF before consulting the table, so a non-ASCII character is not
     * "some junk that gets skipped": it aliases onto whatever ASCII character
     * shares its low byte. `YWŁj` is `YWAj` (U+0141 -> 0x41), and `YWJjĽZA`
     * stops at `YWJj` because U+013D masks to 0x3D, an `=`. A PHP string is
     * UTF-8 bytes, so we must reconstruct the code units before masking —
     * taking UTF-8 bytes directly is a different answer for everything above
     * U+007F, and was worth 1300/3000 on the differential fuzz against Node.
     *
     * Astral characters are the reason this cannot be "decode the codepoint and
     * mask it": U+1D441 is ONE codepoint but TWO code units, the surrogates
     * 0xD835/0xDC41, contributing `5` and `A` — a real byte, not nothing.
     *
     * Bytes that are not valid UTF-8 have no JS-string counterpart; Node would
     * have read them as U+FFFD, so we emit 0xFD. How many replacements a bad
     * run produces is immaterial — 0xFD is outside the alphabet either way, so
     * every spelling of "malformed" filters out to the same empty contribution.
     */
    private static function utf16CodeUnitLowBytes(string $input): string
    {
        $out = '';
        $len = strlen($input);

        for ($i = 0; $i < $len;) {
            $lead = ord($input[$i]);
            if ($lead < 0x80) {
                $out .= $input[$i];
                $i++;
                continue;
            }

            // Sequence length, the bits the lead byte carries, and the smallest
            // codepoint it may legally encode (rejects overlong forms).
            if (($lead & 0xE0) === 0xC0) {
                $tail = 1;
                $cp = $lead & 0x1F;
                $min = 0x80;
            } elseif (($lead & 0xF0) === 0xE0) {
                $tail = 2;
                $cp = $lead & 0x0F;
                $min = 0x800;
            } elseif (($lead & 0xF8) === 0xF0) {
                $tail = 3;
                $cp = $lead & 0x07;
                $min = 0x10000;
            } else {
                $out .= "\xfd"; // continuation byte with no lead, or 0xF8+
                $i++;
                continue;
            }

            if ($i + $tail >= $len) {
                $out .= "\xfd"; // truncated at end of input
                $i++;
                continue;
            }

            $wellFormed = true;
            for ($k = 1; $k <= $tail; $k++) {
                $cont = ord($input[$i + $k]);
                if (($cont & 0xC0) !== 0x80) {
                    $wellFormed = false;
                    break;
                }
                $cp = ($cp << 6) | ($cont & 0x3F);
            }

            // Surrogate halves are rejected here on purpose: CESU-8 `ED B1 81`
            // is U+DC41, whose low byte is an `A`, but Node reading those bytes
            // sees U+FFFD and contributes nothing. Decoding it would invent a
            // base64 character the server never saw.
            if (!$wellFormed || $cp < $min || $cp > 0x10FFFF || ($cp >= 0xD800 && $cp <= 0xDFFF)) {
                $out .= "\xfd";
                $i++;
                continue;
            }

            $i += $tail + 1;

            if ($cp < 0x10000) {
                $out .= chr($cp & 0xFF);
                continue;
            }

            $v = $cp - 0x10000;
            $out .= chr((0xD800 + ($v >> 10)) & 0xFF);
            $out .= chr((0xDC00 + ($v & 0x3FF)) & 0xFF);
        }

        return $out;
    }
}

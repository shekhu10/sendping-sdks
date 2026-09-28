#!/usr/bin/env node
/*
 * webhook-b64-corpus.mjs — the conformance corpus for `whsec_` key derivation.
 *
 *   node scripts/webhook-b64-corpus.mjs > scripts/webhook-b64-corpus.json
 *
 * WHY THIS EXISTS. The backend derives a webhook's HMAC key with Node's
 * `Buffer.from(suffix, 'base64')` (sendping_webapp/lib/crypto.ts secretToKey).
 * Every SDK has to reproduce that byte for byte, because a key that differs from
 * the signer's does not fail loudly — it reports `no_match`, so a correctly
 * configured endpoint silently treats every genuine delivery as forged. That is
 * the worst failure mode this library has, and it has now been shipped twice:
 * 4.0.0 fixed strict decoding in python and php only, and 5.0.0 fixed the other
 * five by porting python's implementation — including python's own residual
 * divergence, which nobody had test vectors to notice.
 *
 * So the vectors are generated FROM NODE ITSELF rather than from anyone's idea
 * of what base64 means. This file is the spec; regenerate it, never hand-edit
 * the JSON.
 *
 * NODE'S ACTUAL RULES, derived empirically (all four matter, all four have a
 * vector below, and every SDK got at least one of them wrong):
 *
 *   1. `=` TERMINATES the input. Everything from the first `=` onward is
 *      discarded — it is not "padding to be stripped". "YWJj====ZA" is "abc",
 *      NOT "abcd". Stripping `=` and continuing is the bug all six shared.
 *   2. Characters outside the alphabet are SKIPPED, not fatal: whitespace,
 *      punctuation and non-ASCII are simply ignored ("YW!Jj" is "abc").
 *   3. `-` and `_` are accepted as the URL-safe spellings of `+` and `/`.
 *   4. A trailing group of ONE character contributes no byte (2 -> 1 byte,
 *      3 -> 2 bytes).
 *   5. THE UNIT IS THE LOW 8 BITS OF EACH UTF-16 CODE UNIT, not the codepoint.
 *      Node masks every code unit with 0xFF before the table lookup, so
 *      'L-with-stroke' (U+0141) is read as 'A' (0x41) and 'L-with-caron'
 *      (U+013D) is read as '=' (0x3D) and TERMINATES the value. This is the
 *      rule that is invisible to an ASCII-only test: every SDK passed 31/31 and
 *      2000/2000 on an ASCII fuzz while scoring 1300/3000 once codepoints above
 *      0xFF were included. Languages whose strings are UTF-16 (java, C#) mask
 *      each char directly; UTF-8 languages (python, ruby, php, go, rust) must
 *      convert to UTF-16 code units FIRST, so an astral character contributes
 *      its two surrogate halves' low bytes, not its UTF-8 bytes.
 *
 * And the caller of the decoder matters as much as the decoder: when the decode
 * yields ZERO bytes, secretToKey falls back to the UTF-8 bytes of the WHOLE
 * secret — `whsec_` prefix included. Seven vectors below exercise that path.
 *
 * A caller-supplied secret is accepted verbatim with no shape validation
 * (sendping_webapp/lib/webhooks/service.ts), so none of these shapes are
 * hypothetical: a customer can create any of them.
 *
 * KEEPING SDKs HONEST: each package embeds these vectors in its own suite (they
 * are inlined rather than read from this path so a published tarball's tests
 * stay self-contained). After regenerating, re-embed anywhere the counts move.
 */
import crypto from 'node:crypto';

// VERBATIM from sendping_webapp/lib/crypto.ts. Do not "clean this up" — the
// point is that it is the server's code, not a restatement of it.
function secretToKey(secret) {
  const s = String(secret || '');
  if (s.startsWith('whsec_')) {
    try {
      const buf = Buffer.from(s.slice('whsec_'.length), 'base64');
      if (buf.length) return buf;
    } catch { /* raw fallback */ }
  }
  return Buffer.from(s, 'utf8');
}
const signContent = (secret, id, ts, body) =>
  `v1,${crypto.createHmac('sha256', secretToKey(secret)).update(`${id}.${ts}.${body}`).digest('base64')}`;

const SUFFIXES = [
  ['std_padded', 'YWJjZA=='], ['std_unpadded', 'YWJjZA'], ['std_exact4', 'YWJj'],
  ['short_1', 'Y'], ['short_2', 'YW'], ['short_3', 'YWJ'],
  ['interior_eq', 'YWJjZA==ZXh0cmE'], ['single_eq_mid', 'SGVsbG8=V29ybGQ'],
  ['eq_at_pos1', 'Y=WJj'], ['leading_eq', '=YWJj'], ['only_eq', '='],
  ['urlsafe', 'a-b_cd'], ['urlsafe_long', 'SGVsbG8td29ybGRfMTIz'],
  ['space', 'YW Jj'], ['newline', 'YW\nJj'], ['tab', 'YW\tJj'], ['crlf', 'YWJj\r\nZA'],
  ['junk_bang', 'YW!Jj'], ['junk_at', 'YW@#Jj'], ['junk_unicode', 'YWéJj'],
  ['all_junk', '!!!!'], ['empty', ''],
  ['urlsafe_junk_eq', 'a-b_c=d!e'],
  ['real_shape', crypto.createHash('sha256').update('sendping-conformance').digest().subarray(0, 24).toString('base64')],
  ['long_mixed', 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVph-_YmNkZQ=='],
  ['plus_slash', 'a+b/cd'], ['mixed_alpha', 'a-b/c_d+e'],
  ['many_eq', 'YWJj====ZA'], ['eq_then_pad', 'YWJjZA==='],
  ['nonascii_only', 'éüñ'], ['digits', 'MTIzNDU2Nzg5MA'],
  // Rule 5. Every one of these was decoded WRONG by all eight non-npm SDKs
  // until it was measured; the names say which byte the code unit masks to.
  ['hi_masks_to_A', 'YWŁj'],            // U+0141 -> 0x41 'A'
  ['hi_masks_to_eq', 'YWJjĽZA'],        // U+013D -> 0x3D '=' TERMINATES
  ['hi_masks_to_a', 'šš'],              // U+0161 -> 0x61 'a'
  ['hi_masks_to_4', 'YWJሴ'],            // U+1234 -> 0x34 '4'
  ['hi_masks_to_nul', 'ĀĀĀĀ'],          // U+0100 -> 0x00, not in the alphabet
  ['fullwidth', 'ＹＷＪｊ'],                // U+FF39.. -> 0x39 '9', 0x37 '7', ...
  ['astral_pair', '𝑁'],                 // U+1D441 -> surrogates D835/DC41 -> '5','A'
  ['astral_emoji', '🎉'],                // U+1F389 -> D83C/DF89 -> '<',(0x89)
  ['cjk_skipped', '中文'],                // low bytes fall outside the alphabet
  ['mixed_hi_lo', 'YWŁjĽZAšš'],
];

// A FIXED body/id, and a timestamp supplied by the caller so a suite can sign
// "now" and still exercise its own freshness check.
const BODY = JSON.stringify({ type: 'email.delivered', data: { id: 'em_1' } });
const ID = 'msg_conformance';
const ts = Number(process.argv[2]) || Math.floor(Date.now() / 1000);

const vectors = SUFFIXES.map(([name, suffix]) => {
  const secret = `whsec_${suffix}`;
  const key = secretToKey(secret);
  return {
    name, suffix, secret,
    key_hex: key.toString('hex'),
    // true when the base64 decode produced nothing and secretToKey therefore
    // used the whole `whsec_...` string as UTF-8 bytes.
    key_is_raw_fallback: Buffer.from(suffix, 'base64').length === 0,
    sig: signContent(secret, ID, ts, BODY),
  };
});

console.log(JSON.stringify({ body: BODY, id: ID, ts, vectors }, null, 1));

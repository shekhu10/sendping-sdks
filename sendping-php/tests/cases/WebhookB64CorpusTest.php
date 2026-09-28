<?php

declare(strict_types=1);

use SendPing\WebhookSignature;

/**
 * CONFORMANCE CORPUS for `whsec_` key derivation.
 *
 * The server derives a webhook's HMAC key with Node's `Buffer.from(suffix,
 * 'base64')` (sendping_webapp/lib/crypto.ts secretToKey). This SDK has to
 * reproduce that byte for byte, because a key that differs from the signer's
 * does NOT fail loudly — verify returns `no_match`, so a correctly configured
 * customer endpoint silently treats every genuine delivery as forged. That is
 * the worst failure mode this library has, and it shipped three times before
 * anyone had vectors to catch it.
 *
 * The vectors below were generated FROM NODE ITSELF by
 * scripts/webhook-b64-corpus.mjs — never from anyone's reading of a base64 RFC,
 * because the RFC is not what Node does and following it is how the bugs got
 * written. They are INLINED rather than read from that path so a published
 * package's tests stay self-contained; regenerate there and re-paste here.
 * Non-ASCII secrets are written as explicit \xNN byte escapes so the exact
 * bytes survive a paste, an editor, and anyone's locale.
 *
 * The five rules they pin down, each of which some SDK got wrong:
 *   1. `=` TERMINATES the input — everything from the first `=` on is discarded
 *      ('YWJj====ZA' is 'abc', not 'abcd'). PHP's non-strict base64_decode
 *      strips `=` and keeps decoding; that alone failed 6 of these.
 *   2. Characters outside the alphabet are skipped, not fatal ('YW!Jj' = 'abc').
 *   3. `-`/`_` are translated to `+`/`/`, not dropped.
 *   4. A trailing group of ONE character contributes no byte.
 *   5. The unit is the LOW 8 BITS OF EACH UTF-16 CODE UNIT, not the codepoint
 *      and not the UTF-8 byte: 'YWŁj' is 'YWAj' because U+0141 masks to 0x41,
 *      and 'YWJjĽZA' stops at 'YWJj' because U+013D masks to an '='. An astral
 *      character contributes its TWO surrogate halves' low bytes, so U+1D441 is
 *      '5' then 'A' — one whole key byte, not nothing.
 * …plus the caller-side rule: an EMPTY decode falls back to the UTF-8 bytes of
 * the WHOLE secret, `whsec_` prefix included — the real bytes, unmasked. Ten
 * vectors take that path.
 *
 * Rule 5 is why this table grew from 31 vectors to 41. It is invisible to an
 * ASCII-only corpus: this SDK scored 31/31 here and 2000/2000 on an ASCII fuzz
 * while getting every one of the ten new vectors wrong, and 1300 of 3000 on a
 * fuzz that included codepoints above 0xFF.
 *
 * FRESHNESS: the corpus `ts` is fixed at generation time, so every case passes
 * toleranceSec = 0 to skip the clock-skew check. Signing "now" would need node
 * at test time; the freshness path itself is covered by WebhookVerifyTest.
 *
 * [name, secret, key_hex, key_is_raw_fallback, sig]
 */
$corpusBody = '{"type":"email.delivered","data":{"id":"em_1"}}';
$corpusId = 'msg_conformance';
$corpusTs = '1787200000';

$corpus = [
    ['std_padded'     , 'whsec_YWJjZA=='                                        , '61626364'                                                          , false, 'v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg='],
    ['std_unpadded'   , 'whsec_YWJjZA'                                          , '61626364'                                                          , false, 'v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg='],
    ['std_exact4'     , 'whsec_YWJj'                                            , '616263'                                                            , false, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='],
    ['short_1'        , 'whsec_Y'                                               , '77687365635f59'                                                    , true , 'v1,ZMKGqdkd7rDYPj+XX10aKkkyV1NMbcTZ7tFWT6FOwdI='],
    ['short_2'        , 'whsec_YW'                                              , '61'                                                                , false, 'v1,xnhr17yqBov566EgLaHShB0U7fh87lB6A7uiu7MAgLo='],
    ['short_3'        , 'whsec_YWJ'                                             , '6162'                                                              , false, 'v1,Fen63yOpcFJsYPJGDIVlJAcEyTdJLIHURAdGZghc0kI='],
    ['interior_eq'    , 'whsec_YWJjZA==ZXh0cmE'                                 , '61626364'                                                          , false, 'v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg='],
    ['single_eq_mid'  , 'whsec_SGVsbG8=V29ybGQ'                                 , '48656c6c6f'                                                        , false, 'v1,CZX45uWtP5WJeQEwRlfXHLHcHVZCe/8kJBOVyFNtg5Y='],
    ['eq_at_pos1'     , 'whsec_Y=WJj'                                           , '77687365635f593d574a6a'                                            , true , 'v1,UIfA+R8GMffinY6yCKf04G/2VJDSROFMoPH2eyquI0s='],
    ['leading_eq'     , 'whsec_=YWJj'                                           , '77687365635f3d59574a6a'                                            , true , 'v1,bCBBdBeVJ0HXeLD7IFOD+yuxa6OmPlOE1aglni87vcg='],
    ['only_eq'        , 'whsec_='                                               , '77687365635f3d'                                                    , true , 'v1,+Kwou17QNljxc57ZDXLHUV65F24WTp2IJ2Wrt4QX7GU='],
    ['urlsafe'        , 'whsec_a-b_cd'                                          , '6be6ff71'                                                          , false, 'v1,fkOORhSnL1g+us9oP06M38Upg0O0DWHEjNrEp14Db3o='],
    ['urlsafe_long'   , 'whsec_SGVsbG8td29ybGRfMTIz'                            , '48656c6c6f2d776f726c645f313233'                                    , false, 'v1,MQuwMf+xxNaiL4iSVxVAfo2ipZyhiRQ2nECOhs+/9cc='],
    ['space'          , 'whsec_YW Jj'                                           , '616263'                                                            , false, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='],
    ['newline'        , "whsec_YW\x0aJj"                                        , '616263'                                                            , false, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='],
    ['tab'            , "whsec_YW\x09Jj"                                        , '616263'                                                            , false, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='],
    ['crlf'           , "whsec_YWJj\x0d\x0aZA"                                  , '61626364'                                                          , false, 'v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg='],
    ['junk_bang'      , 'whsec_YW!Jj'                                           , '616263'                                                            , false, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='],
    ['junk_at'        , 'whsec_YW@#Jj'                                          , '616263'                                                            , false, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='],
    ['junk_unicode'   , "whsec_YW\xc3\xa9Jj"                                    , '616263'                                                            , false, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='],
    ['all_junk'       , 'whsec_!!!!'                                            , '77687365635f21212121'                                              , true , 'v1,58LmcOHpECIN1Kd9LCIwLIMvCWoASpvHQmdFktsf+gU='],
    ['empty'          , 'whsec_'                                                , '77687365635f'                                                      , true , 'v1,aPFabYSxb1mJ7chEB+03S8aHnrX0lOYMM3NlpX8jlD0='],
    ['urlsafe_junk_eq', 'whsec_a-b_c=d!e'                                       , '6be6ff'                                                            , false, 'v1,tCZ7/6V9FvVbB2YgSNYiDUQHBdTKAOdTBdvcu5juq4k='],
    ['real_shape'     , 'whsec_cg6z29GIzlSydvyOkBWpEsGcKujWfHKh'                , '720eb3dbd188ce54b276fc8e9015a912c19c2ae8d67c72a1'                  , false, 'v1,9ibSgi4IvJt6jD8z6VsRB20hKehvwsMa2ytnUAiUTrM='],
    ['long_mixed'     , 'whsec_QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVph-_YmNkZQ=='  , '4142434445464748494a4b4c4d4e4f505152535455565758595a61fbf626364650', false, 'v1,wWHwga20dee3TMzivzmoRroQs9kbOe7nExI/9q8Arkc='],
    ['plus_slash'     , 'whsec_a+b/cd'                                          , '6be6ff71'                                                          , false, 'v1,fkOORhSnL1g+us9oP06M38Upg0O0DWHEjNrEp14Db3o='],
    ['mixed_alpha'    , 'whsec_a-b/c_d+e'                                       , '6be6ff73f77e'                                                      , false, 'v1,dexpl11tMd2WSNauNI5gjPiV1e53krdgh0erdyvdgoI='],
    ['many_eq'        , 'whsec_YWJj====ZA'                                      , '616263'                                                            , false, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='],
    ['eq_then_pad'    , 'whsec_YWJjZA==='                                       , '61626364'                                                          , false, 'v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg='],
    ['nonascii_only'  , "whsec_\xc3\xa9\xc3\xbc\xc3\xb1"                        , '77687365635fc3a9c3bcc3b1'                                          , true , 'v1,EFNGWPcyr/96NM1jNdYvBKQ7cDfDlPpx1D8QnQV0bX4='],
    ['digits'         , 'whsec_MTIzNDU2Nzg5MA'                                  , '31323334353637383930'                                              , false, 'v1,RAjKzOdb0xlpZlm64AFX2dHxtKQ45vjn7ccB2VgrYxo='],
    ['hi_masks_to_A'  , "whsec_YW\xc5\x81j"                                     , '616023'                                                            , false, 'v1,VL40mx0DtTM2Ikt2oCpzCyFMH7ScXmNlILOohrV8QNM='], // U+0141 -> 0x41 "A"
    ['hi_masks_to_eq' , "whsec_YWJj\xc4\xbdZA"                                  , '616263'                                                            , false, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='], // U+013D -> 0x3D "=", TERMINATES
    ['hi_masks_to_a'  , "whsec_\xc5\xa1\xc5\xa1"                                , '69'                                                                , false, 'v1,qH+B7OwJNP75A4fe3wfM9VmT2/NDw3CmQzM4wFLDa6Y='], // U+0161 -> 0x61 "a"
    ['hi_masks_to_4'  , "whsec_YWJ\xe1\x88\xb4"                                 , '616278'                                                            , false, 'v1,DaONzoMXkQD31ZqPmBOAOGJgLUGdfvTQ8laGoBzdhz0='], // U+1234 -> 0x34 "4"
    ['hi_masks_to_nul', "whsec_\xc4\x80\xc4\x80\xc4\x80\xc4\x80"                , '77687365635fc480c480c480c480'                                      , true , 'v1,JVTFqibx23iRpUpvctjVuWsso1nYD2MtGUBfIwaOc/Y='], // U+0100 -> 0x00, outside the alphabet
    ['fullwidth'      , "whsec_\xef\xbc\xb9\xef\xbc\xb7\xef\xbc\xaa\xef\xbd\x8a", 'f7b2'                                                              , false, 'v1,1KN9k08myfWQt8J2QP1T1iecIEckkiLWohn3HwjKCho='], // U+FF39/37/2A/4A -> "9","7","*" (dropped),"J"
    ['astral_pair'    , "whsec_\xf0\x9d\x91\x81"                                , 'e4'                                                                , false, 'v1,VlIqZd+gIP90ykvTun54mNp62zzcFqpPgTSR1MNDcyM='], // U+1D441 -> surrogates D835/DC41 -> "5","A"
    ['astral_emoji'   , "whsec_\xf0\x9f\x8e\x89"                                , '77687365635ff09f8e89'                                              , true , 'v1,wMaEB8aUXtVZo6CX0fOjkc2gWXqwvU10RIxi4KzRX6k='], // U+1F389 -> D83C/DF89 -> "<",0x89 -> nothing
    ['cjk_skipped'    , "whsec_\xe4\xb8\xad\xe6\x96\x87"                        , '77687365635fe4b8ade69687'                                          , true , 'v1,uK9WdHrxDFXtkfPvRaB5k/JBwL3EoYA762+/mb/V6yk='], // U+4E2D -> 0x2D "-" -> "+" alone; U+6587 -> 0x87
    ['mixed_hi_lo'    , "whsec_YW\xc5\x81j\xc4\xbdZA\xc5\xa1\xc5\xa1"           , '616023'                                                            , false, 'v1,VL40mx0DtTM2Ikt2oCpzCyFMH7ScXmNlILOohrV8QNM='], // masks to "YWAj" then an "=" stops it
];

$corpusHeaders = static fn (string $sig): array => [
    'svix-id' => $corpusId,
    'svix-timestamp' => $corpusTs,
    'svix-signature' => $sig,
];
$corpusSigned = $corpusId . '.' . $corpusTs . '.' . $corpusBody;

// Pin the shape of the table itself. A re-embed that silently drops vectors
// would otherwise "pass" by testing less — which is exactly how the 31-vector
// corpus went on reporting green while rule 5 was broken in every SDK.
check_same('webhook corpus: vector count', 41, count($corpus));

// The rule-5 vectors by name, each also required to actually carry a byte above
// 0x7F. Name alone is not enough: an ASCII stand-in pasted under one of these
// names would restore precisely the blind spot this corpus exists to close.
$corpusByName = array_column($corpus, null, 0);
foreach ([
    'hi_masks_to_A', 'hi_masks_to_eq', 'hi_masks_to_a', 'hi_masks_to_4', 'hi_masks_to_nul',
    'fullwidth', 'astral_pair', 'astral_emoji', 'cjk_skipped', 'mixed_hi_lo',
] as $rule5Name) {
    check(
        "webhook corpus [{$rule5Name}]: rule-5 vector present and non-ASCII",
        isset($corpusByName[$rule5Name]) && preg_match('#[\x80-\xff]#', $corpusByName[$rule5Name][1]) === 1
    );
}

$rawFallbacks = 0;
foreach ($corpus as [$name, $secret, $keyHex, $isRawFallback, $sig]) {
    // Integrity of the inlined table: the vector's own sig must be the HMAC
    // under its stated key. Catches a mangled paste before it looks like a bug.
    $fromKeyHex = 'v1,' . base64_encode(hash_hmac('sha256', $corpusSigned, (string) hex2bin($keyHex), true));
    check_same("webhook corpus [{$name}]: vector sig matches its key_hex", $fromKeyHex, $sig);

    // The real assertion: our derived key must equal the signer's, which is
    // true exactly when the delivery verifies.
    check_same(
        "webhook corpus [{$name}]: derives the server's key",
        ['valid' => true],
        WebhookSignature::verify($corpusBody, $corpusHeaders($sig), $secret, ['toleranceSec' => 0])
    );

    if ($isRawFallback) {
        $rawFallbacks++;
        // The empty-decode fallback keys on the WHOLE secret. Signing with the
        // suffix alone — the tempting wrong answer — must NOT verify, or the
        // `whsec_` prefix has been dropped from the key.
        $suffixOnly = 'v1,' . base64_encode(hash_hmac('sha256', $corpusSigned, substr($secret, strlen('whsec_')), true));
        check_same(
            "webhook corpus [{$name}]: raw fallback keys on the whole secret, not the suffix",
            ['valid' => false, 'reason' => 'no_match'],
            WebhookSignature::verify($corpusBody, $corpusHeaders($suffixOnly), $secret, ['toleranceSec' => 0])
        );
    }
}

check_same('webhook corpus: raw-fallback vectors exercised', 10, $rawFallbacks);

import base64
import hashlib
import hmac
import time

import sendping
from sendping.webhooks import _b64_lenient, _secret_to_key

from .helpers import RecordingTestCase


class PairIteratingHeaders:
    """Stand-in for Flask/werkzeug's ``request.headers``.

    Werkzeug's ``Headers.__iter__`` yields ``(name, value)`` TUPLES, not names —
    unlike a dict, Django's ``HttpHeaders`` or Starlette's ``Headers``. The
    package README passes ``request.headers`` straight into ``Webhooks.verify``,
    so this shape has to work.
    """

    def __init__(self, pairs):
        self._list = list(pairs)

    def __iter__(self):
        return iter(self._list)

    def items(self):
        return iter(self._list)

    def __getitem__(self, key):
        for name, value in self._list:
            if name.lower() == str(key).lower():
                return value
        raise KeyError(key)


def _sign(secret_key: bytes, msg_id: str, timestamp: str, payload: str) -> str:
    signed = f"{msg_id}.{timestamp}.{payload}"
    return base64.b64encode(
        hmac.new(secret_key, signed.encode("utf-8"), hashlib.sha256).digest()
    ).decode("ascii")


class TestWebhooksApi(RecordingTestCase):
    def test_create(self):
        params = {
            "endpoint": "https://yourapp.com/hooks",
            "events": ["email.delivered", "email.bounced"],
        }
        sendping.Webhooks.create(params)
        self.assertCall("POST", "/webhooks", params)

    def test_get_list_update_remove(self):
        sendping.Webhooks.get("wh_1")
        self.assertCall("GET", "/webhooks/wh_1")
        sendping.Webhooks.list({"limit": 10})
        self.assertCall("GET", "/webhooks?limit=10")
        sendping.Webhooks.update("wh_1", {"status": "disabled"})
        self.assertCall("PATCH", "/webhooks/wh_1", {"status": "disabled"})
        sendping.Webhooks.remove("wh_1")
        self.assertCall("DELETE", "/webhooks/wh_1")

    def test_rotate_and_test(self):
        sendping.Webhooks.rotate("wh_1")
        self.assertCall("POST", "/webhooks/wh_1/rotate")
        sendping.Webhooks.test("wh_1")
        self.assertCall("POST", "/webhooks/wh_1/test")

    def test_failed_test_delivery_is_a_200_not_an_error(self):
        # A rejected test delivery still comes back HTTP 200, so this must not
        # raise — the outcome lives in "ok", and treating 200 as success would
        # silently report a broken endpoint as healthy.
        self.response = {
            "object": "webhook_test",
            "id": "wh_1",
            "ok": False,
            "error": "lookup_failed",
        }
        result = sendping.Webhooks.test("wh_1")
        self.assertCall("POST", "/webhooks/wh_1/test")
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "lookup_failed")

    def test_successful_test_delivery_reports_the_endpoint_status(self):
        self.response = {
            "object": "webhook_test",
            "id": "wh_1",
            "ok": True,
            "status": 200,
        }
        result = sendping.Webhooks.test("wh_1")
        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], 200)


class TestVerifySignature(RecordingTestCase):
    payload = '{"type":"email.delivered","data":{"id":"em_1"}}'

    def headers_for(self, secret_key: bytes, ts=None, msg_id="msg_1"):
        ts = str(int(time.time())) if ts is None else ts
        sig = _sign(secret_key, msg_id, ts, self.payload)
        return {
            "svix-id": msg_id,
            "svix-timestamp": ts,
            "svix-signature": f"v1,{sig}",
        }

    def test_valid_raw_secret(self):
        secret = "topsecret"
        headers = self.headers_for(secret.encode("utf-8"))
        result = sendping.Webhooks.verify(self.payload, headers, secret)
        self.assertEqual(result, {"valid": True})

    def test_valid_whsec_prefixed_secret(self):
        key = b"0123456789abcdef0123456789abcdef"
        secret = "whsec_" + base64.b64encode(key).decode("ascii")
        headers = self.headers_for(key)
        result = sendping.verify_webhook_signature(self.payload, headers, secret)
        self.assertEqual(result, {"valid": True})

    def test_case_insensitive_headers_and_multi_sig(self):
        secret = "topsecret"
        ts = str(int(time.time()))
        good = _sign(secret.encode(), "msg_1", ts, self.payload)
        headers = {
            "Svix-Id": "msg_1",
            "SVIX-TIMESTAMP": ts,
            "Svix-Signature": f"v1,badbadbad v1,{good}",
        }
        self.assertTrue(sendping.Webhooks.verify(self.payload, headers, secret)["valid"])

    def test_tampered_payload_rejected(self):
        secret = "topsecret"
        headers = self.headers_for(secret.encode("utf-8"))
        result = sendping.Webhooks.verify(self.payload + " ", headers, secret)
        self.assertEqual(result, {"valid": False, "reason": "no_match"})

    def test_missing_headers(self):
        result = sendping.Webhooks.verify(self.payload, {"svix-id": "msg_1"}, "s")
        self.assertEqual(result, {"valid": False, "reason": "missing_headers"})

    def test_missing_secret(self):
        headers = self.headers_for(b"x")
        result = sendping.Webhooks.verify(self.payload, headers, "")
        self.assertEqual(result, {"valid": False, "reason": "missing_secret"})

    def test_stale_timestamp_rejected(self):
        secret = "topsecret"
        stale = str(int(time.time()) - 3600)
        headers = self.headers_for(secret.encode("utf-8"), ts=stale)
        result = sendping.Webhooks.verify(self.payload, headers, secret)
        self.assertEqual(result, {"valid": False, "reason": "timestamp_out_of_tolerance"})

    def test_stale_timestamp_accepted_when_tolerance_disabled(self):
        secret = "topsecret"
        stale = str(int(time.time()) - 3600)
        headers = self.headers_for(secret.encode("utf-8"), ts=stale)
        result = sendping.Webhooks.verify(self.payload, headers, secret, tolerance_sec=0)
        self.assertEqual(result, {"valid": True})

    def test_invalid_timestamp(self):
        secret = "topsecret"
        headers = self.headers_for(secret.encode("utf-8"), ts="not-a-number")
        result = sendping.Webhooks.verify(self.payload, headers, secret)
        self.assertEqual(result, {"valid": False, "reason": "invalid_timestamp"})

    def test_bytes_payload_accepted(self):
        secret = "topsecret"
        headers = self.headers_for(secret.encode("utf-8"))
        result = sendping.Webhooks.verify(self.payload.encode("utf-8"), headers, secret)
        self.assertEqual(result, {"valid": True})

    def test_flask_style_headers_that_iterate_pairs(self):
        """A container whose iteration yields (name, value) pairs — Flask's
        ``request.headers`` — must still be read. Iterating it as if each element
        were a NAME matched nothing, so every genuinely signed delivery came back
        `missing_headers` on the exact call the README documents."""
        secret = "topsecret"
        headers = PairIteratingHeaders(self.headers_for(secret.encode("utf-8")).items())
        result = sendping.Webhooks.verify(self.payload, headers, secret)
        self.assertEqual(result, {"valid": True})

    def test_unpadded_whsec_secret_verifies(self):
        """The signer derives its key with Node's lenient base64 decoder, which
        needs no `=` padding. Python's strict ``b64decode`` raised on the same
        suffix, the SDK fell back to the raw string, and a valid delivery was
        rejected as `no_match`."""
        key = b"abcd"
        unpadded = base64.b64encode(key).decode("ascii").rstrip("=")
        self.assertEqual(unpadded, "YWJjZA")  # length 6 — not a multiple of 4
        headers = self.headers_for(key)
        result = sendping.Webhooks.verify(self.payload, headers, "whsec_" + unpadded)
        self.assertEqual(result, {"valid": True})

    def test_url_safe_whsec_secret_verifies(self):
        """Node's base64 decoder also accepts the URL-safe `-`/`_` spellings;
        ``b64decode`` silently DISCARDS them, yielding a different key."""
        key = bytes(range(250, 256)) + b"\xfb\xff\xbe"
        urlsafe = base64.urlsafe_b64encode(key).decode("ascii").rstrip("=")
        self.assertTrue("-" in urlsafe or "_" in urlsafe)
        headers = self.headers_for(key)
        result = sendping.Webhooks.verify(self.payload, headers, "whsec_" + urlsafe)
        self.assertEqual(result, {"valid": True})

    def test_lenient_base64_matches_node_byte_for_byte(self):
        """Pinned against `node -e "Buffer.from(s, 'base64')"`, which is what the
        backend's secretToKey uses (lib/crypto.ts). A trailing single character
        carries no whole byte and is dropped; 2 or 3 decode as a partial group."""
        self.assertEqual(_b64_lenient("abcd"), b"\x69\xb7\x1d")
        self.assertEqual(_b64_lenient("hello"), b"\x85\xe9\x65")  # 5 chars -> drop 1
        self.assertEqual(_b64_lenient("abc"), b"\x69\xb7")
        self.assertEqual(_b64_lenient("ab"), b"\x69")
        self.assertEqual(_b64_lenient("YWJjZA"), b"abcd")
        self.assertEqual(_b64_lenient("ab-cd_ef"), b"\x69\xbf\x9c\x77\xf7\x9f")

    def test_unrecognized_secret_still_falls_back_to_raw_bytes(self):
        """A `whsec_` secret whose suffix decodes to nothing keeps the documented
        fallback: the WHOLE string as UTF-8, exactly like the server."""
        secret = "whsec_"
        headers = self.headers_for(secret.encode("utf-8"))
        self.assertEqual(sendping.Webhooks.verify(self.payload, headers, secret),
                         {"valid": True})


# --- `whsec_` key-derivation conformance corpus ------------------------------
#
# Generated FROM NODE by scripts/webhook-b64-corpus.mjs (which runs the
# backend's own secretToKey verbatim), then INLINED here rather than read from
# that path so a published sdist/wheel's tests stay self-contained. Do not
# hand-edit: regenerate the corpus and re-embed.
#
# These vectors exist because a wrong key is SILENT. It does not raise, it
# reports `no_match`, so a correctly configured customer endpoint rejects every
# genuine delivery as forged — and that shipped twice (4.0.0 fixed strict
# decoding here and in php; 5.0.0 spread this file's own residual `=` bug to
# five more SDKs by porting it, because nobody had vectors to notice).
#
# The last ten vectors are rule 5 — Node masks each UTF-16 CODE UNIT with 0xFF
# before the table lookup, so the unit is neither the codepoint nor the UTF-8
# byte. Nothing in the first 31 can see that: every SDK scored 31/31 here and
# 2000/2000 on an ASCII fuzz while getting 1300/3000 on a fuzz that included
# codepoints above 0xFF.
#
# (name, secret, key_hex, key_is_raw_fallback, sig)
_CORPUS_BODY = '{"type":"email.delivered","data":{"id":"em_1"}}'
_CORPUS_ID = 'msg_conformance'
_CORPUS_TS = '1787200000'
_CORPUS = [
    ('std_padded', 'whsec_YWJjZA==',
     '61626364',
     False, 'v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg='),
    ('std_unpadded', 'whsec_YWJjZA',
     '61626364',
     False, 'v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg='),
    ('std_exact4', 'whsec_YWJj',
     '616263',
     False, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='),
    ('short_1', 'whsec_Y',
     '77687365635f59',
     True, 'v1,ZMKGqdkd7rDYPj+XX10aKkkyV1NMbcTZ7tFWT6FOwdI='),
    ('short_2', 'whsec_YW',
     '61',
     False, 'v1,xnhr17yqBov566EgLaHShB0U7fh87lB6A7uiu7MAgLo='),
    ('short_3', 'whsec_YWJ',
     '6162',
     False, 'v1,Fen63yOpcFJsYPJGDIVlJAcEyTdJLIHURAdGZghc0kI='),
    ('interior_eq', 'whsec_YWJjZA==ZXh0cmE',
     '61626364',
     False, 'v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg='),
    ('single_eq_mid', 'whsec_SGVsbG8=V29ybGQ',
     '48656c6c6f',
     False, 'v1,CZX45uWtP5WJeQEwRlfXHLHcHVZCe/8kJBOVyFNtg5Y='),
    ('eq_at_pos1', 'whsec_Y=WJj',
     '77687365635f593d574a6a',
     True, 'v1,UIfA+R8GMffinY6yCKf04G/2VJDSROFMoPH2eyquI0s='),
    ('leading_eq', 'whsec_=YWJj',
     '77687365635f3d59574a6a',
     True, 'v1,bCBBdBeVJ0HXeLD7IFOD+yuxa6OmPlOE1aglni87vcg='),
    ('only_eq', 'whsec_=',
     '77687365635f3d',
     True, 'v1,+Kwou17QNljxc57ZDXLHUV65F24WTp2IJ2Wrt4QX7GU='),
    ('urlsafe', 'whsec_a-b_cd',
     '6be6ff71',
     False, 'v1,fkOORhSnL1g+us9oP06M38Upg0O0DWHEjNrEp14Db3o='),
    ('urlsafe_long', 'whsec_SGVsbG8td29ybGRfMTIz',
     '48656c6c6f2d776f726c645f313233',
     False, 'v1,MQuwMf+xxNaiL4iSVxVAfo2ipZyhiRQ2nECOhs+/9cc='),
    ('space', 'whsec_YW Jj',
     '616263',
     False, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='),
    ('newline', 'whsec_YW\nJj',
     '616263',
     False, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='),
    ('tab', 'whsec_YW\tJj',
     '616263',
     False, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='),
    ('crlf', 'whsec_YWJj\r\nZA',
     '61626364',
     False, 'v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg='),
    ('junk_bang', 'whsec_YW!Jj',
     '616263',
     False, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='),
    ('junk_at', 'whsec_YW@#Jj',
     '616263',
     False, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='),
    ('junk_unicode', 'whsec_YWéJj',
     '616263',
     False, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='),
    ('all_junk', 'whsec_!!!!',
     '77687365635f21212121',
     True, 'v1,58LmcOHpECIN1Kd9LCIwLIMvCWoASpvHQmdFktsf+gU='),
    ('empty', 'whsec_',
     '77687365635f',
     True, 'v1,aPFabYSxb1mJ7chEB+03S8aHnrX0lOYMM3NlpX8jlD0='),
    ('urlsafe_junk_eq', 'whsec_a-b_c=d!e',
     '6be6ff',
     False, 'v1,tCZ7/6V9FvVbB2YgSNYiDUQHBdTKAOdTBdvcu5juq4k='),
    ('real_shape', 'whsec_cg6z29GIzlSydvyOkBWpEsGcKujWfHKh',
     '720eb3dbd188ce54b276fc8e9015a912c19c2ae8d67c72a1',
     False, 'v1,9ibSgi4IvJt6jD8z6VsRB20hKehvwsMa2ytnUAiUTrM='),
    ('long_mixed', 'whsec_QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVph-_YmNkZQ==',
     '4142434445464748494a4b4c4d4e4f505152535455565758595a61fbf626364650',
     False, 'v1,wWHwga20dee3TMzivzmoRroQs9kbOe7nExI/9q8Arkc='),
    ('plus_slash', 'whsec_a+b/cd',
     '6be6ff71',
     False, 'v1,fkOORhSnL1g+us9oP06M38Upg0O0DWHEjNrEp14Db3o='),
    ('mixed_alpha', 'whsec_a-b/c_d+e',
     '6be6ff73f77e',
     False, 'v1,dexpl11tMd2WSNauNI5gjPiV1e53krdgh0erdyvdgoI='),
    ('many_eq', 'whsec_YWJj====ZA',
     '616263',
     False, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='),
    ('eq_then_pad', 'whsec_YWJjZA===',
     '61626364',
     False, 'v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg='),
    ('nonascii_only', 'whsec_éüñ',
     '77687365635fc3a9c3bcc3b1',
     True, 'v1,EFNGWPcyr/96NM1jNdYvBKQ7cDfDlPpx1D8QnQV0bX4='),
    ('digits', 'whsec_MTIzNDU2Nzg5MA',
     '31323334353637383930',
     False, 'v1,RAjKzOdb0xlpZlm64AFX2dHxtKQ45vjn7ccB2VgrYxo='),
    # --- rule 5: the unit is the low byte of each UTF-16 code unit ---
    ('hi_masks_to_A', 'whsec_YWŁj',  # U+0141 -> 0x41 'A'
     '616023',
     False, 'v1,VL40mx0DtTM2Ikt2oCpzCyFMH7ScXmNlILOohrV8QNM='),
    ('hi_masks_to_eq', 'whsec_YWJjĽZA',  # U+013D -> 0x3D '=' TERMINATES
     '616263',
     False, 'v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk='),
    ('hi_masks_to_a', 'whsec_šš',  # U+0161 -> 0x61 'a'
     '69',
     False, 'v1,qH+B7OwJNP75A4fe3wfM9VmT2/NDw3CmQzM4wFLDa6Y='),
    ('hi_masks_to_4', 'whsec_YWJሴ',  # U+1234 -> 0x34 '4'
     '616278',
     False, 'v1,DaONzoMXkQD31ZqPmBOAOGJgLUGdfvTQ8laGoBzdhz0='),
    ('hi_masks_to_nul', 'whsec_ĀĀĀĀ',  # U+0100 -> 0x00, outside the alphabet -> raw fallback
     '77687365635fc480c480c480c480',
     True, 'v1,JVTFqibx23iRpUpvctjVuWsso1nYD2MtGUBfIwaOc/Y='),
    ('fullwidth', 'whsec_ＹＷＪｊ',  # U+FF39.. -> '9', '7', ...
     'f7b2',
     False, 'v1,1KN9k08myfWQt8J2QP1T1iecIEckkiLWohn3HwjKCho='),
    ('astral_pair', 'whsec_𝑁',  # U+1D441 -> surrogates D835/DC41 -> '5', 'A'
     'e4',
     False, 'v1,VlIqZd+gIP90ykvTun54mNp62zzcFqpPgTSR1MNDcyM='),
    ('astral_emoji', 'whsec_🎉',  # U+1F389 -> D83C/DF89 -> '<', 0x89 -> raw fallback
     '77687365635ff09f8e89',
     True, 'v1,wMaEB8aUXtVZo6CX0fOjkc2gWXqwvU10RIxi4KzRX6k='),
    ('cjk_skipped', 'whsec_中文',  # low bytes fall outside the alphabet -> raw fallback
     '77687365635fe4b8ade69687',
     True, 'v1,uK9WdHrxDFXtkfPvRaB5k/JBwL3EoYA762+/mb/V6yk='),
    ('mixed_hi_lo', 'whsec_YWŁjĽZAšš',  # masked, then rule 1 terminates at the U+013D
     '616023',
     False, 'v1,VL40mx0DtTM2Ikt2oCpzCyFMH7ScXmNlILOohrV8QNM='),
]


class TestWhsecKeyDerivationConformance(RecordingTestCase):
    """Every vector must derive the byte-for-byte key Node derives.

    The corpus `ts` is FIXED, so the signatures here go stale against the
    default 300s freshness window within minutes of generation. Rather than
    shell out to node at test time (a published tarball has no node, and a
    clock-dependent suite is a flaky suite), this drives the public API with
    the documented ``tolerance_sec=0`` escape hatch and additionally asserts
    the derived key directly — freshness is a separate contract with its own
    tests above.
    """

    def test_corpus_is_complete(self):
        # A re-embed that silently drops vectors would make this file pass by
        # testing less; the count and the raw-fallback split are both pinned.
        self.assertEqual(len(_CORPUS), 41)
        self.assertEqual(sum(1 for v in _CORPUS if v[3]), 10)
        # And specifically that the rule-5 tail survived the re-embed: those ten
        # are the only vectors that can catch a decoder reading codepoints or
        # UTF-8 bytes instead of masked UTF-16 code units.
        self.assertEqual(
            [v[0] for v in _CORPUS[31:]],
            ["hi_masks_to_A", "hi_masks_to_eq", "hi_masks_to_a", "hi_masks_to_4",
             "hi_masks_to_nul", "fullwidth", "astral_pair", "astral_emoji",
             "cjk_skipped", "mixed_hi_lo"],
        )

    def test_every_vector_derives_the_servers_key(self):
        for name, secret, key_hex, _raw, _sig in _CORPUS:
            with self.subTest(vector=name):
                self.assertEqual(_secret_to_key(secret).hex(), key_hex)

    def test_every_vector_verifies_through_the_public_api(self):
        """End-to-end proof: the key feeds the HMAC the caller actually uses."""
        for name, secret, _key_hex, _raw, sig in _CORPUS:
            with self.subTest(vector=name):
                headers = {
                    "svix-id": _CORPUS_ID,
                    "svix-timestamp": _CORPUS_TS,
                    "svix-signature": sig,
                }
                result = sendping.Webhooks.verify(
                    _CORPUS_BODY, headers, secret, tolerance_sec=0
                )
                self.assertEqual(result, {"valid": True}, name)

    def test_raw_fallback_vectors_key_off_the_whole_prefixed_secret(self):
        """When the suffix decodes to nothing the key is the WHOLE secret as
        UTF-8 — `whsec_` prefix INCLUDED, not the suffix and not empty bytes.
        Getting the decoder right and this wrong fails just as invisibly."""
        fallbacks = [(n, s, h) for n, s, h, raw, _ in _CORPUS if raw]
        self.assertEqual(
            [n for n, _, _ in fallbacks],
            ["short_1", "eq_at_pos1", "leading_eq", "only_eq", "all_junk",
             "empty", "nonascii_only", "hi_masks_to_nul", "astral_emoji",
             "cjk_skipped"],
        )
        for name, secret, key_hex in fallbacks:
            with self.subTest(vector=name):
                self.assertEqual(bytes.fromhex(key_hex), secret.encode("utf-8"))
                self.assertEqual(_secret_to_key(secret), secret.encode("utf-8"))

    def test_equals_terminates_rather_than_pads(self):
        """Rule 1, called out on its own because it is the bug all six SDKs
        shared: `=` ENDS the input, it is not padding to be stripped and
        decoded past. "YWJj====ZA" is b"abc" — never b"abcd"."""
        self.assertEqual(_b64_lenient("YWJj====ZA"), b"abc")
        self.assertEqual(_b64_lenient("YWJjZA==ZXh0cmE"), b"abcd")
        self.assertEqual(_b64_lenient("SGVsbG8=V29ybGQ"), b"Hello")
        self.assertEqual(_b64_lenient("Y=WJj"), b"")   # -> raw fallback
        self.assertEqual(_b64_lenient("=YWJj"), b"")   # -> raw fallback

    def test_unit_is_the_low_byte_of_each_utf16_code_unit(self):
        """Rule 5, the one no SDK implemented and no ASCII test can reach.

        Node masks every UTF-16 code unit with 0xFF before the table lookup, so
        a codepoint above 0xFF is not skipped as junk (rule 2) — it decodes as
        whatever ASCII character its low byte spells. Reading codepoints, or
        UTF-8 bytes, yields a key that differs from the signer's and therefore
        answers `no_match` for every genuine delivery."""
        self.assertEqual(_b64_lenient("YWŁj"), b"\x61\x60\x23")  # U+0141 -> 'A', not junk
        self.assertEqual(_b64_lenient("šš"), b"\x69")              # U+0161 -> 'a'
        self.assertEqual(_b64_lenient("YWJሴ"), b"\x61\x62\x78")  # U+1234 -> '4'
        self.assertEqual(_b64_lenient("ＹＷＪｊ"), b"\xf7\xb2")     # fullwidth low bytes
        # Masking must precede the `=` split (rule 1) or U+013D never terminates.
        self.assertEqual(_b64_lenient("YWJjĽZA"), b"abc")          # U+013D -> '='
        # Astral: the TWO surrogate halves' low bytes, never the UTF-8 bytes.
        self.assertEqual(_b64_lenient("𝑁"), b"\xe4")               # D835/DC41 -> '5','A'
        # And a low byte outside the alphabet is still skipped, as rule 2 says.
        self.assertEqual(_b64_lenient("ĀĀĀĀ"), b"")                # U+0100 -> 0x00

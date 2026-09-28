# frozen_string_literal: true

require "test_helper"
require "openssl"

class WebhooksTest < Minitest::Test
  include ClientStubHelper

  def test_rest_surface
    SendPing::Webhooks.create({ endpoint: "https://yourapp.com/hooks", events: ["email.delivered"] })
    assert_request :post, "/webhooks"
    assert_equal ["email.delivered"], last_body["events"]

    SendPing::Webhooks.get("wh_1")
    assert_request :get, "/webhooks/wh_1"

    SendPing::Webhooks.list
    assert_request :get, "/webhooks"

    SendPing::Webhooks.update("wh_1", { status: "disabled" })
    assert_request :patch, "/webhooks/wh_1"

    SendPing::Webhooks.rotate("wh_1")
    assert_request :post, "/webhooks/wh_1/rotate"

    SendPing::Webhooks.test("wh_1")
    assert_request :post, "/webhooks/wh_1/test"

    SendPing::Webhooks.delete("wh_1")
    assert_request :delete, "/webhooks/wh_1"
  end

  # A failed test delivery is still HTTP 200 — the real outcome is "ok", so the
  # call must not raise and the caller must not read success from the status.
  def test_failed_test_delivery_is_reported_in_ok_not_by_raising
    stub_response!(200, { "object" => "webhook_test", "id" => "wh_1",
                          "ok" => false, "error" => "lookup_failed" })
    result = SendPing::Webhooks.test("wh_1")
    assert_request :post, "/webhooks/wh_1/test"
    assert_equal false, result["ok"]
    assert_equal "lookup_failed", result["error"]
    assert_nil result["status"]
  end

  def test_successful_test_delivery_carries_the_endpoint_status
    stub_response!(200, { "object" => "webhook_test", "id" => "wh_1", "ok" => true, "status" => 200 })
    result = SendPing::Webhooks.test("wh_1")
    assert_equal true, result["ok"]
    assert_equal 200, result["status"]
    assert_nil result["error"]
  end

  # --- verify (pure local HMAC; no HTTP) ---

  SECRET_BYTES = "super-secret-signing-key"
  WHSEC = "whsec_#{[SECRET_BYTES].pack('m0')}".freeze

  # Key bytes chosen so their base64 actually contains "+" and "/", which is the
  # only way the URL-safe spelling below differs from the standard one at all.
  URLSAFE_KEY_BYTES = [0xFB, 0xFF, 0xBE, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].pack("C*").freeze
  WHSEC_STD     = "whsec_#{[URLSAFE_KEY_BYTES].pack('m0')}".freeze
  WHSEC_URLSAFE = "whsec_#{[URLSAFE_KEY_BYTES].pack('m0').tr('+/', '-_')}".freeze

  # Faithful structural stand-in for Rails' ActionDispatch::Http::Headers: an
  # Enumerable (NOT a Hash) whose #each delegates to Rack::Request::Env#each_header,
  # i.e. yields raw rack env pairs. actionpack is not a test dependency, so the
  # shape is reproduced rather than required.
  class RailsHeadersStandIn
    include Enumerable

    def initialize(env)
      @env = env
    end

    def each(&block)
      @env.each_pair(&block)
    end
  end

  def sign(payload, id: "msg_1", timestamp: Time.now.to_i.to_s, key: SECRET_BYTES)
    digest = OpenSSL::HMAC.digest("SHA256", key, "#{id}.#{timestamp}.#{payload}")
    ["v1,#{[digest].pack('m0')}", id, timestamp]
  end

  def test_valid_signature_with_whsec_secret
    payload = '{"type":"email.delivered","data":{"id":"email_1"}}'
    sig, id, ts = sign(payload)
    result = SendPing::Webhooks.verify(
      payload,
      { "svix-id" => id, "svix-timestamp" => ts, "svix-signature" => sig },
      WHSEC
    )
    assert_equal({ valid: true }, result)
    assert_empty @requests # pure local computation
  end

  def test_headers_are_read_case_insensitively_and_multi_sig_any_match_wins
    payload = "{}"
    sig, id, ts = sign(payload)
    result = SendPing::Webhooks.verify(
      payload,
      { "Svix-Id" => id, "SVIX-TIMESTAMP" => ts, "Svix-Signature" => "v1,bogus #{sig}" },
      WHSEC
    )
    assert result[:valid]
  end

  def test_raw_secret_without_whsec_prefix
    payload = "{}"
    sig, id, ts = sign(payload, key: "rawsecret")
    result = SendPing::Webhooks.verify(
      payload,
      { "svix-id" => id, "svix-timestamp" => ts, "svix-signature" => sig },
      "rawsecret"
    )
    assert result[:valid]
  end

  def test_tampered_payload_fails_with_no_match
    sig, id, ts = sign('{"amount":100}')
    result = SendPing::Webhooks.verify(
      '{"amount":999}',
      { "svix-id" => id, "svix-timestamp" => ts, "svix-signature" => sig },
      WHSEC
    )
    assert_equal({ valid: false, reason: "no_match" }, result)
  end

  def test_missing_headers_and_secret
    assert_equal "missing_headers",
                 SendPing::Webhooks.verify("{}", { "svix-id" => "msg_1" }, WHSEC)[:reason]
    sig, id, ts = sign("{}")
    assert_equal "missing_secret",
                 SendPing::Webhooks.verify(
                   "{}", { "svix-id" => id, "svix-timestamp" => ts, "svix-signature" => sig }, ""
                 )[:reason]
  end

  def test_stale_timestamp_rejected_unless_tolerance_disabled
    old_ts = (Time.now.to_i - 3600).to_s
    payload = "{}"
    sig, id, = sign(payload, timestamp: old_ts)
    headers = { "svix-id" => id, "svix-timestamp" => old_ts, "svix-signature" => sig }

    assert_equal "timestamp_out_of_tolerance",
                 SendPing::Webhooks.verify(payload, headers, WHSEC)[:reason]
    assert SendPing::Webhooks.verify(payload, headers, WHSEC, tolerance: 0)[:valid]
  end

  # The signer decodes the secret with Node's Buffer.from(suffix, 'base64')
  # (lib/crypto.ts secretToKey), which reads "-"/"_" as "+"/"/". `unpack1("m")`
  # alone DROPS those characters, deriving a shorter key than the signer, so a
  # caller-supplied URL-safe `whsec_` secret rejected every genuine delivery as
  # forged. Both spellings must derive the same key and verify the same bytes.
  def test_url_safe_whsec_secret_derives_the_same_key_as_the_standard_spelling
    refute_equal WHSEC_STD, WHSEC_URLSAFE, "test vector must actually contain + and /"

    payload = '{"type":"email.delivered","data":{"id":"email_1"}}'
    sig, id, ts = sign(payload, key: URLSAFE_KEY_BYTES)
    headers = { "svix-id" => id, "svix-timestamp" => ts, "svix-signature" => sig }

    assert SendPing::Webhooks.verify(payload, headers, WHSEC_STD)[:valid]
    assert_equal({ valid: true }, SendPing::Webhooks.verify(payload, headers, WHSEC_URLSAFE))
  end

  # Rails' `request.headers` is an ActionDispatch::Http::Headers — Enumerable,
  # not a Hash — and its #each yields rack env pairs, so the obvious Rails call
  # and the `.to_h` form the docstring used to show BOTH answered
  # `missing_headers` for deliveries SendPing really had signed.
  def test_rails_header_container_and_rack_env_spellings_verify
    payload = "{}"
    sig, id, ts = sign(payload)
    env = { "REQUEST_METHOD" => "POST", "HTTP_SVIX_ID" => id,
            "HTTP_SVIX_TIMESTAMP" => ts, "HTTP_SVIX_SIGNATURE" => sig }
    rails_headers = RailsHeadersStandIn.new(env)

    refute_kind_of Hash, rails_headers
    assert SendPing::Webhooks.verify(payload, rails_headers, WHSEC)[:valid]
    assert SendPing::Webhooks.verify(payload, rails_headers.to_h, WHSEC)[:valid]
    assert SendPing::Webhooks.verify(payload, env, WHSEC)[:valid]
  end

  # Widening the reader must not let caller-supplied input raise out of verify:
  # a LocalJumpError inside a webhook controller turns a 401 into a 500.
  def test_unreadable_header_containers_answer_missing_headers_without_raising
    block_only = Class.new do
      def each
        raise LocalJumpError, "no block given (yield)" unless block_given?
      end
    end.new

    [nil, "not-headers", block_only].each do |bad|
      assert_equal "missing_headers", SendPing::Webhooks.verify("{}", bad, WHSEC)[:reason]
    end
  end

  def test_invalid_timestamp
    payload = "{}"
    sig, id, = sign(payload, timestamp: "not-a-number")
    result = SendPing::Webhooks.verify(
      payload,
      { "svix-id" => id, "svix-timestamp" => "not-a-number", "svix-signature" => sig },
      WHSEC
    )
    assert_equal "invalid_timestamp", result[:reason]
  end

  # --- `whsec_` key derivation conformance (the whole corpus, inline) ---
  #
  # A key that differs from the signer's does NOT fail loudly: verify answers
  # `no_match`, so a correctly configured customer endpoint silently treats
  # every genuine delivery as forged. That has now shipped twice, because each
  # fix was reasoned from a base64 RFC instead of measured against the signer.
  # These vectors ARE the measurement: they come out of Node's own
  # `Buffer.from(suffix, 'base64')` (sendping_webapp/lib/crypto.ts
  # secretToKey), so they pin the five rules Ruby's decoder disagrees with —
  # "=" terminates, out-of-alphabet bytes are skipped, "-"/"_" translate to
  # "+"/"/", a trailing single character carries no byte, and the alphabet is
  # indexed by the LOW 8 BITS OF EACH UTF-16 CODE UNIT — plus the zero-byte raw
  # fallback in the caller.
  #
  # The last rule is why the corpus grew past ASCII: every codepoint below
  # 0x100 masks to itself, so a purely ASCII corpus scores a perfect run against
  # a decoder that has rule 5 completely wrong. The `hi_masks_to_*`, `fullwidth`,
  # `astral_*`, `cjk_skipped` and `mixed_hi_lo` vectors are the ones that
  # actually exercise it.
  #
  # They are INLINED rather than read from scripts/webhook-b64-corpus.json so
  # a published gem tarball stays self-contained. Regenerate them there with
  # `node scripts/webhook-b64-corpus.mjs <unix_ts>`, then re-embed here.
  CONFORMANCE_BODY = "{\"type\":\"email.delivered\",\"data\":{\"id\":\"em_1\"}}"
  CONFORMANCE_ID   = "msg_conformance"
  CONFORMANCE_TS   = 1787200000
  CONFORMANCE_VECTORS = [
    { name: "std_padded", secret: "whsec_YWJjZA==",
      key_hex: "61626364", raw_fallback: false,
      sig: "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg=" },
    { name: "std_unpadded", secret: "whsec_YWJjZA",
      key_hex: "61626364", raw_fallback: false,
      sig: "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg=" },
    { name: "std_exact4", secret: "whsec_YWJj",
      key_hex: "616263", raw_fallback: false,
      sig: "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
    { name: "short_1", secret: "whsec_Y",
      key_hex: "77687365635f59", raw_fallback: true,
      sig: "v1,ZMKGqdkd7rDYPj+XX10aKkkyV1NMbcTZ7tFWT6FOwdI=" },
    { name: "short_2", secret: "whsec_YW",
      key_hex: "61", raw_fallback: false,
      sig: "v1,xnhr17yqBov566EgLaHShB0U7fh87lB6A7uiu7MAgLo=" },
    { name: "short_3", secret: "whsec_YWJ",
      key_hex: "6162", raw_fallback: false,
      sig: "v1,Fen63yOpcFJsYPJGDIVlJAcEyTdJLIHURAdGZghc0kI=" },
    { name: "interior_eq", secret: "whsec_YWJjZA==ZXh0cmE",
      key_hex: "61626364", raw_fallback: false,
      sig: "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg=" },
    { name: "single_eq_mid", secret: "whsec_SGVsbG8=V29ybGQ",
      key_hex: "48656c6c6f", raw_fallback: false,
      sig: "v1,CZX45uWtP5WJeQEwRlfXHLHcHVZCe/8kJBOVyFNtg5Y=" },
    { name: "eq_at_pos1", secret: "whsec_Y=WJj",
      key_hex: "77687365635f593d574a6a", raw_fallback: true,
      sig: "v1,UIfA+R8GMffinY6yCKf04G/2VJDSROFMoPH2eyquI0s=" },
    { name: "leading_eq", secret: "whsec_=YWJj",
      key_hex: "77687365635f3d59574a6a", raw_fallback: true,
      sig: "v1,bCBBdBeVJ0HXeLD7IFOD+yuxa6OmPlOE1aglni87vcg=" },
    { name: "only_eq", secret: "whsec_=",
      key_hex: "77687365635f3d", raw_fallback: true,
      sig: "v1,+Kwou17QNljxc57ZDXLHUV65F24WTp2IJ2Wrt4QX7GU=" },
    { name: "urlsafe", secret: "whsec_a-b_cd",
      key_hex: "6be6ff71", raw_fallback: false,
      sig: "v1,fkOORhSnL1g+us9oP06M38Upg0O0DWHEjNrEp14Db3o=" },
    { name: "urlsafe_long", secret: "whsec_SGVsbG8td29ybGRfMTIz",
      key_hex: "48656c6c6f2d776f726c645f313233", raw_fallback: false,
      sig: "v1,MQuwMf+xxNaiL4iSVxVAfo2ipZyhiRQ2nECOhs+/9cc=" },
    { name: "space", secret: "whsec_YW Jj",
      key_hex: "616263", raw_fallback: false,
      sig: "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
    { name: "newline", secret: "whsec_YW\nJj",
      key_hex: "616263", raw_fallback: false,
      sig: "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
    { name: "tab", secret: "whsec_YW\tJj",
      key_hex: "616263", raw_fallback: false,
      sig: "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
    { name: "crlf", secret: "whsec_YWJj\r\nZA",
      key_hex: "61626364", raw_fallback: false,
      sig: "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg=" },
    { name: "junk_bang", secret: "whsec_YW!Jj",
      key_hex: "616263", raw_fallback: false,
      sig: "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
    { name: "junk_at", secret: "whsec_YW@#Jj",
      key_hex: "616263", raw_fallback: false,
      sig: "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
    { name: "junk_unicode", secret: "whsec_YW\u00E9Jj",
      key_hex: "616263", raw_fallback: false,
      sig: "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
    { name: "all_junk", secret: "whsec_!!!!",
      key_hex: "77687365635f21212121", raw_fallback: true,
      sig: "v1,58LmcOHpECIN1Kd9LCIwLIMvCWoASpvHQmdFktsf+gU=" },
    { name: "empty", secret: "whsec_",
      key_hex: "77687365635f", raw_fallback: true,
      sig: "v1,aPFabYSxb1mJ7chEB+03S8aHnrX0lOYMM3NlpX8jlD0=" },
    { name: "urlsafe_junk_eq", secret: "whsec_a-b_c=d!e",
      key_hex: "6be6ff", raw_fallback: false,
      sig: "v1,tCZ7/6V9FvVbB2YgSNYiDUQHBdTKAOdTBdvcu5juq4k=" },
    { name: "real_shape", secret: "whsec_cg6z29GIzlSydvyOkBWpEsGcKujWfHKh",
      key_hex: "720eb3dbd188ce54b276fc8e9015a912c19c2ae8d67c72a1", raw_fallback: false,
      sig: "v1,9ibSgi4IvJt6jD8z6VsRB20hKehvwsMa2ytnUAiUTrM=" },
    { name: "long_mixed", secret: "whsec_QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVph-_YmNkZQ==",
      key_hex: "4142434445464748494a4b4c4d4e4f505152535455565758595a61fbf626364650", raw_fallback: false,
      sig: "v1,wWHwga20dee3TMzivzmoRroQs9kbOe7nExI/9q8Arkc=" },
    { name: "plus_slash", secret: "whsec_a+b/cd",
      key_hex: "6be6ff71", raw_fallback: false,
      sig: "v1,fkOORhSnL1g+us9oP06M38Upg0O0DWHEjNrEp14Db3o=" },
    { name: "mixed_alpha", secret: "whsec_a-b/c_d+e",
      key_hex: "6be6ff73f77e", raw_fallback: false,
      sig: "v1,dexpl11tMd2WSNauNI5gjPiV1e53krdgh0erdyvdgoI=" },
    { name: "many_eq", secret: "whsec_YWJj====ZA",
      key_hex: "616263", raw_fallback: false,
      sig: "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
    { name: "eq_then_pad", secret: "whsec_YWJjZA===",
      key_hex: "61626364", raw_fallback: false,
      sig: "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg=" },
    { name: "nonascii_only", secret: "whsec_\u00E9\u00FC\u00F1",
      key_hex: "77687365635fc3a9c3bcc3b1", raw_fallback: true,
      sig: "v1,EFNGWPcyr/96NM1jNdYvBKQ7cDfDlPpx1D8QnQV0bX4=" },
    { name: "digits", secret: "whsec_MTIzNDU2Nzg5MA",
      key_hex: "31323334353637383930", raw_fallback: false,
      sig: "v1,RAjKzOdb0xlpZlm64AFX2dHxtKQ45vjn7ccB2VgrYxo=" },
    { name: "hi_masks_to_A", secret: "whsec_YW\u0141j",
      key_hex: "616023", raw_fallback: false,
      sig: "v1,VL40mx0DtTM2Ikt2oCpzCyFMH7ScXmNlILOohrV8QNM=" },
    { name: "hi_masks_to_eq", secret: "whsec_YWJj\u013DZA",
      key_hex: "616263", raw_fallback: false,
      sig: "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=" },
    { name: "hi_masks_to_a", secret: "whsec_\u0161\u0161",
      key_hex: "69", raw_fallback: false,
      sig: "v1,qH+B7OwJNP75A4fe3wfM9VmT2/NDw3CmQzM4wFLDa6Y=" },
    { name: "hi_masks_to_4", secret: "whsec_YWJ\u1234",
      key_hex: "616278", raw_fallback: false,
      sig: "v1,DaONzoMXkQD31ZqPmBOAOGJgLUGdfvTQ8laGoBzdhz0=" },
    { name: "hi_masks_to_nul", secret: "whsec_\u0100\u0100\u0100\u0100",
      key_hex: "77687365635fc480c480c480c480", raw_fallback: true,
      sig: "v1,JVTFqibx23iRpUpvctjVuWsso1nYD2MtGUBfIwaOc/Y=" },
    { name: "fullwidth", secret: "whsec_\uFF39\uFF37\uFF2A\uFF4A",
      key_hex: "f7b2", raw_fallback: false,
      sig: "v1,1KN9k08myfWQt8J2QP1T1iecIEckkiLWohn3HwjKCho=" },
    { name: "astral_pair", secret: "whsec_\u{1D441}",
      key_hex: "e4", raw_fallback: false,
      sig: "v1,VlIqZd+gIP90ykvTun54mNp62zzcFqpPgTSR1MNDcyM=" },
    { name: "astral_emoji", secret: "whsec_\u{1F389}",
      key_hex: "77687365635ff09f8e89", raw_fallback: true,
      sig: "v1,wMaEB8aUXtVZo6CX0fOjkc2gWXqwvU10RIxi4KzRX6k=" },
    { name: "cjk_skipped", secret: "whsec_\u4E2D\u6587",
      key_hex: "77687365635fe4b8ade69687", raw_fallback: true,
      sig: "v1,uK9WdHrxDFXtkfPvRaB5k/JBwL3EoYA762+/mb/V6yk=" },
    { name: "mixed_hi_lo", secret: "whsec_YW\u0141j\u013DZA\u0161\u0161",
      key_hex: "616023", raw_fallback: false,
      sig: "v1,VL40mx0DtTM2Ikt2oCpzCyFMH7ScXmNlILOohrV8QNM=" },
  ].freeze

  # The corpus's key_hex is the contract, so assert the derived bytes directly:
  # a divergence then names the offending secret instead of surfacing as one
  # more anonymous `no_match`. `send` because derivation is deliberately
  # private — this is a pure behaviour fix and the public API is unchanged.
  def test_key_derivation_matches_node_for_every_corpus_vector
    assert_equal 41, CONFORMANCE_VECTORS.length, "the corpus must stay complete"
    # Pinned so a lossy re-embed cannot pass by testing LESS. Everything below
    # 0x100 masks to itself, so ONLY the 10 vectors carrying a codepoint above
    # 0xFF exercise rule 5 at all — drop them and the remaining corpus is
    # satisfied by a decoder that has rule 5 completely wrong. Two of the ten
    # must be ASTRAL, the case where UTF-8 bytes and UTF-16 code units diverge
    # into two surrogate halves rather than one masked unit.
    hi = CONFORMANCE_VECTORS.select { |v| v[:secret].codepoints.any? { |c| c > 0xFF } }
    assert_equal 10, hi.length, "the corpus must keep its 10 rule-5 vectors"
    assert_equal 2, hi.count { |v| v[:secret].codepoints.any? { |c| c > 0xFFFF } },
                 "the corpus must keep both astral vectors"

    CONFORMANCE_VECTORS.each do |v|
      got = SendPing::Webhooks.send(:secret_to_key, v[:secret]).unpack1("H*")
      assert_equal v[:key_hex], got, "vector #{v[:name]}: secret #{v[:secret].inspect}"
    end
  end

  # ...and end to end through the public API, using the corpus's own
  # signatures. `tolerance: 0` because the corpus timestamp is FIXED so the
  # embedded signatures stay valid forever; freshness has its own test above,
  # and leaving it on here would fail all 41 for the wrong reason.
  def test_public_verify_accepts_every_corpus_signature
    CONFORMANCE_VECTORS.each do |v|
      headers = { "svix-id" => CONFORMANCE_ID,
                  "svix-timestamp" => CONFORMANCE_TS.to_s,
                  "svix-signature" => v[:sig] }
      result = SendPing::Webhooks.verify(CONFORMANCE_BODY, headers, v[:secret], tolerance: 0)
      assert result[:valid], "vector #{v[:name]} rejected a genuine delivery: #{result[:reason]}"
    end
    assert_empty @requests # pure local computation
  end

  # The zero-byte-decode path, asserted separately because it is the one the
  # decoder cannot fix on its own: when the decode yields NOTHING the key is
  # the UTF-8 bytes of the WHOLE secret, `whsec_` prefix INCLUDED — not an
  # empty key, and not the suffix's bytes. POST /webhooks stores `secret`
  # verbatim with no shape validation, so "whsec_", "whsec_=", "whsec_!!!!"
  # and "whsec_=YWJj" are all secrets a customer can really create.
  #
  # Note the fallback bytes are the secret's REAL UTF-8 bytes — rule 5's mask
  # applies only inside the base64 decode. "whsec_ĀĀĀĀ"
  # masks to four NULs and decodes to nothing, yet keys with c4 80 four times
  # over, not with 00 00 00 00.
  def test_zero_byte_decode_falls_back_to_the_whole_secret_including_the_prefix
    raw = CONFORMANCE_VECTORS.select { |v| v[:raw_fallback] }
    assert_equal 10, raw.length, "the corpus carries 10 raw-fallback vectors"

    raw.each do |v|
      key = SendPing::Webhooks.send(:secret_to_key, v[:secret])
      assert_equal v[:secret].b, key.b, "vector #{v[:name]} did not use the whole secret"
      assert key.start_with?("whsec_"), "vector #{v[:name]} dropped the prefix"
    end
  end

  # The single rule every implementation missed, kept as a named case so a
  # regression reads as the rule it broke rather than as four opaque corpus
  # failures: "=" TERMINATES the input. It is not padding to strip and decode
  # past — doing that yields "abcd" for the first secret below, where Node
  # yields "abc", and the resulting key rejects every genuine delivery.
  def test_equals_terminates_the_base64_input
    derive = ->(secret) { SendPing::Webhooks.send(:secret_to_key, secret) }

    assert_equal "616263", derive.call("whsec_YWJj====ZA").unpack1("H*")
    assert_equal "61626364", derive.call("whsec_YWJjZA==ZXh0cmE").unpack1("H*")
    # Nothing decodable before the terminator -> zero bytes -> raw fallback.
    assert_equal "whsec_=YWJj", derive.call("whsec_=YWJj")
  end

  # Rule 5, named for the same reason: the alphabet is indexed by the LOW 8
  # BITS OF EACH UTF-16 CODE UNIT, not by the codepoint and not by the UTF-8
  # bytes. Ruby strings are UTF-8, so the units have to be materialised before
  # anything else happens — reading UTF-8 bytes instead feeds the decoder
  # continuation bytes that are all out of alphabet, silently shortening the
  # key, and `no_match` is the only symptom a customer ever sees.
  def test_low_byte_of_each_utf16_code_unit_is_the_base64_unit
    derive = ->(secret) { SendPing::Webhooks.send(:secret_to_key, secret).unpack1("H*") }

    # U+0141 masks to 0x41 "A": one unit, though it is two UTF-8 bytes.
    assert_equal "616023", derive.call("whsec_YWŁj")
    # U+0161 masks to 0x61 "a" -> "aa", a 2-char group carrying one byte.
    assert_equal "69", derive.call("whsec_šš")
    # U+1234 masks to 0x34 "4" — three UTF-8 bytes, still ONE unit.
    assert_equal "616278", derive.call("whsec_YWJሴ")
    # Fullwidth: 0x39 "9", 0x37 "7", 0x2A "*" (skipped), 0x4A "J".
    assert_equal "f7b2", derive.call("whsec_ＹＷＪｊ")
  end

  # Rule 5 must run BEFORE rule 1, not after: U+013D masks to 0x3D, a literal
  # "=", and therefore TERMINATES the input. Splitting the unmasked text first
  # never sees it, decodes straight through, and derives 61626364 where Node
  # derives 616263.
  def test_masked_unit_can_be_the_equals_terminator
    assert_equal "616263",
                 SendPing::Webhooks.send(:secret_to_key, "whsec_YWJjĽZA").unpack1("H*")
  end

  # An ASTRAL codepoint is Node's TWO surrogate halves, and each half's low
  # byte is its own base64 character: U+1D441 is 0xD835/0xDC41 -> "5A" -> one
  # byte 0xE4. Its four UTF-8 bytes (f0 9d 91 81) are all out of alphabet and
  # would decode to nothing at all, sending this secret down the raw fallback
  # and keying with entirely different bytes.
  def test_astral_codepoint_contributes_both_surrogate_halves
    key = SendPing::Webhooks.send(:secret_to_key, "whsec_𝑁")
    assert_equal "e4", key.unpack1("H*")
    refute_equal "whsec_𝑁".b, key.b, "astral secret must not fall back to raw UTF-8"
  end

end

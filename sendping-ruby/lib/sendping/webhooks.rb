# frozen_string_literal: true

require "openssl"

module SendPing
  module Webhooks
    class << self
      # Create a webhook. The plaintext signing secret is returned ONCE, only here.
      # POST /webhooks — params: { endpoint:, events: [...], secret: }
      def create(params)
        Client.request(:post, "/webhooks", body: params)
      end

      # GET /webhooks/:id
      def get(webhook_id)
        Client.request(:get, "/webhooks/#{Client.path_escape(webhook_id)}")
      end

      # GET /webhooks
      def list(params = {})
        Client.request(:get, "/webhooks", query: Client.pagination(params))
      end

      # PATCH /webhooks/:id — params: { endpoint:, events:, status: }
      def update(webhook_id, params)
        Client.request(:patch, "/webhooks/#{Client.path_escape(webhook_id)}", body: params)
      end

      # Rotate the signing secret; the new plaintext secret is returned once and
      # the old one stops verifying immediately. POST /webhooks/:id/rotate
      def rotate(webhook_id)
        Client.request(:post, "/webhooks/#{Client.path_escape(webhook_id)}/rotate")
      end

      # Send a synchronous test delivery and return the endpoint's live result.
      # POST /webhooks/:id/test
      #
      # A FAILED delivery is still HTTP 200, so this does NOT raise when your
      # endpoint rejects the test. The outcome is the "ok" key:
      #
      #   { "object" => "webhook_test", "id" => "<id>",
      #     "ok" => true,  "status" => 200 }          # endpoint accepted it
      #   { "object" => "webhook_test", "id" => "<id>",
      #     "ok" => false, "error" => "lookup_failed" } # it did not
      #
      #   result = SendPing::Webhooks.test(id)
      #   warn "test delivery failed: #{result['error']}" unless result["ok"]
      #
      # "status" is your endpoint's HTTP status when it responded at all;
      # "error" says why the delivery failed (e.g. "lookup_failed",
      # "webhook missing or disabled"). It is a single attempt — no retries
      # are scheduled.
      def test(webhook_id)
        Client.request(:post, "/webhooks/#{Client.path_escape(webhook_id)}/test")
      end

      # DELETE /webhooks/:id
      def delete(webhook_id)
        Client.request(:delete, "/webhooks/#{Client.path_escape(webhook_id)}")
      end

      # Verify a webhook delivery's Svix-style signature against your endpoint's
      # signing secret. Pure local computation (OpenSSL HMAC-SHA256) — no HTTP.
      #
      # `payload` MUST be the exact raw request body string (do not re-serialize
      # parsed JSON). `headers` may be a Hash OR any pair-yielding header
      # container (e.g. Rails' `request.headers`), carrying svix-id /
      # svix-timestamp / svix-signature (read case-insensitively, rack
      # `HTTP_SVIX_ID` spellings included; array values use the first element).
      # The signature header may carry multiple space-separated `v1,<base64>`
      # entries — any one match makes the delivery valid.
      #
      # Returns { valid: true } or { valid: false, reason: "..." }.
      #
      #   # Rails: pass request.headers straight through — NOT .to_h, which
      #   # hands you the rack env spellings instead of the header names.
      #   result = SendPing::Webhooks.verify(request.raw_post, request.headers, secret)
      #   head :unauthorized unless result[:valid]
      def verify(payload, headers, secret, tolerance: 300)
        id = read_header(headers, "svix-id")
        timestamp = read_header(headers, "svix-timestamp")
        sig_header = read_header(headers, "svix-signature")
        return { valid: false, reason: "missing_headers" } if id.nil? || timestamp.nil? || sig_header.nil?
        return { valid: false, reason: "missing_secret" } if secret.nil? || secret.to_s.empty?

        # Optional timestamp freshness check (default 5 minutes; 0 disables).
        if tolerance && tolerance.positive?
          ts = begin
            Integer(timestamp, 10)
          rescue ArgumentError, TypeError
            nil
          end
          return { valid: false, reason: "invalid_timestamp" } if ts.nil?
          return { valid: false, reason: "timestamp_out_of_tolerance" } if (Time.now.to_i - ts).abs > tolerance
        end

        signed = "#{id}.#{timestamp}.#{payload}"
        digest = OpenSSL::HMAC.digest("SHA256", secret_to_key(secret), signed)
        expected = [digest].pack("m0") # strict base64, no newline

        sig_header.split(" ").each do |part|
          part = part.strip
          next if part.empty?

          sig = part.start_with?("v1,") ? part[3..] : part
          return { valid: true } if secure_compare(sig, expected)
        end
        { valid: false, reason: "no_match" }
      end

      private

      # Case-insensitively read one header value (first element if an array).
      #
      # Accepts a Hash AND any pair-yielding container, because Rails'
      # `request.headers` is an ActionDispatch::Http::Headers — Enumerable, not
      # a Hash — and the old `is_a?(Hash)` guard rejected it before any lookup,
      # so the most natural call answered `missing_headers` for every genuinely
      # signed delivery. Rack/WSGI spellings (`HTTP_SVIX_ID`) are matched too,
      # since ActionDispatch's #each delegates to the raw rack env: that is what
      # `request.headers.to_h` and a bare rack `env` actually contain, and
      # downcased `http_svix_id` never equals `svix-id`.
      #
      # Enumerating is guarded: an exotic container whose #each demands a block
      # would otherwise raise LocalJumpError out of `verify`, turning a 401 into
      # a 500 inside a webhook controller. Caller-supplied input must never
      # raise here — an unreadable container is just `missing_headers`.
      def read_header(headers, name)
        return nil if headers.nil?

        lower = name.downcase
        rack = "http_#{lower.tr('-', '_')}"
        pairs =
          begin
            if headers.respond_to?(:each_pair) then headers.each_pair.to_a
            elsif headers.respond_to?(:each) then headers.each.to_a
            else return nil
            end
          rescue StandardError
            return nil
          end

        pairs.each do |k, v|
          key = k.to_s.downcase
          next unless key == lower || key == rack

          return v.is_a?(Array) ? v.first : v
        end
        nil
      end

      # Derive the HMAC key from a `whsec_`-prefixed secret the way the SIGNER
      # does, byte for byte. The signer is Node: base64-decode the suffix with
      # `Buffer.from(suffix, 'base64')` and, when that yields ZERO bytes, fall
      # back to the UTF-8 bytes of the WHOLE secret — `whsec_` prefix INCLUDED
      # (sendping_webapp/lib/crypto.ts secretToKey). A secret without the
      # prefix is used as raw UTF-8 bytes.
      #
      # The zero-byte fallback is not a curiosity: POST /webhooks stores
      # `secret` verbatim with no shape validation, so "whsec_", "whsec_=",
      # "whsec_!!!!" and "whsec_=YWJj" are all secrets a customer can really
      # create, and each one keys the HMAC with its own literal text. Keying
      # with an empty string instead — the obvious reading of "decode, then
      # use the result" — costs the whole endpoint silently, because a key
      # that differs from the signer's does not fail loudly: verify answers
      # `no_match` and a correctly configured endpoint treats every genuine
      # delivery as forged.
      def secret_to_key(secret)
        s = secret.to_s
        return s unless s.start_with?("whsec_")

        decoded = node_base64_decode(s["whsec_".length..])
        decoded.empty? ? s : decoded
      end

      # Node's `Buffer.from(str, 'base64')`, reproduced. Every rule here was
      # read off Node itself, NOT off a base64 RFC — following the RFC is
      # precisely how this shipped broken twice — and each one costs a real
      # key when Ruby's own decoder is trusted instead:
      #
      #   * "=" TERMINATES the input. Everything from the first one onward is
      #     DISCARDED; it is not "padding to be stripped". "YWJj====ZA" is
      #     "abc", NOT "abcd", and a leading "=" leaves nothing at all (so the
      #     caller's raw fallback takes over). `unpack1("m")` decodes straight
      #     past an interior "=", deriving a LONGER key than the signer's.
      #   * "-" and "_" are the URL-safe spellings of "+" and "/" and must be
      #     TRANSLATED. `unpack1("m")` silently DROPS them, shortening the key.
      #   * Any other out-of-alphabet byte is SKIPPED, never fatal: whitespace,
      #     punctuation and non-ASCII are ignored, so "YW!Jj" is "abc".
      #   * A trailing group of ONE character carries no whole byte, so it is
      #     dropped here rather than left to `unpack1`'s discretion (2 chars ->
      #     1 byte, 3 -> 2, 4 -> 3).
      #   * The unit Node indexes the alphabet with is the LOW 8 BITS OF EACH
      #     UTF-16 CODE UNIT, applied FIRST — see `utf16_low_bytes` below.
      #
      # Bytes, not characters, from the mask onward: a caller's secret need not
      # be valid UTF-8, and an Encoding::CompatibilityError escaping this method
      # would turn a webhook controller's 401 into a 500.
      def node_base64_decode(suffix)
        # Rule 5 runs BEFORE the "=" split, not after: U+013D masks to 0x3D and
        # must TERMINATE the input like a literal "=" — splitting on the
        # unmasked text would decode straight past it and derive a longer key.
        s = utf16_low_bytes(suffix)
        terminator = s.index("=")
        s = s[0, terminator] if terminator

        chars = s.tr("-_", "+/").gsub(%r{[^A-Za-z0-9+/]}n, "")
        chars = chars[0, chars.bytesize - 1] if (chars.bytesize % 4) == 1
        return "" if chars.empty?

        chars.unpack1("m") || ""
      end

      # Rule 5, the one no SDK had: Node masks every UTF-16 CODE UNIT with 0xFF
      # before the base64 table lookup, so the alphabet is indexed by a code
      # unit's low byte, NOT by the codepoint and NOT by the UTF-8 bytes.
      #
      # Ruby strings are UTF-8, so the code units have to be materialised first:
      # "Ł" (U+0141) is two UTF-8 bytes but ONE code unit masking to 0x41 "A",
      # and "𝑁" (U+1D441) is ASTRAL — its four UTF-8 bytes are Node's TWO
      # surrogate halves 0xD835/0xDC41, masking to 0x35 "5" and 0x41 "A". Taking
      # UTF-8 bytes instead feeds the decoder continuation bytes that are all
      # out-of-alphabet, silently shortening the key.
      #
      # Every codepoint below 0x100 masks to itself and every one at or above it
      # is a different character entirely, so nothing under 0x100 can expose
      # this — which is exactly why it survived a 31-vector corpus and a
      # 2000-case ASCII fuzz, and why the cost lands only on the customer whose
      # secret happens to carry a "Ł", a fullwidth letter or an emoji: their
      # endpoint answers `no_match` to every genuine delivery.
      #
      # Undecodable input never raises out of here: invalid bytes become U+FFFD,
      # whose low byte 0xFD is out of alphabet and therefore skipped — the same
      # answer the old byte-wise reader gave — and a total conversion failure
      # falls back to the raw bytes rather than 500-ing a webhook controller.
      def utf16_low_bytes(str)
        s = str.to_s
        s = s.dup.force_encoding(Encoding::UTF_8) if s.encoding == Encoding::BINARY
        s.encode(Encoding::UTF_16LE, invalid: :replace, undef: :replace)
         .b.unpack("v*").map { |unit| unit & 0xFF }.pack("C*")
      rescue StandardError
        # Unreachable in practice: invalid:/undef: :replace make the encode total
        # for any String. Kept so a webhook controller cannot 500 on a pathological
        # input -- but it must NOT return str.b. Those are the raw UTF-8 bytes,
        # which is exactly the pre-5.0.1 behaviour this method exists to replace,
        # and returning them would silently derive a WRONG key that verifies
        # nothing. Empty routes to the documented whole-secret fallback instead:
        # still a mismatch, but a defined one rather than a reinstated bug.
        ""
      end

      # Constant-time compare of two signature strings.
      def secure_compare(a, b)
        a = a.to_s
        b = b.to_s
        return false unless a.bytesize == b.bytesize

        l = a.unpack("C*")
        res = 0
        b.each_byte.with_index { |byte, i| res |= byte ^ l[i] }
        res.zero?
      end
    end
  end
end

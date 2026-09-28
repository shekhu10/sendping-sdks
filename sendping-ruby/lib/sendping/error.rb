# frozen_string_literal: true

module SendPing
  # Raised for every non-2xx API response. Mirrors the API error shape
  # { statusCode, name, message }:
  #
  #   begin
  #     SendPing::Emails.send(params)
  #   rescue SendPing::Error => e
  #     e.status_code # => 422
  #     e.name        # => "validation_error"
  #     e.message     # => "The `from` address must use a verified domain."
  #   end
  #
  # Match on #name, never on #message — messages are scrubbed of provider
  # identifiers server-side and are not a stable contract. A handler may also
  # answer with a status other than the one a name usually maps to, so read
  # #status_code rather than assuming one from the name.
  #
  # Some errors carry additive fields on top of those three. The whole parsed
  # body is kept on #body, with the common extras surfaced as readers that
  # return nil on an ordinary error:
  #
  #   rescue SendPing::Error => e
  #     if (cap = e.limit)                   # WHICH quota ran out
  #       cap["kind"]                        # => "emails_daily"
  #       cap["used"]; cap["limit"]          # => 100, 100
  #       cap.dig("next_plan", "name")       # => "Pro"
  #     end
  #     e.reputation                         # reputation gates
  #     e.sent                               # a batch that failed part way through
  #     e.sent_count                         #   — do NOT resend these
  #   end
  class Error < StandardError
    attr_reader :status_code, :error_name

    # The full parsed error body ({} when the response was not a JSON object).
    # Read it for any additive field newer than this SDK version.
    attr_reader :body

    def initialize(message = nil, status_code: nil, error_name: nil, body: nil)
      super(message)
      @status_code = status_code
      @error_name = error_name
      @body = body.is_a?(Hash) ? body : {}
    end

    # The API error `name` (e.g. "validation_error", "not_found").
    def name
      @error_name
    end

    # Original email for a failed or unconfirmed send; inspect before resending.
    def id
      value = @body["id"]
      value.is_a?(String) ? value : nil
    end

    # Reserved prefix, including uncertain sends. Never automatically resend it.
    def reserved
      value = @body["reserved"]
      value.is_a?(Array) ? value : nil
    end

    # The never-attempted tail; distinct from uncertain reserved items.
    def unsent_count
      value = @body["unsent_count"]
      value.is_a?(Integer) ? value : nil
    end

    # The plan/quota cap this request hit, else nil. Carried by
    # plan_limit_reached, every *_quota_exceeded, contact_limit_reached and
    # ai_credits_exceeded — it says WHICH quota ran out, how much of it was
    # used, and the cheapest plan that would fit.
    def limit
      hash_field("limit")
    end

    # The reputation-gate detail on reputation_paused /
    # reputation_limit_exceeded, else nil. Carries at least "retryable" and
    # "scope" ("tenant" | "domain" | "platform").
    def reputation
      hash_field("reputation")
    end

    # The emails that were already sent before a batch failed part way through
    # (POST /emails/batch with an idempotency_key), else nil. Do NOT resend them.
    def sent
      value = @body["sent"]
      value.is_a?(Array) ? value : nil
    end

    # How many emails went out before a batch failed part way through, else nil.
    # Falls back to #sent's size when the body carried the list but not the count.
    def sent_count
      count = @body["sent_count"]
      return count if count.is_a?(Integer)

      sent&.size
    end

    private

    def hash_field(key)
      value = @body[key]
      value.is_a?(Hash) ? value : nil
    end
  end
end

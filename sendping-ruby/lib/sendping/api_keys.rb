# frozen_string_literal: true

module SendPing
  # Listing only, by design. Keys are created, re-scoped and revoked in the
  # SendPing dashboard by a signed-in user — POST /api-keys,
  # PATCH /api-keys/:id and DELETE /api-keys/:id answer 403 `dashboard_only`
  # to every API-key caller, whatever its permission. Exposing only `list`
  # means a leaked key cannot mint itself a replacement or widen its access.
  module ApiKeys
    class << self
      # GET /api-keys — with no pagination params one page carries up to 1,000
      # non-revoked keys and `has_more` reports any truncation. `token` here is
      # the 8-character display prefix, never the secret.
      def list(params = {})
        Client.request(:get, "/api-keys", query: Client.pagination(params))
      end
    end
  end
end

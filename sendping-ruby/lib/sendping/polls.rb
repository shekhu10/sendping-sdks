# frozen_string_literal: true

module SendPing
  # Read-only results of the in-email poll widget.
  module Polls
    class << self
      # One summary row per email that has poll responses. GET /polls
      def list(params = {})
        Client.request(:get, "/polls", query: Client.pagination(params))
      end

      # The aggregated answer breakdown for one email. GET /polls/:email_id
      def get(email_id)
        Client.request(:get, "/polls/#{Client.path_escape(email_id)}")
      end
    end
  end
end

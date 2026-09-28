# frozen_string_literal: true

module SendPing
  # API request logs.
  module Logs
    class << self
      # List logs — cursor pagination plus optional server-side `method`
      # (e.g. "POST") and `status` (e.g. 429) filters. GET /logs
      def list(params = {})
        query = Client.pagination(params)
        method = Client.opt(params, :method)
        status = Client.opt(params, :status)
        query[:method] = method if method
        query[:status] = status unless status.nil?
        Client.request(:get, "/logs", query: query)
      end

      # Retrieve one log with request/response bodies. GET /logs/:id
      def get(log_id)
        Client.request(:get, "/logs/#{Client.path_escape(log_id)}")
      end
    end
  end
end

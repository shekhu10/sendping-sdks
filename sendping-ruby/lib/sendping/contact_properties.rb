# frozen_string_literal: true

module SendPing
  # Custom contact fields, usable as {{merge_tags}}.
  module ContactProperties
    class << self
      # POST /contact-properties — params: { key:, type: "string"|"number", fallback_value: }
      def create(params)
        Client.request(:post, "/contact-properties", body: params)
      end

      # GET /contact-properties/:id
      def get(property_id)
        Client.request(:get, "/contact-properties/#{Client.path_escape(property_id)}")
      end

      # GET /contact-properties
      def list(params = {})
        Client.request(:get, "/contact-properties", query: Client.pagination(params))
      end

      # PATCH /contact-properties/:id — only fallback_value is mutable.
      def update(property_id, params)
        Client.request(:patch, "/contact-properties/#{Client.path_escape(property_id)}", body: params)
      end

      # DELETE /contact-properties/:id
      def delete(property_id)
        Client.request(:delete, "/contact-properties/#{Client.path_escape(property_id)}")
      end
    end
  end
end

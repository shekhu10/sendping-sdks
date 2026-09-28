# frozen_string_literal: true

module SendPing
  module Audiences
    class << self
      # POST /audiences — params: { name: "..." }
      def create(params)
        Client.request(:post, "/audiences", body: params)
      end

      # GET /audiences/:id
      def get(audience_id)
        Client.request(:get, "/audiences/#{Client.path_escape(audience_id)}")
      end

      # GET /audiences
      def list(params = {})
        Client.request(:get, "/audiences", query: Client.pagination(params))
      end

      # Rename an audience. PATCH /audiences/:id
      def update(audience_id, params)
        Client.request(:patch, "/audiences/#{Client.path_escape(audience_id)}", body: params)
      end

      # DELETE /audiences/:id
      def delete(audience_id)
        Client.request(:delete, "/audiences/#{Client.path_escape(audience_id)}")
      end

      # Import contacts from a link-shared Google Sheet; header columns become
      # contact properties and rows land in a fresh segment.
      # POST /audiences/:id/contacts/import-sheet — params: { url:, segment_name: }
      def import_sheet(audience_id, params)
        Client.request(:post, "/audiences/#{Client.path_escape(audience_id)}/contacts/import-sheet", body: params)
      end
    end
  end
end

# frozen_string_literal: true

module SendPing
  module Templates
    class << self
      # POST /templates — params: { name:, alias:, subject:, html:, text:, variables: [...] }
      def create(params)
        Client.request(:post, "/templates", body: params)
      end

      # GET /templates/:id (an alias works anywhere an id is accepted)
      def get(template_id)
        Client.request(:get, "/templates/#{Client.path_escape(template_id)}")
      end

      # GET /templates
      def list(params = {})
        Client.request(:get, "/templates", query: Client.pagination(params))
      end

      # PATCH /templates/:id
      def update(template_id, params)
        Client.request(:patch, "/templates/#{Client.path_escape(template_id)}", body: params)
      end

      # Duplicate a template. POST /templates/:id/duplicate — params: { name:, alias: }
      def duplicate(template_id, params = {})
        Client.request(:post, "/templates/#{Client.path_escape(template_id)}/duplicate", body: params)
      end

      # Publish a template (make its latest draft live). POST /templates/:id/publish
      def publish(template_id)
        Client.request(:post, "/templates/#{Client.path_escape(template_id)}/publish")
      end

      # DELETE /templates/:id
      def delete(template_id)
        Client.request(:delete, "/templates/#{Client.path_escape(template_id)}")
      end
    end
  end
end

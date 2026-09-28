# frozen_string_literal: true

module SendPing
  # Topics (granular subscriptions) are DOMAIN-FIRST: `domain` is required on
  # create and list. Topic names are reusable across domains.
  module Topics
    class << self
      # POST /topics
      #   SendPing::Topics.create({ domain: "yourdomain.com", name: "Product updates",
      #                               default_subscription: "opt_in" })
      def create(params)
        Client.require_domain!(params, "Topics.create")
        Client.request(:post, "/topics", body: params)
      end

      # GET /topics/:id
      def get(topic_id)
        Client.request(:get, "/topics/#{Client.path_escape(topic_id)}")
      end

      # List a domain's topics (`domain` required). GET /topics?domain=
      def list(params)
        domain = Client.require_domain!(params, "Topics.list")
        Client.request(:get, "/topics", query: { domain: domain }.merge(Client.pagination(params)))
      end

      # PATCH /topics/:id
      def update(topic_id, params)
        Client.request(:patch, "/topics/#{Client.path_escape(topic_id)}", body: params)
      end

      # DELETE /topics/:id
      def delete(topic_id)
        Client.request(:delete, "/topics/#{Client.path_escape(topic_id)}")
      end
    end
  end
end

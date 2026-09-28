# frozen_string_literal: true

module SendPing
  # Segments are DOMAIN-FIRST: `domain` is required on create and list. Names
  # are unique within a domain (reusable across domains); every domain also
  # carries an auto-created "General" (all contacts) segment.
  module Segments
    class << self
      # POST /segments
      #   SendPing::Segments.create({ domain: "yourdomain.com", name: "VIP",
      #                                 filter: { status: "subscribed" } })
      def create(params)
        Client.require_domain!(params, "Segments.create")
        Client.request(:post, "/segments", body: params)
      end

      # GET /segments/:id
      def get(segment_id)
        Client.request(:get, "/segments/#{Client.path_escape(segment_id)}")
      end

      # List a domain's segments (`domain` required). GET /segments?domain=
      def list(params)
        domain = Client.require_domain!(params, "Segments.list")
        Client.request(:get, "/segments", query: { domain: domain }.merge(Client.pagination(params)))
      end

      # Preview the contacts a segment currently resolves to (filter matches
      # plus explicit memberships). With no pagination params the response is
      # capped at 1,000 contacts and sets `has_more` — a segment can hold far
      # more than that, so page with `limit` + `after` to read all of it.
      # GET /segments/:id/contacts
      def contacts(segment_id, params = {})
        Client.request(
          :get,
          "/segments/#{Client.path_escape(segment_id)}/contacts",
          query: Client.pagination(params)
        )
      end

      # PATCH /segments/:id
      def update(segment_id, params)
        Client.request(:patch, "/segments/#{Client.path_escape(segment_id)}", body: params)
      end

      # DELETE /segments/:id
      def delete(segment_id)
        Client.request(:delete, "/segments/#{Client.path_escape(segment_id)}")
      end
    end
  end
end

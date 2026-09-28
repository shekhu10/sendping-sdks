# frozen_string_literal: true

module SendPing
  # Contacts are DOMAIN-FIRST: each sending domain has its own contact pool,
  # so the flat /contacts API takes `domain` (required on create/list). The
  # nested audience variants (`audience_id:`) derive the pool from the path.
  module Contacts
    class << self
      # Create a contact. POST /contacts (flat, `domain` required) or
      # POST /audiences/:id/contacts when `audience_id` is given.
      #   SendPing::Contacts.create({ domain: "yourdomain.com", email: "a@b.com" })
      #   SendPing::Contacts.create({ audience_id: "aud_1", email: "a@b.com" })
      def create(params)
        audience_id = Client.opt(params, :audience_id)
        if audience_id
          body = Client.without(params, :audience_id, :domain)
          Client.request(:post, "/audiences/#{Client.path_escape(audience_id)}/contacts", body: body)
        else
          Client.require_domain!(params, "Contacts.create (flat /contacts API)")
          Client.request(:post, "/contacts", body: Client.without(params, :audience_id))
        end
      end

      # Retrieve a contact by id (exact) or by email. An email can exist in
      # several domains' pools, so pass `domain` to pick the pool.
      #   Contacts.get({ id: "cont_1" })
      #   Contacts.get({ id: "a@b.com", domain: "yourdomain.com" })
      #   Contacts.get({ id: "cont_1", audience_id: "aud_1" })
      def get(params)
        id = Client.path_escape(Client.opt(params, :id))
        audience_id = Client.opt(params, :audience_id)
        return Client.request(:get, "/audiences/#{Client.path_escape(audience_id)}/contacts/#{id}") if audience_id

        domain = Client.opt(params, :domain)
        query = domain ? { domain: domain } : nil
        Client.request(:get, "/contacts/#{id}", query: query)
      end

      # List contacts. Flat /contacts requires `domain` (names the pool);
      # pass `audience_id` instead to use the nested API. `segment_id`
      # filters either variant; limit/after/before paginate.
      def list(params = {})
        audience_id = Client.opt(params, :audience_id)
        query = Client.pagination(params)
        segment_id = Client.opt(params, :segment_id)
        query[:segment_id] = segment_id if segment_id

        if audience_id
          Client.request(:get, "/audiences/#{Client.path_escape(audience_id)}/contacts", query: query)
        else
          query = { domain: Client.require_domain!(params, "Contacts.list (flat /contacts API)") }.merge(query)
          Client.request(:get, "/contacts", query: query)
        end
      end

      # Update a contact (id or email). PATCH /contacts/:id, or the nested
      # route when `audience_id` is given. On the flat API pass `domain` when
      # `id` is an email (disambiguates across pools).
      #   Contacts.update({ id: "cont_1", unsubscribed: true })
      def update(params)
        id = Client.path_escape(Client.opt(params, :id))
        audience_id = Client.opt(params, :audience_id)
        if audience_id
          body = Client.without(params, :audience_id, :domain, :id)
          Client.request(:patch, "/audiences/#{Client.path_escape(audience_id)}/contacts/#{id}", body: body)
        else
          Client.request(:patch, "/contacts/#{id}", body: Client.without(params, :audience_id, :id))
        end
      end

      # Delete a contact. DELETE /contacts/:id (pass `domain` when `id` is an
      # email), or the nested route when `audience_id` is given.
      def delete(params)
        id = Client.path_escape(Client.opt(params, :id))
        audience_id = Client.opt(params, :audience_id)
        return Client.request(:delete, "/audiences/#{Client.path_escape(audience_id)}/contacts/#{id}") if audience_id

        domain = Client.opt(params, :domain)
        query = domain ? { domain: domain } : nil
        Client.request(:delete, "/contacts/#{id}", query: query)
      end

      # Bulk-import contacts from an array (upsert by email; max 10,000).
      #
      # Domain-first, like .create: pass :domain for the flat
      # POST /contacts/batch, or :audience_id for POST /audiences/:id/contacts/batch.
      # Prefer this over a .create loop for many contacts — one batch takes the
      # account's contact-limit lock once, a loop takes it per contact.
      #   Contacts.batch({ domain: "yourdomain.com", contacts: [{ email: "a@b.com" }] })
      #   Contacts.batch({ audience_id: "aud_1", contacts: [{ email: "a@b.com" }], on_conflict: "skip" })
      def batch(params)
        audience_id = Client.opt(params, :audience_id)
        # "" is truthy in Ruby but names no audience — treat it as absent and
        # take the flat route, matching the other SendPing SDKs.
        audience_id = nil if audience_id == ""
        query = {}
        on_conflict = Client.opt(params, :on_conflict)
        query[:on_conflict] = on_conflict if on_conflict
        body = { contacts: Client.opt(params, :contacts) }
        return Client.request(
          :post,
          "/audiences/#{Client.path_escape(audience_id)}/contacts/batch",
          body: body,
          query: query
        ) if audience_id

        # The nested route derives its pool from the path; only the flat route
        # takes :domain (in the body, same as POST /contacts).
        domain = Client.opt(params, :domain)
        body[:domain] = domain unless domain.nil?
        Client.request(:post, "/contacts/batch", body: body, query: query)
      end

      # Bulk-import contacts from CSV (header row optional; upsert by email).
      # Non-builtin columns auto-register as custom properties unless
      # `create_properties: false`. Pass `segment_id` to also add every
      # imported email to one of this audience's segments.
      # POST /audiences/:id/contacts/import
      #
      # Inline CSV text (capped at 5 MB and 10,000 rows):
      #   Contacts.import({ audience_id: "aud_1", csv: "email\na@b.com" })
      # Or a file already uploaded via create_import_upload (no row cap — the
      # overflow past your contact limit comes back as `limit_skipped`):
      #   Contacts.import({ audience_id: "aud_1", storage_key: key })
      def import(params)
        audience_id = Client.opt(params, :audience_id)
        query = Client.filters(params, :on_conflict, :segment_id)
        query[:create_properties] = "false" if Client.opt(params, :create_properties) == false
        body = Client.filters(params, :csv, :file_name, :storage_key)
        Client.request(
          :post,
          "/audiences/#{Client.path_escape(audience_id)}/contacts/import",
          body: body,
          query: query
        )
      end

      # Mint a presigned direct-upload URL for a CSV too large to inline
      # (up to 256 MB). Upload the file to `upload_url`, then pass the returned
      # `storage_key` to Contacts.import.
      # POST /audiences/:id/contacts/import/upload — params: { filename:, size: }
      # The `upload_url` is a bearer credential — do not log it.
      def create_import_upload(params)
        audience_id = Client.opt(params, :audience_id)
        Client.request(
          :post,
          "/audiences/#{Client.path_escape(audience_id)}/contacts/import/upload",
          body: Client.without(params, :audience_id)
        )
      end

      # Add a contact to a segment. POST /contacts/:id/segments/:segment_id
      def add_to_segment(contact_id, segment_id)
        Client.request(:post, "/contacts/#{Client.path_escape(contact_id)}/segments/#{Client.path_escape(segment_id)}")
      end

      # Remove a contact from a segment. DELETE /contacts/:id/segments/:segment_id
      def remove_from_segment(contact_id, segment_id)
        Client.request(:delete, "/contacts/#{Client.path_escape(contact_id)}/segments/#{Client.path_escape(segment_id)}")
      end

      # List the segments a contact belongs to — items carry id/name/created_at
      # only, not the full segment object. GET /contacts/:id/segments
      def list_segments(contact_id, params = {})
        Client.request(
          :get,
          "/contacts/#{Client.path_escape(contact_id)}/segments",
          query: Client.pagination(params)
        )
      end

      # Get a contact's topic subscriptions. GET /contacts/:id/topics
      def get_topics(contact_id, params = {})
        Client.request(
          :get,
          "/contacts/#{Client.path_escape(contact_id)}/topics",
          query: Client.pagination(params)
        )
      end

      # Update a contact's topic subscriptions. PATCH /contacts/:id/topics
      #   Contacts.update_topics("cont_1", { topics: [{ id: "top_1", subscription: "opt_in" }] })
      def update_topics(contact_id, params)
        Client.request(:patch, "/contacts/#{Client.path_escape(contact_id)}/topics", body: params)
      end
    end
  end
end

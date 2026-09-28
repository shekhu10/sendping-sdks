# frozen_string_literal: true

module SendPing
  # Custom events that automations trigger on. Events are DOMAIN-FIRST:
  # `domain` is required on send, and only that domain's automations fire.
  module Events
    class << self
      # Send a custom event. POST /events/send
      #   SendPing::Events.send({ event: "signup.completed", domain: "yourdomain.com",
      #                             email: "user@example.com", payload: { plan: "pro" } })
      # Identify the contact by `contact_id` OR `email`. Event names cannot
      # start with the reserved "sendping:" prefix.
      #
      # NOTE: only POST /emails, POST /emails/batch, and received-email reply/forward honour `Idempotency-Key`.
      # An `idempotency_key` passed here is still forwarded, but the server
      # ignores it, so a retry ingests a SECOND event and can enroll the contact
      # twice — de-duplicate on your side instead.
      def send(params, options = {})
        Client.require_domain!(params, "Events.send")
        Client.request(:post, "/events/send", body: params, options: options)
      end

      # Create a custom-event definition (name + optional payload schema).
      # Schema values are one of "string", "number", "boolean", "date".
      # POST /events
      #   SendPing::Events.create({ name: "signup.completed", schema: { plan: "string" } })
      #
      # NOTE: `options[:idempotency_key]` carries no guarantee here — see
      # `send`. A duplicate event name is already a 422 validation_error.
      def create(params, options = {})
        Client.request(:post, "/events", body: params, options: options)
      end

      # Update a definition's payload schema. PATCH /events/:id
      # The event NAME is immutable (automations reference it) — passing `name`
      # is a 422; pass `schema: nil` to clear the schema.
      #   SendPing::Events.update("evt_1", { schema: { plan: "string" } })
      def update(event_id, params)
        Client.request(:patch, "/events/#{Client.path_escape(event_id)}", body: params)
      end

      # List custom-event definitions. GET /events
      def list(params = {})
        Client.request(:get, "/events", query: Client.pagination(params))
      end

      # Delete a custom-event definition. DELETE /events/:id
      def delete(event_id)
        Client.request(:delete, "/events/#{Client.path_escape(event_id)}")
      end
    end
  end
end

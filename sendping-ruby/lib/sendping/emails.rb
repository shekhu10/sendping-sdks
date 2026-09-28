# frozen_string_literal: true

module SendPing
  # Send and inspect emails. Inbound mail lives under SendPing::Emails::Receiving.
  module Emails
    class << self
      # Send a single email. POST /emails
      #   SendPing::Emails.send({ from: "...", to: ["..."], subject: "...", html: "..." })
      #
      # Write ordinary links. Anchors, markdown links and bare URLs/domains in
      # BOTH the :html and :text bodies are converted to tracked redirects at
      # send time (when the sending domain has click tracking on), so a click is
      # recorded whichever alternative the recipient's mail client renders.
      # Opt-out links are never wrapped, and the content you send is stored and
      # returned UNCHANGED — only the delivered copy carries the tracking URL.
      # Pass { idempotency_key: "order-123" } as the second argument to retry safely.
      def send(params, options = {})
        Client.request(:post, "/emails", body: params, options: options)
      end

      # Send up to 100 emails in one request. POST /emails/batch (alias of Batch.send).
      # Batch items reject `attachments` and `scheduled_at` — send those
      # individually via Emails.send.
      def batch(payloads, options = {})
        Client.request(:post, "/emails/batch", body: payloads, options: options)
      end

      # List sent emails (trimmed list items) — cursor pagination plus optional
      # server-side filters: `campaign_id`, `automation_id`, `source`
      # ("individual" for all one-off sends with no campaign/automation origin,
      # "api" for one-off sends made with an API key — which also covers mail
      # sent before the send origin was recorded — or "dashboard" for one-off
      # mail composed in the dashboard: the composer and inbox replies/forwards;
      # honoured only when neither `campaign_id` nor `automation_id` is
      # supplied), `domain_id`, `status` (matched case-insensitively
      # against the row's `last_event`), `folder` (one of "outbox", "sent",
      # "scheduled" or "failed" — any other value is rejected with a 422) and
      # `search` (recipients, subject and sender). `q` is the server's alias
      # for `search`, honoured only when `search` is absent. GET /emails
      def list(params = {})
        query = Client.pagination(params).merge(
          Client.filters(params, :campaign_id, :automation_id, :source, :domain_id, :status, :search, :q, :folder)
        )
        Client.request(:get, "/emails", query: query)
      end

      # Per-source send metrics, one row per origin. `kind` is "campaign",
      # "automation", "api" (one-off API-key sends, including mail sent before
      # the send origin was recorded) or "individual" (dashboard-composed
      # one-offs); `id`, `name`, `subject` and `status` are null for both the
      # "api" and "individual" rows. Not paginated. GET /emails/sources
      def sources
        Client.request(:get, "/emails/sources")
      end

      # Retrieve a sent email and its events. GET /emails/:id
      def get(email_id)
        Client.request(:get, "/emails/#{Client.path_escape(email_id)}")
      end

      # List a sent email's attachments. GET /emails/:id/attachments
      def list_attachments(email_id)
        Client.request(:get, "/emails/#{Client.path_escape(email_id)}/attachments")
      end

      # Retrieve one attachment's metadata. GET /emails/:id/attachments/:attachment_id
      def get_attachment(email_id, attachment_id)
        Client.request(:get, "/emails/#{Client.path_escape(email_id)}/attachments/#{Client.path_escape(attachment_id)}")
      end

      # Reschedule a scheduled email. PATCH /emails/:id
      #   SendPing::Emails.update("email_id", { scheduled_at: "2026-08-01T09:00:00Z" })
      def update(email_id, params)
        Client.request(:patch, "/emails/#{Client.path_escape(email_id)}", body: params)
      end

      # Cancel a scheduled email. POST /emails/:id/cancel
      def cancel(email_id)
        Client.request(:post, "/emails/#{Client.path_escape(email_id)}/cancel")
      end
    end

    # Inbound (received) email.
    module Receiving
      class << self
        # List received emails — cursor pagination plus an optional
        # `received_for` filter (only messages received for that address).
        # With no `limit` and no cursor the endpoint returns up to 1000 rows in
        # one response; pass `limit` to get normal 1-100 pages.
        # GET /emails/receiving
        def list(params = {})
          query = Client.pagination(params).merge(Client.filters(params, :received_for))
          Client.request(:get, "/emails/receiving", query: query)
        end

        # Per-address inbound stats (totals, replies, last received).
        # Not paginated. GET /emails/receiving/addresses
        def list_addresses
          Client.request(:get, "/emails/receiving/addresses")
        end

        # Retrieve a received email. GET /emails/receiving/:id
        def get(email_id)
          Client.request(:get, "/emails/receiving/#{Client.path_escape(email_id)}")
        end

        # List a received email's attachments. With no `limit` and no `after`
        # one page carries up to 1,000 of them and `has_more` reports any
        # truncation; supplying either paginates normally.
        # GET /emails/receiving/:id/attachments
        def list_attachments(email_id, params = {})
          Client.request(
            :get,
            "/emails/receiving/#{Client.path_escape(email_id)}/attachments",
            query: Client.pagination(params)
          )
        end

        # Download one attachment as raw bytes (binary String).
        # GET /emails/receiving/:id/attachments/:attachment_id
        def get_attachment(email_id, attachment_id)
          Client.request(
            :get,
            "/emails/receiving/#{Client.path_escape(email_id)}/attachments/#{Client.path_escape(attachment_id)}",
            raw: true
          )
        end

        # Download the original RFC822/MIME message as raw bytes (binary String).
        # GET /emails/receiving/:id/raw
        def get_raw(email_id)
          Client.request(:get, "/emails/receiving/#{Client.path_escape(email_id)}/raw", raw: true)
        end

        # Forward a received email. POST /emails/receiving/:id/forward
        #   Receiving.forward(id, { from: "you@yourdomain.com", to: "team@you.com" })
        def forward(email_id, params, options = {})
          Client.request(:post, "/emails/receiving/#{Client.path_escape(email_id)}/forward", body: params, options: options)
        end

        # Reply to a received email's sender, threaded into the conversation.
        # POST /emails/receiving/:id/reply
        def reply(email_id, params, options = {})
          Client.request(:post, "/emails/receiving/#{Client.path_escape(email_id)}/reply", body: params, options: options)
        end

        # Delete a received email. DELETE /emails/receiving/:id
        def delete(email_id)
          Client.request(:delete, "/emails/receiving/#{Client.path_escape(email_id)}")
        end
      end
    end
  end

  # Batch send — SendPing::Batch.send([...]). POST /emails/batch
  # Batch items reject `attachments` and `scheduled_at` — send those
  # individually via SendPing::Emails.send.
  module Batch
    class << self
      def send(payloads, options = {})
        Client.request(:post, "/emails/batch", body: payloads, options: options)
      end
    end
  end
end

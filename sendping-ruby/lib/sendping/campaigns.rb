# frozen_string_literal: true

module SendPing
  # Campaigns are DOMAIN-FIRST: `domain` (required on create) picks the
  # contact pool the campaign targets; `from` may be any verified domain.
  module Campaigns
    class << self
      # POST /campaigns
      #   SendPing::Campaigns.create({ domain: "yourdomain.com", from: "you@yourdomain.com",
      #                                  subject: "Hello", html: "<p>Hi</p>", segment_id: "seg_1" })
      # Optional scheduling params: `schedule_timezone` (IANA zone the schedule +
      # daily batching are evaluated in, e.g. "America/New_York") and
      # `daily_batch_size` (max recipients per batch-day, 1-100000).
      def create(params)
        Client.require_domain!(params, "Campaigns.create")
        Client.request(:post, "/campaigns", body: params)
      end

      # GET /campaigns/:id
      def get(campaign_id)
        Client.request(:get, "/campaigns/#{Client.path_escape(campaign_id)}")
      end

      # GET /campaigns
      def list(params = {})
        Client.request(:get, "/campaigns", query: Client.pagination(params))
      end

      # PATCH /campaigns/:id (draft campaigns only). Accepts the create-side
      # fields plus `followups` (replace pending follow-ups, [] clears),
      # `list_to` (true/false), `unsubscribe_policy` ("account" | "domain" |
      # "ignore"), `schedule_timezone` (IANA zone; nil clears), and
      # `daily_batch_size` (1-100000; nil clears).
      def update(campaign_id, params)
        Client.request(:patch, "/campaigns/#{Client.path_escape(campaign_id)}", body: params)
      end

      # Send now, or schedule with { scheduled_at: "..." }. An optional
      # `schedule_timezone` (IANA name) is persisted onto the campaign so daily
      # batching evaluates batch-days in that zone. POST /campaigns/:id/send
      def send(campaign_id, params = {})
        Client.request(:post, "/campaigns/#{Client.path_escape(campaign_id)}/send", body: params)
      end

      # Stop a campaign's remaining work. Accepted on `scheduled`, `recurring`,
      # `paused` and `queued`; anything else is a validation_error.
      # `scheduled`/`recurring`/`paused` return to `draft` (editable, re-sendable);
      # a `queued` campaign already fanning out becomes the TERMINAL `canceled`,
      # which can never be edited, re-sent or deleted. Copies already handed to
      # the mail service cannot be recalled; what stops is every remaining
      # recipient (for a staggered campaign, every future batch-day).
      # Read the returned `status` to see which happened.
      # POST /campaigns/:id/cancel
      def cancel(campaign_id)
        Client.request(:post, "/campaigns/#{Client.path_escape(campaign_id)}/cancel")
      end

      # Per-campaign analytics (counts, engagement rates, top links). GET /campaigns/:id/stats
      def stats(campaign_id)
        Client.request(:get, "/campaigns/#{Client.path_escape(campaign_id)}/stats")
      end

      # Who opened, clicked and replied, contact by contact. Each list is
      # capped at 500 rows and there is no pagination.
      # GET /campaigns/:id/engagement
      def engagement(campaign_id)
        Client.request(:get, "/campaigns/#{Client.path_escape(campaign_id)}/engagement")
      end

      # A/B winner evaluation for an A/B campaign. GET /campaigns/:id/ab
      def ab(campaign_id)
        Client.request(:get, "/campaigns/#{Client.path_escape(campaign_id)}/ab")
      end

      # DELETE /campaigns/:id
      def delete(campaign_id)
        Client.request(:delete, "/campaigns/#{Client.path_escape(campaign_id)}")
      end
    end
  end
end

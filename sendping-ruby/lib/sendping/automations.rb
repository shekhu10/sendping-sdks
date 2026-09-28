# frozen_string_literal: true

module SendPing
  # Automations are DOMAIN-FIRST: `domain` is required on create, and only
  # Events.send calls naming the same domain trigger them.
  module Automations
    class << self
      # POST /automations
      #   SendPing::Automations.create({ name: "Welcome series", domain: "yourdomain.com",
      #                                    trigger: "contact.created" })
      # The built-in "sendping:schedule" trigger fires once at
      # `trigger_config` ({ at: ISO 8601 instant, timezone: IANA name }),
      # enrolling every contact of the domain's pool — `trigger_config` is
      # required with that trigger and not accepted on any other.
      def create(params)
        Client.require_domain!(params, "Automations.create")
        Client.request(:post, "/automations", body: params)
      end

      # GET /automations/:id
      def get(automation_id)
        Client.request(:get, "/automations/#{Client.path_escape(automation_id)}")
      end

      # GET /automations
      def list(params = {})
        Client.request(:get, "/automations", query: Client.pagination(params))
      end

      # PATCH /automations/:id — params: { name:, status: "enabled"|"disabled", ... }
      # `trigger_config` ({ at:, timezone: }) updates the "sendping:schedule"
      # trigger's schedule (only valid on automations with that trigger).
      def update(automation_id, params)
        Client.request(:patch, "/automations/#{Client.path_escape(automation_id)}", body: params)
      end

      # Append a step. POST /automations/:id/steps — params: { type:, config:, key: }
      # The automation must be disabled first, and `type: "trigger"` is
      # rejected here (the trigger lives on the automation, not in `steps`).
      def add_step(automation_id, params)
        Client.request(:post, "/automations/#{Client.path_escape(automation_id)}/steps", body: params)
      end

      # Edit a step in place (automation must be disabled).
      # PATCH /automations/:id/steps/:step_id — params: { type:, config: }
      # `type` is REQUIRED: the server re-validates the whole step, so omitting
      # it is a validation_error naming the valid types. `config` REPLACES the
      # stored config wholesale (there is no merge) — resend every key you want
      # to keep. `key` is not accepted here; a step's graph key is create-only
      # (set on add_step), so delete and re-add a step to re-key it.
      def update_step(automation_id, step_id, params)
        Client.request(
          :patch,
          "/automations/#{Client.path_escape(automation_id)}/steps/#{Client.path_escape(step_id)}",
          body: params
        )
      end

      # Delete a step. DELETE /automations/:id/steps/:step_id
      def delete_step(automation_id, step_id)
        Client.request(:delete, "/automations/#{Client.path_escape(automation_id)}/steps/#{Client.path_escape(step_id)}")
      end

      # Build (or extend) the automation's steps from a prompt.
      # POST /automations/:id/ai — params: { prompt:, template_ids:, events:, attach: }
      # `prompt` is required and capped at 2000 characters. Without `attach` the
      # automation must have no steps yet; pass `attach` ({ from:, type:,
      # before: }) to append to an existing graph. The automation must be
      # stopped, and the route is limited to 20 requests per minute per account.
      def create_with_ai(automation_id, params)
        Client.request(:post, "/automations/#{Client.path_escape(automation_id)}/ai", body: params)
      end

      # List an automation's runs. `status` filters to specific run statuses
      # ("running", "completed", "failed", "skipped") and accepts an Array or a
      # comma-separated String. GET /automations/:id/runs
      def runs(automation_id, params = {})
        query = Client.pagination(params)
        status = Client.opt(params, :status)
        query[:status] = status.is_a?(Array) ? status.join(",") : status unless status.nil?
        Client.request(:get, "/automations/#{Client.path_escape(automation_id)}/runs", query: query)
      end

      # Retrieve a single run with its step trace. GET /automations/:id/runs/:run_id
      def get_run(automation_id, run_id)
        Client.request(:get, "/automations/#{Client.path_escape(automation_id)}/runs/#{Client.path_escape(run_id)}")
      end

      # Stop an automation — no new runs; in-progress runs finish. POST /automations/:id/stop
      def stop(automation_id)
        Client.request(:post, "/automations/#{Client.path_escape(automation_id)}/stop")
      end

      # DELETE /automations/:id
      def delete(automation_id)
        Client.request(:delete, "/automations/#{Client.path_escape(automation_id)}")
      end
    end
  end
end

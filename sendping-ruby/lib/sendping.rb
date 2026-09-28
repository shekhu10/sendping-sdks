# frozen_string_literal: true

require "sendping/version"
require "sendping/error"
require "sendping/client"
require "sendping/emails"
require "sendping/domains"
require "sendping/audiences"
require "sendping/contacts"
require "sendping/contact_properties"
require "sendping/segments"
require "sendping/topics"
require "sendping/campaigns"
require "sendping/templates"
require "sendping/automations"
require "sendping/webhooks"
require "sendping/events"
require "sendping/api_keys"
require "sendping/logs"
require "sendping/polls"

# The SendPing API client.
#
#   SendPing.api_key = "mb_xxxxxxxxx"
#
#   sent = SendPing::Emails.send({
#     from: "Acme <hello@yourdomain.com>",
#     to: ["delivered@test.sendping.co"],
#     subject: "Hello from SendPing",
#     html: "<p>Your first email</p>"
#   })
#   sent["id"] # => "..."
#
# `delivered@test.sendping.co` is the mailbox simulator: the send is accepted and
# produces a real email object without reaching a provider. Swap in a real
# recipient when you go live — an address on a reserved documentation domain
# (example.com, .test, .invalid) is refused with 422 `reserved_recipient`.
module SendPing
  DEFAULT_BASE_URL = "https://www.sendping.co/api"

  # Per-request network timeout, in seconds, applied to both the connect
  # (open) and read phases. 0 or nil means "no timeout".
  DEFAULT_TIMEOUT = 30

  # How many times a retryable response (HTTP 429/503) is retried before
  # giving up. 0 disables retries (a single attempt).
  DEFAULT_MAX_RETRIES = 2

  class << self
    # Your API key, e.g. "mb_xxxxxxxxx". Required before any call.
    attr_accessor :api_key

    # Override the API host (defaults to https://www.sendping.co/api).
    attr_writer :base_url

    # Per-request timeout in seconds (default 30). Set 0 (or nil) for none.
    attr_writer :timeout

    # Max automatic retries on HTTP 429/503 (default 2, i.e. up to 3 tries).
    attr_writer :max_retries

    def base_url
      @base_url || DEFAULT_BASE_URL
    end

    def timeout
      @timeout.nil? ? DEFAULT_TIMEOUT : @timeout
    end

    def max_retries
      @max_retries.nil? ? DEFAULT_MAX_RETRIES : @max_retries
    end

    #   SendPing.configure do |config|
    #     config.api_key = ENV["SENDPING_API_KEY"]
    #   end
    def configure
      yield self
    end
  end
end

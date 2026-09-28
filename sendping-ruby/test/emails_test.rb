# frozen_string_literal: true

require "test_helper"

class EmailsTest < Minitest::Test
  include ClientStubHelper

  # A stubbed 429 body would otherwise drive the real retry loop (and its real
  # sleeps). These tests are about the error envelope, not the backoff.
  def without_retries
    SendPing.max_retries = 0
    yield
  ensure
    SendPing.max_retries = nil
  end

  def test_send_posts_json_body_with_auth
    stub_response!(200, { "id" => "email_1" })
    result = SendPing::Emails.send({
                                       from: "Acme <hello@yourdomain.com>",
                                       to: ["user@example.com"],
                                       subject: "Hello",
                                       html: "<p>Hi</p>"
                                     })

    assert_request :post, "/emails"
    assert_equal "application/json", last_request["Content-Type"]
    assert_equal "Acme <hello@yourdomain.com>", last_body["from"]
    assert_equal ["user@example.com"], last_body["to"]
    assert_equal "Hello", last_body["subject"]
    assert_equal({ "id" => "email_1" }, result)
  end

  def test_send_sets_idempotency_key_header
    SendPing::Emails.send({ from: "a@b.com", to: "c@d.com", subject: "s" }, { idempotency_key: "order-123" })
    assert_equal "order-123", last_request["Idempotency-Key"]
  end

  # The 1-255 bound belongs to the server: the SDK forwards whatever it is
  # given and lets the API answer 400 invalid_idempotency_key. Every SendPing
  # SDK behaves this way — none of them pre-check the length.
  def test_idempotency_key_is_sent_verbatim_and_never_checked_locally
    assert_equal 255, SendPing::Client::IDEMPOTENCY_KEY_MAX_LENGTH

    # Not trimmed — the server trims before measuring.
    SendPing::Emails.send({ from: "a@b.com", to: "c@d.com", subject: "s" }, { idempotency_key: "  order-9  " })
    assert_equal "  order-9  ", last_request["Idempotency-Key"]

    max = "k" * SendPing::Client::IDEMPOTENCY_KEY_MAX_LENGTH
    SendPing::Emails.send({ from: "a@b.com", to: "c@d.com", subject: "s" }, { idempotency_key: max })
    assert_equal max, last_request["Idempotency-Key"]

    # 256 is one over the api_idempotency.key column width — transmitted, so
    # the API reports it, rather than raising here.
    over = "k" * (SendPing::Client::IDEMPOTENCY_KEY_MAX_LENGTH + 1)
    SendPing::Emails.send({ from: "a@b.com", to: "c@d.com", subject: "s" }, { idempotency_key: over })
    assert_equal over, last_request["Idempotency-Key"]

    SendPing::Emails.send({ from: "a@b.com", to: "c@d.com", subject: "s" }, { idempotency_key: "   " })
    assert_equal "   ", last_request["Idempotency-Key"]
  end

  def test_blank_idempotency_key_sends_no_header
    SendPing::Emails.send({ from: "a@b.com", to: "c@d.com", subject: "s" }, { idempotency_key: "" })
    assert_nil last_request["Idempotency-Key"]

    SendPing::Emails.send({ from: "a@b.com", to: "c@d.com", subject: "s" }, {})
    assert_nil last_request["Idempotency-Key"]
  end

  def test_batch_send_posts_array
    SendPing::Batch.send([{ from: "a@b.com", to: "c@d.com", subject: "one" }])
    assert_request :post, "/emails/batch"
    assert_instance_of Array, last_body
    assert_equal "one", last_body.first["subject"]
  end

  def test_list_with_pagination
    SendPing::Emails.list({ limit: 20, after: "email_9" })
    assert_request :get, "/emails?limit=20&after=email_9"
    assert_nil last_request.body
  end

  def test_list_forwards_every_server_side_filter
    SendPing::Emails.list({
                              limit: 10,
                              campaign_id: "camp_1",
                              automation_id: "auto_1",
                              source: "individual",
                              domain_id: "dom_1",
                              status: "delivered",
                              search: "acme"
                            })
    assert_request :get,
                   "/emails?limit=10&campaign_id=camp_1&automation_id=auto_1&source=individual" \
                   "&domain_id=dom_1&status=delivered&search=acme"
  end

  # `folder` takes outbox | sent | scheduled | failed; the server answers any
  # other value with 422 validation_error, so the SDK forwards it verbatim.
  def test_list_forwards_the_folder_filter
    SendPing::Emails.list({ folder: "scheduled" })
    assert_request :get, "/emails?folder=scheduled"
  end

  def test_list_supports_the_q_alias_for_search
    SendPing::Emails.list({ q: "acme" })
    assert_request :get, "/emails?q=acme"
  end

  def test_list_omits_filters_that_were_not_supplied
    SendPing::Emails.list({ status: "bounced" })
    assert_request :get, "/emails?status=bounced"
  end

  def test_sources
    SendPing::Emails.sources
    assert_request :get, "/emails/sources"
  end

  def test_get_update_cancel_and_attachments
    SendPing::Emails.get("email_1")
    assert_request :get, "/emails/email_1"

    SendPing::Emails.update("email_1", { scheduled_at: "2026-08-01T09:00:00Z" })
    assert_request :patch, "/emails/email_1"
    assert_equal "2026-08-01T09:00:00Z", last_body["scheduled_at"]

    SendPing::Emails.cancel("email_1")
    assert_request :post, "/emails/email_1/cancel"

    SendPing::Emails.list_attachments("email_1")
    assert_request :get, "/emails/email_1/attachments"

    SendPing::Emails.get_attachment("email_1", "att_1")
    assert_request :get, "/emails/email_1/attachments/att_1"
  end

  def test_path_traversal_ids_are_percent_encoded
    SendPing::Emails.get("../api-keys")
    assert_request :get, "/emails/..%2Fapi-keys"
  end

  def test_receiving_surface
    SendPing::Emails::Receiving.list({ limit: 5 })
    assert_request :get, "/emails/receiving?limit=5"

    SendPing::Emails::Receiving.get("recv_1")
    assert_request :get, "/emails/receiving/recv_1"

    SendPing::Emails::Receiving.list_addresses
    assert_request :get, "/emails/receiving/addresses"

    SendPing::Emails::Receiving.list({ received_for: "hi@yourdomain.com" })
    assert_request :get, "/emails/receiving?received_for=hi%40yourdomain.com"

    SendPing::Emails::Receiving.list_attachments("recv_1")
    assert_request :get, "/emails/receiving/recv_1/attachments"

    SendPing::Emails::Receiving.list_attachments("recv_1", { limit: 5 })
    assert_request :get, "/emails/receiving/recv_1/attachments?limit=5"

    SendPing::Emails::Receiving.forward("recv_1", { from: "you@yourdomain.com", to: "team@you.com" })
    assert_request :post, "/emails/receiving/recv_1/forward"
    assert_equal "team@you.com", last_body["to"]

    SendPing::Emails::Receiving.reply("recv_1", { from: "you@yourdomain.com", html: "<p>Thanks</p>" })
    assert_request :post, "/emails/receiving/recv_1/reply"

    SendPing::Emails::Receiving.delete("recv_1")
    assert_request :delete, "/emails/receiving/recv_1"
  end

  def test_receiving_raw_downloads_return_body_string_unparsed
    stub_response!(200, "BINARY-BYTES-NOT-JSON")
    data = SendPing::Emails::Receiving.get_raw("recv_1")
    assert_request :get, "/emails/receiving/recv_1/raw"
    assert_equal "BINARY-BYTES-NOT-JSON", data

    stub_response!(200, "%PDF-1.4 ...")
    data = SendPing::Emails::Receiving.get_attachment("recv_1", "att_1")
    assert_request :get, "/emails/receiving/recv_1/attachments/att_1"
    assert_equal "%PDF-1.4 ...", data
  end

  def test_non_2xx_raises_sendping_error_with_api_shape
    stub_response!(422, { "statusCode" => 422, "name" => "validation_error", "message" => "from must be verified" })
    err = assert_raises(SendPing::Error) do
      SendPing::Emails.send({ from: "nope@unverified.com", to: "a@b.com", subject: "s" })
    end
    assert_equal 422, err.status_code
    assert_equal "validation_error", err.name
    assert_equal "from must be verified", err.message
    # An ordinary error carries none of the additive fields.
    assert_nil err.limit
    assert_nil err.reputation
    assert_nil err.sent
    assert_nil err.sent_count
  end

  def test_quota_error_says_which_quota_ran_out
    stub_response!(429, {
                     "statusCode" => 429,
                     "name" => "daily_quota_exceeded",
                     "message" => "Daily send quota reached.",
                     "limit" => {
                       "kind" => "emails_daily", "used" => 100, "limit" => 100,
                       "requested" => 3, "remaining" => 0, "period" => "24h",
                       "plan" => { "id" => "free", "name" => "Free" },
                       "next_plan" => { "id" => "pro", "name" => "Pro", "amount" => 1400, "currency" => "USD" },
                       "credits" => { "balance" => 0, "needed" => 1, "purchasable" => true,
                                      "unit" => 1000, "amount_per_unit_cents" => 100 }
                     }
                   })
    err = without_retries do
      assert_raises(SendPing::Error) do
        SendPing::Emails.send({ from: "a@acme.com", to: "b@example.com", subject: "s" })
      end
    end
    assert_equal 429, err.status_code
    assert_equal "daily_quota_exceeded", err.name
    assert_equal "emails_daily", err.limit["kind"]
    assert_equal 100, err.limit["used"]
    assert_equal 100, err.limit["limit"]
    assert_equal "24h", err.limit["period"]
    assert_equal "Pro", err.limit.dig("next_plan", "name")
    assert_equal true, err.limit.dig("credits", "purchasable")
    # The whole body stays reachable for anything newer than this SDK.
    assert_equal "daily_quota_exceeded", err.body["name"]
    assert_nil err.reputation
    assert_nil err.sent
  end

  def test_reputation_error_exposes_the_gate_detail
    stub_response!(429, {
                     "statusCode" => 429,
                     "name" => "reputation_limit_exceeded",
                     "message" => "Sending is rate limited.",
                     "reputation" => {
                       "retryable" => true, "scope" => "domain", "status" => "warming",
                       "scope_key" => "acme.com", "hourly_limit" => 50, "hourly_used" => 50,
                       "retry_at" => "2026-08-08T12:00:00.000Z"
                     }
                   })
    err = without_retries do
      assert_raises(SendPing::Error) do
        SendPing::Emails.send({ from: "a@acme.com", to: "b@example.com", subject: "s" })
      end
    end
    assert_equal true, err.reputation["retryable"]
    assert_equal "domain", err.reputation["scope"]
    assert_equal "acme.com", err.reputation["scope_key"]
    assert_equal "2026-08-08T12:00:00.000Z", err.reputation["retry_at"]
    assert_nil err.limit
  end

  def test_partial_batch_failure_names_the_emails_already_sent
    stub_response!(429, {
                     "statusCode" => 429,
                     "name" => "daily_quota_exceeded",
                     "message" => "Daily send quota reached.",
                     "limit" => { "kind" => "emails_daily", "used" => 100, "limit" => 100 },
                     "sent" => [{ "id" => "em_1" }, { "id" => "em_2" }],
                     "sent_count" => 2
                   })
    err = without_retries do
      assert_raises(SendPing::Error) do
        SendPing::Emails.batch([{ from: "a@acme.com", to: "b@example.com", subject: "s" }],
                                 idempotency_key: "batch-1")
      end
    end
    assert_equal 2, err.sent_count
    assert_equal %w[em_1 em_2], err.sent.map { |e| e["id"] }
    assert_equal "emails_daily", err.limit["kind"]
  end

  def test_partial_batch_failure_without_sent_count_falls_back_to_the_sent_list
    stub_response!(429, { "statusCode" => 429, "name" => "monthly_quota_exceeded",
                          "message" => "…", "sent" => [{ "id" => "em_1" }] })
    err = without_retries { assert_raises(SendPing::Error) { SendPing::Emails.list } }
    assert_equal 1, err.sent_count
  end

  def test_additive_fields_of_an_unknown_shape_do_not_cost_the_caller_the_error
    stub_response!(402, { "statusCode" => 402, "name" => "plan_limit_reached",
                          "message" => "Domain cap reached.", "limit" => "soon" })
    err = assert_raises(SendPing::Error) { SendPing::Emails.list }
    assert_equal 402, err.status_code
    assert_equal "plan_limit_reached", err.name
    assert_nil err.limit
    assert_equal "soon", err.body["limit"]
  end

  def test_missing_api_key_raises_before_any_request
    SendPing.api_key = nil
    err = assert_raises(SendPing::Error) { SendPing::Emails.list }
    assert_equal "missing_api_key", err.name
    assert_empty @requests
  end

  def test_base_url_override
    SendPing.base_url = "http://localhost:3000/"
    SendPing::Emails.list
    assert_equal "localhost", last_uri.host
    assert_equal 3000, last_uri.port
    assert_equal "/emails", last_request.path
  end
end

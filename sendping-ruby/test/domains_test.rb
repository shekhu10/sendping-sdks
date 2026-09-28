# frozen_string_literal: true

require "test_helper"

class DomainsTest < Minitest::Test
  include ClientStubHelper

  def test_crud_and_verify
    SendPing::Domains.create({ name: "yourdomain.com", region: "us-east-1" })
    assert_request :post, "/domains"
    assert_equal "yourdomain.com", last_body["name"]

    SendPing::Domains.get("dom_1")
    assert_request :get, "/domains/dom_1"

    SendPing::Domains.list({ limit: 5 })
    assert_request :get, "/domains?limit=5"

    SendPing::Domains.update("dom_1", { click_tracking: true })
    assert_request :patch, "/domains/dom_1"
    assert_equal true, last_body["click_tracking"]

    SendPing::Domains.verify("dom_1")
    assert_request :post, "/domains/dom_1/verify"

    SendPing::Domains.delete("dom_1")
    assert_request :delete, "/domains/dom_1"
  end

  def test_claim_flow
    SendPing::Domains.claim({ name: "yourdomain.com" })
    assert_request :post, "/domains/claim"
    assert_equal "yourdomain.com", last_body["name"]

    SendPing::Domains.get_claim("dom_1")
    assert_request :get, "/domains/dom_1/claim"

    SendPing::Domains.verify_claim("dom_1")
    assert_request :post, "/domains/dom_1/claim/verify"
  end

  def test_dns_helpers
    SendPing::Domains.detect_dns("dom_1")
    assert_request :get, "/domains/dom_1/dns/detect"

    SendPing::Domains.apply_cloudflare_dns("dom_1", { token: "cf_token" })
    assert_request :post, "/domains/dom_1/dns/cloudflare"
    assert_equal "cf_token", last_body["token"]

    SendPing::Domains.apply_godaddy_dns("dom_1", { key: "k", secret: "s" })
    assert_request :post, "/domains/dom_1/dns/godaddy"
    assert_equal "s", last_body["secret"]

    SendPing::Domains.apply_namecheap_dns("dom_1", { apiUser: "u", apiKey: "k" })
    assert_request :post, "/domains/dom_1/dns/namecheap"
    assert_equal "u", last_body["apiUser"]
  end

  # The API reads the Namecheap credentials as `apiUser`/`apiKey` (with
  # `api_user`/`api_key` as aliases) and the optional username as `userName` or
  # `username` — there is NO `user_name` alias, so the gem must transmit these
  # keys byte-for-byte rather than rewriting them into a snake_case spelling
  # the server would ignore.
  def test_namecheap_credentials_are_transmitted_verbatim
    SendPing::Domains.apply_namecheap_dns("dom_1", { apiUser: "u", apiKey: "k", userName: "acme-sub" })
    assert_equal "acme-sub", last_body["userName"]

    SendPing::Domains.apply_namecheap_dns("dom_1", { api_user: "u", api_key: "k", username: "acme-sub" })
    assert_equal({ "api_user" => "u", "api_key" => "k", "username" => "acme-sub" }, last_body)
  end

  def test_mx_check_and_records_csv
    SendPing::Domains.mx_check("yourdomain.com")
    assert_request :get, "/domains/mx-check?name=yourdomain.com"

    # records.csv is CSV text, not JSON — it must come back as a raw String.
    stub_response!(200, "Type,Host,Full name,Value,Priority,TTL,Purpose,Status\r\nTXT,@,...")
    csv = SendPing::Domains.records_csv("dom_1")
    assert_request :get, "/domains/dom_1/records.csv"
    assert csv.start_with?("Type,Host,Full name")
  end

  def test_domain_id_is_escaped_in_paths
    SendPing::Domains.get("dom x/../../admin")
    assert_request :get, "/domains/dom%20x%2F..%2F..%2Fadmin"
  end
end

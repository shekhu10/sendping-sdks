# frozen_string_literal: true

require "minitest/autorun"
require "json"
require "sendping"

# Stubs SendPing::Client.deliver (the only method that touches the network)
# and records every Net::HTTP request the SDK builds, so tests can assert
# method + path + body + auth header without any HTTP.
module ClientStubHelper
  FakeResponse = Struct.new(:code, :body)

  TEST_API_KEY = "mb_test_key_123"

  def setup
    super
    SendPing.api_key = TEST_API_KEY
    SendPing.base_url = nil # default host
    @requests = []
    stub_response!(200, { "id" => "stub" })
  end

  def teardown
    restore_deliver!
    SendPing.api_key = nil
    SendPing.base_url = nil
    super
  end

  # Queue the response the next deliver call(s) will return.
  def stub_response!(status, body)
    @original_deliver ||= SendPing::Client.method(:deliver)
    requests = @requests
    payload = body.is_a?(String) ? body : JSON.generate(body)
    response = FakeResponse.new(status.to_s, payload)
    SendPing::Client.define_singleton_method(:deliver) do |req, uri|
      requests << { request: req, uri: uri }
      response
    end
  end

  def restore_deliver!
    return unless @original_deliver

    original = @original_deliver
    SendPing::Client.define_singleton_method(:deliver) do |req, uri|
      original.call(req, uri)
    end
    @original_deliver = nil
  end

  def last_request
    @requests.last.fetch(:request)
  end

  def last_uri
    @requests.last.fetch(:uri)
  end

  def last_body
    JSON.parse(last_request.body)
  end

  # Assert the canonical trio on the most recent request: HTTP method,
  # request path (including query string), and the Bearer auth header.
  # Tests speak in SDK-relative paths ("/webhooks"); the client prepends the
  # base URL's own path (default https://www.sendping.co/api → "/api"),
  # so strip that prefix before comparing — the suite stays base-URL agnostic.
  def assert_request(method, path_with_query)
    assert_equal method.to_s.upcase, last_request.method
    base_prefix = URI(SendPing.base_url || SendPing::DEFAULT_BASE_URL).path.chomp("/")
    actual = last_request.path
    actual = actual.delete_prefix(base_prefix) unless base_prefix.empty?
    assert_equal path_with_query, actual
    assert_equal "Bearer #{TEST_API_KEY}", last_request["Authorization"]
    assert_equal "sendping-ruby/#{SendPing::VERSION}", last_request["User-Agent"]
  end
end

# frozen_string_literal: true

require "test_helper"

# Exercises the 429/503 retry loop and timeout wiring at the single request
# chokepoint (SendPing::Client.deliver_with_retries). Stubs deliver to hand
# back a scripted sequence of responses, and stubs backoff_sleep so the loop
# runs instantly while recording the waits it chose.
class RetryTest < Minitest::Test
  # A minimal stand-in for Net::HTTPResponse: code, body, and header lookup.
  class FakeResp
    def initialize(code, body: "{}", headers: {})
      @code = code.to_s
      @body = body
      @headers = headers
    end

    attr_reader :code, :body

    def [](name)
      @headers[name]
    end
  end

  def setup
    SendPing.api_key = "mb_test_key_123"
    SendPing.base_url = nil
    SendPing.timeout = nil
    SendPing.max_retries = nil
    @original_deliver = SendPing::Client.method(:deliver)
    @original_sleep = SendPing::Client.method(:backoff_sleep)
    @waits = []
    waits = @waits
    SendPing::Client.define_singleton_method(:backoff_sleep) { |s| waits << s }
  end

  def teardown
    orig_deliver = @original_deliver
    orig_sleep = @original_sleep
    SendPing::Client.define_singleton_method(:deliver) { |req, uri| orig_deliver.call(req, uri) }
    SendPing::Client.define_singleton_method(:backoff_sleep) { |s| orig_sleep.call(s) }
    SendPing.api_key = nil
    SendPing.base_url = nil
    SendPing.timeout = nil
    SendPing.max_retries = nil
  end

  # Queue a list of FakeResp; each deliver call pops the next one.
  def stub_sequence!(responses)
    queue = responses.dup
    calls = []
    @calls = calls
    SendPing::Client.define_singleton_method(:deliver) do |req, uri|
      calls << [req, uri]
      queue.shift
    end
  end

  def test_retries_503_then_succeeds
    stub_sequence!([FakeResp.new(503), FakeResp.new(200, body: '{"id":"ok"}')])
    result = SendPing::Client.request(:get, "/emails/e_1")
    assert_equal "ok", result["id"]
    assert_equal 2, @calls.length            # one retry
    assert_equal [0.5], @waits               # exp backoff, attempt 0 => 0.5s
  end

  def test_retries_429_and_honors_retry_after_header
    stub_sequence!([FakeResp.new(429, headers: { "Retry-After" => "2" }),
                    FakeResp.new(200, body: '{"id":"ok"}')])
    SendPing::Client.request(:get, "/emails/e_1")
    assert_equal [2.0], @waits               # numeric Retry-After honored
  end

  def test_retry_after_is_capped_at_30_seconds
    stub_sequence!([FakeResp.new(503, headers: { "Retry-After" => "999" }),
                    FakeResp.new(200)])
    SendPing::Client.request(:get, "/emails/e_1")
    assert_equal [30.0], @waits
  end

  def test_exhausts_retries_and_raises_last_error
    stub_sequence!([FakeResp.new(503), FakeResp.new(503), FakeResp.new(503)])
    err = assert_raises(SendPing::Error) { SendPing::Client.request(:get, "/emails/e_1") }
    assert_equal 503, err.status_code
    assert_equal 3, @calls.length            # default max_retries 2 => 3 attempts
    assert_equal [0.5, 1.0], @waits          # exponential backoff between tries
  end

  def test_max_retries_zero_disables_retry
    SendPing.max_retries = 0
    stub_sequence!([FakeResp.new(503)])
    assert_raises(SendPing::Error) { SendPing::Client.request(:get, "/emails/e_1") }
    assert_equal 1, @calls.length            # no retry
    assert_empty @waits
  end

  def test_non_retryable_status_is_not_retried
    stub_sequence!([FakeResp.new(500, body: '{"message":"boom"}')])
    assert_raises(SendPing::Error) { SendPing::Client.request(:get, "/emails/e_1") }
    assert_equal 1, @calls.length            # 500 is not retryable
    assert_empty @waits
  end

  def test_timeout_applied_to_deliver_options
    # Verify the timeout reaches Net::HTTP.start by intercepting it.
    SendPing.timeout = 12
    captured = {}
    Net::HTTP.singleton_class.send(:alias_method, :__orig_start, :start)
    Net::HTTP.define_singleton_method(:start) do |host, port, *args, **opts, &blk|
      captured.merge!(opts)
      # Do not actually connect; return a fake success response.
      RetryTest::FakeResp.new(200, body: '{"id":"ok"}')
    end
    SendPing::Client.request(:get, "/emails/e_1")
    assert_equal 12, captured[:open_timeout]
    assert_equal 12, captured[:read_timeout]
  ensure
    Net::HTTP.singleton_class.send(:alias_method, :start, :__orig_start)
  end
end

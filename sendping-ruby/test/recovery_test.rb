# frozen_string_literal: true
require_relative "retry_test"

class RetryTest
  def test_shared_recovery_corpus
    cases = JSON.parse(File.read(File.expand_path("../../scripts/http-recovery-corpus.json", __dir__)))
    cases.each do |c|
      @waits.clear
      stub_sequence!([FakeResp.new(c["status"], body: JSON.generate(c["body"]), headers: {"Retry-After"=>"0"}),
                      FakeResp.new(200, body: '{"id":"em_retry"}')])
      invoke = -> { SendPing::Client.request(c["method"].downcase.to_sym, c["path"], body: {}, options: {idempotency_key:c["key"]}) }
      if c["attempts"] == 1
        error = assert_raises(SendPing::Error, c["name"], &invoke)
        assert_equal c["status"], error.status_code
      else
        assert_equal "em_retry", invoke.call["id"]
      end
      assert_equal c["attempts"], @calls.length, c["name"]
      assert @calls.all? { |req, _uri| req["Idempotency-Key"] == c["key"] } if c["key"]
    end
  end

  def test_reply_forward_keys_health_and_metadata
    stub_sequence!([FakeResp.new(200),FakeResp.new(200),FakeResp.new(200,body:'{"custom_host":null,"status":"shared","checked_at":"2026-09-10T00:00:00Z"}')])
    SendPing::Emails::Receiving.reply("rcv_one", {text:"a  b\n\n c"}, idempotency_key:"reply-1")
    SendPing::Emails::Receiving.forward("rcv_one", {}, idempotency_key:"forward-1")
    assert_equal "shared", SendPing::Domains.tracking_health("domain one")["status"]
    assert_equal "reply-1", @calls[0][0]["Idempotency-Key"]
    assert_equal "forward-1", @calls[1][0]["Idempotency-Key"]
    assert_equal "/api/domains/domain%20one/tracking-health", @calls[2][1].path
    assert_equal "a  b\n\n c", JSON.parse(@calls[0][0].body)["text"]
    stub_sequence!([FakeResp.new(422,body:'{"statusCode":503,"name":"validation_error","id":"em_one","reserved":[{"id":"em_one"}],"unsent_count":0}')])
    error=assert_raises(SendPing::Error) { SendPing::Client.request(:post,"/emails",body:{}) }
    assert_equal 422,error.status_code
    assert_equal "em_one",error.id
    assert_equal [{"id"=>"em_one"}],error.reserved
    assert_equal 0,error.unsent_count
  end
end

# frozen_string_literal: true

require "test_helper"

class CampaignsTest < Minitest::Test
  include ClientStubHelper

  def test_create_requires_domain
    assert_raises(ArgumentError) do
      SendPing::Campaigns.create({ from: "a@b.com", subject: "s", html: "<p>x</p>" })
    end
    assert_empty @requests
  end

  def test_create_posts_domain_first_body
    SendPing::Campaigns.create({
                                   domain: "yourdomain.com",
                                   from: "Acme <hello@yourdomain.com>",
                                   subject: "Big news",
                                   html: "<p>Hello</p>",
                                   segment_id: "seg_1"
                                 })
    assert_request :post, "/campaigns"
    assert_equal "yourdomain.com", last_body["domain"]
    assert_equal "seg_1", last_body["segment_id"]
  end

  def test_send_now_and_scheduled
    SendPing::Campaigns.send("camp_1")
    assert_request :post, "/campaigns/camp_1/send"
    assert_equal({}, last_body)

    SendPing::Campaigns.send("camp_1", { scheduled_at: "2026-08-01T09:00:00Z" })
    assert_request :post, "/campaigns/camp_1/send"
    assert_equal "2026-08-01T09:00:00Z", last_body["scheduled_at"]
  end

  def test_lifecycle_and_analytics_routes
    SendPing::Campaigns.get("camp_1")
    assert_request :get, "/campaigns/camp_1"

    SendPing::Campaigns.list({ limit: 25, after: "camp_0" })
    assert_request :get, "/campaigns?limit=25&after=camp_0"

    SendPing::Campaigns.update("camp_1", { subject: "Bigger news" })
    assert_request :patch, "/campaigns/camp_1"

    SendPing::Campaigns.cancel("camp_1")
    assert_request :post, "/campaigns/camp_1/cancel"

    SendPing::Campaigns.stats("camp_1")
    assert_request :get, "/campaigns/camp_1/stats"

    SendPing::Campaigns.engagement("camp_1")
    assert_request :get, "/campaigns/camp_1/engagement"

    SendPing::Campaigns.ab("camp_1")
    assert_request :get, "/campaigns/camp_1/ab"

    SendPing::Campaigns.delete("camp_1")
    assert_request :delete, "/campaigns/camp_1"
  end
end

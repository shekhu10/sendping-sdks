package sendping

import (
	"net/http"
	"testing"
)

func TestCampaignsCreateDomainRequired(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/campaigns" {
			t.Errorf("%s %s, want POST /campaigns", r.Method, r.URL.Path)
		}
		assertAuth(t, r)
		body := decodeBody(t, r)
		if body["domain"] != "yourdomain.com" {
			t.Errorf("domain = %v, want yourdomain.com", body["domain"])
		}
		if body["from"] != "Acme <hello@yourdomain.com>" {
			t.Errorf("from = %v", body["from"])
		}
		if body["subject"] != "Launch" {
			t.Errorf("subject = %v", body["subject"])
		}
		if body["segment_id"] != "seg_1" {
			t.Errorf("segment_id = %v", body["segment_id"])
		}
		ab, ok := body["ab_test"].(map[string]any)
		if !ok || ab["enabled"] != true || ab["subject_b"] != "Launch v2" {
			t.Errorf("ab_test = %v", body["ab_test"])
		}
		w.Write([]byte(`{"id":"cmp_1"}`))
	})

	res, err := client.Campaigns.Create(&CreateCampaignRequest{
		Domain:    "yourdomain.com",
		From:      "Acme <hello@yourdomain.com>",
		Subject:   "Launch",
		Html:      "<p>We launched!</p>",
		SegmentId: "seg_1",
		AbTest:    &CampaignAbTest{Enabled: true, SubjectB: "Launch v2", Metric: "open"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if res.Id != "cmp_1" {
		t.Errorf("Id = %q, want cmp_1", res.Id)
	}
}

func TestCampaignsSendScheduled(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/campaigns/cmp_1/send" {
			t.Errorf("%s %s, want POST /campaigns/cmp_1/send", r.Method, r.URL.Path)
		}
		body := decodeBody(t, r)
		if body["scheduled_at"] != "2026-08-01T09:00:00Z" {
			t.Errorf("scheduled_at = %v", body["scheduled_at"])
		}
		w.Write([]byte(`{"id":"cmp_1"}`))
	})

	res, err := client.Campaigns.Send("cmp_1", &SendCampaignRequest{ScheduledAt: "2026-08-01T09:00:00Z"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.Id != "cmp_1" {
		t.Errorf("Id = %q", res.Id)
	}
}

func TestCampaignsSendNowNilParamsSendsEmptyObject(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(t, r)
		if len(body) != 0 {
			t.Errorf("body = %v, want empty object", body)
		}
		w.Write([]byte(`{"id":"cmp_1"}`))
	})

	if _, err := client.Campaigns.Send("cmp_1", nil); err != nil {
		t.Fatalf("Send: %v", err)
	}
}

func TestCampaignsStats(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/campaigns/cmp_1/stats" {
			t.Errorf("%s %s, want GET /campaigns/cmp_1/stats", r.Method, r.URL.Path)
		}
		w.Write([]byte(`{"object":"campaign_stats","campaign_id":"cmp_1","total":100,"delivered":95,"opened":40,"clicked":12,"replied":3,"bounced":4,"complained":1,"rates":{"delivery":95,"open":42.1,"click":12.6,"reply":3.2,"bounce":4,"complaint":1},"links":[{"url":"https://example.com","clicks":3}]}`))
	})

	stats, err := client.Campaigns.Stats("cmp_1")
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}
	if stats.CampaignId != "cmp_1" || len(stats.Links) != 1 {
		t.Errorf("unexpected stats: %+v", stats)
	}
	if stats.Total != 100 || stats.Delivered != 95 || stats.Opened != 40 {
		t.Errorf("counts not decoded: %+v", stats)
	}
	if stats.Rates.Open != 42.1 || stats.Rates.Delivery != 95 {
		t.Errorf("rates not decoded: %+v", stats.Rates)
	}
	if stats.Links[0].Url != "https://example.com" || stats.Links[0].Clicks != 3 {
		t.Errorf("links not decoded: %+v", stats.Links[0])
	}
}

func TestCampaignsEngagement(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/campaigns/cmp_1/engagement" {
			t.Errorf("%s %s, want GET /campaigns/cmp_1/engagement", r.Method, r.URL.Path)
		}
		w.Write([]byte(`{"object":"campaign_engagement","campaign_id":"cmp_1","opened":[{"email":"a@b.com","contact_id":"con_1","opened_at":"2026-08-08T00:00:00Z","open_count":2}],"clicked":[],"replied":[{"email":"a@b.com","contact_id":null,"replied_at":null,"received_email_id":"rcv_1","subject":"Re: Launch","preview":"sounds good","category":"interested","received_at":"2026-08-08T01:00:00Z"}]}`))
	})

	eng, err := client.Campaigns.Engagement("cmp_1")
	if err != nil {
		t.Fatalf("Engagement: %v", err)
	}
	if len(eng.Opened) != 1 || eng.Opened[0].OpenCount != 2 {
		t.Errorf("opened not decoded: %+v", eng.Opened)
	}
	if len(eng.Replied) != 1 || eng.Replied[0].ReceivedEmailId != "rcv_1" || eng.Replied[0].Category != "interested" {
		t.Errorf("replied not decoded: %+v", eng.Replied)
	}
}

func TestCampaignsAbCamelCaseStats(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/campaigns/cmp_1/ab" {
			t.Errorf("path = %s", r.URL.Path)
		}
		w.Write([]byte(`{"object":"campaign_ab","campaign_id":"cmp_1","metric":"open","a":{"variant":"A","sent":50,"conversions":10,"rate":0.2},"b":{"variant":"B","sent":50,"conversions":15,"rate":0.3},"winner":"B","fallback":false,"lift":0.5,"zScore":1.29,"pValue":0.197,"confidence":"low","reason":"B leads on open rate"}`))
	})

	res, err := client.Campaigns.Ab("cmp_1")
	if err != nil {
		t.Fatalf("Ab: %v", err)
	}
	if res.Winner != "B" || res.B.Conversions != 15 || res.Confidence != "low" {
		t.Errorf("unexpected result: %+v", res)
	}
	// zScore / pValue are camelCase on the wire, deliberately.
	if res.ZScore != 1.29 || res.PValue != 0.197 {
		t.Errorf("camelCase stats not decoded: zScore=%v pValue=%v", res.ZScore, res.PValue)
	}
	// Rate and Lift arrive as FRACTIONS here (ab_winner.ts returns raw
	// conversions/sent and (winner-loser)/loser), unlike CampaignStatsRates,
	// which the server has already run through pct(). This fixture is pinned to
	// the fraction form so nobody "corrects" it back to percentages and teaches
	// the next reader to multiply by 100 twice.
	if res.A.Rate != 0.2 || res.B.Rate != 0.3 || res.Lift != 0.5 {
		t.Errorf("A/B rate and lift are fractions: a=%v b=%v lift=%v", res.A.Rate, res.B.Rate, res.Lift)
	}
}

// PATCH is 'key in body'-based, so clearing follow-ups needs an explicit empty
// array — a nil slice must stay omitted.
func TestCampaignsUpdateClearsFollowups(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(t, r)
		followups, present := body["followups"]
		if !present {
			t.Fatal("followups must be sent when set to an empty slice")
		}
		if arr, ok := followups.([]any); !ok || len(arr) != 0 {
			t.Errorf("followups = %v, want []", followups)
		}
		if body["list_to"] != false {
			t.Errorf("list_to = %v, want false", body["list_to"])
		}
		w.Write([]byte(`{"id":"cmp_1"}`))
	})

	if _, err := client.Campaigns.Update("cmp_1", &UpdateCampaignRequest{
		Followups: &[]CampaignFollowupInput{},
		ListTo:    Bool(false),
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}
}

func TestCampaignsUpdateOmitsUnsetFollowups(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(t, r)
		if _, present := body["followups"]; present {
			t.Error("unset followups must be omitted, not sent as null")
		}
		if _, present := body["list_to"]; present {
			t.Error("unset list_to must be omitted")
		}
		w.Write([]byte(`{"id":"cmp_1"}`))
	})

	if _, err := client.Campaigns.Update("cmp_1", &UpdateCampaignRequest{Name: "Renamed"}); err != nil {
		t.Fatalf("Update: %v", err)
	}
}

func TestCampaignsListReturnsReducedRows(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/campaigns" {
			t.Errorf("%s %s, want GET /campaigns", r.Method, r.URL.Path)
		}
		// The list serializer sends ONLY these keys — no from, topic_id, html,
		// text, reply_to, preview_text, schedule_timezone, daily_batch_size,
		// followups, list_address, unsubscribe_policy, recurrence or statistics.
		w.Write([]byte(`{"object":"list","has_more":false,"data":[{"object":"campaign","id":"cmp_1",` +
			`"name":"Launch","subject":"Hi","audience_id":"aud_1","segment_id":null,"status":"sent",` +
			`"ab_test":{"enabled":false},"created_at":"2026-08-08T10:00:00.000Z",` +
			`"scheduled_at":null,"sent_at":"2026-08-08T11:00:00.000Z","failure_reason":null}]}`))
	})

	list, err := client.Campaigns.List(nil)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	// Compile-time guard: widening this back to the full Campaign would promise
	// bodies, follow-ups and statistics the route never sends, and would hand
	// callers empty strings instead of an error.
	var _ *ListResponse[CampaignListItem] = list

	if len(list.Data) != 1 {
		t.Fatalf("data = %+v, want one row", list.Data)
	}
	row := list.Data[0]
	if row.Id != "cmp_1" || row.Name != "Launch" || row.Subject != "Hi" || row.AudienceId != "aud_1" {
		t.Errorf("reduced row not decoded: %+v", row)
	}
	if row.Status != "sent" || row.SentAt == "" || row.AbTest == nil || row.AbTest.Enabled {
		t.Errorf("reduced row not decoded: %+v", row)
	}
}

// The PATCH endpoints key off whether a JSON key is PRESENT: absent leaves the
// field untouched, present-with-null clears it. Before 3.0.0 the clearable
// fields were plain strings/ints with omitempty, so "clear this" was
// unreachable — the zero value was indistinguishable from "leave alone".
func TestCampaignsUpdateClearsFieldsWithExplicitNull(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/campaigns/cmp_1" {
			t.Errorf("%s %s, want PATCH /campaigns/cmp_1", r.Method, r.URL.Path)
		}
		body := decodeBody(t, r)
		for _, key := range []string{"segment_id", "topic_id", "preview_text", "reply_to", "schedule_timezone", "daily_batch_size"} {
			value, present := body[key]
			if !present {
				t.Errorf("%s missing from body, want present with null", key)
				continue
			}
			if value != nil {
				t.Errorf("%s = %v, want null", key, value)
			}
		}
		// Untouched fields must stay out of the body entirely.
		if _, present := body["name"]; present {
			t.Errorf("name present in body, want omitted")
		}
		w.Write([]byte(`{"id":"cmp_1"}`))
	})

	_, err := client.Campaigns.Update("cmp_1", &UpdateCampaignRequest{
		SegmentId:        Clear[string](),
		TopicId:          Clear[string](),
		PreviewText:      Clear[string](),
		ReplyTo:          Clear[[]string](),
		ScheduleTimezone: Clear[string](),
		DailyBatchSize:   Clear[int](),
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
}

func TestCampaignsUpdateSendsSetValues(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(t, r)
		if body["segment_id"] != "seg_2" {
			t.Errorf("segment_id = %v, want seg_2", body["segment_id"])
		}
		if body["daily_batch_size"] != float64(500) {
			t.Errorf("daily_batch_size = %v, want 500", body["daily_batch_size"])
		}
		replyTo, ok := body["reply_to"].([]any)
		if !ok || len(replyTo) != 1 || replyTo[0] != "ops@example.com" {
			t.Errorf("reply_to = %v", body["reply_to"])
		}
		if _, present := body["topic_id"]; present {
			t.Errorf("topic_id present in body, want omitted")
		}
		w.Write([]byte(`{"id":"cmp_1"}`))
	})

	_, err := client.Campaigns.Update("cmp_1", &UpdateCampaignRequest{
		SegmentId:      Set("seg_2"),
		DailyBatchSize: Set(500),
		ReplyTo:        Set([]string{"ops@example.com"}),
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
}

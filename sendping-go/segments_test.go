package sendping

import (
	"net/http"
	"testing"
)

func TestSegmentsCreateDomainRequired(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/segments" {
			t.Errorf("%s %s, want POST /segments", r.Method, r.URL.Path)
		}
		assertAuth(t, r)
		body := decodeBody(t, r)
		if body["domain"] != "yourdomain.com" {
			t.Errorf("domain = %v, want yourdomain.com", body["domain"])
		}
		if body["name"] != "VIP" {
			t.Errorf("name = %v, want VIP", body["name"])
		}
		filter, ok := body["filter"].(map[string]any)
		if !ok || filter["status"] != "subscribed" {
			t.Errorf("filter = %v", body["filter"])
		}
		w.Write([]byte(`{"object":"segment","id":"seg_1","audience_id":"aud_1","name":"VIP","filter":{"status":"subscribed","email_contains":null,"property_filters":[],"engagement":null},"created_at":"2026-07-06T00:00:00Z","updated_at":"2026-07-06T00:00:00Z"}`))
	})

	seg, err := client.Segments.Create(&CreateSegmentRequest{
		Domain: "yourdomain.com",
		Name:   "VIP",
		Filter: &SegmentFilterInput{Status: "subscribed"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if seg.Id != "seg_1" || seg.Name != "VIP" || seg.Filter.Status != "subscribed" {
		t.Errorf("unexpected segment: %+v", seg)
	}
}

func TestSegmentsCreateEngagementFilter(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(t, r)
		filter, ok := body["filter"].(map[string]any)
		if !ok {
			t.Fatalf("filter = %v", body["filter"])
		}
		eng, ok := filter["engagement"].(map[string]any)
		if !ok || eng["event"] != "not_opened" || eng["campaign_id"] != "cmp_1" {
			t.Errorf("engagement = %v, want {event:not_opened, campaign_id:cmp_1}", filter["engagement"])
		}
		if filter["status"] != "members_only" {
			t.Errorf("status = %v, want members_only", filter["status"])
		}
		w.Write([]byte(`{"object":"segment","id":"seg_2","audience_id":"aud_1","name":"Re-engage","filter":{"status":"members_only","engagement":{"event":"not_opened","campaign_id":"cmp_1"}},"created_at":null,"updated_at":null}`))
	})

	seg, err := client.Segments.Create(&CreateSegmentRequest{
		Domain: "yourdomain.com",
		Name:   "Re-engage",
		Filter: &SegmentFilterInput{
			Status:     "members_only",
			Engagement: Set(SegmentEngagement{Event: "not_opened", CampaignId: "cmp_1"}),
		},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if seg.Filter.Engagement == nil || seg.Filter.Engagement.CampaignId != "cmp_1" {
		t.Errorf("engagement not round-tripped: %+v", seg.Filter)
	}
}

func TestSegmentsListDomainQuery(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/segments" {
			t.Errorf("path = %s", r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("domain") != "yourdomain.com" {
			t.Errorf("domain = %q, want yourdomain.com", q.Get("domain"))
		}
		if q.Get("limit") != "10" {
			t.Errorf("limit = %q, want 10", q.Get("limit"))
		}
		w.Write([]byte(`{"object":"list","has_more":false,"data":[{"object":"segment","id":"seg_general","audience_id":"aud_1","name":"General","filter":{"status":"all","email_contains":null,"property_filters":[]},"created_at":"2026-07-06T00:00:00Z","updated_at":"2026-07-06T00:00:00Z"}]}`))
	})

	list, err := client.Segments.List(&ListSegmentsRequest{Domain: "yourdomain.com", Limit: 10})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list.Data) != 1 || list.Data[0].Name != "General" {
		t.Errorf("unexpected list: %+v", list)
	}
}

func TestSegmentsContactsPreview(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/segments/seg_1/contacts" {
			t.Errorf("%s %s, want GET /segments/seg_1/contacts", r.Method, r.URL.Path)
		}
		w.Write([]byte(`{"object":"list","has_more":false,"data":[]}`))
	})

	list, err := client.Segments.Contacts("seg_1", nil)
	if err != nil {
		t.Fatalf("Contacts: %v", err)
	}
	if list.Object != "list" || len(list.Data) != 0 {
		t.Errorf("unexpected list: %+v", list)
	}
}

// Segment create/patch and the segment response are different shapes: the
// request side is three-state (absent / value / null-clears), the response
// side always carries status plus a property_filters array. 3.0.0 split them
// into SegmentFilterInput and SegmentFilter so the clears are expressible.
func TestSegmentsUpdateClearsEngagementAndPropertyFilters(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/segments/seg_1" {
			t.Errorf("%s %s, want PATCH /segments/seg_1", r.Method, r.URL.Path)
		}
		filter, ok := decodeBody(t, r)["filter"].(map[string]any)
		if !ok {
			t.Fatalf("filter missing from body")
		}
		engagement, present := filter["engagement"]
		if !present || engagement != nil {
			t.Errorf("engagement = %v (present=%v), want null", engagement, present)
		}
		propertyFilters, present := filter["property_filters"]
		if !present {
			t.Fatalf("property_filters missing from body")
		}
		if list, ok := propertyFilters.([]any); !ok || len(list) != 0 {
			t.Errorf("property_filters = %v, want []", propertyFilters)
		}
		w.Write([]byte(`{"object":"segment","id":"seg_1","audience_id":"aud_1","name":"VIP","filter":{"status":"all","email_contains":null,"property_filters":[],"engagement":null},"created_at":null,"updated_at":null}`))
	})

	_, err := client.Segments.Update("seg_1", &UpdateSegmentRequest{
		Filter: &SegmentFilterInput{
			Engagement:      Clear[SegmentEngagement](),
			PropertyFilters: &[]PropertyFilter{},
		},
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
}

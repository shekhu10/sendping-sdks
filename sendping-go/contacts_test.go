package sendping

import (
	"net/http"
	"testing"
)

func TestContactsCreateFlatDomainFirst(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/contacts" {
			t.Errorf("%s %s, want POST /contacts", r.Method, r.URL.Path)
		}
		assertAuth(t, r)
		body := decodeBody(t, r)
		if body["domain"] != "yourdomain.com" {
			t.Errorf("domain = %v, want yourdomain.com", body["domain"])
		}
		if body["email"] != "user@example.com" {
			t.Errorf("email = %v", body["email"])
		}
		if body["first_name"] != "Ada" {
			t.Errorf("first_name = %v", body["first_name"])
		}
		w.Write([]byte(`{"object":"contact","id":"con_1"}`))
	})

	ref, err := client.Contacts.Create(&CreateContactRequest{
		Domain:    "yourdomain.com",
		Email:     "user@example.com",
		FirstName: "Ada",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if ref.Object != "contact" || ref.Id != "con_1" {
		t.Errorf("unexpected ref: %+v", ref)
	}
}

func TestContactsCreateNestedAudienceStripsDomain(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/audiences/aud_1/contacts" {
			t.Errorf("path = %s, want /audiences/aud_1/contacts", r.URL.Path)
		}
		body := decodeBody(t, r)
		if _, present := body["domain"]; present {
			t.Error("domain must not be sent on the nested audience route")
		}
		w.Write([]byte(`{"object":"contact","id":"con_2"}`))
	})

	_, err := client.Contacts.Create(&CreateContactRequest{
		AudienceId: "aud_1",
		Domain:     "yourdomain.com", // must be stripped
		Email:      "user@example.com",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
}

func TestContactsListFlatRequiresDomainQuery(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/contacts" {
			t.Errorf("path = %s", r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("domain") != "yourdomain.com" {
			t.Errorf("domain query = %q", q.Get("domain"))
		}
		if q.Get("limit") != "50" || q.Get("segment_id") != "seg_1" {
			t.Errorf("query = %v", q)
		}
		w.Write([]byte(`{"object":"list","has_more":false,"data":[{"object":"contact","id":"con_1","email":"user@example.com","unsubscribed":false,"created_at":"2026-07-06T00:00:00Z"}]}`))
	})

	list, err := client.Contacts.List(&ListContactsRequest{
		Domain:    "yourdomain.com",
		Limit:     50,
		SegmentId: "seg_1",
	})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list.Data) != 1 || list.Data[0].Email != "user@example.com" {
		t.Errorf("unexpected list: %+v", list)
	}
}

func TestContactsGetByEmailWithDomain(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		// PathEscape leaves '@' intact (a valid path-segment character).
		if r.URL.Path != "/contacts/user@example.com" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if r.URL.Query().Get("domain") != "yourdomain.com" {
			t.Errorf("domain query = %q", r.URL.Query().Get("domain"))
		}
		w.Write([]byte(`{"object":"contact","id":"con_1","email":"user@example.com","unsubscribed":false,"created_at":"2026-07-06T00:00:00Z"}`))
	})

	got, err := client.Contacts.Get(&GetContactRequest{Id: "user@example.com", Domain: "yourdomain.com"})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Id != "con_1" {
		t.Errorf("Id = %q", got.Id)
	}
}

func TestContactsUpdateTriState(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/contacts/con_1" {
			t.Errorf("%s %s, want PATCH /contacts/con_1", r.Method, r.URL.Path)
		}
		body := decodeBody(t, r)
		if body["unsubscribed"] != true {
			t.Errorf("unsubscribed = %v, want true", body["unsubscribed"])
		}
		if _, present := body["first_name"]; present {
			t.Error("unset first_name must be omitted")
		}
		w.Write([]byte(`{"object":"contact","id":"con_1"}`))
	})

	_, err := client.Contacts.Update(&UpdateContactRequest{
		Id:           "con_1",
		Unsubscribed: Bool(true),
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
}

func TestContactsBatchOnConflict(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/audiences/aud_1/contacts/batch" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if r.URL.Query().Get("on_conflict") != "skip" {
			t.Errorf("on_conflict = %q", r.URL.Query().Get("on_conflict"))
		}
		body := decodeBody(t, r)
		contacts, ok := body["contacts"].([]any)
		if !ok || len(contacts) != 2 {
			t.Errorf("contacts = %v", body["contacts"])
		}
		w.Write([]byte(`{"object":"list","imported":1,"updated":0,"skipped":1,"total":2}`))
	})

	res, err := client.Contacts.Batch(&BatchContactsRequest{
		AudienceId: "aud_1",
		OnConflict: "skip",
		Contacts: []ContactInput{
			{Email: "a@example.com"},
			{Email: "b@example.com"},
		},
	})
	if err != nil {
		t.Fatalf("Batch: %v", err)
	}
	if res.Imported != 1 || res.Skipped != 1 || res.Total != 2 {
		t.Errorf("unexpected import result: %+v", res)
	}
}

// The delete route returns the contact id as `id` — not `contact`.
func TestContactsRemoveDecodesId(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/contacts/con_1" {
			t.Errorf("%s %s, want DELETE /contacts/con_1", r.Method, r.URL.Path)
		}
		w.Write([]byte(`{"object":"contact","id":"con_1","deleted":true}`))
	})

	res, err := client.Contacts.Remove(&RemoveContactRequest{Id: "con_1"})
	if err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if res.Id != "con_1" || !res.Deleted || res.Object != "contact" {
		t.Errorf("unexpected response: %+v", res)
	}
}

func TestContactsImportSegmentAndStorageKey(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/audiences/aud_1/contacts/import" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("segment_id"); got != "seg_1" {
			t.Errorf("segment_id = %q, want seg_1", got)
		}
		body := decodeBody(t, r)
		if body["storage_key"] != "uploads/abc.csv" {
			t.Errorf("storage_key = %v", body["storage_key"])
		}
		if _, present := body["csv"]; present {
			t.Error("csv must not be sent alongside storage_key")
		}
		w.Write([]byte(`{"object":"contact_import","imported":3,"updated":1,"skipped":0,"total":4,"invalid_rows":0,"limit_skipped":2,"ignored_columns":["notes"],"segment_added":4}`))
	})

	res, err := client.Contacts.Import(&ImportContactsRequest{
		AudienceId: "aud_1",
		StorageKey: "uploads/abc.csv",
		SegmentId:  "seg_1",
	})
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if res.LimitSkipped != 2 || res.SegmentAdded != 4 || len(res.IgnoredColumns) != 1 {
		t.Errorf("CSV-import fields not decoded: %+v", res)
	}
}

func TestContactsSegmentMembership(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/contacts/con_1/segments/seg_1" {
			t.Errorf("%s %s, want POST /contacts/con_1/segments/seg_1", r.Method, r.URL.Path)
		}
		w.Write([]byte(`{"id":"seg_1"}`))
	})

	res, err := client.Contacts.AddToSegment("con_1", "seg_1")
	if err != nil {
		t.Fatalf("AddToSegment: %v", err)
	}
	if res.Id != "seg_1" {
		t.Errorf("Id = %q, want seg_1", res.Id)
	}
}

func TestContactsListSegmentsReturnsReducedRows(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/contacts/con_1/segments" {
			t.Errorf("%s %s, want GET /contacts/con_1/segments", r.Method, r.URL.Path)
		}
		if got := r.URL.Query().Get("limit"); got != "5" {
			t.Errorf("limit = %q, want 5 — pagination params must reach the route", got)
		}
		// The route sends ONLY id/name/created_at — no object, audience_id,
		// filter or updated_at.
		w.Write([]byte(`{"object":"list","has_more":false,"data":[{"id":"seg_1","name":"General","created_at":"2026-08-08T10:00:00.000Z"}]}`))
	})

	list, err := client.Contacts.ListSegments("con_1", &ListParams{Limit: 5})
	if err != nil {
		t.Fatalf("ListSegments: %v", err)
	}
	// Compile-time guard: widening this back to the full Segment (which would
	// promise an audience_id/filter/updated_at the route never sends) breaks
	// the build here rather than silently handing callers empty strings.
	var _ *ListResponse[ContactSegmentRef] = list

	if len(list.Data) != 1 {
		t.Fatalf("data = %+v, want one row", list.Data)
	}
	row := list.Data[0]
	if row.Id != "seg_1" || row.Name != "General" || row.CreatedAt == "" {
		t.Errorf("reduced row not decoded: %+v", row)
	}
}

// GetTopics is paginated exactly like its siblings (ListSegments,
// Segments.Contacts, Receiving.ListAttachments): nil params returns one page
// capped at 1,000 rows with HasMore reporting the truncation, and supplying
// ListParams restores 1-100 paging. Before 3.0.0 the method took no params at
// all, so limit/after/before were unreachable from Go.
func TestContactsGetTopicsPagination(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/contacts/con_1/topics" {
			t.Errorf("%s %s, want GET /contacts/con_1/topics", r.Method, r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("limit") != "2" {
			t.Errorf("limit = %q, want 2", q.Get("limit"))
		}
		if q.Get("after") != "top_9" {
			t.Errorf("after = %q, want top_9", q.Get("after"))
		}
		w.Write([]byte(`{"object":"list","has_more":true,"data":[{"id":"top_1","name":"Product","description":"","subscription":"opt_in"}]}`))
	})

	topics, err := client.Contacts.GetTopics("con_1", &ListParams{Limit: 2, After: "top_9"})
	if err != nil {
		t.Fatalf("GetTopics: %v", err)
	}
	if !topics.HasMore || len(topics.Data) != 1 || topics.Data[0].Id != "top_1" {
		t.Errorf("unexpected topics: %+v", topics)
	}
}

func TestContactsGetTopicsNilParamsSendsNoQuery(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" {
			t.Errorf("query = %q, want empty", r.URL.RawQuery)
		}
		w.Write([]byte(`{"object":"list","has_more":false,"data":[]}`))
	})

	if _, err := client.Contacts.GetTopics("con_1", nil); err != nil {
		t.Fatalf("GetTopics: %v", err)
	}
}

func TestContactsBatchInDomain(t *testing.T) {
	// The domain-first bulk door: POST /contacts/batch with the domain in the
	// BODY, exactly as CreateContact does on the flat route.
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/contacts/batch" {
			t.Errorf("path = %s, want /contacts/batch", r.URL.Path)
		}
		if r.URL.Query().Get("on_conflict") != "skip" {
			t.Errorf("on_conflict = %q", r.URL.Query().Get("on_conflict"))
		}
		body := decodeBody(t, r)
		if body["domain"] != "x.com" {
			t.Errorf("domain = %v, want x.com", body["domain"])
		}
		if body["contacts"] == nil {
			t.Error("contacts missing from the body")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"contact_import","imported":1,"updated":0,"skipped":0,"total":1}`))
	})
	res, err := client.Contacts.Batch(&BatchContactsRequest{
		Domain:     "x.com",
		Contacts:   []ContactInput{{Email: "a@b.com"}},
		OnConflict: "skip",
	})
	if err != nil {
		t.Fatalf("Batch: %v", err)
	}
	if res.Imported != 1 {
		t.Errorf("Imported = %d, want 1", res.Imported)
	}
}

func TestContactsBatchAudienceSendsNoDomain(t *testing.T) {
	// Setting AudienceId must keep the nested path AND omit the domain, which
	// the nested route does not accept.
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/audiences/aud_1/contacts/batch" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if _, ok := decodeBody(t, r)["domain"]; ok {
			t.Error("the nested route must not receive a domain")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"contact_import","imported":1,"updated":0,"skipped":0,"total":1}`))
	})
	if _, err := client.Contacts.Batch(&BatchContactsRequest{
		AudienceId: "aud_1",
		Domain:     "ignored.com",
		Contacts:   []ContactInput{{Email: "a@b.com"}},
	}); err != nil {
		t.Fatalf("Batch: %v", err)
	}
}

package sendping

import (
	"net/http"
	"testing"
)

func TestTemplatesListReturnsReducedRows(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/templates" {
			t.Errorf("%s %s, want GET /templates", r.Method, r.URL.Path)
		}
		if got := r.URL.Query().Get("limit"); got != "5" {
			t.Errorf("limit = %q, want 5 — pagination params must reach the route", got)
		}
		// The list serializer sends ONLY these keys — no object, from, reply_to,
		// text, current_version_id or variables.
		w.Write([]byte(`{"object":"list","has_more":false,"data":[{"id":"tpl_1","name":"Welcome",` +
			`"subject":"Hi","html":"<p>Hi</p>","status":"published",` +
			`"published_at":"2026-08-08T10:00:00.000Z","created_at":"2026-08-01T10:00:00.000Z",` +
			`"updated_at":"2026-08-08T10:00:00.000Z","alias":"welcome",` +
			`"has_unpublished_versions":false}]}`))
	})

	list, err := client.Templates.List(&ListParams{Limit: 5})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	// Compile-time guard: widening this back to the full Template would promise
	// a from/reply_to/text/variables the route never sends, and would hand
	// callers empty strings and nil slices rather than an error.
	var _ *ListResponse[TemplateListItem] = list

	if len(list.Data) != 1 {
		t.Fatalf("data = %+v, want one row", list.Data)
	}
	row := list.Data[0]
	if row.Id != "tpl_1" || row.Name != "Welcome" || row.Subject != "Hi" || row.Html == "" {
		t.Errorf("reduced row not decoded: %+v", row)
	}
	if row.Status != "published" || row.Alias != "welcome" || row.PublishedAt == "" || row.UpdatedAt == "" {
		t.Errorf("reduced row not decoded: %+v", row)
	}
}

func TestTemplatesUpdateClearsFieldsWithExplicitNull(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(t, r)
		for _, key := range []string{"alias", "subject", "from", "reply_to", "html", "text"} {
			value, present := body[key]
			if !present || value != nil {
				t.Errorf("%s = %v (present=%v), want null", key, value, present)
			}
		}
		if body["name"] != "Receipt" {
			t.Errorf("name = %v, want Receipt", body["name"])
		}
		w.Write([]byte(`{"id":"tpl_1"}`))
	})

	_, err := client.Templates.Update("tpl_1", &UpdateTemplateRequest{
		Name:    "Receipt",
		Alias:   Clear[string](),
		Subject: Clear[string](),
		From:    Clear[string](),
		ReplyTo: Clear[[]string](),
		Html:    Clear[string](),
		Text:    Clear[string](),
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
}

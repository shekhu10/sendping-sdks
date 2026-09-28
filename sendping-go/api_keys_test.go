package sendping

import (
	"net/http"
	"reflect"
	"testing"
)

func TestApiKeysListPagination(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api-keys" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("limit"); got != "5" {
			t.Errorf("limit = %q, want 5", got)
		}
		w.Write([]byte(`{"object":"list","has_more":true,"data":[{"id":"42","name":"CI","token":"mb_ab12","permission":"full_access","domain_id":null,"domain_ids":null,"created_at":"2026-08-08T00:00:00Z","last_used_at":null}]}`))
	})

	list, err := client.ApiKeys.List(&ListParams{Limit: 5})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if !list.HasMore || list.Data[0].Id != "42" || list.Data[0].Token != "mb_ab12" {
		t.Errorf("unexpected list: %+v", list)
	}
}

// Passing nil sends no pagination params at all, which is what makes this
// endpoint return every key.
func TestApiKeysListNilParamsSendsNoQuery(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" {
			t.Errorf("query = %q, want empty", r.URL.RawQuery)
		}
		w.Write([]byte(`{"object":"list","has_more":false,"data":[]}`))
	})

	if _, err := client.ApiKeys.List(nil); err != nil {
		t.Fatalf("List: %v", err)
	}
}

// Key lifecycle is dashboard-only, so ApiKeysService offers reads and nothing
// else. Writing client.ApiKeys.Create(...) would not compile, which is the
// real guarantee; this reflection check is here so the surface cannot grow a
// write method back by accident.
func TestApiKeysServiceIsReadOnly(t *testing.T) {
	want := map[string]bool{"List": true, "ListWithContext": true}

	typ := reflect.TypeOf(&ApiKeysService{})
	for i := 0; i < typ.NumMethod(); i++ {
		name := typ.Method(i).Name
		if !want[name] {
			t.Errorf("ApiKeysService exposes %q; key create/update/revoke are dashboard-only", name)
		}
		delete(want, name)
	}
	for name := range want {
		t.Errorf("ApiKeysService is missing %q", name)
	}
}

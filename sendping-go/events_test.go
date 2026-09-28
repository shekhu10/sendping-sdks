package sendping

import (
	"net/http"
	"testing"
)

func TestEventsSendDomainRequired(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/events/send" {
			t.Errorf("%s %s, want POST /events/send", r.Method, r.URL.Path)
		}
		assertAuth(t, r)
		body := decodeBody(t, r)
		if body["domain"] != "yourdomain.com" {
			t.Errorf("domain = %v, want yourdomain.com", body["domain"])
		}
		if body["event"] != "signup.completed" {
			t.Errorf("event = %v", body["event"])
		}
		w.Write([]byte(`{"object":"event","id":"evt_1","event":"signup.completed","contact_id":"con_1","enrolled":2}`))
	})

	res, err := client.Events.Send(&SendEventRequest{
		Event:  "signup.completed",
		Domain: "yourdomain.com",
		Email:  "user@example.com",
		Data:   map[string]any{"plan": "pro"},
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.Enrolled != 2 || res.ContactId != "con_1" {
		t.Errorf("unexpected response: %+v", res)
	}
}

// Only the schema is mutable — the name is immutable, so the payload must
// carry `schema` and nothing else.
func TestEventsUpdateSchemaOnly(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/events/evt_1" {
			t.Errorf("%s %s, want PATCH /events/evt_1", r.Method, r.URL.Path)
		}
		body := decodeBody(t, r)
		if _, present := body["name"]; present {
			t.Error("name must never be sent — the API rejects a name change with a 422")
		}
		schema, ok := body["schema"].(map[string]any)
		if !ok || schema["seats"] != "number" {
			t.Errorf("schema = %v", body["schema"])
		}
		w.Write([]byte(`{"object":"event","id":"evt_1","name":"signup.completed","schema":{"plan":"string","seats":"number"},"created_at":"2026-08-08T00:00:00Z","updated_at":"2026-08-08T00:00:00Z"}`))
	})

	def, err := client.Events.Update("evt_1", &UpdateEventRequest{
		Schema: map[string]string{"plan": "string", "seats": "number"},
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if def.Schema["seats"] != "number" {
		t.Errorf("schema not decoded: %+v", def.Schema)
	}
}

// A nil Schema map sends `"schema": null`, which clears the schema.
func TestEventsUpdateClearsSchema(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(t, r)
		val, present := body["schema"]
		if !present || val != nil {
			t.Errorf("schema = %v (present=%v), want an explicit null", val, present)
		}
		w.Write([]byte(`{"object":"event","id":"evt_1","name":"signup.completed","schema":null,"created_at":null,"updated_at":null}`))
	})

	if _, err := client.Events.Update("evt_1", &UpdateEventRequest{}); err != nil {
		t.Fatalf("Update: %v", err)
	}
}

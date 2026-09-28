package sendping

import (
	"net/http"
	"testing"
)

func TestAutomationsCreateScheduleTrigger(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/automations" {
			t.Errorf("%s %s, want POST /automations", r.Method, r.URL.Path)
		}
		assertAuth(t, r)
		body := decodeBody(t, r)
		if body["trigger"] != ScheduleTrigger {
			t.Errorf("trigger = %v, want %s", body["trigger"], ScheduleTrigger)
		}
		cfg, ok := body["trigger_config"].(map[string]any)
		if !ok || cfg["timezone"] != "America/New_York" {
			t.Errorf("trigger_config = %v", body["trigger_config"])
		}
		w.Write([]byte(`{"object":"automation","id":"aut_1","audience_id":"aud_1","name":"Blast","trigger":"sendping:schedule","trigger_key":"trigger","domain":"yourdomain.com","status":"disabled","trigger_config":{"at":"2026-09-01T13:00:00.000Z","timezone":"America/New_York"},"steps":[{"key":"trigger","type":"trigger","config":{"event_name":"sendping:schedule"}}],"connections":[],"created_at":null,"updated_at":null}`))
	})

	aut, err := client.Automations.Create(&CreateAutomationRequest{
		Name:          "Blast",
		Domain:        "yourdomain.com",
		Trigger:       ScheduleTrigger,
		TriggerConfig: &AutomationTriggerConfig{At: "2026-09-01T13:00:00Z", Timezone: "America/New_York"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if aut.TriggerConfig == nil || aut.TriggerConfig.Timezone != "America/New_York" {
		t.Errorf("trigger_config not decoded: %+v", aut.TriggerConfig)
	}
	if aut.TriggerKey != "trigger" {
		t.Errorf("trigger_key = %q, want trigger", aut.TriggerKey)
	}
}

// PATCH /automations/:id/steps/:stepId re-validates the body exactly like an
// add, so `type` is REQUIRED — a config-only patch is a 422 validation_error,
// not a "leave the type alone". `key` is deliberately absent from the payload:
// the endpoint ignores it (a step's graph key is fixed at creation so the
// connections referencing it keep working).
func TestAutomationsUpdateStep(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/automations/aut_1/steps/stp_1" {
			t.Errorf("%s %s, want PATCH /automations/aut_1/steps/stp_1", r.Method, r.URL.Path)
		}
		body := decodeBody(t, r)
		if body["type"] != "delay" {
			t.Errorf("type = %#v, want delay (the API requires it on a step patch)", body["type"])
		}
		cfg, ok := body["config"].(map[string]any)
		if !ok || cfg["duration"] != "2 days" {
			t.Errorf("config = %v", body["config"])
		}
		if _, present := body["key"]; present {
			t.Error("key must not be sent: the step-patch endpoint ignores it")
		}
		w.Write([]byte(`{"id":"stp_1","key":"wait_2d","type":"delay","position":1,"config":{"duration":"2 days"}}`))
	})

	step, err := client.Automations.UpdateStep("aut_1", "stp_1", &UpdateAutomationStepRequest{
		Type:   "delay",
		Config: map[string]any{"duration": "2 days"},
	})
	if err != nil {
		t.Fatalf("UpdateStep: %v", err)
	}
	if step.Key != "wait_2d" || step.Position != 1 {
		t.Errorf("unexpected step: %+v", step)
	}
}

func TestAutomationsRunsStatusFilter(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/automations/aut_1/runs" {
			t.Errorf("path = %s", r.URL.Path)
		}
		// The API takes a comma-separated status list.
		if got := r.URL.Query().Get("status"); got != "running,failed" {
			t.Errorf("status = %q, want running,failed", got)
		}
		if got := r.URL.Query().Get("limit"); got != "50" {
			t.Errorf("limit = %q, want 50", got)
		}
		w.Write([]byte(`{"object":"list","has_more":false,"data":[{"object":"automation_run","id":"run_1","contact_id":"con_1","contact_email":"a@b.com","status":"failed","started_at":null,"completed_at":null,"created_at":null}]}`))
	})

	list, err := client.Automations.RunsFiltered("aut_1", &ListAutomationRunsRequest{
		Limit:  50,
		Status: []string{"running", "failed"},
	})
	if err != nil {
		t.Fatalf("RunsFiltered: %v", err)
	}
	if list.Data[0].Status != "failed" {
		t.Errorf("unexpected run: %+v", list.Data[0])
	}
}

func TestAutomationsCreateWithAi(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/automations/aut_1/ai" {
			t.Errorf("%s %s, want POST /automations/aut_1/ai", r.Method, r.URL.Path)
		}
		body := decodeBody(t, r)
		if body["prompt"] != "Wait a day, then send onboarding." {
			t.Errorf("prompt = %v", body["prompt"])
		}
		if _, present := body["attach"]; present {
			t.Error("attach must be omitted in workflow mode")
		}
		w.Write([]byte(`{"object":"automation","id":"aut_1","audience_id":"aud_1","name":"Welcome","trigger":"contact.created","domain":"yourdomain.com","status":"disabled","steps":[],"connections":[],"ai":{"added_steps":2,"mode":"workflow"},"created_at":null,"updated_at":null}`))
	})

	aut, err := client.Automations.CreateWithAi("aut_1", &AutomationAiRequest{
		Prompt: "Wait a day, then send onboarding.",
	})
	if err != nil {
		t.Fatalf("CreateWithAi: %v", err)
	}
	if aut.Ai == nil || aut.Ai.AddedSteps != 2 || aut.Ai.Mode != "workflow" {
		t.Errorf("ai result not decoded: %+v", aut.Ai)
	}
}

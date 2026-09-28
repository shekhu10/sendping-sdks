package sendping

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// AutomationStep is one step of an automation's graph.
type AutomationStep struct {
	// Id is absent on the synthesized trigger step.
	Id       string         `json:"id,omitempty"`
	Key      string         `json:"key"`
	Type     string         `json:"type"`
	Position int            `json:"position,omitempty"`
	Config   map[string]any `json:"config"`
}

// AutomationConnection is a typed edge between two step keys.
type AutomationConnection struct {
	From string `json:"from"`
	To   string `json:"to"`
	Type string `json:"type"`
}

// Automation is a multi-step workflow triggered by an event.
type Automation struct {
	Object     string `json:"object"`
	Id         string `json:"id"`
	AudienceId string `json:"audience_id"`
	Name       string `json:"name"`
	Trigger    string `json:"trigger"`
	// Domain is the sending domain this automation belongs to. Only
	// Events.Send calls with the same Domain trigger it.
	Domain string `json:"domain"`
	// Status is "enabled" | "disabled".
	Status string `json:"status"`
	// TriggerConfig is set only for the "sendping:schedule" trigger.
	TriggerConfig *AutomationTriggerConfig `json:"trigger_config,omitempty"`
	// TriggerKey names the synthetic trigger step in Connections; defaults to
	// "trigger".
	TriggerKey string `json:"trigger_key,omitempty"`
	// Steps is omitted entirely on list responses. Its first element is always
	// the synthetic trigger step (Type "trigger", no Id, no Position).
	Steps       []AutomationStep       `json:"steps,omitempty"`
	Connections []AutomationConnection `json:"connections,omitempty"`
	// Enrollments holds enrollment counts — included only on retrieve.
	Enrollments *AutomationEnrollments `json:"enrollments,omitempty"`
	// Ai summarizes what Automations.CreateWithAi added; set only on that call.
	Ai        *AutomationAiResult `json:"ai,omitempty"`
	CreatedAt string              `json:"created_at"`
	UpdatedAt string              `json:"updated_at"`
}

// AutomationEnrollments are the counts on GET /automations/:id.
type AutomationEnrollments struct {
	Active    int `json:"active"`
	Completed int `json:"completed"`
}

// AutomationStepInput is an inline step accepted on automation create.
type AutomationStepInput struct {
	// Key optionally names the step for connections.
	Key    string         `json:"key,omitempty"`
	Type   string         `json:"type"`
	Config map[string]any `json:"config,omitempty"`
}

// AutomationConnectionInput is a typed edge accepted on create/update.
type AutomationConnectionInput struct {
	From string `json:"from"`
	To   string `json:"to"`
	Type string `json:"type,omitempty"`
}

// AutomationTriggerConfig is the config for the "sendping:schedule"
// trigger: the automation fires ONCE at At, enrolling every contact of its
// domain's pool. Required with that trigger; not accepted on any other.
type AutomationTriggerConfig struct {
	// At is the ISO 8601 instant the automation fires (future, at most 366
	// days ahead).
	At string `json:"at"`
	// Timezone is the IANA timezone the schedule was picked in (e.g.
	// "America/New_York").
	Timezone string `json:"timezone"`
}

// CreateAutomationRequest is the payload for POST /automations. Domain is
// REQUIRED (domain-first): only Events.Send calls with the same Domain
// trigger the automation.
type CreateAutomationRequest struct {
	Name string `json:"name"`
	// Domain is REQUIRED — the sending domain this automation belongs to
	// (e.g. "yourdomain.com" — one of your domains).
	Domain string `json:"domain"`
	// Trigger is the event that starts a run: "contact.created", the built-in
	// scheduled trigger "sendping:schedule" (requires TriggerConfig), an
	// engagement event ("email.opened", "email.clicked", "email.replied",
	// "email.bounced", "email.delivered"), or any custom event name you send
	// via Events.Send. Usually supplied as a Steps[0] trigger step instead.
	Trigger string `json:"trigger,omitempty"`
	// TriggerKey names the trigger in Connections; defaults to "trigger".
	TriggerKey string `json:"trigger_key,omitempty"`
	// TriggerConfig is the schedule for the "sendping:schedule" trigger
	// ({at, timezone}). Required with that trigger; not accepted on any other.
	TriggerConfig *AutomationTriggerConfig `json:"trigger_config,omitempty"`
	// Status is the initial status: "enabled" | "disabled" (default "disabled").
	Status string `json:"status,omitempty"`
	// Steps is an optional inline step graph.
	Steps []AutomationStepInput `json:"steps,omitempty"`
	// Connections are optional typed edges between step keys.
	Connections []AutomationConnectionInput `json:"connections,omitempty"`
}

// UpdateAutomationRequest is the payload for PATCH /automations/:id.
//
// Changing Domain, Trigger, TriggerConfig or Connections requires the
// automation to be disabled first — otherwise the API answers 422.
type UpdateAutomationRequest struct {
	// Name is at most MaxAutomationNameLength characters.
	Name string `json:"name,omitempty"`
	// Status is "enabled" | "disabled".
	Status string `json:"status,omitempty"`
	// Domain re-points the automation at another of your domains (disabled
	// automations only).
	Domain string `json:"domain,omitempty"`
	// Trigger changes the event that starts a run (disabled automations only).
	Trigger string `json:"trigger,omitempty"`
	// TriggerKey renames the trigger node referenced by Connections.
	TriggerKey string `json:"trigger_key,omitempty"`
	// TriggerConfig updates the "sendping:schedule" trigger's schedule
	// ({at, timezone}). Only valid on automations with that trigger.
	TriggerConfig *AutomationTriggerConfig    `json:"trigger_config,omitempty"`
	Connections   []AutomationConnectionInput `json:"connections,omitempty"`
}

// AddAutomationStepRequest appends a step to an automation. The automation
// must be disabled, and Type "trigger" is rejected — the trigger lives on the
// automation, not in its step list.
type AddAutomationStepRequest struct {
	// Type is one of AutomationStepTypes (the documented aliases
	// "send_email" and "wait_for_event" are accepted too).
	Type string `json:"type"`
	// Config may also be spread across the top level of the request body;
	// this field is the explicit form.
	Config map[string]any `json:"config,omitempty"`
	// Key names the step for Connections; defaults to the new step's id.
	Key string `json:"key,omitempty"`
}

// UpdateAutomationStepRequest edits an existing step in place. The automation
// must be disabled.
//
// The step is REPLACED, not patched: the API re-validates the whole body and
// overwrites type + config, so send Type and the complete Config every time.
type UpdateAutomationStepRequest struct {
	// Type is REQUIRED — the API validates the update exactly like an add, so
	// omitting it is a 422 validation_error ("type must be one of: …"), not a
	// "leave the type alone".
	Type string `json:"type"`
	// Config replaces the step's configuration wholesale; anything you leave
	// out is dropped, not preserved.
	Config map[string]any `json:"config,omitempty"`

	// Key is IGNORED by this endpoint: a step's graph key is fixed at creation
	// so the connections referencing it keep working. Set it on
	// AddAutomationStepRequest instead, or recreate the step.
	//
	// Deprecated: the API never reads it — sending one changes nothing.
	Key string `json:"key,omitempty"`
}

// Automation limits and vocabulary enforced by the API.
const (
	// MaxAutomationNameLength caps an automation's name.
	MaxAutomationNameLength = 255
	// MaxAutomationAiPromptLength caps CreateWithAi's prompt.
	MaxAutomationAiPromptLength = 2000
	// ScheduleTrigger is the built-in one-shot schedule trigger. It is the
	// only trigger allowed to use ReservedEventPrefix, and it requires
	// TriggerConfig.
	ScheduleTrigger = "sendping:schedule"
	// DefaultAutomationTrigger is used when no trigger is supplied.
	DefaultAutomationTrigger = "contact.created"
)

// AutomationStepTypes are the internal step types the API accepts. On read,
// "send" and "wait" are reported as "send_email" and "wait_for_event".
var AutomationStepTypes = []string{
	"delay", "send", "wait", "condition", "split",
	"add_to_segment", "contact_update", "contact_delete",
}

// AutomationConnectionTypes are the edge types accepted by
// AutomationConnectionInput.Type ("default" is an alias for "next").
var AutomationConnectionTypes = []string{
	"next", "default", "condition_met", "condition_not_met",
	"event_received", "timeout",
}

// ListAutomationRunsRequest lists an automation's runs with an optional status
// filter.
type ListAutomationRunsRequest struct {
	Limit  int
	After  string
	Before string
	// Status filters to runs in any of these states (e.g. "running",
	// "completed", "failed", "skipped"). Sent as a comma-separated list.
	Status []string
}

// AutomationAiAttach appends AI-generated steps to an existing graph instead
// of building a new one.
type AutomationAiAttach struct {
	// From is the trigger key or an existing step key to attach after.
	From string `json:"from"`
	// Type is one of AutomationConnectionTypes minus "next" (default
	// "default").
	Type string `json:"type,omitempty"`
	// Before, when set, must be an existing step key.
	Before string `json:"before,omitempty"`
}

// AutomationAiRequest drives "Create with AI". Without Attach the automation
// must have zero steps (workflow mode); with it the generated steps are
// appended (append mode).
type AutomationAiRequest struct {
	// Prompt is required, at most MaxAutomationAiPromptLength characters.
	Prompt string `json:"prompt"`
	// TemplateIds and Events give the model context; only the first 10 of
	// each are used.
	TemplateIds []string            `json:"template_ids,omitempty"`
	Events      []string            `json:"events,omitempty"`
	Attach      *AutomationAiAttach `json:"attach,omitempty"`
}

// AutomationAiResult summarizes an AI generation.
type AutomationAiResult struct {
	AddedSteps int `json:"added_steps"`
	// Mode is "workflow" | "append".
	Mode string `json:"mode"`
}

// DeleteAutomationStepResponse is returned by Automations.DeleteStep.
type DeleteAutomationStepResponse struct {
	Id      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

// AutomationRunStep is one executed step of an automation run trace.
type AutomationRunStep struct {
	Key  string `json:"key"`
	Type string `json:"type"`
	// Status is "completed" | "failed" | "skipped".
	Status      string         `json:"status"`
	StartedAt   string         `json:"started_at"`
	CompletedAt string         `json:"completed_at"`
	Output      map[string]any `json:"output"`
	Error       string         `json:"error"`
}

// AutomationRun is one enrollment/run of an automation.
type AutomationRun struct {
	Object    string `json:"object"`
	Id        string `json:"id"`
	ContactId string `json:"contact_id"`
	// ContactEmail is the email of the contact the run is for; empty if that
	// contact was deleted.
	ContactEmail string `json:"contact_email"`
	// Status is "running" | "completed" | "failed" | "cancelled" | "skipped".
	Status      string `json:"status"`
	StartedAt   string `json:"started_at"`
	CompletedAt string `json:"completed_at"`
	CreatedAt   string `json:"created_at"`
	// AutomationId is present on GET /automations/:id/runs/:runId only.
	AutomationId string              `json:"automation_id,omitempty"`
	Steps        []AutomationRunStep `json:"steps,omitempty"`
	Error        string              `json:"error,omitempty"`
}

// AutomationsService handles the /automations endpoints.
type AutomationsService struct {
	client *Client
}

// Create creates an automation (Domain is required). POST /automations
func (s *AutomationsService) Create(params *CreateAutomationRequest) (*Automation, error) {
	return s.CreateWithContext(context.Background(), params)
}

// CreateWithContext creates an automation. POST /automations
func (s *AutomationsService) CreateWithContext(ctx context.Context, params *CreateAutomationRequest) (*Automation, error) {
	return request[Automation](ctx, s.client, http.MethodPost, "/automations", params, nil)
}

// Get retrieves an automation. GET /automations/:id
func (s *AutomationsService) Get(id string) (*Automation, error) {
	return s.GetWithContext(context.Background(), id)
}

// GetWithContext retrieves an automation. GET /automations/:id
func (s *AutomationsService) GetWithContext(ctx context.Context, id string) (*Automation, error) {
	return request[Automation](ctx, s.client, http.MethodGet, "/automations/"+esc(id), nil, nil)
}

// List lists automations. GET /automations
func (s *AutomationsService) List(params *ListParams) (*ListResponse[Automation], error) {
	return s.ListWithContext(context.Background(), params)
}

// ListWithContext lists automations. GET /automations
func (s *AutomationsService) ListWithContext(ctx context.Context, params *ListParams) (*ListResponse[Automation], error) {
	return request[ListResponse[Automation]](ctx, s.client, http.MethodGet, listPath("/automations", params), nil, nil)
}

// Update updates an automation. PATCH /automations/:id
func (s *AutomationsService) Update(id string, params *UpdateAutomationRequest) (*Automation, error) {
	return s.UpdateWithContext(context.Background(), id, params)
}

// UpdateWithContext updates an automation. PATCH /automations/:id
func (s *AutomationsService) UpdateWithContext(ctx context.Context, id string, params *UpdateAutomationRequest) (*Automation, error) {
	return request[Automation](ctx, s.client, http.MethodPatch, "/automations/"+esc(id), params, nil)
}

// AddStep appends a step to an automation; returns the created step.
// POST /automations/:id/steps
func (s *AutomationsService) AddStep(id string, params *AddAutomationStepRequest) (*AutomationStep, error) {
	return s.AddStepWithContext(context.Background(), id, params)
}

// AddStepWithContext appends a step to an automation.
func (s *AutomationsService) AddStepWithContext(ctx context.Context, id string, params *AddAutomationStepRequest) (*AutomationStep, error) {
	return request[AutomationStep](ctx, s.client, http.MethodPost, "/automations/"+esc(id)+"/steps", params, nil)
}

// UpdateStep replaces an existing step's type and config; returns the updated
// step. Type is required and Config is a wholesale replacement — the endpoint
// re-validates the body like an add rather than patching field by field.
// PATCH /automations/:id/steps/:stepId
func (s *AutomationsService) UpdateStep(id, stepId string, params *UpdateAutomationStepRequest) (*AutomationStep, error) {
	return s.UpdateStepWithContext(context.Background(), id, stepId, params)
}

// UpdateStepWithContext edits an existing step.
// PATCH /automations/:id/steps/:stepId
func (s *AutomationsService) UpdateStepWithContext(ctx context.Context, id, stepId string, params *UpdateAutomationStepRequest) (*AutomationStep, error) {
	return request[AutomationStep](ctx, s.client, http.MethodPatch, "/automations/"+esc(id)+"/steps/"+esc(stepId), params, nil)
}

// DeleteStep deletes a step from an automation.
// DELETE /automations/:id/steps/:stepId
func (s *AutomationsService) DeleteStep(id, stepId string) (*DeleteAutomationStepResponse, error) {
	return s.DeleteStepWithContext(context.Background(), id, stepId)
}

// DeleteStepWithContext deletes a step from an automation.
func (s *AutomationsService) DeleteStepWithContext(ctx context.Context, id, stepId string) (*DeleteAutomationStepResponse, error) {
	return request[DeleteAutomationStepResponse](ctx, s.client, http.MethodDelete, "/automations/"+esc(id)+"/steps/"+esc(stepId), nil, nil)
}

// Runs lists an automation's runs. GET /automations/:id/runs
func (s *AutomationsService) Runs(id string, params *ListParams) (*ListResponse[AutomationRun], error) {
	return s.RunsWithContext(context.Background(), id, params)
}

// RunsWithContext lists an automation's runs. GET /automations/:id/runs
func (s *AutomationsService) RunsWithContext(ctx context.Context, id string, params *ListParams) (*ListResponse[AutomationRun], error) {
	return request[ListResponse[AutomationRun]](ctx, s.client, http.MethodGet, listPath("/automations/"+esc(id)+"/runs", params), nil, nil)
}

// RunsFiltered lists an automation's runs with an optional status filter.
// GET /automations/:id/runs
func (s *AutomationsService) RunsFiltered(id string, params *ListAutomationRunsRequest) (*ListResponse[AutomationRun], error) {
	return s.RunsFilteredWithContext(context.Background(), id, params)
}

// RunsFilteredWithContext lists an automation's runs with a status filter.
// GET /automations/:id/runs
func (s *AutomationsService) RunsFilteredWithContext(ctx context.Context, id string, params *ListAutomationRunsRequest) (*ListResponse[AutomationRun], error) {
	q := url.Values{}
	if params != nil {
		if params.Limit > 0 {
			q.Set("limit", strconv.Itoa(params.Limit))
		}
		if params.After != "" {
			q.Set("after", params.After)
		}
		if params.Before != "" {
			q.Set("before", params.Before)
		}
		if len(params.Status) > 0 {
			q.Set("status", strings.Join(params.Status, ","))
		}
	}
	path := "/automations/" + esc(id) + "/runs"
	if enc := q.Encode(); enc != "" {
		path += "?" + enc
	}
	return request[ListResponse[AutomationRun]](ctx, s.client, http.MethodGet, path, nil, nil)
}

// GetRun retrieves a single automation run. GET /automations/:id/runs/:runId
func (s *AutomationsService) GetRun(id, runId string) (*AutomationRun, error) {
	return s.GetRunWithContext(context.Background(), id, runId)
}

// GetRunWithContext retrieves a single automation run.
func (s *AutomationsService) GetRunWithContext(ctx context.Context, id, runId string) (*AutomationRun, error) {
	return request[AutomationRun](ctx, s.client, http.MethodGet, "/automations/"+esc(id)+"/runs/"+esc(runId), nil, nil)
}

// Stop stops an automation — prevents new runs; in-progress runs finish.
// POST /automations/:id/stop
func (s *AutomationsService) Stop(id string) (*Automation, error) {
	return s.StopWithContext(context.Background(), id)
}

// StopWithContext stops an automation. POST /automations/:id/stop
func (s *AutomationsService) StopWithContext(ctx context.Context, id string) (*Automation, error) {
	return request[Automation](ctx, s.client, http.MethodPost, "/automations/"+esc(id)+"/stop", nil, nil)
}

// CreateWithAi generates automation steps from a natural-language prompt and
// merges them into the automation, which must be stopped (disabled). The
// result's Ai field reports how many steps were added.
//
// Rate limited to 20 requests per 60 s per account (rate_limit_exceeded, 429),
// and it spends AI credits (ai_credits_exceeded, 429, when exhausted).
// POST /automations/:id/ai
func (s *AutomationsService) CreateWithAi(id string, params *AutomationAiRequest) (*Automation, error) {
	return s.CreateWithAiWithContext(context.Background(), id, params)
}

// CreateWithAiWithContext generates automation steps from a prompt.
// POST /automations/:id/ai
func (s *AutomationsService) CreateWithAiWithContext(ctx context.Context, id string, params *AutomationAiRequest) (*Automation, error) {
	return request[Automation](ctx, s.client, http.MethodPost, "/automations/"+esc(id)+"/ai", params, nil)
}

// Remove deletes an automation. DELETE /automations/:id
func (s *AutomationsService) Remove(id string) (*RemovedResponse, error) {
	return s.RemoveWithContext(context.Background(), id)
}

// RemoveWithContext deletes an automation. DELETE /automations/:id
func (s *AutomationsService) RemoveWithContext(ctx context.Context, id string) (*RemovedResponse, error) {
	return request[RemovedResponse](ctx, s.client, http.MethodDelete, "/automations/"+esc(id), nil, nil)
}

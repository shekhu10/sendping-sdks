package sendping

import (
	"context"
	"net/http"
)

// TemplateVariable is a variable definition on a saved template.
//
// The registry carries only the declaration: the API sends no per-variable id
// or timestamps, so those are absent from this type rather than declared and
// handed back as empty strings.
type TemplateVariable struct {
	Key string `json:"key"`
	// Type is "string" | "number".
	Type string `json:"type"`
	// FallbackValue is a string, number, or nil.
	FallbackValue any `json:"fallback_value"`
}

// TemplateVariableInput is a variable definition accepted on create/update.
type TemplateVariableInput struct {
	// Key must match ^[A-Za-z_][A-Za-z0-9_.]*$, be unique within the template,
	// and must not be one of ReservedTemplateVariableKeys.
	Key string `json:"key"`
	// Type is "string" (default) | "number".
	Type string `json:"type,omitempty"`
	// FallbackValue must be numeric when Type is "number".
	FallbackValue any `json:"fallback_value,omitempty"`
}

// Template is a saved email template.
type Template struct {
	Object  string `json:"object"`
	Id      string `json:"id"`
	Name    string `json:"name"`
	Subject string `json:"subject"`
	From    string `json:"from,omitempty"`
	ReplyTo string `json:"reply_to,omitempty"`
	Html    string `json:"html"`
	Text    string `json:"text"`
	Status  string `json:"status,omitempty"`
	// Alias is a stable handle usable anywhere an id is accepted.
	Alias string `json:"alias,omitempty"`
	// PublishedAt is when the template was last published (empty while only a
	// draft exists).
	PublishedAt string `json:"published_at,omitempty"`
	// HasUnpublishedVersions is true when the draft has edits not yet
	// published (retrieve only).
	HasUnpublishedVersions bool               `json:"has_unpublished_versions,omitempty"`
	CurrentVersionId       string             `json:"current_version_id,omitempty"`
	Variables              []TemplateVariable `json:"variables,omitempty"`
	CreatedAt              string             `json:"created_at"`
	UpdatedAt              string             `json:"updated_at"`
}

// TemplateListItem is one row of TemplatesService.List (GET /templates).
//
// The list serializer is narrower than the full Template: it sends no Object,
// From, ReplyTo, Text, CurrentVersionId or Variables. Typing the list as
// Template would promise those and hand back empty strings and nil slices, so
// they are absent from the type. Use Templates.Get for the full record.
type TemplateListItem struct {
	Id      string `json:"id"`
	Name    string `json:"name"`
	Subject string `json:"subject"`
	// Html is included so a list view can render a preview without a per-row
	// fetch.
	Html   string `json:"html"`
	Status string `json:"status"`
	// PublishedAt is when the template was last published (empty while only a
	// draft exists).
	PublishedAt string `json:"published_at"`
	// Alias is a stable handle usable anywhere an id is accepted.
	Alias string `json:"alias"`
	// HasUnpublishedVersions is true when the draft has edits not yet published.
	HasUnpublishedVersions bool   `json:"has_unpublished_versions"`
	CreatedAt              string `json:"created_at"`
	UpdatedAt              string `json:"updated_at"`
}

// Template field limits enforced by the API. Exceeding one is a 422
// validation_error.
const (
	MaxTemplateNameLength    = 255
	MaxTemplateAliasLength   = 255
	MaxTemplateSubjectLength = 998
	MaxTemplateFromLength    = 320
	// MaxTemplateReplyToLength applies to ReplyTo after the parts are joined
	// with ", ".
	MaxTemplateReplyToLength = 320
	// MaxTemplateVariables caps the declared variable registry.
	MaxTemplateVariables = 50
)

// ReservedTemplateVariableKeys cannot be declared in Variables — the renderer
// already provides them.
var ReservedTemplateVariableKeys = []string{
	"FIRST_NAME", "LAST_NAME", "EMAIL", "UNSUBSCRIBE_URL", "contact", "this",
	"SENDPING_UNSUBSCRIBE_URL", "SENDPING_PREFERENCES_URL",
}

// CreateTemplateRequest is the payload for POST /templates. Name is required
// (max MaxTemplateNameLength) and so is at least one of Html / Text. Created
// templates always start as a draft — publish before sending.
type CreateTemplateRequest struct {
	Name string `json:"name"`
	// Alias is an optional stable handle for sending by alias; it must be
	// unique across your templates.
	Alias     string                  `json:"alias,omitempty"`
	Subject   string                  `json:"subject,omitempty"`
	From      string                  `json:"from,omitempty"`
	ReplyTo   []string                `json:"reply_to,omitempty"`
	Html      string                  `json:"html,omitempty"`
	Text      string                  `json:"text,omitempty"`
	Variables []TemplateVariableInput `json:"variables,omitempty"`
}

// UpdateTemplateRequest is the payload for PATCH /templates/:id.
type UpdateTemplateRequest struct {
	Name string `json:"name,omitempty"`
	// Every field below is clearable: a field present with null clears it
	// server-side, so use Set(v) to change it and Clear[T]() to remove it.
	// Leave a field nil to keep the stored value.
	Alias     *Null[string]           `json:"alias,omitempty"`
	Subject   *Null[string]           `json:"subject,omitempty"`
	From      *Null[string]           `json:"from,omitempty"`
	ReplyTo   *Null[[]string]         `json:"reply_to,omitempty"`
	Html      *Null[string]           `json:"html,omitempty"`
	Text      *Null[string]           `json:"text,omitempty"`
	Variables []TemplateVariableInput `json:"variables,omitempty"`
}

// DuplicateTemplateRequest is the optional body for Templates.Duplicate.
type DuplicateTemplateRequest struct {
	Name  string `json:"name,omitempty"`
	Alias string `json:"alias,omitempty"`
}

// TemplatesService handles the /templates endpoints.
type TemplatesService struct {
	client *Client
}

// Create creates a template; returns the slim ack { object, id }.
// POST /templates
func (s *TemplatesService) Create(params *CreateTemplateRequest) (*ObjectRef, error) {
	return s.CreateWithContext(context.Background(), params)
}

// CreateWithContext creates a template. POST /templates
func (s *TemplatesService) CreateWithContext(ctx context.Context, params *CreateTemplateRequest) (*ObjectRef, error) {
	return request[ObjectRef](ctx, s.client, http.MethodPost, "/templates", params, nil)
}

// Get retrieves a template. GET /templates/:id
func (s *TemplatesService) Get(id string) (*Template, error) {
	return s.GetWithContext(context.Background(), id)
}

// GetWithContext retrieves a template. GET /templates/:id
func (s *TemplatesService) GetWithContext(ctx context.Context, id string) (*Template, error) {
	return request[Template](ctx, s.client, http.MethodGet, "/templates/"+esc(id), nil, nil)
}

// List lists templates, newest first. Rows are the reduced TemplateListItem
// shape — Object, From, ReplyTo, Text, CurrentVersionId and Variables are not
// sent by this route; use Get for those. This endpoint always pages (20 per
// page by default). GET /templates
func (s *TemplatesService) List(params *ListParams) (*ListResponse[TemplateListItem], error) {
	return s.ListWithContext(context.Background(), params)
}

// ListWithContext lists templates. Rows are TemplateListItem. GET /templates
func (s *TemplatesService) ListWithContext(ctx context.Context, params *ListParams) (*ListResponse[TemplateListItem], error) {
	return request[ListResponse[TemplateListItem]](ctx, s.client, http.MethodGet, listPath("/templates", params), nil, nil)
}

// Update updates a template; returns the slim ack { object, id }.
// PATCH /templates/:id
func (s *TemplatesService) Update(id string, params *UpdateTemplateRequest) (*ObjectRef, error) {
	return s.UpdateWithContext(context.Background(), id, params)
}

// UpdateWithContext updates a template. PATCH /templates/:id
func (s *TemplatesService) UpdateWithContext(ctx context.Context, id string, params *UpdateTemplateRequest) (*ObjectRef, error) {
	return request[ObjectRef](ctx, s.client, http.MethodPatch, "/templates/"+esc(id), params, nil)
}

// Duplicate duplicates a template; params may be nil.
// POST /templates/:id/duplicate
func (s *TemplatesService) Duplicate(id string, params *DuplicateTemplateRequest) (*ObjectRef, error) {
	return s.DuplicateWithContext(context.Background(), id, params)
}

// DuplicateWithContext duplicates a template. POST /templates/:id/duplicate
func (s *TemplatesService) DuplicateWithContext(ctx context.Context, id string, params *DuplicateTemplateRequest) (*ObjectRef, error) {
	body := params
	if body == nil {
		body = &DuplicateTemplateRequest{}
	}
	return request[ObjectRef](ctx, s.client, http.MethodPost, "/templates/"+esc(id)+"/duplicate", body, nil)
}

// Publish publishes a template (makes its latest draft live).
// POST /templates/:id/publish
func (s *TemplatesService) Publish(id string) (*ObjectRef, error) {
	return s.PublishWithContext(context.Background(), id)
}

// PublishWithContext publishes a template. POST /templates/:id/publish
func (s *TemplatesService) PublishWithContext(ctx context.Context, id string) (*ObjectRef, error) {
	return request[ObjectRef](ctx, s.client, http.MethodPost, "/templates/"+esc(id)+"/publish", nil, nil)
}

// Remove deletes a template. DELETE /templates/:id
func (s *TemplatesService) Remove(id string) (*RemovedResponse, error) {
	return s.RemoveWithContext(context.Background(), id)
}

// RemoveWithContext deletes a template. DELETE /templates/:id
func (s *TemplatesService) RemoveWithContext(ctx context.Context, id string) (*RemovedResponse, error) {
	return request[RemovedResponse](ctx, s.client, http.MethodDelete, "/templates/"+esc(id), nil, nil)
}

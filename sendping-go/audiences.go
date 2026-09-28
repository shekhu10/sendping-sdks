package sendping

import (
	"context"
	"net/http"
)

// Audience is a contact list. In the domain-first model each sending domain
// has one lazily-created contact POOL audience (its Domain field is set);
// plain user-created audiences have Domain == "".
type Audience struct {
	Object string `json:"object"`
	Id     string `json:"id"`
	Name   string `json:"name"`
	// Domain is set when this audience is a sending domain's contact pool.
	Domain    string `json:"domain"`
	CreatedAt string `json:"created_at"`
}

// CreateAudienceRequest is the payload for POST /audiences.
type CreateAudienceRequest struct {
	Name string `json:"name"`
}

// UpdateAudienceRequest renames an audience.
type UpdateAudienceRequest struct {
	Name string `json:"name"`
}

// ImportSheetRequest imports contacts from a link-shared Google Sheet. Header
// columns become contact properties (usable as {{merge_tags}}); rows land in
// a fresh segment.
type ImportSheetRequest struct {
	Url         string `json:"url"`
	SegmentName string `json:"segment_name,omitempty"`
}

// SheetImportResponse is the result of a Google Sheet import.
type SheetImportResponse struct {
	Object       string   `json:"object"`
	Imported     int      `json:"imported"`
	Updated      int      `json:"updated"`
	Skipped      int      `json:"skipped"`
	Total        int      `json:"total"`
	SegmentId    string   `json:"segment_id"`
	SegmentName  string   `json:"segment_name"`
	SegmentAdded int      `json:"segment_added"`
	Variables    []string `json:"variables"`
}

// AudiencesService handles the /audiences endpoints.
type AudiencesService struct {
	client *Client
}

// Create creates an audience. POST /audiences
func (s *AudiencesService) Create(params *CreateAudienceRequest) (*Audience, error) {
	return s.CreateWithContext(context.Background(), params)
}

// CreateWithContext creates an audience. POST /audiences
func (s *AudiencesService) CreateWithContext(ctx context.Context, params *CreateAudienceRequest) (*Audience, error) {
	return request[Audience](ctx, s.client, http.MethodPost, "/audiences", params, nil)
}

// Get retrieves an audience. GET /audiences/:id
func (s *AudiencesService) Get(id string) (*Audience, error) {
	return s.GetWithContext(context.Background(), id)
}

// GetWithContext retrieves an audience. GET /audiences/:id
func (s *AudiencesService) GetWithContext(ctx context.Context, id string) (*Audience, error) {
	return request[Audience](ctx, s.client, http.MethodGet, "/audiences/"+esc(id), nil, nil)
}

// List lists audiences. GET /audiences
func (s *AudiencesService) List(params *ListParams) (*ListResponse[Audience], error) {
	return s.ListWithContext(context.Background(), params)
}

// ListWithContext lists audiences. GET /audiences
func (s *AudiencesService) ListWithContext(ctx context.Context, params *ListParams) (*ListResponse[Audience], error) {
	return request[ListResponse[Audience]](ctx, s.client, http.MethodGet, listPath("/audiences", params), nil, nil)
}

// ImportSheet imports contacts from a link-shared Google Sheet.
// POST /audiences/:id/contacts/import-sheet
func (s *AudiencesService) ImportSheet(audienceId string, params *ImportSheetRequest) (*SheetImportResponse, error) {
	return s.ImportSheetWithContext(context.Background(), audienceId, params)
}

// ImportSheetWithContext imports contacts from a link-shared Google Sheet.
func (s *AudiencesService) ImportSheetWithContext(ctx context.Context, audienceId string, params *ImportSheetRequest) (*SheetImportResponse, error) {
	return request[SheetImportResponse](ctx, s.client, http.MethodPost, "/audiences/"+esc(audienceId)+"/contacts/import-sheet", params, nil)
}

// Update renames an audience. PATCH /audiences/:id
func (s *AudiencesService) Update(id string, params *UpdateAudienceRequest) (*Audience, error) {
	return s.UpdateWithContext(context.Background(), id, params)
}

// UpdateWithContext renames an audience. PATCH /audiences/:id
func (s *AudiencesService) UpdateWithContext(ctx context.Context, id string, params *UpdateAudienceRequest) (*Audience, error) {
	return request[Audience](ctx, s.client, http.MethodPatch, "/audiences/"+esc(id), params, nil)
}

// Remove deletes an audience. DELETE /audiences/:id
func (s *AudiencesService) Remove(id string) (*RemovedResponse, error) {
	return s.RemoveWithContext(context.Background(), id)
}

// RemoveWithContext deletes an audience. DELETE /audiences/:id
func (s *AudiencesService) RemoveWithContext(ctx context.Context, id string) (*RemovedResponse, error) {
	return request[RemovedResponse](ctx, s.client, http.MethodDelete, "/audiences/"+esc(id), nil, nil)
}

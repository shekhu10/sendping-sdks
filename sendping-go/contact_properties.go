package sendping

import (
	"context"
	"net/http"
)

// ContactProperty is a registered custom contact field (usable as a
// {{merge_tag}}). The backend supports "string" | "number" types.
type ContactProperty struct {
	Object string `json:"object"`
	Id     string `json:"id"`
	Key    string `json:"key"`
	// Type is "string" | "number".
	Type string `json:"type"`
	// FallbackValue is a string, number, or nil.
	FallbackValue any    `json:"fallback_value"`
	CreatedAt     string `json:"created_at"`
}

// CreateContactPropertyRequest registers a custom contact property. Provide
// Key (canonical merge-tag key) or Name (accepted as an alias).
//
// Registering a key that already exists is a 409 (with name
// validation_error — read the status, not the name).
type CreateContactPropertyRequest struct {
	// Key must match ^\w{1,50}$ — letters, digits and underscores only.
	Key  string `json:"key,omitempty"`
	Name string `json:"name,omitempty"`
	// Type is "string" (default) | "number".
	Type string `json:"type"`
	// FallbackValue must parse as a finite number when Type is "number";
	// string fallbacks are truncated to 1000 characters.
	FallbackValue any `json:"fallback_value,omitempty"`
}

// UpdateContactPropertyRequest updates a property. Only FallbackValue is
// mutable; key/type are immutable.
type UpdateContactPropertyRequest struct {
	FallbackValue any `json:"fallback_value"`
}

// ContactPropertiesService handles the /contact-properties endpoints.
type ContactPropertiesService struct {
	client *Client
}

// Create registers a property; returns the slim ack { object, id }.
// POST /contact-properties
func (s *ContactPropertiesService) Create(params *CreateContactPropertyRequest) (*ObjectRef, error) {
	return s.CreateWithContext(context.Background(), params)
}

// CreateWithContext registers a property. POST /contact-properties
func (s *ContactPropertiesService) CreateWithContext(ctx context.Context, params *CreateContactPropertyRequest) (*ObjectRef, error) {
	return request[ObjectRef](ctx, s.client, http.MethodPost, "/contact-properties", params, nil)
}

// Get retrieves a property. GET /contact-properties/:id
func (s *ContactPropertiesService) Get(id string) (*ContactProperty, error) {
	return s.GetWithContext(context.Background(), id)
}

// GetWithContext retrieves a property. GET /contact-properties/:id
func (s *ContactPropertiesService) GetWithContext(ctx context.Context, id string) (*ContactProperty, error) {
	return request[ContactProperty](ctx, s.client, http.MethodGet, "/contact-properties/"+esc(id), nil, nil)
}

// List lists properties. GET /contact-properties
func (s *ContactPropertiesService) List(params *ListParams) (*ListResponse[ContactProperty], error) {
	return s.ListWithContext(context.Background(), params)
}

// ListWithContext lists properties. GET /contact-properties
func (s *ContactPropertiesService) ListWithContext(ctx context.Context, params *ListParams) (*ListResponse[ContactProperty], error) {
	return request[ListResponse[ContactProperty]](ctx, s.client, http.MethodGet, listPath("/contact-properties", params), nil, nil)
}

// Update updates a property; returns the slim ack { object, id }.
// PATCH /contact-properties/:id
func (s *ContactPropertiesService) Update(id string, params *UpdateContactPropertyRequest) (*ObjectRef, error) {
	return s.UpdateWithContext(context.Background(), id, params)
}

// UpdateWithContext updates a property. PATCH /contact-properties/:id
func (s *ContactPropertiesService) UpdateWithContext(ctx context.Context, id string, params *UpdateContactPropertyRequest) (*ObjectRef, error) {
	return request[ObjectRef](ctx, s.client, http.MethodPatch, "/contact-properties/"+esc(id), params, nil)
}

// Remove deletes a property. DELETE /contact-properties/:id
func (s *ContactPropertiesService) Remove(id string) (*RemovedResponse, error) {
	return s.RemoveWithContext(context.Background(), id)
}

// RemoveWithContext deletes a property. DELETE /contact-properties/:id
func (s *ContactPropertiesService) RemoveWithContext(ctx context.Context, id string) (*RemovedResponse, error) {
	return request[RemovedResponse](ctx, s.client, http.MethodDelete, "/contact-properties/"+esc(id), nil, nil)
}

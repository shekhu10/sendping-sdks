package sendping

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

// Topic lets contacts manage granular subscriptions (e.g. "Product updates").
type Topic struct {
	Object      string `json:"object"`
	Id          string `json:"id"`
	AudienceId  string `json:"audience_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	// DefaultSubscription is "opt_in" | "opt_out".
	DefaultSubscription string `json:"default_subscription"`
	// Visibility is "public" | "private".
	Visibility string `json:"visibility"`
	CreatedAt  string `json:"created_at"`
}

// CreateTopicRequest is the payload for POST /topics. Domain is REQUIRED
// (domain-first): topics belong to a sending domain; names are reusable
// across domains.
type CreateTopicRequest struct {
	// Domain is REQUIRED — the sending domain this topic belongs to (e.g.
	// "yourdomain.com" — one of your domains).
	Domain string `json:"domain"`
	// Name is required, max MaxTopicNameLength characters.
	Name string `json:"name"`
	// DefaultSubscription is required: "opt_in" | "opt_out". It is IMMUTABLE
	// after creation — UpdateTopicRequest silently ignores it.
	DefaultSubscription string `json:"default_subscription"`
	// Visibility is "public" | "private" (default "private").
	Visibility string `json:"visibility,omitempty"`
	// Description is at most MaxTopicDescriptionLength characters.
	Description string `json:"description,omitempty"`
}

// Topic field limits enforced by the API.
const (
	MaxTopicNameLength        = 255
	MaxTopicDescriptionLength = 200
)

// ListTopicsRequest lists a domain's topics. Domain is REQUIRED.
type ListTopicsRequest struct {
	// Domain is REQUIRED — the sending domain whose topics to list.
	Domain string
	Limit  int
	After  string
	Before string
}

// UpdateTopicRequest is the payload for PATCH /topics/:id. DefaultSubscription
// is immutable, so it is deliberately absent here.
type UpdateTopicRequest struct {
	Name string `json:"name,omitempty"`
	// Description is clearable: Clear[string]() removes the stored copy.
	Description *Null[string] `json:"description,omitempty"`
	Visibility  string        `json:"visibility,omitempty"`
}

// TopicsService handles the /topics endpoints.
type TopicsService struct {
	client *Client
}

// Create creates a topic on a sending domain (Domain is required). POST /topics
func (s *TopicsService) Create(params *CreateTopicRequest) (*Topic, error) {
	return s.CreateWithContext(context.Background(), params)
}

// CreateWithContext creates a topic. POST /topics
func (s *TopicsService) CreateWithContext(ctx context.Context, params *CreateTopicRequest) (*Topic, error) {
	return request[Topic](ctx, s.client, http.MethodPost, "/topics", params, nil)
}

// Get retrieves a topic. GET /topics/:id
func (s *TopicsService) Get(id string) (*Topic, error) {
	return s.GetWithContext(context.Background(), id)
}

// GetWithContext retrieves a topic. GET /topics/:id
func (s *TopicsService) GetWithContext(ctx context.Context, id string) (*Topic, error) {
	return request[Topic](ctx, s.client, http.MethodGet, "/topics/"+esc(id), nil, nil)
}

// List lists a domain's topics (Domain is required). GET /topics?domain=...
func (s *TopicsService) List(params *ListTopicsRequest) (*ListResponse[Topic], error) {
	return s.ListWithContext(context.Background(), params)
}

// ListWithContext lists a domain's topics. GET /topics?domain=...
func (s *TopicsService) ListWithContext(ctx context.Context, params *ListTopicsRequest) (*ListResponse[Topic], error) {
	q := url.Values{}
	q.Set("domain", params.Domain)
	if params.Limit > 0 {
		q.Set("limit", strconv.Itoa(params.Limit))
	}
	if params.After != "" {
		q.Set("after", params.After)
	}
	if params.Before != "" {
		q.Set("before", params.Before)
	}
	return request[ListResponse[Topic]](ctx, s.client, http.MethodGet, "/topics?"+q.Encode(), nil, nil)
}

// Update updates a topic. PATCH /topics/:id
func (s *TopicsService) Update(id string, params *UpdateTopicRequest) (*Topic, error) {
	return s.UpdateWithContext(context.Background(), id, params)
}

// UpdateWithContext updates a topic. PATCH /topics/:id
func (s *TopicsService) UpdateWithContext(ctx context.Context, id string, params *UpdateTopicRequest) (*Topic, error) {
	return request[Topic](ctx, s.client, http.MethodPatch, "/topics/"+esc(id), params, nil)
}

// Remove deletes a topic. DELETE /topics/:id
func (s *TopicsService) Remove(id string) (*RemovedResponse, error) {
	return s.RemoveWithContext(context.Background(), id)
}

// RemoveWithContext deletes a topic. DELETE /topics/:id
func (s *TopicsService) RemoveWithContext(ctx context.Context, id string) (*RemovedResponse, error) {
	return request[RemovedResponse](ctx, s.client, http.MethodDelete, "/topics/"+esc(id), nil, nil)
}

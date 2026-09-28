package sendping

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

// PropertyFilter is a single custom-property predicate. Value is required
// for the "eq" and "contains" operators.
type PropertyFilter struct {
	Key string `json:"key"`
	// Operator is "eq" | "contains" | "exists".
	Operator string `json:"operator"`
	// Value is a string or number.
	Value any `json:"value,omitempty"`
}

// SegmentEngagement narrows a segment to contacts who did (or did not) engage
// with one campaign.
type SegmentEngagement struct {
	// Event is "clicked" | "not_clicked" | "opened" | "not_opened".
	Event      string `json:"event"`
	CampaignId string `json:"campaign_id"`
}

// SegmentFilter is the RESPONSE-side filter carried on a Segment. Status is
// always present and PropertyFilters is always an array (possibly empty).
// Use SegmentFilterInput to create or patch a segment.
type SegmentFilter struct {
	// Status is "all" | "subscribed" | "unsubscribed" | "members_only"
	// ("members_only" keeps just the explicitly added contacts).
	Status          string           `json:"status"`
	EmailContains   string           `json:"email_contains"`
	PropertyFilters []PropertyFilter `json:"property_filters"`
	// Engagement narrows the segment by campaign engagement; nil means the
	// segment has no engagement predicate.
	Engagement *SegmentEngagement `json:"engagement"`
}

// SegmentFilterInput is the REQUEST-side filter for Segments.Create and
// Segments.Update. Every field is optional, and the two clearable fields are
// three-state: leave them nil to keep the stored predicate.
type SegmentFilterInput struct {
	// Status is "all" | "subscribed" | "unsubscribed" | "members_only".
	Status        string `json:"status,omitempty"`
	EmailContains string `json:"email_contains,omitempty"`
	// PropertyFilters replaces the property predicates wholesale. Point it at
	// an empty slice (&[]sendping.PropertyFilter{}) to clear them; a plain
	// empty slice value cannot express "clear", which is why this is a
	// pointer.
	PropertyFilters *[]PropertyFilter `json:"property_filters,omitempty"`
	// Engagement re-targets the campaign-engagement predicate;
	// Clear[SegmentEngagement]() removes it.
	Engagement *Null[SegmentEngagement] `json:"engagement,omitempty"`
}

// Segment is a saved contact filter within a domain's contact pool.
type Segment struct {
	Object     string        `json:"object"`
	Id         string        `json:"id"`
	AudienceId string        `json:"audience_id"`
	Name       string        `json:"name"`
	Filter     SegmentFilter `json:"filter"`
	CreatedAt  string        `json:"created_at"`
	UpdatedAt  string        `json:"updated_at"`
}

// CreateSegmentRequest is the payload for POST /segments. Domain is REQUIRED
// (domain-first): segment names are unique WITHIN a domain but freely
// reusable across domains; every domain also carries an auto-created
// "General" (all contacts) segment.
type CreateSegmentRequest struct {
	// Domain is REQUIRED — the sending domain this segment belongs to (e.g.
	// "yourdomain.com" — one of your domains).
	Domain string              `json:"domain"`
	Name   string              `json:"name"`
	Filter *SegmentFilterInput `json:"filter,omitempty"`
}

// ListSegmentsRequest lists a domain's segments. Domain is REQUIRED.
type ListSegmentsRequest struct {
	// Domain is REQUIRED — the sending domain whose segments to list.
	Domain string
	Limit  int
	After  string
	Before string
}

// UpdateSegmentRequest is the payload for PATCH /segments/:id.
//
// A segment's domain is immutable: there is deliberately no Domain field, and
// sending one (or audience_id) is a 422 validation_error.
type UpdateSegmentRequest struct {
	Name   string              `json:"name,omitempty"`
	Filter *SegmentFilterInput `json:"filter,omitempty"`
}

// SegmentContact is the reduced contact shape returned by Segments.Contacts —
// no Object and no Properties.
type SegmentContact struct {
	Id           string `json:"id"`
	Email        string `json:"email"`
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name"`
	Unsubscribed bool   `json:"unsubscribed"`
	CreatedAt    string `json:"created_at"`
}

// SegmentsService handles the /segments endpoints.
type SegmentsService struct {
	client *Client
}

// Create creates a segment on a sending domain (Domain is required).
// POST /segments
func (s *SegmentsService) Create(params *CreateSegmentRequest) (*Segment, error) {
	return s.CreateWithContext(context.Background(), params)
}

// CreateWithContext creates a segment. POST /segments
func (s *SegmentsService) CreateWithContext(ctx context.Context, params *CreateSegmentRequest) (*Segment, error) {
	return request[Segment](ctx, s.client, http.MethodPost, "/segments", params, nil)
}

// Get retrieves a segment. GET /segments/:id
func (s *SegmentsService) Get(id string) (*Segment, error) {
	return s.GetWithContext(context.Background(), id)
}

// GetWithContext retrieves a segment. GET /segments/:id
func (s *SegmentsService) GetWithContext(ctx context.Context, id string) (*Segment, error) {
	return request[Segment](ctx, s.client, http.MethodGet, "/segments/"+esc(id), nil, nil)
}

// List lists a domain's segments (Domain is required; includes its
// auto-created "General" segment). GET /segments?domain=...
func (s *SegmentsService) List(params *ListSegmentsRequest) (*ListResponse[Segment], error) {
	return s.ListWithContext(context.Background(), params)
}

// ListWithContext lists a domain's segments. GET /segments?domain=...
func (s *SegmentsService) ListWithContext(ctx context.Context, params *ListSegmentsRequest) (*ListResponse[Segment], error) {
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
	return request[ListResponse[Segment]](ctx, s.client, http.MethodGet, "/segments?"+q.Encode(), nil, nil)
}

// Contacts previews the contacts a segment currently resolves to (filter
// matches plus explicit memberships). Passing nil params caps the response at
// 1,000 contacts with HasMore true — a segment can easily resolve to more, so
// page with After while HasMore is true. GET /segments/:id/contacts
func (s *SegmentsService) Contacts(id string, params *ListParams) (*ListResponse[SegmentContact], error) {
	return s.ContactsWithContext(context.Background(), id, params)
}

// ContactsWithContext previews the contacts a segment resolves to.
func (s *SegmentsService) ContactsWithContext(ctx context.Context, id string, params *ListParams) (*ListResponse[SegmentContact], error) {
	return request[ListResponse[SegmentContact]](ctx, s.client, http.MethodGet, listPath("/segments/"+esc(id)+"/contacts", params), nil, nil)
}

// Update updates a segment. PATCH /segments/:id
func (s *SegmentsService) Update(id string, params *UpdateSegmentRequest) (*Segment, error) {
	return s.UpdateWithContext(context.Background(), id, params)
}

// UpdateWithContext updates a segment. PATCH /segments/:id
func (s *SegmentsService) UpdateWithContext(ctx context.Context, id string, params *UpdateSegmentRequest) (*Segment, error) {
	return request[Segment](ctx, s.client, http.MethodPatch, "/segments/"+esc(id), params, nil)
}

// Remove deletes a segment. DELETE /segments/:id
func (s *SegmentsService) Remove(id string) (*RemovedResponse, error) {
	return s.RemoveWithContext(context.Background(), id)
}

// RemoveWithContext deletes a segment. DELETE /segments/:id
func (s *SegmentsService) RemoveWithContext(ctx context.Context, id string) (*RemovedResponse, error) {
	return request[RemovedResponse](ctx, s.client, http.MethodDelete, "/segments/"+esc(id), nil, nil)
}

package sendping

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

// Contact is a single contact record. Contacts are DOMAIN-FIRST: each sending
// domain has its own contact pool, so the same email address on two domains
// is two records with separate consent.
type Contact struct {
	Object       string `json:"object"`
	Id           string `json:"id"`
	Email        string `json:"email"`
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name"`
	Unsubscribed bool   `json:"unsubscribed"`
	// Properties are custom contact properties (own values merged over
	// registered fallbacks).
	Properties map[string]any `json:"properties,omitempty"`
	CreatedAt  string         `json:"created_at"`
}

// CreateContactRequest creates a contact. Domain-first: set Domain to create
// in that domain's contact pool via the flat /contacts API (REQUIRED there),
// or AudienceId to target a specific audience via the nested API.
type CreateContactRequest struct {
	// Domain is the sending domain whose contact pool the contact lands in
	// (e.g. "yourdomain.com" — one of your domains). REQUIRED whenever
	// AudienceId is omitted.
	Domain string `json:"domain,omitempty"`
	// AudienceId targets a specific audience via the nested
	// /audiences/:id/contacts API instead of Domain. Not sent in the body.
	AudienceId   string         `json:"-"`
	Email        string         `json:"email"`
	FirstName    string         `json:"first_name,omitempty"`
	LastName     string         `json:"last_name,omitempty"`
	Unsubscribed bool           `json:"unsubscribed,omitempty"`
	Properties   map[string]any `json:"properties,omitempty"`
}

// GetContactRequest identifies a contact for retrieval. Id may be a contact
// id (exact) or an EMAIL; an email can exist in several domains' pools, so
// set Domain to pick the pool (omitted => the oldest match anywhere).
type GetContactRequest struct {
	AudienceId string
	Domain     string
	// Id is a contact id OR email.
	Id string
}

// ListContactsRequest lists contacts. Domain-first: Domain is REQUIRED on the
// flat /contacts list (names the pool) whenever AudienceId is omitted.
type ListContactsRequest struct {
	Domain     string
	AudienceId string
	Limit      int
	After      string
	Before     string
	// SegmentId restricts to members of that segment (works with or without
	// AudienceId).
	SegmentId string
}

// ContactInput is a single contact in a bulk import (no audience — it's on
// the call).
type ContactInput struct {
	Email        string         `json:"email"`
	FirstName    string         `json:"first_name,omitempty"`
	LastName     string         `json:"last_name,omitempty"`
	Unsubscribed bool           `json:"unsubscribed,omitempty"`
	Properties   map[string]any `json:"properties,omitempty"`
}

// BatchContactsRequest bulk-imports contacts from a slice. Upserts by email;
// at most MaxImportContacts per call. Rows missing a valid email are counted
// as skipped rather than failing the request, and Properties are sanitized but
// not validated against the contact-property registry on this endpoint.
type BatchContactsRequest struct {
	// Domain is the sending domain whose contact pool the contacts land in
	// (domain-first model, e.g. "yourdomain.com"). Used when AudienceId is
	// empty, and sent in the body exactly as CreateContactRequest.Domain is.
	// (BatchWithContext builds the request body explicitly, so this struct
	// carries no json tags — unlike CreateContactRequest, which is marshaled.)
	Domain string
	// AudienceId targets one audience via the nested API instead of Domain.
	AudienceId string
	Contacts   []ContactInput
	// OnConflict "skip" leaves existing contacts untouched (default "upsert").
	OnConflict string
}

// ImportContactsRequest bulk-imports contacts from CSV text (header row
// optional). Upserts by email. By default every non-builtin CSV column is
// auto-registered as a custom property; set CreateProperties to
// sendping.Bool(false) for strict mode.
//
// Provide Csv for an inline import (max MaxInlineImportBytes of UTF-8 and
// MaxImportContacts rows), or StorageKey to import a file already uploaded
// via Contacts.CreateImportUpload.
type ImportContactsRequest struct {
	AudienceId string
	Csv        string
	// FileName labels the archived source file (default "contacts.csv").
	FileName string
	// StorageKey imports a file uploaded through Contacts.CreateImportUpload
	// instead of inline Csv text.
	StorageKey string
	// OnConflict "skip" leaves existing contacts untouched (default "upsert").
	OnConflict       string
	CreateProperties *bool
	// SegmentId adds every imported address to that segment. It must be one
	// of your segments and belong to this audience.
	SegmentId string
}

// ImportContactsUploadRequest mints a direct-upload URL for a CSV too large to
// send inline.
type ImportContactsUploadRequest struct {
	AudienceId string `json:"-"`
	// Filename must end in ".csv".
	Filename string `json:"filename"`
	// Size is the file size in bytes; must be > 0 and at most
	// MaxContactImportUploadBytes.
	Size int64 `json:"size"`
}

// ImportContactsUploadResponse carries a presigned direct-upload URL. UploadUrl
// is a bearer credential — do not log it. PUT the CSV bytes there with the
// given ContentType, then pass StorageKey to Contacts.Import.
type ImportContactsUploadResponse struct {
	Object      string `json:"object"`
	StorageKey  string `json:"storage_key"`
	UploadUrl   string `json:"upload_url"`
	ContentType string `json:"content_type"`
	// ExpiresIn is the URL's lifetime in seconds.
	ExpiresIn int   `json:"expires_in"`
	MaxBytes  int64 `json:"max_bytes"`
}

// ImportSourceFile describes the archived copy of an imported CSV.
type ImportSourceFile struct {
	FileName   string `json:"file_name"`
	StorageKey string `json:"storage_key"`
	Archived   bool   `json:"archived"`
}

// ImportContactLimit reports how the account's contact allowance shaped a CSV
// import.
type ImportContactLimit struct {
	Plan            map[string]any `json:"plan"`
	UsedBefore      int            `json:"used_before"`
	Limit           int            `json:"limit"`
	RemainingBefore *int           `json:"remaining_before"`
	RemainingAfter  *int           `json:"remaining_after"`
	LimitSkipped    int            `json:"limit_skipped"`
	Reached         bool           `json:"reached"`
	Message         string         `json:"message"`
}

// Contact-import limits enforced by the API.
const (
	// MaxImportContacts caps rows per Contacts.Batch, Contacts.Import (inline)
	// and Audiences.ImportSheet call.
	MaxImportContacts = 10000
	// MaxInlineImportBytes caps the UTF-8 size of inline CSV text.
	MaxInlineImportBytes = 5 * 1024 * 1024
	// MaxContactImportUploadBytes caps a direct CSV upload.
	MaxContactImportUploadBytes = 256 * 1024 * 1024
)

// ImportContactsResponse is the result of a batch / CSV contact import. The
// fields below Total are populated by the CSV import only.
type ImportContactsResponse struct {
	Object string `json:"object"`
	// Imported counts newly inserted contacts.
	Imported int `json:"imported"`
	// Updated counts existing contacts updated.
	Updated int `json:"updated"`
	// Skipped counts rows dropped: missing/invalid email OR left untouched
	// under OnConflict "skip".
	Skipped int `json:"skipped"`
	// Total counts distinct contacts processed.
	Total int `json:"total"`

	// InvalidRows counts CSV rows without a usable email.
	InvalidRows int `json:"invalid_rows,omitempty"`
	// LimitSkipped counts rows dropped because the plan's contact allowance
	// ran out mid-import.
	LimitSkipped int `json:"limit_skipped,omitempty"`
	// SystemSkipped counts rows the importer rejected internally.
	SystemSkipped int `json:"system_skipped,omitempty"`
	// IgnoredColumns lists CSV headers that were not imported.
	IgnoredColumns []string `json:"ignored_columns,omitempty"`
	// SegmentAdded is present only when SegmentId was supplied.
	SegmentAdded int                 `json:"segment_added,omitempty"`
	SourceFile   *ImportSourceFile   `json:"source_file,omitempty"`
	ContactLimit *ImportContactLimit `json:"contact_limit,omitempty"`
}

// UpdateContactRequest updates a contact.
type UpdateContactRequest struct {
	// Domain disambiguates an EMAIL Id across domains (a contact id is exact
	// and needs no domain). Flat API only.
	Domain string `json:"domain,omitempty"`
	// AudienceId is the audience the contact belongs to. OMIT for the flat
	// /contacts/:id API. Not sent in the body.
	AudienceId string `json:"-"`
	// Id is a contact id OR email. Not sent in the body.
	Id           string         `json:"-"`
	FirstName    *string        `json:"first_name,omitempty"`
	LastName     *string        `json:"last_name,omitempty"`
	Unsubscribed *bool          `json:"unsubscribed,omitempty"`
	Properties   map[string]any `json:"properties,omitempty"`
}

// RemoveContactRequest identifies a contact for deletion. On the flat API,
// set Domain when Id is an EMAIL (disambiguates across pools).
type RemoveContactRequest struct {
	AudienceId string
	Domain     string
	// Id is a contact id OR email.
	Id string
}

// RemoveContactResponse is returned by contact deletion.
type RemoveContactResponse struct {
	Object string `json:"object"`
	// Id is the deleted contact's id.
	Id      string `json:"id"`
	Deleted bool   `json:"deleted"`

	// Contact is always empty: the API returns the deleted contact's id as
	// `id`, never as `contact`.
	//
	// Deprecated: read Id instead.
	Contact string `json:"contact,omitempty"`
}

// SegmentMembershipRemoved is returned when removing a contact from a segment.
type SegmentMembershipRemoved struct {
	// Id is the contact id.
	Id string `json:"id"`
	// AudienceId carries the SEGMENT id despite its name — that is what the
	// API returns, camelCase key and all.
	AudienceId string `json:"audienceId"`
	Deleted    bool   `json:"deleted"`
}

// ContactSegmentRef is a segment reference as returned by
// ContactsService.ListSegments (GET /contacts/:id/segments). The route returns
// only Id, Name and CreatedAt — not the full Segment. Use Segments.Get for the
// audience, filter and timestamps.
type ContactSegmentRef struct {
	Id        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
}

// ContactTopicSubscription is one topic subscription state of a contact.
type ContactTopicSubscription struct {
	Id          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	// Subscription is "opt_in" | "opt_out".
	Subscription string `json:"subscription"`
}

// ContactTopics is a contact's topic subscription list.
type ContactTopics struct {
	Object  string                     `json:"object"`
	HasMore bool                       `json:"has_more"`
	Data    []ContactTopicSubscription `json:"data"`
}

// TopicSubscriptionUpdate sets one topic's subscription state.
type TopicSubscriptionUpdate struct {
	Id string `json:"id"`
	// Subscription is "opt_in" | "opt_out".
	Subscription string `json:"subscription"`
}

// UpdateContactTopicsRequest updates a contact's topic subscriptions.
type UpdateContactTopicsRequest struct {
	Topics []TopicSubscriptionUpdate `json:"topics"`
}

// ContactsService handles the flat /contacts and nested
// /audiences/:id/contacts endpoints.
type ContactsService struct {
	client *Client
}

// Create creates a contact; returns the slim ack { object, id }.
// POST /contacts (flat, Domain required) or POST /audiences/:id/contacts.
func (s *ContactsService) Create(params *CreateContactRequest) (*ObjectRef, error) {
	return s.CreateWithContext(context.Background(), params)
}

// CreateWithContext creates a contact.
func (s *ContactsService) CreateWithContext(ctx context.Context, params *CreateContactRequest) (*ObjectRef, error) {
	body := *params
	if params.AudienceId != "" {
		// The nested audience route derives its pool from the path; only the
		// flat route takes domain in the body.
		body.Domain = ""
		return request[ObjectRef](ctx, s.client, http.MethodPost, "/audiences/"+esc(params.AudienceId)+"/contacts", &body, nil)
	}
	return request[ObjectRef](ctx, s.client, http.MethodPost, "/contacts", &body, nil)
}

// Get retrieves a contact by id or email. An id is exact; an EMAIL can exist
// in several domains' pools, so set Domain to pick the pool.
func (s *ContactsService) Get(params *GetContactRequest) (*Contact, error) {
	return s.GetWithContext(context.Background(), params)
}

// GetWithContext retrieves a contact by id or email.
func (s *ContactsService) GetWithContext(ctx context.Context, params *GetContactRequest) (*Contact, error) {
	if params.AudienceId != "" {
		return request[Contact](ctx, s.client, http.MethodGet, "/audiences/"+esc(params.AudienceId)+"/contacts/"+esc(params.Id), nil, nil)
	}
	path := "/contacts/" + esc(params.Id)
	if params.Domain != "" {
		path += "?domain=" + url.QueryEscape(params.Domain)
	}
	return request[Contact](ctx, s.client, http.MethodGet, path, nil, nil)
}

// List lists contacts. Domain-first: Domain is required on the flat /contacts
// list (names the pool) whenever AudienceId is omitted.
func (s *ContactsService) List(params *ListContactsRequest) (*ListResponse[Contact], error) {
	return s.ListWithContext(context.Background(), params)
}

// ListWithContext lists contacts.
func (s *ContactsService) ListWithContext(ctx context.Context, params *ListContactsRequest) (*ListResponse[Contact], error) {
	base := "/contacts"
	q := url.Values{}
	if params != nil {
		if params.AudienceId != "" {
			base = "/audiences/" + esc(params.AudienceId) + "/contacts"
		} else if params.Domain != "" {
			q.Set("domain", params.Domain)
		}
		if params.Limit > 0 {
			q.Set("limit", strconv.Itoa(params.Limit))
		}
		if params.After != "" {
			q.Set("after", params.After)
		}
		if params.Before != "" {
			q.Set("before", params.Before)
		}
		// segment_id filter is honored by both the flat and audience-scoped list.
		if params.SegmentId != "" {
			q.Set("segment_id", params.SegmentId)
		}
	}
	path := base
	if enc := q.Encode(); enc != "" {
		path += "?" + enc
	}
	return request[ListResponse[Contact]](ctx, s.client, http.MethodGet, path, nil, nil)
}

// Batch bulk-imports contacts from a slice. Upserts by email; max 10,000 per
// call. Domain-first, like Create: set Domain for the flat POST /contacts/batch,
// or AudienceId for POST /audiences/:id/contacts/batch.
//
// Use this for many contacts: one batch takes the account's contact-limit lock
// once, where a Create loop takes it per contact.
func (s *ContactsService) Batch(params *BatchContactsRequest) (*ImportContactsResponse, error) {
	return s.BatchWithContext(context.Background(), params)
}

// BatchWithContext bulk-imports contacts from a slice.
func (s *ContactsService) BatchWithContext(ctx context.Context, params *BatchContactsRequest) (*ImportContactsResponse, error) {
	suffix := ""
	if params.OnConflict != "" {
		suffix = "?on_conflict=" + url.QueryEscape(params.OnConflict)
	}
	body := map[string]any{"contacts": params.Contacts}
	if params.AudienceId != "" {
		// The nested audience route derives its pool from the path; only the
		// flat route takes a domain.
		path := "/audiences/" + esc(params.AudienceId) + "/contacts/batch" + suffix
		return request[ImportContactsResponse](ctx, s.client, http.MethodPost, path, body, nil)
	}
	if params.Domain != "" {
		body["domain"] = params.Domain
	}
	return request[ImportContactsResponse](ctx, s.client, http.MethodPost, "/contacts/batch"+suffix, body, nil)
}

// Import bulk-imports contacts from CSV text. Upserts by email.
// POST /audiences/:id/contacts/import
func (s *ContactsService) Import(params *ImportContactsRequest) (*ImportContactsResponse, error) {
	return s.ImportWithContext(context.Background(), params)
}

// ImportWithContext bulk-imports contacts from CSV text.
func (s *ContactsService) ImportWithContext(ctx context.Context, params *ImportContactsRequest) (*ImportContactsResponse, error) {
	q := url.Values{}
	if params.OnConflict != "" {
		q.Set("on_conflict", params.OnConflict)
	}
	if params.CreateProperties != nil && !*params.CreateProperties {
		q.Set("create_properties", "false")
	}
	if params.SegmentId != "" {
		q.Set("segment_id", params.SegmentId)
	}
	path := "/audiences/" + esc(params.AudienceId) + "/contacts/import"
	if enc := q.Encode(); enc != "" {
		path += "?" + enc
	}
	body := map[string]any{}
	if params.StorageKey != "" {
		body["storage_key"] = params.StorageKey
	} else {
		body["csv"] = params.Csv
	}
	if params.FileName != "" {
		body["file_name"] = params.FileName
	}
	return request[ImportContactsResponse](ctx, s.client, http.MethodPost, path, body, nil)
}

// CreateImportUpload mints a presigned direct-upload URL for a CSV too large to send
// inline. Upload the bytes to the returned UploadUrl, then call Import with
// the returned StorageKey. POST /audiences/:id/contacts/import/upload
func (s *ContactsService) CreateImportUpload(params *ImportContactsUploadRequest) (*ImportContactsUploadResponse, error) {
	return s.CreateImportUploadWithContext(context.Background(), params)
}

// CreateImportUploadWithContext mints a presigned direct-upload URL for a CSV.
// POST /audiences/:id/contacts/import/upload
func (s *ContactsService) CreateImportUploadWithContext(ctx context.Context, params *ImportContactsUploadRequest) (*ImportContactsUploadResponse, error) {
	path := "/audiences/" + esc(params.AudienceId) + "/contacts/import/upload"
	return request[ImportContactsUploadResponse](ctx, s.client, http.MethodPost, path, params, nil)
}

// Update updates a contact; returns the slim ack { object, id }. On the flat
// API, set Domain when Id is an EMAIL (disambiguates across pools).
func (s *ContactsService) Update(params *UpdateContactRequest) (*ObjectRef, error) {
	return s.UpdateWithContext(context.Background(), params)
}

// UpdateWithContext updates a contact.
func (s *ContactsService) UpdateWithContext(ctx context.Context, params *UpdateContactRequest) (*ObjectRef, error) {
	body := *params
	if params.AudienceId != "" {
		// The nested audience route derives its pool from the path.
		body.Domain = ""
		return request[ObjectRef](ctx, s.client, http.MethodPatch, "/audiences/"+esc(params.AudienceId)+"/contacts/"+esc(params.Id), &body, nil)
	}
	return request[ObjectRef](ctx, s.client, http.MethodPatch, "/contacts/"+esc(params.Id), &body, nil)
}

// Remove deletes a contact. On the flat API, set Domain when Id is an EMAIL.
func (s *ContactsService) Remove(params *RemoveContactRequest) (*RemoveContactResponse, error) {
	return s.RemoveWithContext(context.Background(), params)
}

// RemoveWithContext deletes a contact.
func (s *ContactsService) RemoveWithContext(ctx context.Context, params *RemoveContactRequest) (*RemoveContactResponse, error) {
	if params.AudienceId != "" {
		return request[RemoveContactResponse](ctx, s.client, http.MethodDelete, "/audiences/"+esc(params.AudienceId)+"/contacts/"+esc(params.Id), nil, nil)
	}
	path := "/contacts/" + esc(params.Id)
	if params.Domain != "" {
		path += "?domain=" + url.QueryEscape(params.Domain)
	}
	return request[RemoveContactResponse](ctx, s.client, http.MethodDelete, path, nil, nil)
}

// AddToSegment adds a contact to a segment; returns { id } (the segment id).
// POST /contacts/:id/segments/:segmentId
func (s *ContactsService) AddToSegment(id, segmentId string) (*IdResponse, error) {
	return s.AddToSegmentWithContext(context.Background(), id, segmentId)
}

// AddToSegmentWithContext adds a contact to a segment.
func (s *ContactsService) AddToSegmentWithContext(ctx context.Context, id, segmentId string) (*IdResponse, error) {
	return request[IdResponse](ctx, s.client, http.MethodPost, "/contacts/"+esc(id)+"/segments/"+esc(segmentId), nil, nil)
}

// RemoveFromSegment removes a contact from a segment.
// DELETE /contacts/:id/segments/:segmentId
func (s *ContactsService) RemoveFromSegment(id, segmentId string) (*SegmentMembershipRemoved, error) {
	return s.RemoveFromSegmentWithContext(context.Background(), id, segmentId)
}

// RemoveFromSegmentWithContext removes a contact from a segment.
func (s *ContactsService) RemoveFromSegmentWithContext(ctx context.Context, id, segmentId string) (*SegmentMembershipRemoved, error) {
	return request[SegmentMembershipRemoved](ctx, s.client, http.MethodDelete, "/contacts/"+esc(id)+"/segments/"+esc(segmentId), nil, nil)
}

// ListSegments lists the segments a contact belongs to. Rows are the reduced
// ContactSegmentRef shape (Id, Name, CreatedAt), not the full Segment — use
// Segments.Get for that. Passing nil params returns up to 1,000 segments in
// one response, with HasMore true when that cap truncated it — page with
// After. GET /contacts/:id/segments
func (s *ContactsService) ListSegments(id string, params *ListParams) (*ListResponse[ContactSegmentRef], error) {
	return s.ListSegmentsWithContext(context.Background(), id, params)
}

// ListSegmentsWithContext lists the segments a contact belongs to.
func (s *ContactsService) ListSegmentsWithContext(ctx context.Context, id string, params *ListParams) (*ListResponse[ContactSegmentRef], error) {
	return request[ListResponse[ContactSegmentRef]](ctx, s.client, http.MethodGet, listPath("/contacts/"+esc(id)+"/segments", params), nil, nil)
}

// GetTopics gets a contact's topic subscriptions. Passing nil params returns
// up to 1,000 topics in one response, with HasMore true when that cap bites.
// Set ListParams.Limit for normal 1-100 paging. GET /contacts/:id/topics
func (s *ContactsService) GetTopics(id string, params *ListParams) (*ContactTopics, error) {
	return s.GetTopicsWithContext(context.Background(), id, params)
}

// GetTopicsWithContext gets a contact's topic subscriptions.
func (s *ContactsService) GetTopicsWithContext(ctx context.Context, id string, params *ListParams) (*ContactTopics, error) {
	return request[ContactTopics](ctx, s.client, http.MethodGet, listPath("/contacts/"+esc(id)+"/topics", params), nil, nil)
}

// UpdateTopics updates a contact's topic subscriptions; returns { id } (the
// contact id). PATCH /contacts/:id/topics
func (s *ContactsService) UpdateTopics(id string, params *UpdateContactTopicsRequest) (*IdResponse, error) {
	return s.UpdateTopicsWithContext(context.Background(), id, params)
}

// UpdateTopicsWithContext updates a contact's topic subscriptions.
func (s *ContactsService) UpdateTopicsWithContext(ctx context.Context, id string, params *UpdateContactTopicsRequest) (*IdResponse, error) {
	return request[IdResponse](ctx, s.client, http.MethodPatch, "/contacts/"+esc(id)+"/topics", params, nil)
}

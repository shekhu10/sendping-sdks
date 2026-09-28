package sendping

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

// ReceivedAttachment describes an attachment of a received (inbound) email.
type ReceivedAttachment struct {
	Id                 string `json:"id,omitempty"`
	Filename           string `json:"filename"`
	ContentType        string `json:"content_type"`
	Size               int64  `json:"size"`
	ContentId          string `json:"content_id,omitempty"`
	ContentDisposition string `json:"content_disposition,omitempty"`
	Downloadable       bool   `json:"downloadable"`
	DownloadUrl        string `json:"download_url,omitempty"`
	ExpiresAt          string `json:"expires_at,omitempty"`
	// Url is a backward-compatible relative-path alias.
	Url string `json:"url,omitempty"`
}

// ReceivedEmailRaw points at the original RFC822 message download.
type ReceivedEmailRaw struct {
	DownloadUrl string `json:"download_url"`
	ExpiresAt   string `json:"expires_at"`
}

// ReceivedEmail is an inbound email as returned by GET /emails/receiving/:id.
type ReceivedEmail struct {
	Object string   `json:"object"`
	Id     string   `json:"id"`
	From   string   `json:"from"`
	To     []string `json:"to"`
	// DomainId is the receiving domain the message arrived on.
	DomainId    string   `json:"domain_id"`
	Cc          []string `json:"cc,omitempty"`
	Bcc         []string `json:"bcc,omitempty"`
	ReceivedFor []string `json:"received_for,omitempty"`
	Subject     string   `json:"subject"`
	Html        string   `json:"html,omitempty"`
	Text        string   `json:"text,omitempty"`
	// Headers are the parsed message headers as a name -> value map.
	Headers   map[string]string `json:"headers,omitempty"`
	MessageId string            `json:"message_id,omitempty"`
	// Category is the AI reply intent (replies only): "interested" |
	// "neutral" | "not_interested".
	Category string `json:"category,omitempty"`
	// ReplyToEmailId is the id of the sent email this message replied to,
	// when the reply was recognised.
	ReplyToEmailId string               `json:"reply_to_email_id,omitempty"`
	Spf            string               `json:"spf,omitempty"`
	Verdicts       map[string]any       `json:"verdicts,omitempty"`
	Attachments    []ReceivedAttachment `json:"attachments,omitempty"`
	RawAvailable   bool                 `json:"raw_available"`
	Raw            *ReceivedEmailRaw    `json:"raw,omitempty"`
	RawUrl         string               `json:"raw_url,omitempty"`
	CreatedAt      string               `json:"created_at"`
}

// ForwardReceivedEmailRequest forwards a received email.
type ForwardReceivedEmailRequest struct {
	// From must be a verified sending address (required by the backend).
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject,omitempty"`
}

// ReplyReceivedEmailRequest replies to a received email's sender, threaded
// into the same conversation (subject defaults to "Re: ...").
type ReplyReceivedEmailRequest struct {
	From    string `json:"from"`
	Html    string `json:"html,omitempty"`
	Text    string `json:"text,omitempty"`
	Subject string `json:"subject,omitempty"`
}

// ListReceivedEmailsRequest lists received emails: cursor pagination plus an
// optional received_for filter.
type ListReceivedEmailsRequest struct {
	Limit  int
	After  string
	Before string
	// ReceivedFor restricts to messages received for this address (matches
	// the received_for recipients).
	ReceivedFor string
}

// ReceivingAddressStats is one row of Receiving.ListAddresses: inbound volume
// per receiving address.
type ReceivingAddressStats struct {
	Address string `json:"address"`
	Total   int    `json:"total"`
	Replies int    `json:"replies"`
	// Interested counts replies the AI classifier tagged "interested".
	Interested     int    `json:"interested"`
	LastReceivedAt string `json:"last_received_at"`
}

// ReceivingService handles inbound (received) email — client.Emails.Receiving.
type ReceivingService struct {
	client *Client
}

// List lists received emails. GET /emails/receiving
// For the received_for filter use ListFiltered.
//
// This endpoint's unpaged default differs from the 20-row one: with no Limit
// and no cursor it returns up to 1,000 rows in one response (HasMore reports
// the truncation). Set Limit for normal 1-100 paging.
func (s *ReceivingService) List(params *ListParams) (*ListResponse[ReceivedEmail], error) {
	return s.ListWithContext(context.Background(), params)
}

// ListWithContext lists received emails. GET /emails/receiving
func (s *ReceivingService) ListWithContext(ctx context.Context, params *ListParams) (*ListResponse[ReceivedEmail], error) {
	return request[ListResponse[ReceivedEmail]](ctx, s.client, http.MethodGet, listPath("/emails/receiving", params), nil, nil)
}

// ListFiltered lists received emails with an optional received_for filter.
// GET /emails/receiving
func (s *ReceivingService) ListFiltered(params *ListReceivedEmailsRequest) (*ListResponse[ReceivedEmail], error) {
	return s.ListFilteredWithContext(context.Background(), params)
}

// ListFilteredWithContext lists received emails with an optional received_for
// filter. GET /emails/receiving
func (s *ReceivingService) ListFilteredWithContext(ctx context.Context, params *ListReceivedEmailsRequest) (*ListResponse[ReceivedEmail], error) {
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
		if params.ReceivedFor != "" {
			q.Set("received_for", params.ReceivedFor)
		}
	}
	path := "/emails/receiving"
	if enc := q.Encode(); enc != "" {
		path += "?" + enc
	}
	return request[ListResponse[ReceivedEmail]](ctx, s.client, http.MethodGet, path, nil, nil)
}

// ListAddresses reports inbound volume per receiving address. Not paginated —
// HasMore is always false. GET /emails/receiving/addresses
func (s *ReceivingService) ListAddresses() (*ListResponse[ReceivingAddressStats], error) {
	return s.ListAddressesWithContext(context.Background())
}

// ListAddressesWithContext reports inbound volume per receiving address.
// GET /emails/receiving/addresses
func (s *ReceivingService) ListAddressesWithContext(ctx context.Context) (*ListResponse[ReceivingAddressStats], error) {
	return request[ListResponse[ReceivingAddressStats]](ctx, s.client, http.MethodGet, "/emails/receiving/addresses", nil, nil)
}

// Get retrieves a received email. GET /emails/receiving/:id
func (s *ReceivingService) Get(id string) (*ReceivedEmail, error) {
	return s.GetWithContext(context.Background(), id)
}

// GetWithContext retrieves a received email. GET /emails/receiving/:id
func (s *ReceivingService) GetWithContext(ctx context.Context, id string) (*ReceivedEmail, error) {
	return request[ReceivedEmail](ctx, s.client, http.MethodGet, "/emails/receiving/"+esc(id), nil, nil)
}

// ListAttachments lists a received email's attachments. Passing nil params
// returns up to 1,000 attachments in one response (HasMore reports the
// truncation); supply Limit or After for normal 1-100 paging.
// GET /emails/receiving/:id/attachments
func (s *ReceivingService) ListAttachments(id string, params *ListParams) (*ListResponse[ReceivedAttachment], error) {
	return s.ListAttachmentsWithContext(context.Background(), id, params)
}

// ListAttachmentsWithContext lists a received email's attachments.
func (s *ReceivingService) ListAttachmentsWithContext(ctx context.Context, id string, params *ListParams) (*ListResponse[ReceivedAttachment], error) {
	return request[ListResponse[ReceivedAttachment]](ctx, s.client, http.MethodGet, listPath("/emails/receiving/"+esc(id)+"/attachments", params), nil, nil)
}

// GetAttachment downloads one attachment of a received email as raw bytes
// (the route streams the binary file, not JSON).
// GET /emails/receiving/:id/attachments/:attachmentId
func (s *ReceivingService) GetAttachment(id, attachmentId string) ([]byte, error) {
	return s.GetAttachmentWithContext(context.Background(), id, attachmentId)
}

// GetAttachmentWithContext downloads one attachment of a received email as raw bytes.
func (s *ReceivingService) GetAttachmentWithContext(ctx context.Context, id, attachmentId string) ([]byte, error) {
	return requestRaw(ctx, s.client, http.MethodGet, "/emails/receiving/"+esc(id)+"/attachments/"+esc(attachmentId))
}

// GetRaw downloads the original RFC822/MIME message as raw bytes.
// GET /emails/receiving/:id/raw
func (s *ReceivingService) GetRaw(id string) ([]byte, error) {
	return s.GetRawWithContext(context.Background(), id)
}

// GetRawWithContext downloads the original RFC822/MIME message as raw bytes.
func (s *ReceivingService) GetRawWithContext(ctx context.Context, id string) ([]byte, error) {
	return requestRaw(ctx, s.client, http.MethodGet, "/emails/receiving/"+esc(id)+"/raw")
}

// Forward forwards a received email. POST /emails/receiving/:id/forward
func (s *ReceivingService) Forward(id string, params *ForwardReceivedEmailRequest) (*CreateEmailResponse, error) {
	return s.ForwardWithContext(context.Background(), id, params)
}

// ForwardWithContext forwards a received email. POST /emails/receiving/:id/forward
func (s *ReceivingService) ForwardWithContext(ctx context.Context, id string, params *ForwardReceivedEmailRequest) (*CreateEmailResponse, error) {
	return s.ForwardWithOptions(ctx, id, params, nil)
}

// ForwardWithOptions preserves an IdempotencyKey across retries of one logical forward.
func (s *ReceivingService) ForwardWithOptions(ctx context.Context, id string, params *ForwardReceivedEmailRequest, opts *RequestOptions) (*CreateEmailResponse, error) {
	return request[CreateEmailResponse](ctx, s.client, http.MethodPost, "/emails/receiving/"+esc(id)+"/forward", params, opts)
}

// Reply replies to a received email's sender, threaded into the same
// conversation. POST /emails/receiving/:id/reply
func (s *ReceivingService) Reply(id string, params *ReplyReceivedEmailRequest) (*CreateEmailResponse, error) {
	return s.ReplyWithContext(context.Background(), id, params)
}

// ReplyWithContext replies to a received email's sender.
func (s *ReceivingService) ReplyWithContext(ctx context.Context, id string, params *ReplyReceivedEmailRequest) (*CreateEmailResponse, error) {
	return s.ReplyWithOptions(ctx, id, params, nil)
}

// ReplyWithOptions preserves an IdempotencyKey across retries of one logical reply.
func (s *ReceivingService) ReplyWithOptions(ctx context.Context, id string, params *ReplyReceivedEmailRequest, opts *RequestOptions) (*CreateEmailResponse, error) {
	return request[CreateEmailResponse](ctx, s.client, http.MethodPost, "/emails/receiving/"+esc(id)+"/reply", params, opts)
}

// Remove deletes a received email. DELETE /emails/receiving/:id
func (s *ReceivingService) Remove(id string) (*RemovedResponse, error) {
	return s.RemoveWithContext(context.Background(), id)
}

// RemoveWithContext deletes a received email. DELETE /emails/receiving/:id
func (s *ReceivingService) RemoveWithContext(ctx context.Context, id string) (*RemovedResponse, error) {
	return request[RemovedResponse](ctx, s.client, http.MethodDelete, "/emails/receiving/"+esc(id), nil, nil)
}

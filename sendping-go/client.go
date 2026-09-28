// Package sendping is the official Go SDK for the SendPing email API —
// send transactional and marketing email from your own verified domain.
//
// Usage:
//
//	client := sendping.NewClient("mb_xxxxxxxxx")
//	sent, err := client.Emails.Send(&sendping.SendEmailRequest{
//		From:    "Acme <hello@yourdomain.com>",
//		To:      []string{"delivered@test.sendping.co"},
//		Subject: "Hello from SendPing",
//		Html:    "<p>Your first email</p>",
//	})
//
// delivered@test.sendping.co is the simulator address for an IMMEDIATE send — it
// exercises the whole path without delivering anything. Reserved documentation
// domains (example.com/.net/.org, .test, .invalid) are rejected with a 422
// reserved_recipient, so swap in a real recipient for a real send.
//
// Every method has a context-aware variant (e.g. SendWithContext). Non-2xx
// API responses are returned as a *SendPingError.
package sendping

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	// Version is the SDK version, sent in the User-Agent header.
	Version = "1.0.0"
	// DefaultBaseURL is the production SendPing API host.
	DefaultBaseURL = "https://www.sendping.co/api"

	defaultUserAgent = "sendping-go/" + Version

	// DefaultTimeout is the per-request timeout applied to every HTTP call.
	DefaultTimeout = 30 * time.Second
	// DefaultMaxRetries is how many times a retryable (429/503) response is
	// retried, i.e. up to DefaultMaxRetries+1 total attempts.
	DefaultMaxRetries = 2

	// maxBackoff caps how long the client will wait between retries.
	maxBackoff = 30 * time.Second
)

// Limit kinds reported by PlanLimitDetail.Kind. Treat the field as an open
// string — new kinds may appear without an SDK release.
const (
	LimitKindEmailsDaily       = "emails_daily"
	LimitKindEmailsMonthly     = "emails_monthly"
	LimitKindDomains           = "domains"
	LimitKindAutomationRuns    = "automation_runs"
	LimitKindAiCredits         = "ai_credits"
	LimitKindContacts          = "contacts"
	LimitKindCampaignPreflight = "campaign_preflight"
)

// PlanRef identifies a plan by id and display name.
type PlanRef struct {
	Id   string `json:"id"`
	Name string `json:"name"`
}

// PlanUpgrade is the cheapest plan that would clear the limit, with its
// allowances. Nil (JSON null) when only Enterprise fits.
type PlanUpgrade struct {
	Id   string `json:"id"`
	Name string `json:"name"`
	// Amount is the price in the currency's minor unit (e.g. cents).
	Amount         int    `json:"amount"`
	Currency       string `json:"currency"`
	MonthlyEmails  int    `json:"monthly_emails"`
	DailyEmails    int    `json:"daily_emails"`
	Domains        int    `json:"domains"`
	Contacts       int    `json:"contacts"`
	AiCredits      int    `json:"ai_credits"`
	AutomationRuns int    `json:"automation_runs"`
}

// LimitCredits describes topping up with prepaid send credits instead of
// upgrading. Present only for the email-quota kinds.
type LimitCredits struct {
	Balance     int  `json:"balance"`
	Needed      int  `json:"needed"`
	Purchasable bool `json:"purchasable"`
	// Unit is how many emails one credit pack buys.
	Unit int `json:"unit"`
	// AmountPerUnitCents is the price of one pack, in cents.
	AmountPerUnitCents int `json:"amount_per_unit_cents"`
}

// PlanLimitDetail is the additive "limit" object the API attaches to plan and
// quota rejections — plan_limit_reached, daily_quota_exceeded,
// monthly_quota_exceeded, contact_limit_reached, ai_credits_exceeded and
// automation_quota_exceeded. It says WHICH allowance was hit, how much of it
// was used, and what would clear it.
type PlanLimitDetail struct {
	// Kind is which allowance ran out; see the LimitKind* constants.
	Kind  string `json:"kind"`
	Used  int    `json:"used"`
	Limit int    `json:"limit"`
	// Requested is how much the rejected call asked for.
	Requested int `json:"requested,omitempty"`
	Remaining int `json:"remaining,omitempty"`
	// Period is the rolling window the limit is measured over: "24h" or "30d".
	// Empty for kinds that are not windowed (e.g. domains).
	Period string  `json:"period,omitempty"`
	Plan   PlanRef `json:"plan"`
	// NextPlan is the cheapest plan that would fit, or nil when only
	// Enterprise does.
	NextPlan *PlanUpgrade `json:"next_plan,omitempty"`
	// Credits is the top-up option, present only for email-quota kinds.
	Credits *LimitCredits `json:"credits,omitempty"`
}

// Reputation scopes reported by ReputationDetail.Scope.
const (
	ReputationScopeTenant   = "tenant"
	ReputationScopeDomain   = "domain"
	ReputationScopePlatform = "platform"
)

// ReputationDetail is the additive "reputation" object on reputation-gate
// errors (reputation_paused, reputation_limit_exceeded, and the platform-wide
// sending_service_unavailable). Every field beyond Retryable and Scope is
// optional and may be zero.
type ReputationDetail struct {
	// Retryable reports whether waiting and retrying can succeed (a warm-up
	// capacity ceiling) rather than the send being blocked outright.
	Retryable bool `json:"retryable"`
	// Scope is what was gated: "tenant", "domain" or "platform".
	Scope string `json:"scope"`
	// Status is the internal reputation state, when reported.
	Status string `json:"status,omitempty"`
	// ScopeKey identifies the gated entity (e.g. the domain).
	ScopeKey    string `json:"scope_key,omitempty"`
	HourlyLimit int    `json:"hourly_limit,omitempty"`
	DailyLimit  int    `json:"daily_limit,omitempty"`
	HourlyUsed  int    `json:"hourly_used,omitempty"`
	DailyUsed   int    `json:"daily_used,omitempty"`
	// RetryAt is an ISO 8601 timestamp for when sending may resume.
	RetryAt      string `json:"retry_at,omitempty"`
	SupportEmail string `json:"support_email,omitempty"`
}

// SendPingError is the error type returned for any non-2xx API response. It
// is parsed from the API's error envelope { statusCode, name, message }.
//
// Branch on Name together with StatusCode, never on Message: message text is
// scrubbed of provider identifiers server-side and is not a stable contract,
// and some handlers return a status that differs from the name's usual one.
//
// Some errors are a SUPERSET of the envelope, and those extras are parsed too:
//
//   - Limit — plan/quota rejections say which allowance was hit.
//   - Reputation — reputation gates say what was paused or throttled.
//   - Sent / SentCount — a POST /emails/batch that failed part way through
//     (with or without an Idempotency-Key) names the emails that DID
//     go out, so they are not sent twice on retry.
//
// All three are absent on an ordinary error: Limit and Reputation are nil,
// Sent is empty and SentCount is 0.
type SendPingError struct {
	StatusCode int    `json:"statusCode"`
	Name       string `json:"name"`
	Message    string `json:"message"`
	// Id identifies a failed or unconfirmed logical send. Inspect it before resending.
	Id string `json:"id,omitempty"`
	// Reserved includes attempted emails whose delivery may still be unconfirmed.
	Reserved []IdResponse `json:"reserved,omitempty"`
	// UnsentCount counts only the never-attempted tail of an interrupted batch.
	UnsentCount *int `json:"unsent_count,omitempty"`

	// Limit is set on plan/quota errors, else nil.
	Limit *PlanLimitDetail `json:"limit,omitempty"`
	// Reputation is set on reputation-gate errors, else nil.
	Reputation *ReputationDetail `json:"reputation,omitempty"`
	// Sent lists the emails already delivered before a batch failed part way
	// through. Empty on every other error.
	Sent []IdResponse `json:"sent,omitempty"`
	// SentCount is how many emails went out before a mid-batch failure. It
	// falls back to len(Sent) when the server omits the count.
	SentCount int `json:"sent_count,omitempty"`

	// Body is the whole parsed error body, so fields this SDK version does
	// not model yet are still reachable. Nil when the response was not a JSON
	// object.
	Body map[string]any `json:"-"`
}

func (e *SendPingError) Error() string {
	return fmt.Sprintf("sendping: [%d %s] %s", e.StatusCode, e.Name, e.Message)
}

// ObjectRef is the slim acknowledgement { object, id } returned by several
// create/update routes.
type ObjectRef struct {
	Object string `json:"object"`
	Id     string `json:"id"`
}

// IdResponse is the minimal { id } acknowledgement some routes return.
type IdResponse struct {
	Id string `json:"id"`
}

// RemovedResponse is returned by delete endpoints.
type RemovedResponse struct {
	Object  string `json:"object"`
	Id      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

// ListResponse is the standard paginated list envelope.
type ListResponse[T any] struct {
	Object  string `json:"object"`
	HasMore bool   `json:"has_more"`
	Data    []T    `json:"data"`
}

// ListParams are the cursor-pagination params accepted by most List methods.
// Zero values are omitted from the query string.
type ListParams struct {
	Limit int
	// After is the id of the last item on the previous page.
	After string
	// Before is the id of the first item on the next page.
	Before string
}

func (p *ListParams) apply(q url.Values) {
	if p == nil {
		return
	}
	if p.Limit > 0 {
		q.Set("limit", strconv.Itoa(p.Limit))
	}
	if p.After != "" {
		q.Set("after", p.After)
	}
	if p.Before != "" {
		q.Set("before", p.Before)
	}
}

// listPath appends ListParams as a query string to base.
func listPath(base string, p *ListParams) string {
	q := url.Values{}
	p.apply(q)
	if enc := q.Encode(); enc != "" {
		return base + "?" + enc
	}
	return base
}

// IdempotencyKeyMaxLen is the longest Idempotency-Key the API accepts. The
// value is trimmed server-side, then must be 1-255 characters (the storage
// column is VARCHAR(255)) — 255, not 256. A key outside that range is rejected
// with invalid_idempotency_key (HTTP 400).
//
// The header is honoured by POST /emails, POST /emails/batch, and received-email reply/forward ONLY; every
// other endpoint ignores it, so a retry there creates a second resource.
//
// This package does not check the length itself — the server is the authority.
// The constant is exported so the rule is discoverable.
const IdempotencyKeyMaxLen = 255

// RequestOptions carries per-request options for create calls.
type RequestOptions struct {
	// IdempotencyKey is sent VERBATIM as the Idempotency-Key header, letting
	// you safely retry a send. It must be 1-255 characters after the server
	// trims it (IdempotencyKeyMaxLen); the server, not this package, rejects
	// anything else with a 400 invalid_idempotency_key.
	//
	// Only POST /emails, POST /emails/batch, and received-email reply/forward honour the header — i.e.
	// Emails.SendWithOptions, Batch.SendEmailsWithOptions, and ReceivingService's
	// ReplyWithOptions / ForwardWithOptions. Other endpoints ignore it, so a retry there
	// creates a second resource.
	IdempotencyKey string
}

// Bool returns a pointer to b. Handy for optional tri-state fields.
func Bool(b bool) *bool { return &b }

// Int returns a pointer to i.
func Int(i int) *int { return &i }

// String returns a pointer to s.
func String(s string) *string { return &s }

// Null is a three-state PATCH field.
//
// The API's PATCH endpoints key off whether a JSON key is present: a key that
// is absent leaves the field untouched, and a key present with an explicit
// null CLEARS it. A plain Go pointer can only express two of those three
// states, so the clearable fields use *Null[T]:
//
//	nil          -> the key is omitted; the server leaves the field alone
//	Set(v)       -> the key is sent with v
//	Clear[T]()   -> the key is sent as JSON null; the server clears the field
//
// For example, re-targeting and then un-targeting a campaign's segment:
//
//	client.Campaigns.Update(id, &sendping.UpdateCampaignRequest{
//		SegmentId: sendping.Set("seg_123"),
//	})
//	client.Campaigns.Update(id, &sendping.UpdateCampaignRequest{
//		SegmentId: sendping.Clear[string](),
//	})
type Null[T any] struct {
	value *T
}

// Set builds a PATCH field that sends v.
func Set[T any](v T) *Null[T] { return &Null[T]{value: &v} }

// Clear builds a PATCH field that sends an explicit JSON null, clearing the
// field server-side. The type parameter matches the struct field, e.g.
// sendping.Clear[string]().
func Clear[T any]() *Null[T] { return &Null[T]{} }

// Value reports the value the field carries. ok is false when the field
// clears the server-side value (or the receiver is nil).
func (n *Null[T]) Value() (value T, ok bool) {
	var zero T
	if n == nil || n.value == nil {
		return zero, false
	}
	return *n.value, true
}

// MarshalJSON emits the carried value, or JSON null when the field clears.
func (n *Null[T]) MarshalJSON() ([]byte, error) {
	if n == nil || n.value == nil {
		return []byte("null"), nil
	}
	return json.Marshal(*n.value)
}

// UnmarshalJSON accepts a value or JSON null.
func (n *Null[T]) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		n.value = nil
		return nil
	}
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	n.value = &v
	return nil
}

// esc percent-encodes a path segment so ids like "a/../b" can't traverse the
// URL path.
func esc(s string) string { return url.PathEscape(s) }

// Client is the SendPing API client. Construct it with NewClient; the
// exported BaseURL, HTTPClient, and UserAgent fields may be overridden before
// first use.
type Client struct {
	apiKey string

	// BaseURL is the API host (default DefaultBaseURL). No trailing slash.
	BaseURL string
	// HTTPClient is the underlying *http.Client. NewClient gives the client its
	// own instance (not http.DefaultClient) so tuning it never affects other
	// callers.
	HTTPClient *http.Client
	// UserAgent is sent with every request. The API rejects a request whose
	// User-Agent is missing or blank with 403 validation_error, before
	// authentication, so setting this to "" falls back to the default rather
	// than producing a client that 403s on every call.
	UserAgent string

	// Timeout bounds every HTTP request (JSON and raw/binary paths alike),
	// applied per attempt via a request context. Default DefaultTimeout (30s).
	// A value of 0 drops that per-attempt deadline — note that NewClient also
	// sets HTTPClient.Timeout to DefaultTimeout, so clear that too (or supply
	// your own HTTPClient) to run genuinely unbounded requests.
	Timeout time.Duration
	// MaxRetries is how many times a 429 or 503 response is retried before the
	// error is returned. Default DefaultMaxRetries (2); 0 disables retries.
	// Only 429/503 are retried — never other 5xx, network errors, or timeouts,
	// so a non-idempotent write is never silently duplicated.
	MaxRetries int

	Emails            *EmailsService
	Batch             *BatchService
	Domains           *DomainsService
	Audiences         *AudiencesService
	Contacts          *ContactsService
	ContactProperties *ContactPropertiesService
	Campaigns         *CampaignsService
	Segments          *SegmentsService
	Topics            *TopicsService
	Templates         *TemplatesService
	Automations       *AutomationsService
	Webhooks          *WebhooksService
	Events            *EventsService
	ApiKeys           *ApiKeysService
	Logs              *LogsService
	Polls             *PollsService
}

// NewClient creates a SendPing API client authenticated with the given API
// key (e.g. "mb_xxxxxxxxx").
func NewClient(apiKey string) *Client {
	c := &Client{
		apiKey:     apiKey,
		BaseURL:    DefaultBaseURL,
		HTTPClient: &http.Client{Timeout: DefaultTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		UserAgent:  defaultUserAgent,
		Timeout:    DefaultTimeout,
		MaxRetries: DefaultMaxRetries,
	}
	c.Emails = &EmailsService{client: c, Receiving: &ReceivingService{client: c}}
	c.Batch = &BatchService{client: c}
	c.Domains = &DomainsService{client: c}
	c.Audiences = &AudiencesService{client: c}
	c.Contacts = &ContactsService{client: c}
	c.ContactProperties = &ContactPropertiesService{client: c}
	c.Campaigns = &CampaignsService{client: c}
	c.Segments = &SegmentsService{client: c}
	c.Topics = &TopicsService{client: c}
	c.Templates = &TemplatesService{client: c}
	c.Automations = &AutomationsService{client: c}
	c.Webhooks = &WebhooksService{client: c}
	c.Events = &EventsService{client: c}
	c.ApiKeys = &ApiKeysService{client: c}
	c.Logs = &LogsService{client: c}
	c.Polls = &PollsService{client: c}
	return c
}

// newRequest builds the request and returns the marshaled body bytes alongside
// it so the do-request chokepoint can re-create the body reader on each retry
// (a request body is consumed once per send).
func (c *Client) newRequest(ctx context.Context, method, path string, body any, opts *RequestOptions) (*http.Request, []byte, error) {
	var bodyBytes []byte
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, nil, err
		}
		bodyBytes = b
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, reader)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	// A non-empty User-Agent is MANDATORY: the gate runs before authentication
	// and answers a blank one with 403 validation_error. net/http omits the
	// header entirely when its value is "", so fall back to the default.
	userAgent := strings.TrimSpace(c.UserAgent)
	if userAgent == "" {
		userAgent = defaultUserAgent
	}
	req.Header.Set("User-Agent", userAgent)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if opts != nil && opts.IdempotencyKey != "" {
		req.Header.Set("Idempotency-Key", opts.IdempotencyKey)
	}
	return req, bodyBytes, nil
}

func (c *Client) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return http.DefaultClient
}

func parseAPIError(status int, body []byte) *SendPingError {
	apiErr := &SendPingError{
		StatusCode: status,
		Name:       "application_error",
		Message:    fmt.Sprintf("request failed with status %d", status),
	}
	// Decode field by field: an additive field in a shape this SDK version
	// does not expect must never cost the caller the envelope itself.
	var fields map[string]json.RawMessage
	if json.Unmarshal(body, &fields) != nil {
		return apiErr
	}
	// Envelope only — decoding it into SendPingError would make a malformed
	// additive field poison the three fields every caller relies on.
	var envelope struct {
		Name    string `json:"name"`
		Message string `json:"message"`
	}
	if json.Unmarshal(body, &envelope) == nil {
		if envelope.Name != "" {
			apiErr.Name = envelope.Name
		}
		if envelope.Message != "" {
			apiErr.Message = envelope.Message
		}
	}

	// Additive fields, present only on plan/quota, reputation and
	// partial-batch errors; they stay nil/empty otherwise.
	if raw, ok := fields["limit"]; ok {
		var limit PlanLimitDetail
		if json.Unmarshal(raw, &limit) == nil {
			apiErr.Limit = &limit
		}
	}
	if raw, ok := fields["reputation"]; ok {
		var reputation ReputationDetail
		if json.Unmarshal(raw, &reputation) == nil {
			apiErr.Reputation = &reputation
		}
	}
	if raw, ok := fields["sent"]; ok {
		var sent []IdResponse
		if json.Unmarshal(raw, &sent) == nil {
			apiErr.Sent = sent
		}
	}
	if raw, ok := fields["sent_count"]; ok {
		var count int
		if json.Unmarshal(raw, &count) == nil {
			apiErr.SentCount = count
		}
	}
	if apiErr.SentCount == 0 {
		apiErr.SentCount = len(apiErr.Sent)
	}
	_ = json.Unmarshal(fields["id"], &apiErr.Id)
	_ = json.Unmarshal(fields["reserved"], &apiErr.Reserved)
	_ = json.Unmarshal(fields["unsent_count"], &apiErr.UnsentCount)

	// Keep the raw body so extras this version does not model are reachable.
	var raw map[string]any
	if json.Unmarshal(body, &raw) == nil {
		apiErr.Body = raw
	}
	return apiErr
}

// maxRetries returns the configured retry budget, clamping negatives to 0.
func (c *Client) maxRetries() int {
	if c.MaxRetries < 0 {
		return 0
	}
	return c.MaxRetries
}

// isRetryable identifies candidate statuses; retryAllowed also checks progress
// and whether a write was rejected before processing or protected by a key.
func isRetryable(status int) bool {
	return status == http.StatusTooManyRequests || status == http.StatusServiceUnavailable
}

var idempotentSendPath = regexp.MustCompile(`/emails(?:/batch|/receiving/[^/]+/(?:reply|forward))?$`)

func retryAllowed(req *http.Request, status int, body []byte) bool {
	apiErr := parseAPIError(status, body)
	// Raw progress survives item-schema changes and numeric decoding failures.
	var progress map[string]any
	_ = json.Unmarshal(body, &progress)
	count, _ := progress["sent_count"].(float64)
	sent, _ := progress["sent"].([]any)
	reserved, _ := progress["reserved"].([]any)
	if apiErr.Id != "" || count > 0 || len(sent) > 0 || len(reserved) > 0 || apiErr.Name == "batch_incomplete" {
		return false
	}
	if status != 503 || req.Method == http.MethodGet || req.Method == http.MethodHead {
		return true
	}
	switch apiErr.Name {
	case "service_unavailable", "sending_service_unavailable", "sending_configuration_unavailable", "contacts_busy", "contacts_timeout":
		return true
	}
	return req.Method == http.MethodPost && strings.TrimSpace(req.Header.Get("Idempotency-Key")) != "" && idempotentSendPath.MatchString(req.URL.EscapedPath())
}

// capDelay clamps a wait duration to [0, maxBackoff].
func capDelay(d time.Duration) time.Duration {
	if d < 0 {
		return 0
	}
	if d > maxBackoff {
		return maxBackoff
	}
	return d
}

// backoffDelay computes how long to wait before the next retry. It honors the
// Retry-After header — delta-seconds (integer or decimal) or an HTTP-date —
// capping at maxBackoff and treating negatives as 0. When Retry-After is absent
// or unparseable it falls back to exponential backoff min(30s, 0.5s*2^attempt),
// where attempt is 0 for the first retry.
func backoffDelay(retryAfter string, attempt int) time.Duration {
	if h := strings.TrimSpace(retryAfter); h != "" {
		if secs, err := strconv.ParseFloat(h, 64); err == nil {
			if !math.IsNaN(secs) && !math.IsInf(secs, 0) {
				if secs >= maxBackoff.Seconds() {
					return maxBackoff
				}
				if secs <= 0 {
					return 0
				}
				return time.Duration(secs * float64(time.Second))
			}
		}
		if t, err := http.ParseTime(h); err == nil {
			return capDelay(time.Until(t))
		}
	}
	if attempt >= 6 {
		return maxBackoff
	}
	return capDelay(time.Duration(float64(500*time.Millisecond) * math.Pow(2, float64(attempt))))
}

// doRequest is the single HTTP chokepoint shared by the JSON (do) and raw
// (requestRaw) paths, so both get the per-request timeout and the 429/503
// retry loop. reqBody is the buffered request body (nil for bodyless calls);
// it is re-wrapped in a fresh reader before each attempt because a body is
// consumed once per send.
func (c *Client) doRequest(req *http.Request, reqBody []byte) (int, []byte, error) {
	maxRetries := c.maxRetries()
	for attempt := 0; ; attempt++ {
		if reqBody != nil {
			req.Body = io.NopCloser(bytes.NewReader(reqBody))
			req.ContentLength = int64(len(reqBody))
		}

		status, header, body, err := c.attempt(req)
		if err != nil {
			// Network errors and timeouts are not retried.
			return 0, nil, err
		}
		if !isRetryable(status) || attempt >= maxRetries || !retryAllowed(req, status, body) {
			return status, body, nil
		}
		timer := time.NewTimer(backoffDelay(header.Get("Retry-After"), attempt))
		select {
		case <-req.Context().Done():
			timer.Stop()
			return 0, nil, req.Context().Err()
		case <-timer.C:
		}
	}
}

// attempt performs a single HTTP round-trip with the per-request timeout applied
// as a context deadline, fully reading (and closing) the response body before it
// returns so the deadline covers the body read too.
func (c *Client) attempt(req *http.Request) (int, http.Header, []byte, error) {
	ctx := req.Context()
	if c.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.Timeout)
		defer cancel()
	}
	resp, err := c.httpClient().Do(req.WithContext(ctx))
	if err != nil {
		return 0, nil, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, nil, nil, err
	}
	return resp.StatusCode, resp.Header, body, nil
}

// do executes the request through the chokepoint; on 2xx it unmarshals the JSON
// body into v (when v is non-nil), on non-2xx it returns a *SendPingError.
func (c *Client) do(req *http.Request, reqBody []byte, v any) error {
	status, body, err := c.doRequest(req, reqBody)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return parseAPIError(status, body)
	}
	if v == nil || len(body) == 0 {
		return nil
	}
	return json.Unmarshal(body, v)
}

// request is the shared typed JSON call helper used by every service.
func request[T any](ctx context.Context, c *Client, method, path string, body any, opts *RequestOptions) (*T, error) {
	req, reqBody, err := c.newRequest(ctx, method, path, body, opts)
	if err != nil {
		return nil, err
	}
	out := new(T)
	if err := c.do(req, reqBody, out); err != nil {
		return nil, err
	}
	return out, nil
}

// requestRaw is like request but for endpoints that stream raw binary bytes
// (e.g. a received-email attachment download). On error the JSON error body
// is parsed like request.
func requestRaw(ctx context.Context, c *Client, method, path string) ([]byte, error) {
	req, _, err := c.newRequest(ctx, method, path, nil, nil)
	if err != nil {
		return nil, err
	}
	status, body, err := c.doRequest(req, nil)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, parseAPIError(status, body)
	}
	return body, nil
}

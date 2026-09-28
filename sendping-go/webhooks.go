package sendping

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
)

// Webhook event names accepted by CreateWebhookRequest.Events and
// UpdateWebhookRequest.Events. Short aliases ("opened", "click", "bounce", …)
// are also accepted on write but are normalized to these canonical values, so
// reads always return the forms below. Anything else is a 422
// validation_error ("Unknown event '<value>'.").
const (
	EventEmailSent            = "email.sent"
	EventEmailDelivered       = "email.delivered"
	EventEmailDeliveryDelayed = "email.delivery_delayed"
	EventEmailBounced         = "email.bounced"
	EventEmailComplained      = "email.complained"
	EventEmailOpened          = "email.opened"
	EventEmailClicked         = "email.clicked"
	EventEmailFailed          = "email.failed"
	EventEmailScheduled       = "email.scheduled"
	EventEmailSuppressed      = "email.suppressed"
	EventEmailReceived        = "email.received"
	EventEmailReplied         = "email.replied"
	EventEmailUnsubscribed    = "email.unsubscribed"
	EventContactCreated       = "contact.created"
	EventContactUpdated       = "contact.updated"
	EventContactDeleted       = "contact.deleted"
	EventDomainCreated        = "domain.created"
	EventDomainUpdated        = "domain.updated"
	EventDomainDeleted        = "domain.deleted"
)

// WebhookEvents lists every canonical webhook event name.
var WebhookEvents = []string{
	EventEmailSent, EventEmailDelivered, EventEmailDeliveryDelayed,
	EventEmailBounced, EventEmailComplained, EventEmailOpened,
	EventEmailClicked, EventEmailFailed, EventEmailScheduled,
	EventEmailSuppressed, EventEmailReceived, EventEmailReplied,
	EventEmailUnsubscribed, EventContactCreated, EventContactUpdated,
	EventContactDeleted, EventDomainCreated, EventDomainUpdated,
	EventDomainDeleted,
}

// Webhook is a delivery endpoint subscribed to events.
type Webhook struct {
	Object string `json:"object"`
	// Id is a string-encoded integer.
	Id       string   `json:"id"`
	Endpoint string   `json:"endpoint"`
	Events   []string `json:"events"`
	// Status is "enabled" | "disabled".
	Status string `json:"status"`
	// HasSecret reports whether a signing secret is set. (The secret itself is
	// returned ONLY on create + rotate, never on get/list.)
	HasSecret bool `json:"has_secret,omitempty"`
	// LastDeliveryAt is the timestamp of the last delivery attempt.
	LastDeliveryAt string `json:"last_delivery_at,omitempty"`
	// LastDeliveryStatus is the HTTP status of the last delivery attempt (0
	// until first delivery).
	LastDeliveryStatus int `json:"last_delivery_status,omitempty"`
	// FailureCount is the consecutive delivery failure count.
	FailureCount int    `json:"failure_count,omitempty"`
	CreatedAt    string `json:"created_at"`
}

// CreateWebhookRequest is the payload for POST /webhooks.
type CreateWebhookRequest struct {
	// Endpoint must be an https:// URL that resolves to a public address —
	// http://, IPv6 literals and private/loopback addresses are rejected with
	// a 422 validation_error ("Endpoint URL rejected: <reason>").
	Endpoint string `json:"endpoint"`
	// Events must be non-empty; see WebhookEvents for the canonical names.
	Events []string `json:"events"`
	// Secret is an optional caller-supplied signing secret. When omitted,
	// SendPing generates one (returned once).
	Secret string `json:"secret,omitempty"`
}

// CreateWebhookResponse carries the signing secret, shown ONCE (create and
// rotate only).
type CreateWebhookResponse struct {
	Object        string `json:"object"`
	Id            string `json:"id"`
	SigningSecret string `json:"signing_secret"`
}

// UpdateWebhookRequest is the payload for PATCH /webhooks/:id.
type UpdateWebhookRequest struct {
	Endpoint string   `json:"endpoint,omitempty"`
	Events   []string `json:"events,omitempty"`
	// Status is "enabled" | "disabled".
	Status string `json:"status,omitempty"`
}

// WebhookTestResult is the endpoint's live result from a synchronous test
// delivery.
//
// A failed delivery still comes back as HTTP 200 — inspect Ok, not the error
// return of Webhooks.Test.
type WebhookTestResult struct {
	Object string `json:"object"`
	Id     string `json:"id"`
	// Ok reports whether the endpoint accepted the test delivery.
	Ok bool `json:"ok"`
	// Status is the HTTP status the endpoint returned (0 when Ok is false).
	Status int `json:"status,omitempty"`
	// Error is the failure reason when Ok is false, e.g. "lookup_failed".
	Error string `json:"error,omitempty"`
}

// VerifyWebhookResult is the outcome of verifying a webhook delivery signature.
type VerifyWebhookResult struct {
	// Valid is true when the signature matches and (when checked) the
	// timestamp is fresh.
	Valid bool
	// Reason is a machine reason when Valid is false (e.g. "missing_headers",
	// "no_match").
	Reason string
}

// VerifyWebhookOptions configures VerifyWebhookSignature.
type VerifyWebhookOptions struct {
	// ToleranceSec is the max allowed clock skew in seconds. 0 means the
	// default of 300; a negative value skips the timestamp check entirely.
	ToleranceSec int
}

// WebhooksService handles the /webhooks endpoints.
type WebhooksService struct {
	client *Client
}

// Create creates a webhook. The signing secret is shown ONCE, only here.
// POST /webhooks
func (s *WebhooksService) Create(params *CreateWebhookRequest) (*CreateWebhookResponse, error) {
	return s.CreateWithContext(context.Background(), params)
}

// CreateWithContext creates a webhook. POST /webhooks
func (s *WebhooksService) CreateWithContext(ctx context.Context, params *CreateWebhookRequest) (*CreateWebhookResponse, error) {
	return request[CreateWebhookResponse](ctx, s.client, http.MethodPost, "/webhooks", params, nil)
}

// Get retrieves a webhook. GET /webhooks/:id
func (s *WebhooksService) Get(id string) (*Webhook, error) {
	return s.GetWithContext(context.Background(), id)
}

// GetWithContext retrieves a webhook. GET /webhooks/:id
func (s *WebhooksService) GetWithContext(ctx context.Context, id string) (*Webhook, error) {
	return request[Webhook](ctx, s.client, http.MethodGet, "/webhooks/"+esc(id), nil, nil)
}

// List lists webhooks. GET /webhooks
func (s *WebhooksService) List(params *ListParams) (*ListResponse[Webhook], error) {
	return s.ListWithContext(context.Background(), params)
}

// ListWithContext lists webhooks. GET /webhooks
func (s *WebhooksService) ListWithContext(ctx context.Context, params *ListParams) (*ListResponse[Webhook], error) {
	return request[ListResponse[Webhook]](ctx, s.client, http.MethodGet, listPath("/webhooks", params), nil, nil)
}

// Update updates a webhook; returns the slim ack { object, id }.
// PATCH /webhooks/:id
func (s *WebhooksService) Update(id string, params *UpdateWebhookRequest) (*ObjectRef, error) {
	return s.UpdateWithContext(context.Background(), id, params)
}

// UpdateWithContext updates a webhook. PATCH /webhooks/:id
func (s *WebhooksService) UpdateWithContext(ctx context.Context, id string, params *UpdateWebhookRequest) (*ObjectRef, error) {
	return request[ObjectRef](ctx, s.client, http.MethodPatch, "/webhooks/"+esc(id), params, nil)
}

// Rotate rotates the signing secret. The new plaintext SigningSecret is
// returned ONCE (reveal-once); the old secret stops verifying immediately.
// POST /webhooks/:id/rotate
func (s *WebhooksService) Rotate(id string) (*CreateWebhookResponse, error) {
	return s.RotateWithContext(context.Background(), id)
}

// RotateWithContext rotates the signing secret. POST /webhooks/:id/rotate
func (s *WebhooksService) RotateWithContext(ctx context.Context, id string) (*CreateWebhookResponse, error) {
	return request[CreateWebhookResponse](ctx, s.client, http.MethodPost, "/webhooks/"+esc(id)+"/rotate", nil, nil)
}

// Test sends a synchronous test delivery and returns the endpoint's live
// result. A failed delivery is still HTTP 200 — check the result's Ok field.
// POST /webhooks/:id/test
func (s *WebhooksService) Test(id string) (*WebhookTestResult, error) {
	return s.TestWithContext(context.Background(), id)
}

// TestWithContext sends a synchronous test delivery. POST /webhooks/:id/test
func (s *WebhooksService) TestWithContext(ctx context.Context, id string) (*WebhookTestResult, error) {
	return request[WebhookTestResult](ctx, s.client, http.MethodPost, "/webhooks/"+esc(id)+"/test", nil, nil)
}

// Remove deletes a webhook. DELETE /webhooks/:id
func (s *WebhooksService) Remove(id string) (*RemovedResponse, error) {
	return s.RemoveWithContext(context.Background(), id)
}

// RemoveWithContext deletes a webhook. DELETE /webhooks/:id
func (s *WebhooksService) RemoveWithContext(ctx context.Context, id string) (*RemovedResponse, error) {
	return request[RemovedResponse](ctx, s.client, http.MethodDelete, "/webhooks/"+esc(id), nil, nil)
}

// Verify verifies a webhook delivery's Svix-style signature against your
// endpoint's signing secret. See VerifyWebhookSignature — this is a pure
// local computation, no HTTP request is made.
func (s *WebhooksService) Verify(payload []byte, headers http.Header, secret string, opts *VerifyWebhookOptions) VerifyWebhookResult {
	return VerifyWebhookSignature(payload, headers, secret, opts)
}

// b64Alphabet is standard base64 (RFC 4648 §4). lenientB64 maps the URL-safe
// '-'/'_' onto '+'/'/' before testing membership, so both spellings decode.
const b64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

// maskedUnits reproduces the FIRST thing Node's base64 decoder does to a
// string: it walks the value as UTF-16 code units and keeps only the low 8
// bits of each one, before any alphabet lookup happens. The masking is not a
// detail of the lookup — it changes which characters exist. U+0141 'Ł' masks
// to 0x41 'A' and contributes six bits of data; U+013D 'Ľ' masks to 0x3D '='
// and TERMINATES the value, truncating the key. Go strings are UTF-8 and
// range-ing one yields codepoints, so the conversion to code units has to be
// explicit: an astral character such as U+1D441 '𝑁' contributes its two
// surrogate halves 0xD835/0xDC41 — masking to '5' and 'A' — and NOT its four
// UTF-8 bytes, which would decode to something else entirely. Getting this
// wrong is silent: the derived key merely differs from the signer's, so
// verification answers no_match and a correctly configured endpoint rejects
// every genuine delivery as forged.
func maskedUnits(s string) []byte {
	units := utf16.Encode([]rune(s))
	out := make([]byte, len(units))
	for i, u := range units {
		out[i] = byte(u) // low 8 bits; the rest of the code unit is discarded
	}
	return out
}

// lenientB64 decodes base64 the way the signer does, not the way Go does.
//
// The backend derives its key with Node's Buffer.from(suffix, "base64")
// (sendping_webapp/lib/crypto.ts secretToKey), which is LENIENT: it stops at
// the first '=', ignores every other character outside the alphabet, accepts
// the URL-safe '-'/'_' spellings, needs no padding, and drops a lone trailing
// character that encodes no whole byte. base64.StdEncoding does none of that —
// it rejects any length that is not a multiple of four and rejects '-'/'_'
// outright. A caller-supplied secret (the optional `secret` field on POST
// /webhooks, the path you take when mirroring a signing secret from another
// provider) that is unpadded or URL-safe therefore derived a DIFFERENT key here
// than at the signer, and secretToKey's err == nil guard then fell through to
// the raw string INCLUDING the "whsec_" prefix — so every genuinely signed
// delivery came back {Valid: false, Reason: "no_match"} and the handler 401'd
// real SendPing events. Node, python (_b64_lenient) and php are all lenient;
// this reproduces them byte for byte.
//
// Everything below operates on maskedUnits(s), never on s itself, because the
// UTF-16 low-byte mask has to run BEFORE these rules see the input: 'Ľ' only
// terminates the value once it has become '=', and 'Ł' only carries data once
// it has become 'A'. Splitting on '=' in the original string first would miss
// both.
func lenientB64(s string) []byte {
	masked := maskedUnits(s)
	if i := bytes.IndexByte(masked, '='); i >= 0 {
		masked = masked[:i] // Node's decoder treats '=' as a terminator, not as padding to skip
	}
	cleaned := make([]byte, 0, len(masked))
	for _, c := range masked {
		switch {
		case c == '-':
			c = '+'
		case c == '_':
			c = '/'
		}
		if strings.IndexByte(b64Alphabet, c) >= 0 {
			cleaned = append(cleaned, c)
		}
		// whitespace, punctuation, anything else: ignored, not fatal
	}
	if len(cleaned)%4 == 1 {
		cleaned = cleaned[:len(cleaned)-1] // a single leftover character encodes no byte
	}
	raw, err := base64.RawStdEncoding.DecodeString(string(cleaned))
	if err != nil {
		return nil // unreachable: cleaned is alphabet-only and never length%4 == 1
	}
	return raw
}

// secretToKey derives the HMAC key from a "whsec_"-prefixed secret
// (base64-decodes the suffix leniently, exactly as the signer does — see
// lenientB64); a secret without the prefix, or one whose suffix decodes to
// nothing, is used as raw UTF-8 bytes.
//
// The fallback takes the WHOLE secret, "whsec_" prefix included, and its real
// UTF-8 bytes — lenientB64's UTF-16 low-byte masking applies only inside the
// decoder. "whsec_中文" decodes to nothing (both code units mask outside the
// alphabet) and keys on the 12 bytes of "whsec_中文", not on the two masked
// ones.
func secretToKey(secret string) []byte {
	if suffix, ok := strings.CutPrefix(secret, "whsec_"); ok {
		if raw := lenientB64(suffix); len(raw) > 0 {
			return raw
		}
	}
	return []byte(secret)
}

// VerifyWebhookSignature verifies a SendPing webhook delivery's Svix-style
// signature ("<id>.<timestamp>.<body>" -> base64 HMAC-SHA256, tagged "v1,").
//
// payload MUST be the exact raw request body the server sent (do not
// re-serialize the parsed JSON — whitespace differences break the signature).
// headers is typically r.Header from your handler; the svix-id,
// svix-timestamp, and svix-signature headers are read case-insensitively. A
// header may carry multiple space-separated signatures; any one matching
// makes the delivery valid.
//
// The timestamp freshness check defaults to a 5-minute tolerance; pass
// &VerifyWebhookOptions{ToleranceSec: -1} to skip it. This is a pure local
// computation — it makes no HTTP request.
func VerifyWebhookSignature(payload []byte, headers http.Header, secret string, opts *VerifyWebhookOptions) VerifyWebhookResult {
	id := headers.Get("svix-id")
	timestamp := headers.Get("svix-timestamp")
	sigHeader := headers.Get("svix-signature")
	if id == "" || timestamp == "" || sigHeader == "" {
		return VerifyWebhookResult{Valid: false, Reason: "missing_headers"}
	}
	if secret == "" {
		return VerifyWebhookResult{Valid: false, Reason: "missing_secret"}
	}

	// Optional timestamp freshness check (default 5-minute tolerance;
	// negative disables).
	toleranceSec := 300
	if opts != nil && opts.ToleranceSec != 0 {
		toleranceSec = opts.ToleranceSec
	}
	if toleranceSec > 0 {
		ts, err := strconv.ParseInt(timestamp, 10, 64)
		if err != nil {
			return VerifyWebhookResult{Valid: false, Reason: "invalid_timestamp"}
		}
		skew := time.Now().Unix() - ts
		if skew < 0 {
			skew = -skew
		}
		if skew > int64(toleranceSec) {
			return VerifyWebhookResult{Valid: false, Reason: "timestamp_out_of_tolerance"}
		}
	}

	mac := hmac.New(sha256.New, secretToKey(secret))
	mac.Write([]byte(id + "." + timestamp + "."))
	mac.Write(payload)
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	// The header may contain multiple space-separated "v1,<sig>" entries; any
	// match wins.
	for _, part := range strings.Fields(sigHeader) {
		sig := strings.TrimPrefix(part, "v1,")
		if hmac.Equal([]byte(sig), []byte(expected)) {
			return VerifyWebhookResult{Valid: true}
		}
	}
	return VerifyWebhookResult{Valid: false, Reason: "no_match"}
}

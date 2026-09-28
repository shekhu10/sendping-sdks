package sendping

import (
	"context"
	"net/http"
)

// ApiKey is an API key as returned by ApiKeys.List (GET /api-keys).
type ApiKey struct {
	// Id is a string-encoded integer.
	Id string `json:"id"`
	// Object is omitted on list rows.
	Object string `json:"object,omitempty"`
	Name   string `json:"name"`
	// Token is the non-secret 8-character display prefix of the key (e.g.
	// "mb_ab12"); empty for legacy keys with no stored prefix. The full secret
	// is shown once, in the dashboard, when the key is created. There is no
	// "mb_live_" prefix.
	Token string `json:"token"`
	// Permission is derived from the key's scopes: "full_access" |
	// "sending_access".
	Permission string `json:"permission"`
	// DomainId is set when the key is scoped to exactly one sending domain
	// (legacy).
	DomainId string `json:"domain_id"`
	// DomainIds lists the domains the key is scoped to; nil when unscoped.
	DomainIds []string `json:"domain_ids"`
	CreatedAt string   `json:"created_at"`
	// LastUsedAt is the last time the key authenticated a request; empty if
	// never used.
	LastUsedAt string `json:"last_used_at"`
}

// ApiKeysService handles the /api-keys endpoints.
//
// This service is deliberately read-only. Creating a key, changing its
// permission or domain scoping, and revoking it are dashboard-only operations:
// the API answers 403 dashboard_only to every api-key-authenticated caller,
// whatever its scopes. That is a security property — a leaked key cannot mint
// itself a replacement, widen its own access, or revoke the keys that would
// have caught it — so the SDK exposes no method for any of it.
type ApiKeysService struct {
	client *Client
}

// List lists API keys (revoked ones excluded), showing only the non-secret
// display prefix of each. Pass nil to get every key — this endpoint only pages
// when you supply pagination params. GET /api-keys
func (s *ApiKeysService) List(params *ListParams) (*ListResponse[ApiKey], error) {
	return s.ListWithContext(context.Background(), params)
}

// ListWithContext lists API keys. GET /api-keys
func (s *ApiKeysService) ListWithContext(ctx context.Context, params *ListParams) (*ListResponse[ApiKey], error) {
	return request[ListResponse[ApiKey]](ctx, s.client, http.MethodGet, listPath("/api-keys", params), nil, nil)
}

package sendping

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

const testAPIKey = "mb_test_key"

// newTestClient spins up an httptest server and points a client at it.
func newTestClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	c := NewClient(testAPIKey)
	c.BaseURL = srv.URL
	return c
}

// decodeBody unmarshals the request body into a map for assertions.
func decodeBody(t *testing.T, r *http.Request) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		t.Fatalf("decode request body: %v", err)
	}
	return body
}

func assertAuth(t *testing.T, r *http.Request) {
	t.Helper()
	if got := r.Header.Get("Authorization"); got != "Bearer "+testAPIKey {
		t.Errorf("Authorization = %q, want %q", got, "Bearer "+testAPIKey)
	}
}

// The API rejects any request to a resource route without a non-empty
// User-Agent with a 403 validation_error, before authentication — so the SDK
// must always send one.
func TestUserAgentAlwaysSent(t *testing.T) {
	var gotUA []string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotUA = append(gotUA, r.Header.Get("User-Agent"))
		w.Write([]byte(`{"object":"list","has_more":false,"data":[]}`))
	})

	if _, err := client.Emails.List(nil); err != nil {
		t.Fatalf("List: %v", err)
	}
	// Bodyless and raw/binary paths go through the same chokepoint.
	if _, err := client.Emails.Receiving.GetRaw("rcv_1"); err != nil {
		t.Fatalf("GetRaw: %v", err)
	}

	want := "sendping-go/" + Version
	for i, ua := range gotUA {
		if ua != want {
			t.Errorf("request %d User-Agent = %q, want %q", i, ua, want)
		}
	}
	if len(gotUA) != 2 {
		t.Fatalf("saw %d requests, want 2", len(gotUA))
	}
}

// UserAgent is an exported, mutable field. net/http omits the header entirely
// when its value is "", which would make every request a 403 validation_error
// — so a blank override falls back to the default rather than disabling a
// header the API requires.
func TestBlankUserAgentFallsBackToDefault(t *testing.T) {
	var gotUA string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotUA = r.Header.Get("User-Agent")
		w.Write([]byte(`{"object":"list","has_more":false,"data":[]}`))
	})

	for _, override := range []string{"", "   "} {
		client.UserAgent = override
		if _, err := client.Emails.List(nil); err != nil {
			t.Fatalf("List: %v", err)
		}
		if want := "sendping-go/" + Version; gotUA != want {
			t.Errorf("UserAgent = %q sent %q, want %q", override, gotUA, want)
		}
	}

	// A real override is still honoured verbatim.
	client.UserAgent = "acme-app/2.1 (+https://acme.example)"
	if _, err := client.Emails.List(nil); err != nil {
		t.Fatalf("List: %v", err)
	}
	if gotUA != "acme-app/2.1 (+https://acme.example)" {
		t.Errorf("custom User-Agent = %q, want it sent verbatim", gotUA)
	}
}

func TestErrorParsing(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		w.Write([]byte(`{"statusCode":422,"name":"validation_error","message":"domain is required"}`))
	})

	_, err := client.Segments.Create(&CreateSegmentRequest{Name: "VIP"})
	if err == nil {
		t.Fatal("expected an error, got nil")
	}
	var apiErr *SendPingError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *SendPingError, got %T: %v", err, err)
	}
	if apiErr.StatusCode != 422 {
		t.Errorf("StatusCode = %d, want 422", apiErr.StatusCode)
	}
	if apiErr.Name != "validation_error" {
		t.Errorf("Name = %q, want validation_error", apiErr.Name)
	}
	if apiErr.Message != "domain is required" {
		t.Errorf("Message = %q, want %q", apiErr.Message, "domain is required")
	}
}

func TestErrorParsingNonJSONBody(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		w.Write([]byte("Bad Gateway"))
	})

	_, err := client.Emails.Get("em_1")
	var apiErr *SendPingError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *SendPingError, got %T: %v", err, err)
	}
	if apiErr.StatusCode != 502 {
		t.Errorf("StatusCode = %d, want 502", apiErr.StatusCode)
	}
	if apiErr.Name != "application_error" {
		t.Errorf("Name = %q, want application_error", apiErr.Name)
	}
}

// A plan/quota rejection is a superset of the envelope: the `limit` object
// says WHICH allowance ran out. Without it a caller cannot tell a daily cap
// from a monthly one.
func TestErrorCarriesPlanLimitDetail(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"statusCode":429,"name":"daily_quota_exceeded",` +
			`"message":"Daily send limit reached.","limit":{"kind":"emails_daily",` +
			`"used":100,"limit":100,"requested":3,"remaining":0,"period":"24h",` +
			`"plan":{"id":"free","name":"Free"},"next_plan":{"id":"pro","name":"Pro",` +
			`"amount":1400,"currency":"USD","monthly_emails":50000,"daily_emails":2000,` +
			`"domains":10,"contacts":10000,"ai_credits":100,"automation_runs":10000},` +
			`"credits":{"balance":0,"needed":1,"purchasable":true,"unit":1000,` +
			`"amount_per_unit_cents":100}}}`))
	})
	// No retry budget: the 429 here is the assertion subject, not a
	// transient the client should sit through.
	client.MaxRetries = 0

	_, err := client.Emails.Send(&SendEmailRequest{From: "a@b.com", To: []string{"c@d.com"}, Subject: "x"})
	var apiErr *SendPingError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *SendPingError, got %T: %v", err, err)
	}
	if apiErr.Limit == nil {
		t.Fatal("Limit = nil, want the additive limit object")
	}
	if apiErr.Limit.Kind != LimitKindEmailsDaily {
		t.Errorf("Limit.Kind = %q, want %q", apiErr.Limit.Kind, LimitKindEmailsDaily)
	}
	if apiErr.Limit.Used != 100 || apiErr.Limit.Limit != 100 || apiErr.Limit.Requested != 3 {
		t.Errorf("Limit = %+v, want used/limit 100 and requested 3", apiErr.Limit)
	}
	if apiErr.Limit.Period != "24h" {
		t.Errorf("Limit.Period = %q, want 24h", apiErr.Limit.Period)
	}
	if apiErr.Limit.Plan.Id != "free" {
		t.Errorf("Limit.Plan.Id = %q, want free", apiErr.Limit.Plan.Id)
	}
	if apiErr.Limit.NextPlan == nil || apiErr.Limit.NextPlan.Id != "pro" || apiErr.Limit.NextPlan.Amount != 1400 {
		t.Errorf("Limit.NextPlan = %+v, want pro/1400", apiErr.Limit.NextPlan)
	}
	if apiErr.Limit.Credits == nil || !apiErr.Limit.Credits.Purchasable || apiErr.Limit.Credits.Unit != 1000 {
		t.Errorf("Limit.Credits = %+v, want purchasable packs of 1000", apiErr.Limit.Credits)
	}
	// The other extras stay absent.
	if apiErr.Reputation != nil || apiErr.SentCount != 0 {
		t.Errorf("unrelated extras set: reputation=%+v sentCount=%d", apiErr.Reputation, apiErr.SentCount)
	}
}

// next_plan is JSON null when only Enterprise fits; that must decode as a nil
// pointer, not a zero-valued plan a caller would read as "$0 upgrade".
func TestErrorPlanLimitNullNextPlan(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusPaymentRequired)
		w.Write([]byte(`{"statusCode":402,"name":"plan_limit_reached","message":"Domain limit reached.",` +
			`"limit":{"kind":"domains","used":1,"limit":1,"requested":2,"remaining":0,` +
			`"plan":{"id":"free","name":"Free"},"next_plan":null}}`))
	})

	_, err := client.Domains.Create(&CreateDomainRequest{Name: "example.com"})
	var apiErr *SendPingError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *SendPingError, got %T: %v", err, err)
	}
	if apiErr.StatusCode != 402 {
		t.Errorf("StatusCode = %d, want 402", apiErr.StatusCode)
	}
	if apiErr.Limit == nil || apiErr.Limit.Kind != LimitKindDomains {
		t.Fatalf("Limit = %+v, want kind domains", apiErr.Limit)
	}
	if apiErr.Limit.NextPlan != nil {
		t.Errorf("Limit.NextPlan = %+v, want nil for a null next_plan", apiErr.Limit.NextPlan)
	}
	// Not an email-quota kind, so no credits block and no window.
	if apiErr.Limit.Credits != nil || apiErr.Limit.Period != "" {
		t.Errorf("Limit = %+v, want no credits and no period", apiErr.Limit)
	}
}

// Reputation gates carry a `reputation` object saying what was paused and
// whether waiting helps.
func TestErrorCarriesReputationDetail(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"statusCode":429,"name":"reputation_limit_exceeded","message":"Warm-up capacity reached.",` +
			`"reputation":{"retryable":true,"scope":"domain","status":"warming","scope_key":"example.com",` +
			`"hourly_limit":50,"daily_limit":500,"hourly_used":50,"daily_used":120,` +
			`"retry_at":"2026-08-08T10:00:00.000Z","support_email":"support@sendping.co"}}`))
	})
	// No retry budget: the 429 here is the assertion subject, not a
	// transient the client should sit through.
	client.MaxRetries = 0

	_, err := client.Emails.Send(&SendEmailRequest{From: "a@b.com", To: []string{"c@d.com"}, Subject: "x"})
	var apiErr *SendPingError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *SendPingError, got %T: %v", err, err)
	}
	if apiErr.Reputation == nil {
		t.Fatal("Reputation = nil, want the additive reputation object")
	}
	if !apiErr.Reputation.Retryable {
		t.Error("Reputation.Retryable = false, want true")
	}
	if apiErr.Reputation.Scope != ReputationScopeDomain || apiErr.Reputation.ScopeKey != "example.com" {
		t.Errorf("Reputation scope = %q/%q, want domain/example.com", apiErr.Reputation.Scope, apiErr.Reputation.ScopeKey)
	}
	if apiErr.Reputation.HourlyLimit != 50 || apiErr.Reputation.DailyUsed != 120 {
		t.Errorf("Reputation = %+v, want hourly_limit 50 and daily_used 120", apiErr.Reputation)
	}
	if apiErr.Reputation.RetryAt == "" {
		t.Error("Reputation.RetryAt is empty, want the resume timestamp")
	}
	if apiErr.Limit != nil {
		t.Errorf("Limit = %+v, want nil on a reputation error", apiErr.Limit)
	}
}

// A batch that fails part way through (with an Idempotency-Key) reports the
// emails that DID go out, so a retry does not send them twice.
func TestErrorCarriesPartialBatchSent(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Idempotency-Key"); got != "batch-1" {
			t.Errorf("Idempotency-Key = %q, want batch-1", got)
		}
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"statusCode":429,"name":"daily_quota_exceeded","message":"Daily send limit reached.",` +
			`"limit":{"kind":"emails_daily","used":100,"limit":100,"plan":{"id":"free","name":"Free"}},` +
			`"sent":[{"id":"em_1"},{"id":"em_2"}],"sent_count":2}`))
	})
	// No retry budget: the 429 here is the assertion subject, not a
	// transient the client should sit through.
	client.MaxRetries = 0

	_, err := client.Batch.SendEmailsWithOptions(
		context.Background(),
		[]*BatchEmailRequest{{From: "a@b.com", To: []string{"c@d.com"}, Subject: "x"}},
		&RequestOptions{IdempotencyKey: "batch-1"},
	)
	var apiErr *SendPingError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *SendPingError, got %T: %v", err, err)
	}
	if apiErr.SentCount != 2 {
		t.Errorf("SentCount = %d, want 2", apiErr.SentCount)
	}
	if len(apiErr.Sent) != 2 || apiErr.Sent[0].Id != "em_1" || apiErr.Sent[1].Id != "em_2" {
		t.Errorf("Sent = %+v, want em_1 and em_2", apiErr.Sent)
	}
	if apiErr.Limit == nil || apiErr.Limit.Kind != LimitKindEmailsDaily {
		t.Errorf("Limit = %+v, want the quota that stopped the batch", apiErr.Limit)
	}
}

// sent_count is derived from `sent` when the server omits it, so callers can
// always trust SentCount.
func TestErrorPartialBatchSentCountFallsBackToLen(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		w.Write([]byte(`{"statusCode":422,"name":"validation_error","message":"bad item",` +
			`"sent":[{"id":"em_1"}]}`))
	})

	_, err := client.Batch.SendEmails([]*BatchEmailRequest{{From: "a@b.com", To: []string{"c@d.com"}, Subject: "x"}})
	var apiErr *SendPingError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *SendPingError, got %T: %v", err, err)
	}
	if apiErr.SentCount != 1 {
		t.Errorf("SentCount = %d, want 1 derived from Sent", apiErr.SentCount)
	}
}

// An ordinary error carries none of the extras, and the raw body stays
// reachable for fields this version does not model.
func TestErrorExtrasAbsentOnOrdinaryError(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"statusCode":404,"name":"not_found","message":"Email not found.","future_field":"kept"}`))
	})

	_, err := client.Emails.Get("em_1")
	var apiErr *SendPingError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *SendPingError, got %T: %v", err, err)
	}
	if apiErr.Limit != nil || apiErr.Reputation != nil || apiErr.Sent != nil || apiErr.SentCount != 0 {
		t.Errorf("extras set on an ordinary error: %+v", apiErr)
	}
	if got, _ := apiErr.Body["future_field"].(string); got != "kept" {
		t.Errorf("Body[future_field] = %v, want the unmodeled field preserved", apiErr.Body["future_field"])
	}
}

// An additive field in a shape this SDK version does not expect must cost the
// caller that field only — never the envelope, and never the other extras.
func TestErrorUnexpectedExtraShapeKeepsTheEnvelope(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		w.Write([]byte(`{"statusCode":422,"name":"validation_error","message":"bad item",` +
			`"limit":"not-an-object","sent":[{"id":"em_1"}]}`))
	})

	_, err := client.Emails.Get("em_1")
	var apiErr *SendPingError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *SendPingError, got %T: %v", err, err)
	}
	if apiErr.StatusCode != 422 || apiErr.Name != "validation_error" || apiErr.Message != "bad item" {
		t.Errorf("envelope lost to a malformed extra: %+v", apiErr)
	}
	if apiErr.Limit != nil {
		t.Errorf("Limit = %+v, want nil for an unparseable limit", apiErr.Limit)
	}
	if apiErr.SentCount != 1 {
		t.Errorf("SentCount = %d, want 1 — a bad `limit` must not drop `sent`", apiErr.SentCount)
	}
}

func TestRetryOn429(t *testing.T) {
	var calls atomic.Int32
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			// Retry-After: 0 makes the retry immediate (keeps the test fast)
			// and exercises the Retry-After delta-seconds path.
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"statusCode":429,"name":"rate_limited","message":"slow down"}`))
			return
		}
		w.Write([]byte(`{"object":"email","id":"em_1"}`))
	})

	email, err := client.Emails.Get("em_1")
	if err != nil {
		t.Fatalf("Get after retry: %v", err)
	}
	if got := calls.Load(); got != 2 {
		t.Errorf("server calls = %d, want 2 (one 429 then a successful retry)", got)
	}
	if email == nil || email.Id != "em_1" {
		t.Errorf("email = %+v, want id em_1 from the retried response", email)
	}
}

func TestNoRetryOn500(t *testing.T) {
	var calls atomic.Int32
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"statusCode":500,"name":"server_error","message":"boom"}`))
	})

	if _, err := client.Emails.Get("em_1"); err == nil {
		t.Fatal("expected an error on 500")
	}
	if got := calls.Load(); got != 1 {
		t.Errorf("server calls = %d, want 1 (500 is not retryable)", got)
	}
}

func TestPathEscaping(t *testing.T) {
	var gotPath string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.EscapedPath()
		w.Write([]byte(`{"object":"email","id":"x"}`))
	})

	if _, err := client.Emails.Get("../api-keys"); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if gotPath != "/emails/..%2Fapi-keys" {
		t.Errorf("path = %q, want escaped id (no traversal)", gotPath)
	}
}

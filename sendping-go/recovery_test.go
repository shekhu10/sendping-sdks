package sendping

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"
)

func TestRecoveryCorpus(t *testing.T) {
	var cases []struct {
		Name, Method, Path, Key string
		Status, Attempts        int
		Body                    json.RawMessage
	}
	data, err := os.ReadFile("testdata/http-recovery-corpus.json")
	if err != nil {
		t.Fatal(err)
	}
	if shared, e := os.ReadFile("../scripts/http-recovery-corpus.json"); e == nil && string(shared) != string(data) {
		t.Fatal("refresh testdata/http-recovery-corpus.json from scripts/http-recovery-corpus.json")
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			calls := 0
			client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				calls++
				if c.Key != "" && r.Header.Get("Idempotency-Key") != c.Key {
					t.Error("operation key changed")
				}
				w.Header().Set("Retry-After", "0")
				if calls == 1 {
					w.WriteHeader(c.Status)
					w.Write(c.Body)
				} else {
					w.Write([]byte(`{"id":"em_retry"}`))
				}
			})
			_, err := request[IdResponse](context.Background(), client, c.Method, c.Path, map[string]string{"text": "a  b\n\n c"}, &RequestOptions{IdempotencyKey: c.Key})
			if calls != c.Attempts {
				t.Fatalf("attempts=%d, want %d", calls, c.Attempts)
			}
			if c.Attempts == 1 {
				var apiErr *SendPingError
				if !errors.As(err, &apiErr) || apiErr.StatusCode != c.Status {
					t.Fatalf("lost original error: %v", err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCanceledBackoffReturnsPromptly(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "0.5")
		w.WriteHeader(429)
		w.Write([]byte(`{}`))
	})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err := client.Emails.GetWithContext(ctx, "em_one")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected caller deadline, got %v", err)
	}
	if time.Since(started) > 300*time.Millisecond {
		t.Fatal("caller cancellation waited for Retry-After")
	}
}

func TestDefaultClientRefusesRedirects(t *testing.T) {
	var redirected atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirected.Add(1)
		io.Copy(io.Discard, r.Body)
		w.Write([]byte(`{"id":"redirected"}`))
	}))
	defer target.Close()
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		w.Header().Set("Location", target.URL)
		w.WriteHeader(307)
	})
	_, err := client.Emails.Send(&SendEmailRequest{From: "from@domain.test", To: []string{"to@domain.test"}, Subject: "private", Text: "private body"})
	var apiErr *SendPingError
	if !errors.As(err, &apiErr) || apiErr.StatusCode != 307 || redirected.Load() != 0 {
		t.Fatalf("redirect followed: %v; target requests %d", err, redirected.Load())
	}
}

func TestRecoveryMetadataUsesTransportStatus(t *testing.T) {
	err := parseAPIError(422, []byte(`{"statusCode":503,"name":"validation_error","id":"em_unknown","reserved":[{"id":"em_unknown"}],"unsent_count":0,"future":{"kept":true}}`))
	if err.StatusCode != 422 || err.Id != "em_unknown" || len(err.Reserved) != 1 || err.UnsentCount == nil || *err.UnsentCount != 0 || err.Body["future"] == nil {
		t.Fatalf("lost recovery information: %+v", err)
	}
}

func TestReplyForwardKeysAndTrackingHealth(t *testing.T) {
	calls := 0
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method == http.MethodPost {
			if r.Header.Get("Idempotency-Key") != "operation-1" {
				t.Error("missing operation key")
			}
			w.Write([]byte(`{"object":"email","id":"em_one"}`))
			return
		}
		if r.URL.Path != "/domains/domain one/tracking-health" {
			t.Errorf("wrong health path: %s", r.URL.Path)
		}
		w.Write([]byte(`{"custom_host":null,"status":"shared","checked_at":"2026-09-10T00:00:00Z"}`))
	})
	opts := &RequestOptions{IdempotencyKey: "operation-1"}
	if _, err := client.Emails.Receiving.ReplyWithOptions(context.Background(), "rcv_one", &ReplyReceivedEmailRequest{}, opts); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Emails.Receiving.ForwardWithOptions(context.Background(), "rcv_one", &ForwardReceivedEmailRequest{}, opts); err != nil {
		t.Fatal(err)
	}
	health, err := client.Domains.TrackingHealth("domain one")
	if err != nil || health.Status != "shared" || health.CustomHost != nil || calls != 3 {
		t.Fatalf("health mapping failed: %+v %v", health, err)
	}
}

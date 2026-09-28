package sendping

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestEmailsSend(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/emails" {
			t.Errorf("path = %s, want /emails", r.URL.Path)
		}
		assertAuth(t, r)
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q, want application/json", ct)
		}
		body := decodeBody(t, r)
		if body["from"] != "Acme <hello@yourdomain.com>" {
			t.Errorf("from = %v", body["from"])
		}
		to, ok := body["to"].([]any)
		if !ok || len(to) != 1 || to[0] != "user@example.com" {
			t.Errorf("to = %v", body["to"])
		}
		if body["subject"] != "Hello" {
			t.Errorf("subject = %v", body["subject"])
		}
		if body["html"] != "<p>Hi</p>" {
			t.Errorf("html = %v", body["html"])
		}
		if _, present := body["text"]; present {
			t.Error("empty text should be omitted from the body")
		}
		w.Write([]byte(`{"id":"em_123"}`))
	})

	sent, err := client.Emails.Send(&SendEmailRequest{
		From:    "Acme <hello@yourdomain.com>",
		To:      []string{"user@example.com"},
		Subject: "Hello",
		Html:    "<p>Hi</p>",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if sent.Id != "em_123" {
		t.Errorf("Id = %q, want em_123", sent.Id)
	}
}

func TestEmailsSendWithOptionsIdempotencyKey(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Idempotency-Key"); got != "order-123" {
			t.Errorf("Idempotency-Key = %q, want order-123", got)
		}
		w.Write([]byte(`{"id":"em_1"}`))
	})

	_, err := client.Emails.SendWithOptions(context.Background(),
		&SendEmailRequest{From: "a@b.com", To: []string{"c@d.com"}, Subject: "s", Text: "t"},
		&RequestOptions{IdempotencyKey: "order-123"})
	if err != nil {
		t.Fatalf("SendWithOptions: %v", err)
	}
}

// The documented bound is 1-255 characters, measured AFTER the server trims
// the value (api_idempotency.key is VARCHAR(255)) — 255, not 256. The constant
// is exported so the rule is discoverable; the key itself is sent verbatim and
// the SERVER answers an out-of-range one with 400 invalid_idempotency_key, so
// this package never pre-checks it.
func TestIdempotencyKeyIsSentVerbatimAndBoundedByTheServer(t *testing.T) {
	if IdempotencyKeyMaxLen != 255 {
		t.Fatalf("IdempotencyKeyMaxLen = %d, want 255", IdempotencyKeyMaxLen)
	}

	tooLong := strings.Repeat("k", IdempotencyKeyMaxLen+1)
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Idempotency-Key"); got != tooLong {
			t.Errorf("Idempotency-Key length = %d, want %d (sent verbatim)", len(got), len(tooLong))
		}
		w.Write([]byte(`{"id":"em_1"}`))
	})

	_, err := client.Emails.SendWithOptions(context.Background(),
		&SendEmailRequest{From: "a@b.com", To: []string{"c@d.com"}, Subject: "s", Text: "t"},
		&RequestOptions{IdempotencyKey: tooLong})
	if err != nil {
		t.Fatalf("the SDK must not reject the key locally: %v", err)
	}
}

func TestEmailsListPagination(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if r.URL.Path != "/emails" {
			t.Errorf("path = %s, want /emails", r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("limit") != "20" || q.Get("after") != "em_9" {
			t.Errorf("query = %v", q)
		}
		w.Write([]byte(`{"object":"list","has_more":true,"data":[{"object":"email","id":"em_10","from":"a@b.com","to":["c@d.com"],"subject":"s","last_event":"delivered","created_at":"2026-07-06T00:00:00Z"}]}`))
	})

	list, err := client.Emails.List(&ListParams{Limit: 20, After: "em_9"})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if !list.HasMore || len(list.Data) != 1 || list.Data[0].Id != "em_10" {
		t.Errorf("unexpected list: %+v", list)
	}
}

func TestEmailsListFilteredStatusAndSearch(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("status") != "bounced" {
			t.Errorf("status = %q, want bounced", q.Get("status"))
		}
		if q.Get("search") != "invoice" {
			t.Errorf("search = %q, want invoice", q.Get("search"))
		}
		if q.Get("domain_id") != "dom_1" || q.Get("campaign_id") != "cmp_1" {
			t.Errorf("query = %v", q)
		}
		// Asserted against the literal so the EmailFolderSent constant is
		// pinned to the wire value.
		if q.Get("folder") != "sent" {
			t.Errorf("folder = %q, want sent", q.Get("folder"))
		}
		w.Write([]byte(`{"object":"list","has_more":false,"data":[{"object":"email","id":"em_1","domain_id":"dom_1","campaign_id":"cmp_1","automation_id":null,"last_event":"bounced","to":["a@b.com"],"from":"c@d.com","subject":"invoice","created_at":"2026-08-08T00:00:00Z"}]}`))
	})

	list, err := client.Emails.ListFiltered(&ListEmailsRequest{
		Status:     "bounced",
		Search:     "invoice",
		DomainId:   "dom_1",
		CampaignId: "cmp_1",
		Folder:     EmailFolderSent,
	})
	if err != nil {
		t.Fatalf("ListFiltered: %v", err)
	}
	got := list.Data[0]
	if got.DomainId != "dom_1" || got.CampaignId != "cmp_1" {
		t.Errorf("origin fields not decoded: %+v", got)
	}
}

func TestEmailsSources(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/emails/sources" {
			t.Errorf("%s %s, want GET /emails/sources", r.Method, r.URL.Path)
		}
		w.Write([]byte(`{"object":"list","has_more":false,"data":[{"kind":"campaign","id":"cmp_1","name":"Launch","subject":"Hi","status":"sent","total":10,"sent":10,"delivered":9,"opened":4,"clicked":1,"replied":0,"failed":0,"last_sent_at":"2026-08-08T10:00:00.000Z"}]}`))
	})

	list, err := client.Emails.Sources()
	if err != nil {
		t.Fatalf("Sources: %v", err)
	}
	src := list.Data[0]
	if src.Kind != "campaign" || src.Delivered != 9 || src.LastSentAt == "" {
		t.Errorf("unexpected source row: %+v", src)
	}
}

func TestReceivingListAddresses(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/emails/receiving/addresses" {
			t.Errorf("path = %s, want /emails/receiving/addresses", r.URL.Path)
		}
		w.Write([]byte(`{"object":"list","has_more":false,"data":[{"address":"hi@x.com","total":12,"replies":3,"interested":1,"last_received_at":"2026-08-08T10:00:00.000Z"}]}`))
	})

	list, err := client.Emails.Receiving.ListAddresses()
	if err != nil {
		t.Fatalf("ListAddresses: %v", err)
	}
	if list.Data[0].Address != "hi@x.com" || list.Data[0].Total != 12 {
		t.Errorf("unexpected row: %+v", list.Data[0])
	}
}

func TestBatchSend(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/emails/batch" {
			t.Errorf("%s %s, want POST /emails/batch", r.Method, r.URL.Path)
		}
		w.Write([]byte(`{"data":[{"id":"em_1"},{"id":"em_2"}]}`))
	})

	res, err := client.Batch.Send([]*SendEmailRequest{
		{From: "a@b.com", To: []string{"x@y.com"}, Subject: "1", Text: "one"},
		{From: "a@b.com", To: []string{"z@y.com"}, Subject: "2", Text: "two"},
	})
	if err != nil {
		t.Fatalf("Batch.Send: %v", err)
	}
	if len(res.Data) != 2 || res.Data[1].Id != "em_2" {
		t.Errorf("unexpected batch response: %+v", res)
	}
}

func TestReceivingGetAttachmentRawBytes(t *testing.T) {
	raw := []byte{0x25, 0x50, 0x44, 0x46} // %PDF
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/emails/receiving/rcv_1/attachments/att_1" {
			t.Errorf("path = %s", r.URL.Path)
		}
		assertAuth(t, r)
		w.Header().Set("Content-Type", "application/pdf")
		w.Write(raw)
	})

	got, err := client.Emails.Receiving.GetAttachment("rcv_1", "att_1")
	if err != nil {
		t.Fatalf("GetAttachment: %v", err)
	}
	if string(got) != string(raw) {
		t.Errorf("bytes = %v, want %v", got, raw)
	}
}

// A send that references a template must OMIT an empty `from`/`subject` so the
// template's own values fill in. The API keys off key PRESENCE
// (lib/send/resolve_template.ts: `body.from != null ? body.from : published.from`),
// so `"from":""` counted as "supplied": the send was rejected with 422
// missing_required_field, and a supplied-from/blank-subject payload went out
// with an EMPTY subject instead of the template's.
func TestTemplateSendOmitsEmptyFromAndSubject(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(t, r)
		if _, present := body["from"]; present {
			t.Errorf("empty from must be omitted for a template send, got %#v", body["from"])
		}
		if _, present := body["subject"]; present {
			t.Errorf("empty subject must be omitted for a template send, got %#v", body["subject"])
		}
		tpl, ok := body["template"].(map[string]any)
		if !ok || tpl["id"] != "tpl_1" {
			t.Errorf("template = %#v", body["template"])
		}
		w.Write([]byte(`{"id":"em_1"}`))
	})

	_, err := client.Emails.Send(&SendEmailRequest{
		To:       []string{"delivered@test.sendping.co"},
		Template: &TemplateRef{Id: "tpl_1", Variables: map[string]any{"name": "Ada"}},
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
}

// The flat `template_id` form gets the same treatment.
func TestTemplateIdSendOmitsEmptyFromAndSubject(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(t, r)
		if _, present := body["from"]; present {
			t.Error("empty from must be omitted when template_id is set")
		}
		if _, present := body["subject"]; present {
			t.Error("empty subject must be omitted when template_id is set")
		}
		if body["template_id"] != "tpl_1" {
			t.Errorf("template_id = %#v", body["template_id"])
		}
		w.Write([]byte(`{"id":"em_1"}`))
	})

	if _, err := client.Emails.Send(&SendEmailRequest{
		To:         []string{"delivered@test.sendping.co"},
		TemplateId: "tpl_1",
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}
}

// An explicit From/Subject still overrides the template's, so both keys are
// present when the caller supplies them.
func TestTemplateSendKeepsExplicitFromAndSubject(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(t, r)
		if body["from"] != "Acme <hello@yourdomain.com>" || body["subject"] != "Override" {
			t.Errorf("from = %#v, subject = %#v", body["from"], body["subject"])
		}
		w.Write([]byte(`{"id":"em_1"}`))
	})

	if _, err := client.Emails.Send(&SendEmailRequest{
		From:       "Acme <hello@yourdomain.com>",
		Subject:    "Override",
		To:         []string{"delivered@test.sendping.co"},
		TemplateId: "tpl_1",
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}
}

// Without a template the two keys are ALWAYS sent, empty included: the API
// documents `subject: ""` as a legal empty subject (only null/absent is
// "missing"), and a missing `from` must still surface as the server's
// missing_required_field rather than being silently reshaped by the SDK.
func TestNonTemplateSendAlwaysSendsFromAndSubject(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(t, r)
		from, hasFrom := body["from"]
		subject, hasSubject := body["subject"]
		if !hasFrom || from != "" {
			t.Errorf("from = %#v (present=%v), want present and empty", from, hasFrom)
		}
		if !hasSubject || subject != "" {
			t.Errorf("subject = %#v (present=%v), want present and empty", subject, hasSubject)
		}
		w.Write([]byte(`{"id":"em_1"}`))
	})

	if _, err := client.Emails.Send(&SendEmailRequest{
		To:   []string{"delivered@test.sendping.co"},
		Text: "no template here",
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}
}

// A nested Template carrying neither Id nor Alias references NOTHING — the
// server's extractor lets a non-null `template` shadow `template_id` — so
// from/subject must keep being sent.
func TestEmptyTemplateRefShadowsTemplateId(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(t, r)
		if _, present := body["from"]; !present {
			t.Error("from must still be sent: an id-less template references nothing")
		}
		if _, present := body["subject"]; !present {
			t.Error("subject must still be sent: an id-less template references nothing")
		}
		w.Write([]byte(`{"id":"em_1"}`))
	})

	if _, err := client.Emails.Send(&SendEmailRequest{
		To:         []string{"delivered@test.sendping.co"},
		TemplateId: "tpl_1",
		Template:   &TemplateRef{Variables: map[string]any{"name": "Ada"}},
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}
}

// Batch items follow the same rule.
func TestBatchTemplateItemOmitsEmptyFromAndSubject(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		var items []map[string]any
		if err := json.NewDecoder(r.Body).Decode(&items); err != nil {
			t.Fatalf("decode batch body: %v", err)
		}
		if len(items) != 1 {
			t.Fatalf("items = %d, want 1", len(items))
		}
		if _, present := items[0]["from"]; present {
			t.Error("empty from must be omitted for a template batch item")
		}
		if _, present := items[0]["subject"]; present {
			t.Error("empty subject must be omitted for a template batch item")
		}
		w.Write([]byte(`{"data":[{"id":"em_1"}]}`))
	})

	if _, err := client.Batch.SendEmails([]*BatchEmailRequest{
		{To: []string{"delivered@test.sendping.co"}, Template: &TemplateRef{Alias: "welcome"}},
	}); err != nil {
		t.Fatalf("SendEmails: %v", err)
	}
}

// A batch larger than BatchSyncMax is QUEUED, not sent: HTTP 202 with
// `queued`/`queued_count` alongside the reserved ids. Callers must be able to
// tell that apart from an inline send.
func TestBatchQueuedResponse(t *testing.T) {
	if BatchSyncMax != 40 {
		t.Fatalf("BatchSyncMax = %d, want 40", BatchSyncMax)
	}
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		w.Write([]byte(`{"data":[{"id":"em_1"},{"id":"em_2"}],"queued":true,"queued_count":2}`))
	})

	res, err := client.Batch.SendEmails([]*BatchEmailRequest{
		{From: "a@b.com", To: []string{"delivered@test.sendping.co"}, Subject: "1", Text: "one"},
		{From: "a@b.com", To: []string{"delivered@test.sendping.co"}, Subject: "2", Text: "two"},
	})
	if err != nil {
		t.Fatalf("SendEmails: %v", err)
	}
	if !res.Queued || res.QueuedCount != 2 || len(res.Data) != 2 {
		t.Errorf("queued batch not surfaced: %+v", res)
	}
}

// An inline (200) batch must NOT look queued.
func TestBatchInlineResponseIsNotQueued(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"data":[{"id":"em_1"}]}`))
	})

	res, err := client.Batch.SendEmails([]*BatchEmailRequest{
		{From: "a@b.com", To: []string{"delivered@test.sendping.co"}, Subject: "1", Text: "one"},
	})
	if err != nil {
		t.Fatalf("SendEmails: %v", err)
	}
	if res.Queued || res.QueuedCount != 0 {
		t.Errorf("inline batch reported as queued: %+v", res)
	}
}

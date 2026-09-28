package sendping

import (
	"net/http"
	"testing"
)

func TestDomainsCreate(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/domains" {
			t.Errorf("%s %s, want POST /domains", r.Method, r.URL.Path)
		}
		assertAuth(t, r)
		body := decodeBody(t, r)
		if body["name"] != "example.com" {
			t.Errorf("name = %v", body["name"])
		}
		caps, ok := body["capabilities"].(map[string]any)
		if !ok || caps["receiving"] != "enabled" {
			t.Errorf("capabilities = %v", body["capabilities"])
		}
		w.Write([]byte(`{"object":"domain","id":"dom_1","name":"example.com","status":"pending","region":"us-east-1","created_at":"2026-07-06T00:00:00Z","records":[{"record":"DKIM","name":"mb._domainkey","type":"CNAME","ttl":"Auto","status":"pending","value":"mb.dkim.sendping.co"}]}`))
	})

	dom, err := client.Domains.Create(&CreateDomainRequest{
		Name:         "example.com",
		Capabilities: &DomainCapabilitiesInput{Receiving: "enabled"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if dom.Id != "dom_1" || dom.Status != "pending" || len(dom.Records) != 1 {
		t.Errorf("unexpected domain: %+v", dom)
	}
	if dom.Records[0].Record != "DKIM" {
		t.Errorf("record = %+v", dom.Records[0])
	}
}

func TestDomainsVerify(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/domains/dom_1/verify" {
			t.Errorf("%s %s, want POST /domains/dom_1/verify", r.Method, r.URL.Path)
		}
		w.Write([]byte(`{"object":"domain","id":"dom_1"}`))
	})

	ref, err := client.Domains.Verify("dom_1")
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if ref.Object != "domain" || ref.Id != "dom_1" {
		t.Errorf("unexpected ref: %+v", ref)
	}
}

func TestDomainsClaimFlow(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/domains/claim":
			body := decodeBody(t, r)
			if body["name"] != "example.com" {
				t.Errorf("name = %v", body["name"])
			}
			w.Write([]byte(`{"object":"domain_claim","id":"clm_1","name":"example.com","domain_id":"dom_1","region":"us-east-1","status":"pending","record":{"type":"TXT","name":"_mbclaim.example.com","value":"mb-claim=abc","ttl":"Auto"},"blocked_reason":null,"failure_reason":null,"created_at":"2026-07-06T00:00:00Z","expires_at":"2026-07-13T00:00:00Z"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/domains/dom_1/claim/verify":
			w.Write([]byte(`{"object":"domain_claim","id":"clm_1","name":"example.com","domain_id":"dom_1","region":"us-east-1","status":"verified","record":{"type":"TXT","name":"_mbclaim.example.com","value":"mb-claim=abc","ttl":"Auto"},"blocked_reason":null,"failure_reason":null,"created_at":"2026-07-06T00:00:00Z","expires_at":"2026-07-13T00:00:00Z"}`))
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	})

	claim, err := client.Domains.Claim(&ClaimDomainRequest{Name: "example.com"})
	if err != nil {
		t.Fatalf("Claim: %v", err)
	}
	if claim.Id != "clm_1" || claim.Record.Type != "TXT" {
		t.Errorf("unexpected claim: %+v", claim)
	}

	verified, err := client.Domains.VerifyClaim("dom_1")
	if err != nil {
		t.Fatalf("VerifyClaim: %v", err)
	}
	if verified.Status != "verified" {
		t.Errorf("status = %q, want verified", verified.Status)
	}
}

func TestDomainsApplyCloudflareDns(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/domains/dom_1/dns/cloudflare" {
			t.Errorf("%s %s, want POST /domains/dom_1/dns/cloudflare", r.Method, r.URL.Path)
		}
		body := decodeBody(t, r)
		if body["token"] != "cf_token" {
			t.Errorf("token = %v", body["token"])
		}
		w.Write([]byte(`{"applied":4,"verified":true}`))
	})

	res, err := client.Domains.ApplyCloudflareDns("dom_1", &CloudflareDnsRequest{Token: "cf_token"})
	if err != nil {
		t.Fatalf("ApplyCloudflareDns: %v", err)
	}
	if res["verified"] != true {
		t.Errorf("unexpected result: %v", res)
	}
}

// PATCH /domains/:id accepts `custom_return_path` (the MAIL FROM subdomain) —
// the request type used to have no field for it, so the Return-Path could be
// set at create time and never changed afterwards.
func TestDomainsUpdateCustomReturnPath(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/domains/dom_1" {
			t.Errorf("%s %s, want PATCH /domains/dom_1", r.Method, r.URL.Path)
		}
		body := decodeBody(t, r)
		if body["custom_return_path"] != "mail" {
			t.Errorf("custom_return_path = %#v, want mail", body["custom_return_path"])
		}
		// Untouched fields must stay absent so the PATCH does not reset them.
		for _, k := range []string{"open_tracking", "click_tracking", "tls", "capabilities"} {
			if _, present := body[k]; present {
				t.Errorf("%s must be omitted when unset, got %#v", k, body[k])
			}
		}
		w.Write([]byte(`{"object":"domain","id":"dom_1"}`))
	})

	ref, err := client.Domains.Update("dom_1", &UpdateDomainRequest{CustomReturnPath: "mail"})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if ref.Id != "dom_1" {
		t.Errorf("unexpected ref: %+v", ref)
	}
}

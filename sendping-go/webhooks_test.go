package sendping

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"testing"
	"time"
)

// sign computes a Svix-style "v1,<base64 hmac>" signature the way the
// SendPing backend does, for building test deliveries.
func sign(t *testing.T, secret, id, timestamp string, payload []byte) string {
	t.Helper()
	mac := hmac.New(sha256.New, secretToKey(secret))
	fmt.Fprintf(mac, "%s.%s.", id, timestamp)
	mac.Write(payload)
	return "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func deliveryHeaders(id, timestamp, signature string) http.Header {
	h := http.Header{}
	h.Set("Svix-Id", id)
	h.Set("Svix-Timestamp", timestamp)
	h.Set("Svix-Signature", signature)
	return h
}

func TestVerifyWebhookSignatureValid(t *testing.T) {
	secret := "whsec_" + base64.StdEncoding.EncodeToString([]byte("super-secret-key"))
	payload := []byte(`{"type":"email.delivered","data":{"id":"em_1"}}`)
	id := "msg_1"
	ts := strconv.FormatInt(time.Now().Unix(), 10)

	headers := deliveryHeaders(id, ts, sign(t, secret, id, ts, payload))
	res := VerifyWebhookSignature(payload, headers, secret, nil)
	if !res.Valid {
		t.Fatalf("expected valid signature, got reason %q", res.Reason)
	}
}

// A caller-supplied signing secret (the optional `secret` on POST /webhooks —
// the path you take when mirroring a secret across providers) is not guaranteed
// to be canonically padded standard base64. The backend derives its key with
// Node's Buffer.from(suffix, "base64"), which accepts an unpadded or URL-safe
// suffix, so those spellings must yield the SAME key here; a strict decoder
// derives a different key (in fact it fell through to the raw string, "whsec_"
// prefix included) and answers no_match for every genuinely signed delivery.
//
// The signature below is built from the server's key DIRECTLY rather than via
// sign()/secretToKey: signing with the function under test is self-consistent
// by construction and would pass with the strict decoder too, proving nothing.
func TestVerifyWebhookSignatureNonCanonicalSecret(t *testing.T) {
	// The 16 bytes "+/++AQIDBAUGBwgJCgsMDQ" encodes, spelled three ways.
	want := []byte{0xfb, 0xff, 0xbe, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13}
	for _, suffix := range []string{
		"+/++AQIDBAUGBwgJCgsMDQ==", // padded standard
		"+/++AQIDBAUGBwgJCgsMDQ",   // unpadded — no "=" needed
		"-_--AQIDBAUGBwgJCgsMDQ",   // URL-safe "-"/"_" spelling
	} {
		secret := "whsec_" + suffix
		if got := secretToKey(secret); !bytes.Equal(got, want) {
			t.Fatalf("suffix %q: key = %x, want %x", suffix, got, want)
		}

		payload := []byte(`{"type":"email.delivered","data":{"id":"em_9"}}`)
		id := "msg_nc"
		ts := strconv.FormatInt(time.Now().Unix(), 10)
		mac := hmac.New(sha256.New, want) // the SERVER's key, not secretToKey's
		fmt.Fprintf(mac, "%s.%s.", id, ts)
		mac.Write(payload)
		sig := "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))

		headers := deliveryHeaders(id, ts, sig)
		if res := VerifyWebhookSignature(payload, headers, secret, nil); !res.Valid {
			t.Fatalf("suffix %q: expected valid signature, got reason %q", suffix, res.Reason)
		}
	}
}

func TestVerifyWebhookSignatureRawSecret(t *testing.T) {
	// A secret without the whsec_ prefix is used as raw UTF-8 bytes.
	secret := "plain-secret"
	payload := []byte(`{"ok":true}`)
	id := "msg_2"
	ts := strconv.FormatInt(time.Now().Unix(), 10)

	headers := deliveryHeaders(id, ts, sign(t, secret, id, ts, payload))
	if res := VerifyWebhookSignature(payload, headers, secret, nil); !res.Valid {
		t.Fatalf("expected valid signature, got reason %q", res.Reason)
	}
}

func TestVerifyWebhookSignatureMultipleSignatures(t *testing.T) {
	secret := "plain-secret"
	payload := []byte(`{"ok":true}`)
	id := "msg_3"
	ts := strconv.FormatInt(time.Now().Unix(), 10)

	good := sign(t, secret, id, ts, payload)
	headers := deliveryHeaders(id, ts, "v1,bogus= "+good)
	if res := VerifyWebhookSignature(payload, headers, secret, nil); !res.Valid {
		t.Fatalf("any matching signature should win, got reason %q", res.Reason)
	}
}

func TestVerifyWebhookSignatureTampered(t *testing.T) {
	secret := "plain-secret"
	payload := []byte(`{"amount":100}`)
	id := "msg_4"
	ts := strconv.FormatInt(time.Now().Unix(), 10)

	headers := deliveryHeaders(id, ts, sign(t, secret, id, ts, payload))
	res := VerifyWebhookSignature([]byte(`{"amount":999}`), headers, secret, nil)
	if res.Valid {
		t.Fatal("tampered payload must not verify")
	}
	if res.Reason != "no_match" {
		t.Errorf("reason = %q, want no_match", res.Reason)
	}
}

func TestVerifyWebhookSignatureStaleTimestamp(t *testing.T) {
	secret := "plain-secret"
	payload := []byte(`{"ok":true}`)
	id := "msg_5"
	ts := strconv.FormatInt(time.Now().Add(-time.Hour).Unix(), 10)

	headers := deliveryHeaders(id, ts, sign(t, secret, id, ts, payload))
	res := VerifyWebhookSignature(payload, headers, secret, nil)
	if res.Valid || res.Reason != "timestamp_out_of_tolerance" {
		t.Fatalf("expected timestamp_out_of_tolerance, got valid=%v reason=%q", res.Valid, res.Reason)
	}

	// Disabling the check (negative tolerance) makes the same delivery valid.
	res = VerifyWebhookSignature(payload, headers, secret, &VerifyWebhookOptions{ToleranceSec: -1})
	if !res.Valid {
		t.Fatalf("expected valid with timestamp check disabled, got reason %q", res.Reason)
	}
}

func TestVerifyWebhookSignatureMissingHeaders(t *testing.T) {
	res := VerifyWebhookSignature([]byte(`{}`), http.Header{}, "secret", nil)
	if res.Valid || res.Reason != "missing_headers" {
		t.Fatalf("expected missing_headers, got valid=%v reason=%q", res.Valid, res.Reason)
	}
}

func TestVerifyWebhookSignatureMissingSecret(t *testing.T) {
	headers := deliveryHeaders("msg_6", strconv.FormatInt(time.Now().Unix(), 10), "v1,abc")
	res := VerifyWebhookSignature([]byte(`{}`), headers, "", nil)
	if res.Valid || res.Reason != "missing_secret" {
		t.Fatalf("expected missing_secret, got valid=%v reason=%q", res.Valid, res.Reason)
	}
}

func TestWebhooksCreateReturnsSecretOnce(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/webhooks" {
			t.Errorf("%s %s, want POST /webhooks", r.Method, r.URL.Path)
		}
		body := decodeBody(t, r)
		if body["endpoint"] != "https://yourapp.com/hooks" {
			t.Errorf("endpoint = %v", body["endpoint"])
		}
		events, ok := body["events"].([]any)
		if !ok || len(events) != 2 {
			t.Errorf("events = %v", body["events"])
		}
		w.Write([]byte(`{"object":"webhook","id":"wh_1","signing_secret":"whsec_abc123"}`))
	})

	res, err := client.Webhooks.Create(&CreateWebhookRequest{
		Endpoint: "https://yourapp.com/hooks",
		Events:   []string{"email.delivered", "email.bounced"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if res.SigningSecret != "whsec_abc123" {
		t.Errorf("SigningSecret = %q", res.SigningSecret)
	}
}

// The test route reports success in `ok`, and a failed delivery is still
// HTTP 200 — so the result must be read, not the error return.
func TestWebhooksTestReadsOkField(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/webhooks/wh_1/test" {
			t.Errorf("%s %s, want POST /webhooks/wh_1/test", r.Method, r.URL.Path)
		}
		w.Write([]byte(`{"object":"webhook_test","id":"wh_1","ok":true,"status":200}`))
	})

	res, err := client.Webhooks.Test("wh_1")
	if err != nil {
		t.Fatalf("Test: %v", err)
	}
	if !res.Ok || res.Status != 200 {
		t.Errorf("unexpected result: %+v", res)
	}
}

func TestWebhooksTestFailedDeliveryIs200(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"object":"webhook_test","id":"wh_1","ok":false,"error":"lookup_failed"}`))
	})

	res, err := client.Webhooks.Test("wh_1")
	if err != nil {
		t.Fatalf("a failed delivery must not surface as an error: %v", err)
	}
	if res.Ok || res.Error != "lookup_failed" {
		t.Errorf("unexpected result: %+v", res)
	}
}

// --- `whsec_` key-derivation conformance corpus ---------------------------
//
// The vectors below are scripts/webhook-b64-corpus.json, generated FROM NODE
// (`node scripts/webhook-b64-corpus.mjs <unix_ts>`) rather than from anyone's
// idea of what base64 means, and inlined here rather than read from that path
// so a published module's tests stay self-contained. keyHex is the key the
// SERVER derives — sendping_webapp/lib/crypto.ts secretToKey, i.e. Node's
// Buffer.from(suffix, "base64"). A caller-supplied secret is accepted verbatim
// with no shape validation, so none of these shapes are hypothetical: a
// customer can create any of them, and a key that differs from the signer's
// does not fail loudly — verification answers no_match and a correctly
// configured endpoint drops every genuine delivery as forged.
type b64CorpusVector struct {
	name   string
	suffix string
	keyHex string
	// rawFallback marks the vectors whose suffix decodes to ZERO bytes, where
	// secretToKey keys on the UTF-8 bytes of the WHOLE secret, "whsec_"
	// prefix included.
	rawFallback bool
}

// Pinned counts. Re-embedding the corpus lossily — dropping the awkward
// vectors, keeping the ASCII ones — would otherwise still go green while
// testing strictly less than the spec.
const (
	b64CorpusSize        = 41
	b64CorpusRawFallback = 10
	b64CorpusBody        = `{"type":"email.delivered","data":{"id":"em_1"}}`
	b64CorpusID          = "msg_conformance"
)

var b64Corpus = []b64CorpusVector{
	{"std_padded", "YWJjZA==", "61626364", false},
	{"std_unpadded", "YWJjZA", "61626364", false},
	{"std_exact4", "YWJj", "616263", false},
	{"short_1", "Y", "77687365635f59", true},
	{"short_2", "YW", "61", false},
	{"short_3", "YWJ", "6162", false},
	{"interior_eq", "YWJjZA==ZXh0cmE", "61626364", false},
	{"single_eq_mid", "SGVsbG8=V29ybGQ", "48656c6c6f", false},
	{"eq_at_pos1", "Y=WJj", "77687365635f593d574a6a", true},
	{"leading_eq", "=YWJj", "77687365635f3d59574a6a", true},
	{"only_eq", "=", "77687365635f3d", true},
	{"urlsafe", "a-b_cd", "6be6ff71", false},
	{"urlsafe_long", "SGVsbG8td29ybGRfMTIz", "48656c6c6f2d776f726c645f313233", false},
	{"space", "YW Jj", "616263", false},
	{"newline", "YW\nJj", "616263", false},
	{"tab", "YW\tJj", "616263", false},
	{"crlf", "YWJj\r\nZA", "61626364", false},
	{"junk_bang", "YW!Jj", "616263", false},
	{"junk_at", "YW@#Jj", "616263", false},
	{"junk_unicode", "YWéJj", "616263", false},
	{"all_junk", "!!!!", "77687365635f21212121", true},
	{"empty", "", "77687365635f", true},
	{"urlsafe_junk_eq", "a-b_c=d!e", "6be6ff", false},
	{"real_shape", "cg6z29GIzlSydvyOkBWpEsGcKujWfHKh", "720eb3dbd188ce54b276fc8e9015a912c19c2ae8d67c72a1", false},
	{"long_mixed", "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVph-_YmNkZQ==", "4142434445464748494a4b4c4d4e4f505152535455565758595a61fbf626364650", false},
	{"plus_slash", "a+b/cd", "6be6ff71", false},
	{"mixed_alpha", "a-b/c_d+e", "6be6ff73f77e", false},
	{"many_eq", "YWJj====ZA", "616263", false},
	{"eq_then_pad", "YWJjZA===", "61626364", false},
	{"nonascii_only", "éüñ", "77687365635fc3a9c3bcc3b1", true},
	{"digits", "MTIzNDU2Nzg5MA", "31323334353637383930", false},
	{"hi_masks_to_A", "YWŁj", "616023", false},
	{"hi_masks_to_eq", "YWJjĽZA", "616263", false},
	{"hi_masks_to_a", "šš", "69", false},
	{"hi_masks_to_4", "YWJሴ", "616278", false},
	{"hi_masks_to_nul", "ĀĀĀĀ", "77687365635fc480c480c480c480", true},
	{"fullwidth", "ＹＷＪｊ", "f7b2", false},
	{"astral_pair", "𝑁", "e4", false},
	{"astral_emoji", "🎉", "77687365635ff09f8e89", true},
	{"cjk_skipped", "中文", "77687365635fe4b8ade69687", true},
	{"mixed_hi_lo", "YWŁjĽZAšš", "616023", false},
}

// b64CorpusRule5Names are the vectors that only pass once the decoder masks
// every UTF-16 code unit with 0xFF before the alphabet lookup — 'Ł' (U+0141)
// reads as 'A', 'Ľ' (U+013D) reads as '=' and TERMINATES the value, and an
// astral character contributes its two SURROGATE halves' low bytes rather than
// its UTF-8 bytes. They are named individually because they are exactly the
// ones an ASCII-only corpus cannot see: this package scored 31/31 on the old
// corpus and 2000/2000 on an ASCII fuzz while deriving the wrong key for
// 1700 of 3000 vectors once codepoints above 0xFF were included.
var b64CorpusRule5Names = []string{
	"hi_masks_to_A", "hi_masks_to_eq", "hi_masks_to_a", "hi_masks_to_4",
	"hi_masks_to_nul", "fullwidth", "astral_pair", "astral_emoji",
	"cjk_skipped", "mixed_hi_lo",
}

func TestSecretToKeyMatchesNodeCorpus(t *testing.T) {
	if len(b64Corpus) != b64CorpusSize {
		t.Fatalf("corpus has %d vectors, want %d — re-embed scripts/webhook-b64-corpus.json in full", len(b64Corpus), b64CorpusSize)
	}
	seen := make(map[string]bool, len(b64Corpus))
	rawFallbacks := 0
	for _, v := range b64Corpus {
		seen[v.name] = true
		if v.rawFallback {
			rawFallbacks++
		}
	}
	if rawFallbacks != b64CorpusRawFallback {
		t.Fatalf("corpus has %d raw-fallback vectors, want %d", rawFallbacks, b64CorpusRawFallback)
	}
	for _, name := range b64CorpusRule5Names {
		if !seen[name] {
			t.Fatalf("corpus is missing rule-5 vector %q — the UTF-16 low-byte cases are the whole point", name)
		}
	}

	for _, v := range b64Corpus {
		want, err := hex.DecodeString(v.keyHex)
		if err != nil {
			t.Fatalf("%s: bad keyHex %q: %v", v.name, v.keyHex, err)
		}
		secret := "whsec_" + v.suffix
		if got := secretToKey(secret); !bytes.Equal(got, want) {
			t.Errorf("%s: suffix %q -> key %x, want %x", v.name, v.suffix, got, want)
		}
		// The rawFallback flag has to mean something, or pinning its count
		// pins nothing: a fallback key IS the whole secret's UTF-8 bytes.
		if isRaw := bytes.Equal(want, []byte(secret)); isRaw != v.rawFallback {
			t.Errorf("%s: rawFallback = %v, but key %s the whole secret", v.name, v.rawFallback, map[bool]string{true: "is", false: "is not"}[isRaw])
		}
	}
}

// The end-to-end half: every corpus secret must verify a delivery signed with
// the SERVER's key. The signature is built from keyHex directly rather than
// via secretToKey — signing with the function under test is self-consistent by
// construction and would pass with any decoder, proving nothing. Signing at
// "now" also keeps the default freshness check in play.
func TestVerifyWebhookSignatureAcceptsNodeCorpusKeys(t *testing.T) {
	payload := []byte(b64CorpusBody)
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	for _, v := range b64Corpus {
		key, err := hex.DecodeString(v.keyHex)
		if err != nil {
			t.Fatalf("%s: bad keyHex %q: %v", v.name, v.keyHex, err)
		}
		mac := hmac.New(sha256.New, key) // the SERVER's key, not secretToKey's
		fmt.Fprintf(mac, "%s.%s.", b64CorpusID, ts)
		mac.Write(payload)
		sig := "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))

		headers := deliveryHeaders(b64CorpusID, ts, sig)
		if res := VerifyWebhookSignature(payload, headers, "whsec_"+v.suffix, nil); !res.Valid {
			t.Errorf("%s: suffix %q: genuine delivery rejected (%s)", v.name, v.suffix, res.Reason)
		}
	}
}

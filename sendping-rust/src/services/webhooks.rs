//! `sendping.webhooks` — webhook endpoints plus a pure, local
//! Svix-style signature verification helper
//! ([`verify_webhook_signature`] / `webhooks.verify`).

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{GeneralPurpose, GeneralPurposeConfig, STANDARD as B64};
use base64::engine::DecodePaddingMode;
use base64::{alphabet, Engine as _};
use hmac::{Hmac, Mac};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::Sha256;

use crate::client::{page_query, seg, Config};
use crate::types::{ListResponse, ObjectAck, PaginationParams, RemovedResponse, Result};

type HmacSha256 = Hmac<Sha256>;

/// Whether a webhook is delivering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WebhookStatus {
    Enabled,
    Disabled,
}

/// A webhook endpoint.
#[derive(Debug, Clone, Deserialize)]
pub struct Webhook {
    pub object: String,
    pub id: String,
    pub endpoint: String,
    pub events: Vec<String>,
    pub status: String,
    /// Whether a signing secret is set (the secret itself is returned ONLY
    /// on create + rotate, never on get/list).
    pub has_secret: Option<bool>,
    pub last_delivery_at: Option<String>,
    pub last_delivery_status: Option<u16>,
    /// Consecutive delivery failure count.
    pub failure_count: Option<u64>,
    pub created_at: String,
}

/// Options for `webhooks.create` (`POST /webhooks`).
#[derive(Debug, Clone, Serialize)]
pub struct CreateWebhookOptions {
    pub endpoint: String,
    pub events: Vec<String>,
    /// Optional caller-supplied signing secret; when omitted, SendPing
    /// generates one (returned once).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
}

impl CreateWebhookOptions {
    pub fn new(
        endpoint: impl Into<String>,
        events: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        Self {
            endpoint: endpoint.into(),
            events: events.into_iter().map(Into::into).collect(),
            secret: None,
        }
    }

    pub fn with_secret(mut self, secret: impl Into<String>) -> Self {
        self.secret = Some(secret.into());
        self
    }
}

/// Options for `webhooks.update` (`PATCH /webhooks/:id`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateWebhookOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<WebhookStatus>,
}

impl UpdateWebhookOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.endpoint = Some(endpoint.into());
        self
    }

    pub fn with_events(mut self, events: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.events = Some(events.into_iter().map(Into::into).collect());
        self
    }

    pub fn with_status(mut self, status: WebhookStatus) -> Self {
        self.status = Some(status);
        self
    }
}

/// `{ object, id, signing_secret }` returned by create + rotate — the
/// plaintext secret is revealed ONCE, only here.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateWebhookResponse {
    pub object: String,
    pub id: String,
    pub signing_secret: String,
}

/// Result of a synchronous test delivery (`POST /webhooks/:id/test`).
///
/// **A FAILED DELIVERY IS STILL HTTP 200.** The route answers `200` whether or
/// not your endpoint accepted the event, so `webhooks.test(..)` returns `Ok`
/// either way — branch on [`ok`](Self::ok), never on the absence of an error:
///
/// ```no_run
/// # async fn run(mb: sendping::SendPing) -> sendping::Result<()> {
/// let result = mb.webhooks.test("42").await?;
/// if !result.ok {
///     eprintln!("delivery failed: {:?}", result.error);
/// }
/// # Ok(())
/// # }
/// ```
#[derive(Debug, Clone, Deserialize)]
pub struct WebhookTestResult {
    pub object: String,
    pub id: String,
    /// Whether the endpoint accepted the test delivery. `false` means the
    /// delivery FAILED even though the HTTP status was 200.
    #[serde(default)]
    pub ok: bool,
    /// The HTTP status your endpoint returned, when it responded at all.
    pub status: Option<u16>,
    /// Why the delivery failed when [`ok`](Self::ok) is `false`, e.g.
    /// `lookup_failed` or `webhook missing or disabled`.
    pub error: Option<String>,
    /// Any further fields the route grows, kept verbatim.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// The Svix-style delivery headers SendPing sends with each webhook
/// (`svix-id`, `svix-timestamp`, `svix-signature`). Extract them from your
/// framework's request and pass them to the verify helper.
#[derive(Debug, Clone, Default)]
pub struct WebhookHeaders {
    pub svix_id: String,
    pub svix_timestamp: String,
    pub svix_signature: String,
}

impl WebhookHeaders {
    pub fn new(
        svix_id: impl Into<String>,
        svix_timestamp: impl Into<String>,
        svix_signature: impl Into<String>,
    ) -> Self {
        Self {
            svix_id: svix_id.into(),
            svix_timestamp: svix_timestamp.into(),
            svix_signature: svix_signature.into(),
        }
    }
}

/// Outcome of verifying a webhook delivery signature.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifyWebhookResult {
    /// True when a signature matches and (when checked) the timestamp is fresh.
    pub valid: bool,
    /// Machine reason when `valid` is false: `missing_headers`,
    /// `missing_secret`, `invalid_timestamp`, `timestamp_out_of_tolerance`,
    /// or `no_match`.
    pub reason: Option<&'static str>,
}

impl VerifyWebhookResult {
    fn invalid(reason: &'static str) -> Self {
        Self {
            valid: false,
            reason: Some(reason),
        }
    }
}

/// Options for signature verification (timestamp tolerance).
#[derive(Debug, Clone, Copy)]
pub struct VerifyWebhookOptions {
    /// Max allowed clock skew in seconds (default 300). `0` skips the check.
    pub tolerance_secs: u64,
}

impl Default for VerifyWebhookOptions {
    fn default() -> Self {
        Self {
            tolerance_secs: 300,
        }
    }
}

/// The engine [`b64_lenient`] decodes with: no `=` required, and a trailing
/// partial group accepted rather than rejected for its leftover bits.
const B64_LENIENT: GeneralPurpose = GeneralPurpose::new(
    &alphabet::STANDARD,
    GeneralPurposeConfig::new()
        .with_decode_padding_mode(DecodePaddingMode::Indifferent)
        .with_decode_allow_trailing_bits(true),
);

/// Decode base64 the way the SIGNER does, not the way Rust does.
///
/// The backend derives its key with Node's `Buffer.from(suffix, 'base64')`
/// (sendping_webapp/lib/crypto.ts `secretToKey`), which is LENIENT: it
/// ignores characters outside the alphabet, accepts the URL-safe `-`/`_`
/// spellings, needs no `=` padding, and decodes a trailing partial group
/// (dropping a lone 1-char remainder, which carries no whole byte). The
/// `STANDARD` engine does none of that — it is `RequireCanonical` over the
/// standard-only alphabet, so an unpadded suffix is `InvalidPadding` and a
/// URL-safe one is `InvalidByte`. Either `Err` fell through to the raw-UTF-8
/// fallback below, keying the HMAC with the whole secret STRING (`whsec_`
/// prefix included) while the server keyed it with the decoded bytes — and
/// every genuine delivery came back `{ valid: false, reason: "no_match" }`.
/// Such secrets are not hypothetical: `POST /webhooks` accepts a caller-chosen
/// `secret` verbatim, with no format validation, and
/// [`CreateWebhookOptions::with_secret`] is how you set it. npm, python, php
/// and ruby are all lenient; this reproduces them byte for byte.
///
/// The order below is load-bearing, and getting it wrong is what shipped twice:
/// `=` TERMINATES the input, it is not padding to be stripped. Node stops at the
/// first `=` and DISCARDS the rest, so `"YWJj====ZA"` is `"abc"` — not `"abcd"`.
/// Filtering `=` out as just another non-alphabet character and decoding what
/// remains silently concatenates the tail onto the head, so a secret that merely
/// looks over-padded derives a longer, wrong key. The truncation therefore has
/// to happen BEFORE the alphabet filter, because the filter would otherwise eat
/// the very `=` that marks where the input ends. Truncating can also leave
/// nothing at all (`"=YWJj"` -> `""`, `"Y=WJj"` -> `"Y"`, a lone char that
/// carries no whole byte), which is not an error here — it returns empty and
/// [`secret_to_key`] takes the raw-UTF-8 fallback, exactly as the server does.
///
/// One rule sits AHEAD of all of that, and no SDK had it: the unit Node feeds
/// the base64 table is the low 8 bits of each UTF-16 CODE UNIT — not the
/// codepoint, and not the UTF-8 byte. `Buffer.from(s, 'base64')` masks every
/// code unit with `0xFF` before the lookup, so `'\u{0141}'` becomes `0x41` `'A'`
/// and contributes a real sextet, `'\u{013D}'` becomes `0x3D` `'='` and
/// TERMINATES the input, and an ASTRAL char arrives as its two SURROGATES
/// (U+1D441 -> 0xD835, 0xDC41 -> `'5'`, `'A'`), never as its four UTF-8 bytes.
/// Rust strings are UTF-8, so the mask has to run over [`str::encode_utf16`]:
/// masking `chars()` would collapse U+1D441 into one unit, and masking
/// `as_bytes()` would spread it over four, each deriving a different key. The
/// masking is the FIRST step for the same reason the `=` truncation precedes the
/// alphabet filter — the split has to see the MASKED bytes or U+013D never
/// terminates. None of this is visible to an ASCII test: every SDK passed the
/// 31-vector ASCII corpus while mis-deriving the key for any secret a customer
/// pasted with a character above U+00FF in it, and every genuine delivery to
/// that endpoint came back `no_match`.
fn b64_lenient(s: &str) -> Vec<u8> {
    let masked: Vec<u8> = s.encode_utf16().map(|unit| (unit & 0xFF) as u8).collect();
    let terminated = masked.split(|b| *b == b'=').next().unwrap_or(&[]);
    let mut cleaned: Vec<u8> = terminated
        .iter()
        .filter_map(|&b| match b {
            b'-' => Some(b'+'),
            b'_' => Some(b'/'),
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'+' | b'/' => Some(b),
            _ => None,
        })
        .collect();
    if cleaned.len() % 4 == 1 {
        cleaned.pop(); // a lone leftover character encodes no whole byte
    }
    B64_LENIENT.decode(&cleaned).unwrap_or_default()
}

/// Derive the HMAC key from a `whsec_`-prefixed secret (base64-decode the
/// suffix); a secret without the prefix is used as raw UTF-8 bytes.
///
/// The empty-decode branch is as much a part of the contract as the decoder is.
/// When the suffix yields ZERO bytes — it was empty, all junk, all non-ASCII, or
/// truncated away by a leading `=` — the server does NOT key the HMAC with an
/// empty key: it falls back to the UTF-8 bytes of the WHOLE secret, `whsec_`
/// prefix INCLUDED. So `"whsec_="` keys on the 7 bytes of `"whsec_="`, not on
/// nothing. Returning the decoded bytes unconditionally, or stripping the prefix
/// before the fallback, both derive a key the signer never used and turn every
/// genuine delivery into `no_match`.
fn secret_to_key(secret: &str) -> Vec<u8> {
    if let Some(b64) = secret.strip_prefix("whsec_") {
        let bytes = b64_lenient(b64);
        if !bytes.is_empty() {
            return bytes;
        }
    }
    secret.as_bytes().to_vec()
}

/// Constant-time byte comparison (xor-fold; length mismatch short-circuits,
/// which leaks only the length — signatures are fixed-size anyway).
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Verify a webhook delivery's Svix-style signature against your endpoint's
/// signing secret. Mirrors the SendPing signing scheme:
/// `"{id}.{timestamp}.{body}"` → base64 HMAC-SHA256, tagged `v1,`.
///
/// `payload` MUST be the exact raw request body string the server sent — do
/// not re-serialize parsed JSON (whitespace differences break the signature).
/// The `svix-signature` header may carry multiple space-separated
/// signatures; any one matching makes the delivery valid.
///
/// This is a pure local computation — it makes no HTTP request.
pub fn verify_webhook_signature(
    payload: &str,
    headers: &WebhookHeaders,
    secret: &str,
    options: &VerifyWebhookOptions,
) -> VerifyWebhookResult {
    if headers.svix_id.is_empty()
        || headers.svix_timestamp.is_empty()
        || headers.svix_signature.is_empty()
    {
        return VerifyWebhookResult::invalid("missing_headers");
    }
    if secret.is_empty() {
        return VerifyWebhookResult::invalid("missing_secret");
    }

    // Optional timestamp freshness check (default 5-minute tolerance).
    if options.tolerance_secs > 0 {
        let ts: i64 = match headers.svix_timestamp.trim().parse() {
            Ok(ts) => ts,
            Err(_) => return VerifyWebhookResult::invalid("invalid_timestamp"),
        };
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        if (now - ts).unsigned_abs() > options.tolerance_secs {
            return VerifyWebhookResult::invalid("timestamp_out_of_tolerance");
        }
    }

    let key = secret_to_key(secret);
    let mut mac = HmacSha256::new_from_slice(&key).expect("HMAC-SHA256 accepts keys of any length");
    mac.update(format!("{}.{}.{}", headers.svix_id, headers.svix_timestamp, payload).as_bytes());
    let expected = mac.finalize().into_bytes();

    // The header may contain multiple space-separated `v1,<sig>` entries;
    // any match wins.
    for part in headers.svix_signature.split(' ') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let sig_b64 = trimmed.strip_prefix("v1,").unwrap_or(trimmed);
        if let Ok(candidate) = B64.decode(sig_b64) {
            if ct_eq(&candidate, expected.as_slice()) {
                return VerifyWebhookResult {
                    valid: true,
                    reason: None,
                };
            }
        }
    }
    VerifyWebhookResult::invalid("no_match")
}

/// `sendping.webhooks`.
#[derive(Clone, Debug)]
pub struct WebhooksSvc {
    config: Arc<Config>,
}

impl WebhooksSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// Create a webhook. The signing secret is shown ONCE, only here.
    /// `POST /webhooks`
    pub async fn create(&self, options: CreateWebhookOptions) -> Result<CreateWebhookResponse> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/webhooks")
                    .json(&options),
            )
            .await
    }

    /// Retrieve a webhook. `GET /webhooks/:id`
    pub async fn get(&self, webhook_id: &str) -> Result<Webhook> {
        let path = format!("/webhooks/{}", seg(webhook_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// List webhooks. `GET /webhooks`
    pub async fn list(&self, params: Option<PaginationParams>) -> Result<ListResponse<Webhook>> {
        let req = self
            .config
            .request(Method::GET, "/webhooks")
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// Update a webhook. Returns the slim `{ object, id }` ack.
    /// `PATCH /webhooks/:id`
    pub async fn update(
        &self,
        webhook_id: &str,
        options: UpdateWebhookOptions,
    ) -> Result<ObjectAck> {
        let path = format!("/webhooks/{}", seg(webhook_id));
        self.config
            .send(self.config.request(Method::PATCH, &path).json(&options))
            .await
    }

    /// Rotate the signing secret. The new plaintext secret is returned ONCE;
    /// the old secret stops verifying immediately. `POST /webhooks/:id/rotate`
    pub async fn rotate(&self, webhook_id: &str) -> Result<CreateWebhookResponse> {
        let path = format!("/webhooks/{}/rotate", seg(webhook_id));
        self.config
            .send(self.config.request(Method::POST, &path))
            .await
    }

    /// Send a synchronous test delivery and return the endpoint's live
    /// result. `POST /webhooks/:id/test`
    ///
    /// A failed delivery is still HTTP 200, so this returns `Ok` even then —
    /// inspect [`WebhookTestResult::ok`].
    pub async fn test(&self, webhook_id: &str) -> Result<WebhookTestResult> {
        let path = format!("/webhooks/{}/test", seg(webhook_id));
        self.config
            .send(self.config.request(Method::POST, &path))
            .await
    }

    /// Delete a webhook. `DELETE /webhooks/:id`
    pub async fn remove(&self, webhook_id: &str) -> Result<RemovedResponse> {
        let path = format!("/webhooks/{}", seg(webhook_id));
        self.config
            .send(self.config.request(Method::DELETE, &path))
            .await
    }

    /// Verify a delivery's signature — see [`verify_webhook_signature`].
    /// Pure local computation; no HTTP request.
    pub fn verify(
        &self,
        payload: &str,
        headers: &WebhookHeaders,
        secret: &str,
        options: &VerifyWebhookOptions,
    ) -> VerifyWebhookResult {
        verify_webhook_signature(payload, headers, secret, options)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "whsec_c2VjcmV0"; // base64("secret")
    const NO_TOLERANCE: VerifyWebhookOptions = VerifyWebhookOptions { tolerance_secs: 0 };

    fn sign(secret: &str, id: &str, ts: &str, payload: &str) -> String {
        let key = secret_to_key(secret);
        let mut mac = HmacSha256::new_from_slice(&key).unwrap();
        mac.update(format!("{id}.{ts}.{payload}").as_bytes());
        B64.encode(mac.finalize().into_bytes())
    }

    #[test]
    fn accepts_a_valid_v1_signature() {
        let payload = r#"{"type":"email.delivered","data":{"id":"em_1"}}"#;
        let sig = sign(SECRET, "msg_1", "1700000000", payload);
        let headers = WebhookHeaders::new("msg_1", "1700000000", format!("v1,{sig}"));
        let res = verify_webhook_signature(payload, &headers, SECRET, &NO_TOLERANCE);
        assert!(res.valid, "expected valid, got {:?}", res.reason);
    }

    #[test]
    fn accepts_when_any_of_multiple_signatures_matches() {
        let payload = "{}";
        let good = sign(SECRET, "msg_2", "1700000000", payload);
        let headers = WebhookHeaders::new(
            "msg_2",
            "1700000000",
            format!("v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= v1,{good}"),
        );
        assert!(verify_webhook_signature(payload, &headers, SECRET, &NO_TOLERANCE).valid);
    }

    #[test]
    fn rejects_a_tampered_payload() {
        let sig = sign(SECRET, "msg_3", "1700000000", "{\"a\":1}");
        let headers = WebhookHeaders::new("msg_3", "1700000000", format!("v1,{sig}"));
        let res = verify_webhook_signature("{\"a\":2}", &headers, SECRET, &NO_TOLERANCE);
        assert!(!res.valid);
        assert_eq!(res.reason, Some("no_match"));
    }

    #[test]
    fn rejects_missing_headers_and_missing_secret() {
        let headers = WebhookHeaders::new("", "1700000000", "v1,abc");
        let res = verify_webhook_signature("{}", &headers, SECRET, &NO_TOLERANCE);
        assert_eq!(res.reason, Some("missing_headers"));

        let headers = WebhookHeaders::new("msg", "1700000000", "v1,abc");
        let res = verify_webhook_signature("{}", &headers, "", &NO_TOLERANCE);
        assert_eq!(res.reason, Some("missing_secret"));
    }

    #[test]
    fn rejects_a_stale_timestamp_under_default_tolerance() {
        let payload = "{}";
        let sig = sign(SECRET, "msg_4", "1700000000", payload);
        let headers = WebhookHeaders::new("msg_4", "1700000000", format!("v1,{sig}"));
        let res =
            verify_webhook_signature(payload, &headers, SECRET, &VerifyWebhookOptions::default());
        assert!(!res.valid);
        assert_eq!(res.reason, Some("timestamp_out_of_tolerance"));
    }

    #[test]
    fn raw_secret_without_whsec_prefix_is_used_as_utf8() {
        let payload = "hello";
        let sig = sign("rawsecret", "msg_5", "1700000000", payload);
        let headers = WebhookHeaders::new("msg_5", "1700000000", format!("v1,{sig}"));
        assert!(verify_webhook_signature(payload, &headers, "rawsecret", &NO_TOLERANCE).valid);
    }

    /// The 16 key bytes all three spellings below decode to. `Buffer.from` gives
    /// the signer these bytes for every one of them, so the SDK must too.
    const KEY_BYTES: [u8; 16] = [
        0xfb, 0xff, 0xbe, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
        0x0d,
    ];
    const SECRET_PADDED: &str = "whsec_+/++AQIDBAUGBwgJCgsMDQ==";
    const SECRET_UNPADDED: &str = "whsec_+/++AQIDBAUGBwgJCgsMDQ";
    const SECRET_URL_SAFE: &str = "whsec_-_--AQIDBAUGBwgJCgsMDQ";

    /// Sign with the key BYTES, the way the server does — never through
    /// `secret_to_key`. The `sign` helper above derives its key with the very
    /// function under test, so it agrees with any deriver, a broken one
    /// included; only a signature made from the server's own key can catch a
    /// key the SDK derived differently.
    fn sign_with_key(key: &[u8], id: &str, ts: &str, payload: &str) -> String {
        let mut mac = HmacSha256::new_from_slice(key).unwrap();
        mac.update(format!("{id}.{ts}.{payload}").as_bytes());
        B64.encode(mac.finalize().into_bytes())
    }

    /// A `whsec_` suffix that is unpadded or URL-safe must derive the SAME key
    /// as the canonical spelling. `POST /webhooks` takes a caller-supplied
    /// secret verbatim, so these reach production; decoding them strictly
    /// yielded the raw secret string as the key and rejected 100% of the
    /// endpoint's genuine deliveries as `no_match`.
    #[test]
    fn accepts_an_unpadded_or_url_safe_secret_suffix() {
        let payload = r#"{"type":"email.delivered","data":{"id":"em_9"}}"#;
        let sig = sign_with_key(&KEY_BYTES, "msg_7", "1700000000", payload);
        let headers = WebhookHeaders::new("msg_7", "1700000000", format!("v1,{sig}"));

        for secret in [SECRET_PADDED, SECRET_UNPADDED, SECRET_URL_SAFE] {
            assert_eq!(
                secret_to_key(secret),
                KEY_BYTES.to_vec(),
                "{secret} must derive the signer's key"
            );
            let res = verify_webhook_signature(payload, &headers, secret, &NO_TOLERANCE);
            assert!(
                res.valid,
                "{secret} rejected a genuine delivery: {:?}",
                res.reason
            );
        }
    }

    // --- `whsec_` key-derivation conformance corpus -----------------------
    //
    // Generated FROM NODE by scripts/webhook-b64-corpus.mjs and inlined here on
    // purpose: read from that path at runtime and a published crate's tests stop
    // working, since the file ships with the monorepo, not the tarball.
    //
    // These vectors exist because a key that differs from the signer's does not
    // fail loudly. Verification just answers `no_match`, so a correctly wired
    // customer endpoint silently treats 100% of its genuine deliveries as
    // forged, and nothing anywhere logs a complaint. That failure has shipped
    // twice; the fix now has vectors instead of a plausible-looking reimplementation.
    //
    // `sig` is signed by NODE with the SERVER's key, never through
    // `secret_to_key`. That is the whole point — a signature made through the
    // function under test agrees with any deriver, a broken one included, so it
    // can only prove self-consistency. Only the server's own signature can prove
    // agreement with the server.
    //
    // 41 vectors, 10 of them raw-fallback. Both counts are asserted below and
    // the array length is pinned in the type, because the previous 31-vector
    // embed was ALL-ASCII and every SDK passed it while getting rule 5 wrong; a
    // lossy re-embed that quietly drops the ten high-codepoint vectors would go
    // green again on exactly the shapes that were broken in production.
    //
    // (name, secret, key_hex, key_is_raw_fallback, sig)
    #[allow(clippy::type_complexity)]
    const CORPUS: [(&str, &str, &str, bool, &str); 41] = [
        (
            "std_padded",
            "whsec_YWJjZA==",
            "61626364",
            false,
            "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg=",
        ),
        (
            "std_unpadded",
            "whsec_YWJjZA",
            "61626364",
            false,
            "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg=",
        ),
        (
            "std_exact4",
            "whsec_YWJj",
            "616263",
            false,
            "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=",
        ),
        (
            "short_1",
            "whsec_Y",
            "77687365635f59",
            true,
            "v1,ZMKGqdkd7rDYPj+XX10aKkkyV1NMbcTZ7tFWT6FOwdI=",
        ),
        (
            "short_2",
            "whsec_YW",
            "61",
            false,
            "v1,xnhr17yqBov566EgLaHShB0U7fh87lB6A7uiu7MAgLo=",
        ),
        (
            "short_3",
            "whsec_YWJ",
            "6162",
            false,
            "v1,Fen63yOpcFJsYPJGDIVlJAcEyTdJLIHURAdGZghc0kI=",
        ),
        (
            "interior_eq",
            "whsec_YWJjZA==ZXh0cmE",
            "61626364",
            false,
            "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg=",
        ),
        (
            "single_eq_mid",
            "whsec_SGVsbG8=V29ybGQ",
            "48656c6c6f",
            false,
            "v1,CZX45uWtP5WJeQEwRlfXHLHcHVZCe/8kJBOVyFNtg5Y=",
        ),
        (
            "eq_at_pos1",
            "whsec_Y=WJj",
            "77687365635f593d574a6a",
            true,
            "v1,UIfA+R8GMffinY6yCKf04G/2VJDSROFMoPH2eyquI0s=",
        ),
        (
            "leading_eq",
            "whsec_=YWJj",
            "77687365635f3d59574a6a",
            true,
            "v1,bCBBdBeVJ0HXeLD7IFOD+yuxa6OmPlOE1aglni87vcg=",
        ),
        (
            "only_eq",
            "whsec_=",
            "77687365635f3d",
            true,
            "v1,+Kwou17QNljxc57ZDXLHUV65F24WTp2IJ2Wrt4QX7GU=",
        ),
        (
            "urlsafe",
            "whsec_a-b_cd",
            "6be6ff71",
            false,
            "v1,fkOORhSnL1g+us9oP06M38Upg0O0DWHEjNrEp14Db3o=",
        ),
        (
            "urlsafe_long",
            "whsec_SGVsbG8td29ybGRfMTIz",
            "48656c6c6f2d776f726c645f313233",
            false,
            "v1,MQuwMf+xxNaiL4iSVxVAfo2ipZyhiRQ2nECOhs+/9cc=",
        ),
        (
            "space",
            "whsec_YW Jj",
            "616263",
            false,
            "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=",
        ),
        (
            "newline",
            "whsec_YW\nJj",
            "616263",
            false,
            "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=",
        ),
        (
            "tab",
            "whsec_YW\tJj",
            "616263",
            false,
            "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=",
        ),
        (
            "crlf",
            "whsec_YWJj\r\nZA",
            "61626364",
            false,
            "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg=",
        ),
        (
            "junk_bang",
            "whsec_YW!Jj",
            "616263",
            false,
            "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=",
        ),
        (
            "junk_at",
            "whsec_YW@#Jj",
            "616263",
            false,
            "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=",
        ),
        (
            "junk_unicode",
            "whsec_YWéJj",
            "616263",
            false,
            "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=",
        ),
        (
            "all_junk",
            "whsec_!!!!",
            "77687365635f21212121",
            true,
            "v1,58LmcOHpECIN1Kd9LCIwLIMvCWoASpvHQmdFktsf+gU=",
        ),
        (
            "empty",
            "whsec_",
            "77687365635f",
            true,
            "v1,aPFabYSxb1mJ7chEB+03S8aHnrX0lOYMM3NlpX8jlD0=",
        ),
        (
            "urlsafe_junk_eq",
            "whsec_a-b_c=d!e",
            "6be6ff",
            false,
            "v1,tCZ7/6V9FvVbB2YgSNYiDUQHBdTKAOdTBdvcu5juq4k=",
        ),
        (
            "real_shape",
            "whsec_cg6z29GIzlSydvyOkBWpEsGcKujWfHKh",
            "720eb3dbd188ce54b276fc8e9015a912c19c2ae8d67c72a1",
            false,
            "v1,9ibSgi4IvJt6jD8z6VsRB20hKehvwsMa2ytnUAiUTrM=",
        ),
        (
            "long_mixed",
            "whsec_QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVph-_YmNkZQ==",
            "4142434445464748494a4b4c4d4e4f505152535455565758595a61fbf626364650",
            false,
            "v1,wWHwga20dee3TMzivzmoRroQs9kbOe7nExI/9q8Arkc=",
        ),
        (
            "plus_slash",
            "whsec_a+b/cd",
            "6be6ff71",
            false,
            "v1,fkOORhSnL1g+us9oP06M38Upg0O0DWHEjNrEp14Db3o=",
        ),
        (
            "mixed_alpha",
            "whsec_a-b/c_d+e",
            "6be6ff73f77e",
            false,
            "v1,dexpl11tMd2WSNauNI5gjPiV1e53krdgh0erdyvdgoI=",
        ),
        (
            "many_eq",
            "whsec_YWJj====ZA",
            "616263",
            false,
            "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=",
        ),
        (
            "eq_then_pad",
            "whsec_YWJjZA===",
            "61626364",
            false,
            "v1,iQ3TgsWvMC6o2n0/+63tfcDdY+HpKHS1hGv7EXnaDmg=",
        ),
        (
            "nonascii_only",
            "whsec_éüñ",
            "77687365635fc3a9c3bcc3b1",
            true,
            "v1,EFNGWPcyr/96NM1jNdYvBKQ7cDfDlPpx1D8QnQV0bX4=",
        ),
        (
            "digits",
            "whsec_MTIzNDU2Nzg5MA",
            "31323334353637383930",
            false,
            "v1,RAjKzOdb0xlpZlm64AFX2dHxtKQ45vjn7ccB2VgrYxo=",
        ),
        (
            "hi_masks_to_A",
            "whsec_YWŁj",
            "616023",
            false,
            "v1,VL40mx0DtTM2Ikt2oCpzCyFMH7ScXmNlILOohrV8QNM=",
        ),
        (
            "hi_masks_to_eq",
            "whsec_YWJjĽZA",
            "616263",
            false,
            "v1,mTxyeI+DVWF63uQ5z0GuEyZ1Xlg+Z1pz6v675XyPSgk=",
        ),
        (
            "hi_masks_to_a",
            "whsec_šš",
            "69",
            false,
            "v1,qH+B7OwJNP75A4fe3wfM9VmT2/NDw3CmQzM4wFLDa6Y=",
        ),
        (
            "hi_masks_to_4",
            "whsec_YWJሴ",
            "616278",
            false,
            "v1,DaONzoMXkQD31ZqPmBOAOGJgLUGdfvTQ8laGoBzdhz0=",
        ),
        (
            "hi_masks_to_nul",
            "whsec_ĀĀĀĀ",
            "77687365635fc480c480c480c480",
            true,
            "v1,JVTFqibx23iRpUpvctjVuWsso1nYD2MtGUBfIwaOc/Y=",
        ),
        (
            "fullwidth",
            "whsec_ＹＷＪｊ",
            "f7b2",
            false,
            "v1,1KN9k08myfWQt8J2QP1T1iecIEckkiLWohn3HwjKCho=",
        ),
        (
            "astral_pair",
            "whsec_𝑁",
            "e4",
            false,
            "v1,VlIqZd+gIP90ykvTun54mNp62zzcFqpPgTSR1MNDcyM=",
        ),
        (
            "astral_emoji",
            "whsec_🎉",
            "77687365635ff09f8e89",
            true,
            "v1,wMaEB8aUXtVZo6CX0fOjkc2gWXqwvU10RIxi4KzRX6k=",
        ),
        (
            "cjk_skipped",
            "whsec_中文",
            "77687365635fe4b8ade69687",
            true,
            "v1,uK9WdHrxDFXtkfPvRaB5k/JBwL3EoYA762+/mb/V6yk=",
        ),
        (
            "mixed_hi_lo",
            "whsec_YWŁjĽZAšš",
            "616023",
            false,
            "v1,VL40mx0DtTM2Ikt2oCpzCyFMH7ScXmNlILOohrV8QNM=",
        ),
    ];
    const CORPUS_BODY: &str = "{\"type\":\"email.delivered\",\"data\":{\"id\":\"em_1\"}}";
    const CORPUS_ID: &str = "msg_conformance";
    const CORPUS_TS: &str = "1787200000";

    fn to_hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    /// Every secret shape must derive the byte-for-byte key Node derives.
    ///
    /// The corpus covers all five of Node's rules, each of which some SDK got
    /// wrong: `=` TERMINATES rather than pads (`YWJj====ZA` is `abc`, not
    /// `abcd`), out-of-alphabet bytes are skipped rather than fatal, `-`/`_` are
    /// translated rather than dropped, a 1-char trailing group contributes no
    /// byte, and the unit fed to the table is the low byte of each UTF-16 code
    /// unit rather than the codepoint or the UTF-8 byte.
    #[test]
    fn derives_node_s_key_for_every_corpus_secret() {
        assert_eq!(
            CORPUS.len(),
            41,
            "corpus must keep all 41 Node-generated vectors"
        );
        let mut wrong = Vec::new();
        for (name, secret, key_hex, _, _) in CORPUS {
            let got = to_hex(&secret_to_key(secret));
            if got != key_hex {
                wrong.push(format!("{name}: expected {key_hex}, derived {got}"));
            }
        }
        assert!(
            wrong.is_empty(),
            "{}/{} secrets derived a key the signer never used:\n  {}",
            wrong.len(),
            CORPUS.len(),
            wrong.join("\n  ")
        );
    }

    /// The same corpus through the PUBLIC verify API, against Node's own
    /// signatures — this is what a customer's endpoint actually calls.
    ///
    /// `tolerance_secs: 0` skips the freshness check because the corpus `ts` is
    /// fixed and would otherwise go stale minutes after it was generated,
    /// failing every vector for a reason that has nothing to do with the key.
    /// Freshness is covered separately by
    /// `rejects_a_stale_timestamp_under_default_tolerance`.
    #[test]
    fn verifies_node_signed_deliveries_for_every_corpus_secret() {
        assert_eq!(
            CORPUS.len(),
            41,
            "corpus must keep all 41 Node-generated vectors"
        );
        let mut rejected = Vec::new();
        for (name, secret, _, _, sig) in CORPUS {
            let headers = WebhookHeaders::new(CORPUS_ID, CORPUS_TS, sig);
            let res = verify_webhook_signature(CORPUS_BODY, &headers, secret, &NO_TOLERANCE);
            if !res.valid {
                rejected.push(format!("{name} ({:?})", res.reason));
            }
        }
        assert!(
            rejected.is_empty(),
            "{}/{} genuine deliveries rejected as forged:\n  {}",
            rejected.len(),
            CORPUS.len(),
            rejected.join("\n  ")
        );
    }

    /// The raw-UTF-8 fallback, called out on its own because it is the half that
    /// lives in the CALLER rather than the decoder, and every SDK got it wrong.
    ///
    /// When the suffix decodes to ZERO bytes the key is the UTF-8 of the WHOLE
    /// secret — `whsec_` prefix INCLUDED — not an empty key and not the bare
    /// suffix. Ten of the 41 vectors land here, three of them only because
    /// masking emptied them, for two different reasons: `ĀĀĀĀ` masks to four
    /// NULs and `🎉` to 0x3C/0x89, none of which are in the alphabet; `中文`
    /// masks to 0x2D and 0x87, and 0x2D IS in the alphabet (it is the URL-safe
    /// `-`), so it survives the filter and empties only because ONE usable
    /// character cannot encode a byte. Same outcome, different rule.
    #[test]
    fn empty_decode_falls_back_to_the_whole_secret_as_utf8() {
        let fallbacks: Vec<_> = CORPUS.iter().filter(|v| v.3).collect();
        assert_eq!(
            fallbacks.len(),
            10,
            "corpus should hold 10 raw-fallback shapes"
        );

        for (name, secret, key_hex, _, sig) in fallbacks {
            // The whole secret, prefix and all — not `secret[6..]`, not empty.
            assert_eq!(
                to_hex(secret.as_bytes()),
                *key_hex,
                "{name}: fallback key must be the whole secret's UTF-8 bytes"
            );
            assert_eq!(
                to_hex(&secret_to_key(secret)),
                *key_hex,
                "{name}: derived key"
            );

            let headers = WebhookHeaders::new(CORPUS_ID, CORPUS_TS, *sig);
            assert!(
                verify_webhook_signature(CORPUS_BODY, &headers, secret, &NO_TOLERANCE).valid,
                "{name}: rejected a genuine delivery"
            );
        }
    }

    /// `=` ends the input; it does not pad it. Pinned separately so the
    /// regression that shipped twice has a test naming it.
    #[test]
    fn eq_terminates_the_suffix_rather_than_padding_it() {
        // Tail after the first `=` is DISCARDED, never concatenated.
        assert_eq!(secret_to_key("whsec_YWJj====ZA"), b"abc".to_vec());
        assert_eq!(secret_to_key("whsec_YWJjZA==ZXh0cmE"), b"abcd".to_vec());
        assert_eq!(secret_to_key("whsec_SGVsbG8=V29ybGQ"), b"Hello".to_vec());
        // Truncating to nothing decodable is the raw fallback, not an empty key.
        assert_eq!(secret_to_key("whsec_=YWJj"), b"whsec_=YWJj".to_vec());
        assert_eq!(secret_to_key("whsec_Y=WJj"), b"whsec_Y=WJj".to_vec());
    }

    /// Rule 5: the unit is the LOW BYTE of each UTF-16 CODE UNIT.
    ///
    /// Pinned separately, and by name, because it is the one rule no ASCII
    /// vector can catch: the old 31-vector corpus was green in every SDK while
    /// all of them mis-derived every key below, so any customer whose secret
    /// carried a character above U+00FF had 100% of its genuine deliveries
    /// answered `no_match`. Each case is a different consequence of the mask —
    /// it can MINT an alphabet character out of a letter that has none, it can
    /// mint the TERMINATOR, and on an astral codepoint it runs over the two
    /// SURROGATES rather than the scalar.
    #[test]
    fn masks_utf16_code_units_to_their_low_byte() {
        // U+0141 masks to 0x41 'A': a real sextet, not a skipped junk char.
        assert_eq!(secret_to_key("whsec_YW\u{0141}j"), vec![0x61, 0x60, 0x23]);
        // U+013D masks to 0x3D '=', which TERMINATES — the trailing `ZA` is gone.
        assert_eq!(secret_to_key("whsec_YWJj\u{013D}ZA"), b"abc".to_vec());
        // U+0161 masks to 0x61 'a'; the 2-char group carries exactly one byte.
        assert_eq!(secret_to_key("whsec_\u{0161}\u{0161}"), vec![0x69]);
        // U+1234 masks to 0x34 '4' — the mask is the low byte, not a codepoint
        // range check, so a Ethiopic syllable is a digit here.
        assert_eq!(secret_to_key("whsec_YWJ\u{1234}"), vec![0x61, 0x62, 0x78]);
        // Fullwidth Ｙ Ｗ Ｊ ｊ mask to '9', '7', '*', 'J'; the '*' is skipped.
        assert_eq!(
            secret_to_key("whsec_\u{FF39}\u{FF37}\u{FF2A}\u{FF4A}"),
            vec![0xf7, 0xb2]
        );
        // U+1D441 is ASTRAL: its surrogates 0xD835/0xDC41 mask to '5' and 'A'.
        assert_eq!(secret_to_key("whsec_\u{1D441}"), vec![0xe4]);
        // ...and emphatically NOT its UTF-8 bytes (f0 9d 91 81), whose low bytes
        // are all outside the alphabet and would decode to nothing, taking the
        // raw fallback instead of this one byte.
        assert_ne!(
            secret_to_key("whsec_\u{1D441}"),
            "whsec_\u{1D441}".as_bytes().to_vec()
        );
        // Masking runs BEFORE the alphabet filter, so the decode can empty out
        // into the raw fallback two ways. U+0100 masks to NUL and U+1F389 to
        // 0x3C/0x89 — none in the alphabet, so all are skipped as junk. U+4E2D
        // is the interesting one: it masks to 0x2D, which IS in the alphabet
        // (URL-safe `-`), so it is NOT skipped; the decode empties because
        // U+6587 masks to 0x87 and one lone usable character encodes no byte.
        for secret in [
            "whsec_\u{0100}\u{0100}\u{0100}\u{0100}",
            "whsec_\u{1F389}",
            "whsec_\u{4E2D}\u{6587}",
        ] {
            assert_eq!(
                secret_to_key(secret),
                secret.as_bytes().to_vec(),
                "{secret} must take the whole-secret UTF-8 fallback"
            );
        }
        // The corpus must keep carrying these shapes; drop them and everything
        // else in this module is an ASCII test again.
        for name in [
            "hi_masks_to_A",
            "hi_masks_to_eq",
            "hi_masks_to_a",
            "hi_masks_to_4",
            "hi_masks_to_nul",
            "fullwidth",
            "astral_pair",
            "astral_emoji",
            "cjk_skipped",
            "mixed_hi_lo",
        ] {
            assert!(
                CORPUS.iter().any(|v| v.0 == name),
                "corpus lost rule-5 vector {name}"
            );
        }
    }

    #[test]
    fn untagged_signature_is_accepted() {
        let payload = "x";
        let sig = sign(SECRET, "msg_6", "1700000000", payload);
        let headers = WebhookHeaders::new("msg_6", "1700000000", sig);
        assert!(verify_webhook_signature(payload, &headers, SECRET, &NO_TOLERANCE).valid);
    }
}

//! Integration tests that drive the real client against a tiny in-process
//! HTTP/1.1 stub (std `TcpListener`, one request per test) via the
//! `SendPing::with_base_url` override — no network, no mocks framework.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};

use sendping::{
    ApiKeyPermission, BatchEmailOptions, CampaignListItem, Error, SendEmailOptions,
    ListEmailsParams, ListSegmentsParams, SendPing, PaginationParams, SegmentFilterOptions,
    TemplateRef, UpdateAutomationStepOptions, UpdateSegmentOptions, UpdateTemplateOptions,
    UpdateTopicOptions, FOLDER_SCHEDULED,
};

/// Find the first occurrence of `needle` in `haystack`.
fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Parse the JSON body out of a captured raw request. Assertions about a key
/// being ABSENT need the body alone — `request.contains` would also see the
/// headers.
fn json_body(request: &str) -> serde_json::Value {
    let (_, body) = request
        .split_once("\r\n\r\n")
        .expect("request has a header/body separator");
    serde_json::from_str(body).expect("request body is JSON")
}

/// Spawn a one-shot HTTP stub. Returns the base URL and a handle that yields
/// the raw request (start-line + headers + body) once the stub has answered.
fn spawn_stub(status: u16, body: &'static str) -> (String, JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind stub listener");
    let addr = listener.local_addr().expect("stub addr");
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buf: Vec<u8> = Vec::new();
        let mut tmp = [0u8; 4096];
        loop {
            let n = stream.read(&mut tmp).expect("read request");
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..n]);
            if let Some(header_end) = find_subsequence(&buf, b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&buf[..header_end]).to_string();
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        if name.trim().eq_ignore_ascii_case("content-length") {
                            value.trim().parse::<usize>().ok()
                        } else {
                            None
                        }
                    })
                    .unwrap_or(0);
                if buf.len() >= header_end + 4 + content_length {
                    break;
                }
            }
        }
        let reason = match status {
            200 => "OK",
            404 => "Not Found",
            422 => "Unprocessable Entity",
            _ => "Status",
        };
        let response = format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len(),
        );
        stream
            .write_all(response.as_bytes())
            .expect("write response");
        let _ = stream.flush();
        String::from_utf8_lossy(&buf).to_string()
    });
    (format!("http://{addr}"), handle)
}

/// Spawn a stub that answers a SEQUENCE of responses, one per incoming
/// connection (the client sends `Connection: close`, so each retry reconnects).
/// The thread is detached: a broken retry loop makes fewer requests, which
/// surfaces as the client call failing — never as a hang.
fn spawn_stub_seq(responses: Vec<(u16, &'static str, Option<&'static str>)>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind stub listener");
    let addr = listener.local_addr().expect("stub addr");
    thread::spawn(move || {
        for (status, body, retry_after) in responses {
            let (mut stream, _) = match listener.accept() {
                Ok(s) => s,
                Err(_) => break,
            };
            let mut buf: Vec<u8> = Vec::new();
            let mut tmp = [0u8; 4096];
            loop {
                let n = match stream.read(&mut tmp) {
                    Ok(n) => n,
                    Err(_) => break,
                };
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&tmp[..n]);
                if let Some(header_end) = find_subsequence(&buf, b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&buf[..header_end]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            if name.trim().eq_ignore_ascii_case("content-length") {
                                value.trim().parse::<usize>().ok()
                            } else {
                                None
                            }
                        })
                        .unwrap_or(0);
                    if buf.len() >= header_end + 4 + content_length {
                        break;
                    }
                }
            }
            let ra = retry_after
                .map(|v| format!("Retry-After: {v}\r\n"))
                .unwrap_or_default();
            let response = format!(
                "HTTP/1.1 {status} Status\r\nContent-Type: application/json\r\n{ra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len(),
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn retries_a_429_then_succeeds() {
    // First attempt is rate-limited (Retry-After: 0 → no real wait); the retry
    // gets a 200. Reaching "em_ok" proves the client reconnected and retried.
    let base_url = spawn_stub_seq(vec![
        (
            429,
            r#"{"statusCode":429,"name":"rate_limited","message":"slow down"}"#,
            Some("0"),
        ),
        (200, r#"{"id":"em_ok"}"#, None),
    ]);
    let mb = SendPing::with_base_url("mb_test_key", base_url);
    let email = SendEmailOptions::new("Acme <hi@x.com>", ["b@y.com"], "Hi").with_html("<p>x</p>");
    let sent = mb
        .emails
        .send(email)
        .await
        .expect("send should succeed after retrying the 429");
    assert_eq!(sent.id, "em_ok");
}

#[tokio::test]
async fn does_not_retry_a_422() {
    // A single 422 stub: if the client wrongly retried, the second attempt would
    // hit a closed listener and the error would change — it must surface the 422.
    let base_url = spawn_stub_seq(vec![(
        422,
        r#"{"statusCode":422,"name":"validation_error","message":"bad"}"#,
        None,
    )]);
    let mb = SendPing::with_base_url("mb_test_key", base_url);
    let email = SendEmailOptions::new("Acme <hi@x.com>", ["b@y.com"], "Hi").with_html("<p>x</p>");
    let err = mb.emails.send(email).await.expect_err("422 should fail");
    match err {
        Error::Api(api) => assert_eq!(api.status_code, 422),
        other => panic!("expected Error::Api(422), got {other:?}"),
    }
}

#[tokio::test]
async fn sends_an_email_with_auth_and_json_body() {
    let (base_url, handle) = spawn_stub(200, r#"{"id":"em_123"}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let email =
        SendEmailOptions::new("Acme <hello@yourdomain.com>", ["user@example.com"], "Hello")
            .with_html("<p>Hi</p>");

    let sent = mb.emails.send(email).await.expect("send should succeed");
    assert_eq!(sent.id, "em_123");

    let request = handle.join().unwrap();
    let lower = request.to_lowercase();
    assert!(
        request.starts_with("POST /emails HTTP/1.1"),
        "got: {request}"
    );
    assert!(lower.contains("authorization: bearer mb_test_key"));
    assert!(lower.contains("user-agent: sendping-rust/"));
    assert!(request.contains(r#""from":"Acme <hello@yourdomain.com>""#));
    assert!(request.contains(r#""to":["user@example.com"]"#));
    assert!(request.contains(r#""html":"<p>Hi</p>""#));
    // Unset optional fields must be omitted, not sent as null.
    assert!(!request.contains(r#""text""#));
}

/// A send that references a template must OMIT an empty `from`/`subject` so the
/// template's own values fill in. The API keys off key PRESENCE
/// (lib/send/resolve_template.ts: `body.from != null ? body.from : published.from`),
/// so `"from":""` counted as "supplied": the send was rejected with 422
/// missing_required_field, and a supplied-from/blank-subject payload went out
/// with an EMPTY subject line instead of the template's rendered one.
#[tokio::test]
async fn template_send_omits_an_empty_from_and_subject() {
    let (base_url, handle) = spawn_stub(200, r#"{"id":"em_t1"}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let email = SendEmailOptions {
        to: vec!["delivered@test.sendping.co".into()],
        template: Some(TemplateRef::by_id("tpl_1").with_variable("name", "Ada")),
        ..Default::default()
    };
    assert_eq!(mb.emails.send(email).await.expect("send").id, "em_t1");

    let body = json_body(&handle.join().unwrap());
    let map = body.as_object().expect("an object body");
    assert!(
        !map.contains_key("from"),
        "empty from must be omitted: {body}"
    );
    assert!(
        !map.contains_key("subject"),
        "empty subject must be omitted: {body}"
    );
    assert_eq!(body["template"]["id"], "tpl_1");
}

/// The flat `template_id` form gets the same treatment.
#[tokio::test]
async fn template_id_send_omits_an_empty_from_and_subject() {
    let (base_url, handle) = spawn_stub(200, r#"{"id":"em_t2"}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let email = SendEmailOptions {
        to: vec!["delivered@test.sendping.co".into()],
        template_id: Some("tpl_1".into()),
        ..Default::default()
    };
    assert_eq!(mb.emails.send(email).await.expect("send").id, "em_t2");

    let body = json_body(&handle.join().unwrap());
    let map = body.as_object().expect("an object body");
    assert!(!map.contains_key("from"), "got: {body}");
    assert!(!map.contains_key("subject"), "got: {body}");
    assert_eq!(body["template_id"], "tpl_1");
}

/// An explicit from/subject still overrides the template's, so both keys are
/// present when the caller supplies them — the rule is key presence, not
/// emptiness.
#[tokio::test]
async fn template_send_keeps_an_explicit_from_and_subject() {
    let (base_url, handle) = spawn_stub(200, r#"{"id":"em_t3"}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let email = SendEmailOptions::new(
        "Acme <hello@yourdomain.com>",
        ["delivered@test.sendping.co"],
        "Override",
    )
    .with_template_id("tpl_1");
    assert_eq!(mb.emails.send(email).await.expect("send").id, "em_t3");

    let body = json_body(&handle.join().unwrap());
    assert_eq!(body["from"], "Acme <hello@yourdomain.com>");
    assert_eq!(body["subject"], "Override");
}

/// A `template` carrying neither `id` nor `alias` references NOTHING, and it
/// shadows `template_id` while doing so — the server's own extraction rule
/// (lib/send/resolve_template.ts `templateRefOf`). Such a payload is an
/// ordinary send, so both keys must ride along and let the server answer.
#[tokio::test]
async fn an_empty_template_ref_shadows_template_id_and_references_nothing() {
    let (base_url, handle) = spawn_stub(
        422,
        r#"{"statusCode":422,"name":"missing_required_field","message":"`from`, `to`, and `subject` are required."}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let email = SendEmailOptions {
        to: vec!["delivered@test.sendping.co".into()],
        template: Some(TemplateRef::default()),
        template_id: Some("tpl_1".into()),
        ..Default::default()
    };
    mb.emails.send(email).await.expect_err("server rejects it");

    let body = json_body(&handle.join().unwrap());
    assert_eq!(body["from"], "");
    assert_eq!(body["subject"], "");
}

/// Without a template the two keys are ALWAYS sent, empty included: the API
/// documents `subject: ""` as a legal empty subject (sendping_validate.ts
/// treats only null as missing), and a missing `from` must still surface as the
/// server's `missing_required_field` rather than being reshaped by the SDK.
#[tokio::test]
async fn non_template_send_always_sends_from_and_subject() {
    let (base_url, handle) = spawn_stub(200, r#"{"id":"em_t4"}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let email = SendEmailOptions::new("Acme <hi@x.com>", ["delivered@test.sendping.co"], "")
        .with_html("<p>x</p>");
    assert_eq!(mb.emails.send(email).await.expect("send").id, "em_t4");

    let body = json_body(&handle.join().unwrap());
    assert_eq!(body["from"], "Acme <hi@x.com>");
    assert_eq!(body["subject"], "");
}

/// The batch route resolves a template PER ITEM, so one item's empty
/// `from`/`subject` must be omitted exactly as a single send's is — and a
/// non-template item in the same array must keep both keys.
#[tokio::test]
async fn batch_items_follow_the_same_template_rule() {
    let (base_url, handle) = spawn_stub(200, r#"{"data":[{"id":"em_b1"},{"id":"em_b2"}]}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let templated = BatchEmailOptions {
        to: vec!["delivered@test.sendping.co".into()],
        template: Some(TemplateRef::by_alias("welcome")),
        ..Default::default()
    };
    let plain = BatchEmailOptions::new("Acme <hi@x.com>", ["delivered@test.sendping.co"], "")
        .with_html("<p>x</p>");
    mb.batch
        .send_emails(vec![templated, plain])
        .await
        .expect("batch should succeed");

    let body = json_body(&handle.join().unwrap());
    let items = body.as_array().expect("a JSON array body");
    let first = items[0].as_object().expect("an object item");
    assert!(!first.contains_key("from"), "got: {}", items[0]);
    assert!(!first.contains_key("subject"), "got: {}", items[0]);
    assert_eq!(items[0]["template"]["alias"], "welcome");
    assert_eq!(items[1]["from"], "Acme <hi@x.com>");
    assert_eq!(items[1]["subject"], "");
}

/// A batch item with `template_id` and an explicit from/subject keeps both —
/// the same presence rule, on the flat form.
#[tokio::test]
async fn batch_template_id_item_omits_empty_but_keeps_explicit_values() {
    let (base_url, handle) = spawn_stub(200, r#"{"data":[{"id":"em_b3"},{"id":"em_b4"}]}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let bare = BatchEmailOptions {
        to: vec!["delivered@test.sendping.co".into()],
        template_id: Some("tpl_1".into()),
        ..Default::default()
    };
    let explicit = BatchEmailOptions::new(
        "Acme <hello@yourdomain.com>",
        ["delivered@test.sendping.co"],
        "Override",
    )
    .with_template_id("tpl_1");
    mb.batch
        .send_emails(vec![bare, explicit])
        .await
        .expect("batch should succeed");

    let body = json_body(&handle.join().unwrap());
    let items = body.as_array().expect("a JSON array body");
    let first = items[0].as_object().expect("an object item");
    assert!(!first.contains_key("from"), "got: {}", items[0]);
    assert!(!first.contains_key("subject"), "got: {}", items[0]);
    assert_eq!(items[0]["template_id"], "tpl_1");
    assert_eq!(items[1]["from"], "Acme <hello@yourdomain.com>");
    assert_eq!(items[1]["subject"], "Override");
}

#[tokio::test]
async fn maps_non_2xx_to_api_error() {
    let (base_url, handle) = spawn_stub(
        422,
        r#"{"statusCode":422,"name":"validation_error","message":"domain is required"}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let err = mb.domains.get("dom_1").await.expect_err("should fail");
    match err {
        Error::Api(api) => {
            assert_eq!(api.status_code, 422);
            assert_eq!(api.name, "validation_error");
            assert_eq!(api.message, "domain is required");
        }
        other => panic!("expected Error::Api, got {other:?}"),
    }
    handle.join().unwrap();
}

/// A quota rejection must reach the caller with the `limit` object intact —
/// end to end, through the real client — or they cannot tell WHICH quota
/// stopped them.
#[tokio::test]
async fn surfaces_the_plan_limit_object_end_to_end() {
    let base_url = spawn_stub_seq(vec![(
        429,
        r#"{"statusCode":429,"name":"daily_quota_exceeded","message":"Daily send limit reached.","limit":{"kind":"emails_daily","used":100,"limit":100,"requested":3,"remaining":0,"period":"24h","plan":{"id":"free","name":"Free"},"next_plan":{"id":"pro","name":"Pro","amount":1400,"currency":"USD","monthly_emails":50000,"daily_emails":2000,"domains":10,"contacts":10000,"ai_credits":100,"automation_runs":10000},"credits":{"balance":0,"needed":1,"purchasable":true,"unit":1000,"amount_per_unit_cents":100}}}"#,
        None,
    )]);
    // No retry budget: the 429 is the assertion subject, not a transient.
    let mb = SendPing::builder("mb_test_key")
        .base_url(base_url)
        .max_retries(0)
        .build();
    let email =
        SendEmailOptions::new("Acme <hi@x.com>", ["b@y.com"], "Hi").with_html("<p>x</p>");

    let err = mb.emails.send(email).await.expect_err("quota should fail");
    let api = err.api().expect("an API error");
    assert_eq!(api.status_code, 429);
    assert_eq!(api.name, "daily_quota_exceeded");
    let limit = api.limit.as_ref().expect("the limit object");
    assert_eq!(limit.kind, "emails_daily");
    assert_eq!((limit.used, limit.limit), (100, 100));
    assert_eq!(limit.period.as_deref(), Some("24h"));
    assert_eq!(limit.next_plan.as_ref().map(|p| p.id.as_str()), Some("pro"));
    assert!(api.reputation.is_none());
    assert!(api.sent.is_empty());
}

/// A batch that failed part way through names the emails that DID go out, so
/// a retry can skip them.
#[tokio::test]
async fn surfaces_partial_batch_sent_end_to_end() {
    let base_url = spawn_stub_seq(vec![(
        429,
        r#"{"statusCode":429,"name":"daily_quota_exceeded","message":"Daily send limit reached.","limit":{"kind":"emails_daily","used":100,"limit":100,"plan":{"id":"free","name":"Free"}},"sent":[{"id":"em_1"},{"id":"em_2"}],"sent_count":2}"#,
        None,
    )]);
    let mb = SendPing::builder("mb_test_key")
        .base_url(base_url)
        .max_retries(0)
        .build();
    let email = BatchEmailOptions::new("Acme <hi@x.com>", ["b@y.com"], "Hi").with_html("<p>x</p>");

    let err = mb
        .batch
        .send_emails_with_idempotency_key(vec![email], "batch-1")
        .await
        .expect_err("quota should stop the batch");
    let api = err.api().expect("an API error");
    assert_eq!(api.sent_count, 2);
    let ids: Vec<&str> = api.sent.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(ids, vec!["em_1", "em_2"]);
    assert_eq!(
        api.limit.as_ref().map(|l| l.kind.as_str()),
        Some("emails_daily")
    );
}

/// `POST /webhooks/:id/test` answers 200 even when the delivery FAILED, so the
/// call succeeds and the real outcome is `ok`.
#[tokio::test]
async fn webhook_test_failure_is_a_200_with_ok_false() {
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"object":"webhook_test","id":"42","ok":false,"error":"lookup_failed"}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let result = mb
        .webhooks
        .test("42")
        .await
        .expect("a failed delivery is still HTTP 200, not an Err");
    assert!(!result.ok, "ok must report the real delivery outcome");
    assert_eq!(result.error.as_deref(), Some("lookup_failed"));
    assert_eq!(result.status, None);

    let request = handle.join().unwrap();
    assert!(
        request.starts_with("POST /webhooks/42/test HTTP/1.1"),
        "got: {request}"
    );
}

#[tokio::test]
async fn webhook_test_success_reports_the_endpoint_status() {
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"object":"webhook_test","id":"42","ok":true,"status":200}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let result = mb.webhooks.test("42").await.expect("test should succeed");
    assert!(result.ok);
    assert_eq!(result.status, Some(200));
    assert!(result.error.is_none());
    handle.join().unwrap();
}

#[tokio::test]
async fn segments_list_requires_domain_in_query() {
    let (base_url, handle) = spawn_stub(200, r#"{"object":"list","has_more":false,"data":[]}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let page = mb
        .segments
        .list(ListSegmentsParams::new("example.com").with_limit(10))
        .await
        .expect("list should succeed");
    assert!(page.data.is_empty());
    assert!(!page.has_more);

    let request = handle.join().unwrap();
    assert!(
        request.starts_with("GET /segments?domain=example.com&limit=10 HTTP/1.1"),
        "got: {request}"
    );
}

#[tokio::test]
async fn contact_email_ids_are_percent_encoded_in_the_path() {
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"object":"contact","id":"con_1","email":"user@example.com","first_name":null,"last_name":null,"unsubscribed":false,"created_at":"2026-01-01T00:00:00Z"}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let contact = mb
        .contacts
        .get(sendping::ContactLookup::new("user@example.com").with_domain("example.com"))
        .await
        .expect("get should succeed");
    assert_eq!(contact.id, "con_1");

    let request = handle.join().unwrap();
    assert!(
        request.starts_with("GET /contacts/user%40example.com?domain=example.com HTTP/1.1"),
        "got: {request}"
    );
}

#[tokio::test]
async fn idempotency_key_header_is_sent() {
    let (base_url, handle) = spawn_stub(200, r#"{"id":"em_9"}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let email = SendEmailOptions::new("a@b.com", ["c@d.com"], "S");
    mb.emails
        .send_with_idempotency_key(email, "order-123")
        .await
        .expect("send should succeed");

    let request = handle.join().unwrap();
    assert!(request
        .to_lowercase()
        .contains("idempotency-key: order-123"));
}

/// The documented bound is 1-255 characters, measured AFTER the server trims
/// the value (`api_idempotency.key` is `VARCHAR(255)`) — 255, not 256. The
/// constant is exported so the rule is discoverable; the key itself is sent
/// verbatim and the SERVER answers an out-of-range one with
/// `400 invalid_idempotency_key`, so this crate never pre-checks it.
#[tokio::test]
async fn over_long_idempotency_key_is_left_to_the_server() {
    assert_eq!(sendping::IDEMPOTENCY_KEY_MAX_LEN, 255);

    let (base_url, handle) = spawn_stub(200, r#"{"id":"em_9"}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let too_long = "k".repeat(sendping::IDEMPOTENCY_KEY_MAX_LEN + 1);
    let email = SendEmailOptions::new("a@b.com", ["c@d.com"], "S");
    mb.emails
        .send_with_idempotency_key(email, &too_long)
        .await
        .expect("the SDK must not reject the key locally");

    let request = handle.join().unwrap();
    assert!(request
        .to_lowercase()
        .contains(&format!("idempotency-key: {too_long}")));
}

#[tokio::test]
async fn received_attachment_downloads_return_raw_bytes() {
    let (base_url, handle) = spawn_stub(200, "%PDF-1.7 raw bytes, not json");
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let bytes = mb
        .emails
        .receiving
        .get_attachment("re_1", "att_1")
        .await
        .expect("download should succeed");
    assert_eq!(bytes, b"%PDF-1.7 raw bytes, not json".to_vec());

    let request = handle.join().unwrap();
    assert!(
        request.starts_with("GET /emails/receiving/re_1/attachments/att_1 HTTP/1.1"),
        "got: {request}"
    );
}

#[tokio::test]
async fn email_list_filters_include_status_and_search() {
    let (base_url, handle) = spawn_stub(200, r#"{"object":"list","has_more":false,"data":[]}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    mb.emails
        .list_filtered(Some(
            ListEmailsParams::new()
                .with_limit(10)
                .with_status("bounced")
                .with_search("acme"),
        ))
        .await
        .expect("list should succeed");

    let request = handle.join().unwrap();
    assert!(
        request.starts_with("GET /emails?limit=10&status=bounced&search=acme HTTP/1.1"),
        "got: {request}"
    );
}

#[tokio::test]
async fn email_list_folder_filter_reaches_the_query_string() {
    let (base_url, handle) = spawn_stub(200, r#"{"object":"list","has_more":false,"data":[]}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    mb.emails
        .list_filtered(Some(ListEmailsParams::new().with_folder(FOLDER_SCHEDULED)))
        .await
        .expect("list should succeed");

    let request = handle.join().unwrap();
    assert!(
        request.starts_with("GET /emails?folder=scheduled HTTP/1.1"),
        "got: {request}"
    );
}

#[tokio::test]
async fn sent_email_rows_expose_domain_and_origin_ids() {
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"object":"list","has_more":false,"data":[{"id":"em_1","object":"email",
            "message_id":null,"to":["a@x.com"],"from":"Me <me@x.com>","domain_id":"dom_1",
            "created_at":"2026-08-08T10:00:00.000Z","subject":"Hi","bcc":null,"cc":null,
            "reply_to":null,"last_event":"delivered","scheduled_at":null,
            "campaign_id":"cmp_1","automation_id":null}]}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let page = mb.emails.list(None).await.expect("list should succeed");
    let row = &page.data[0];
    assert_eq!(row.domain_id.as_deref(), Some("dom_1"));
    assert_eq!(row.campaign_id.as_deref(), Some("cmp_1"));
    assert!(row.automation_id.is_none());
    // List rows use null, not [], for unset recipient lists.
    assert!(row.cc.is_none());
    handle.join().unwrap();
}

#[tokio::test]
async fn received_email_decodes_raw_pointer_without_expires_at() {
    // The receiving route omits optional keys entirely, and `raw` carries only
    // `download_url` — requiring `expires_at` would fail every decode.
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"object":"received_email","id":"re_1","from":"s@other.com","to":["hi@x.com"],
            "domain_id":"dom_1","subject":"Hello","category":null,"reply_to_email_id":null,
            "raw_available":true,"raw":{"download_url":"https://x/raw"},
            "created_at":"2026-08-08T10:00:00.000Z"}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let received = mb
        .emails
        .receiving
        .get("re_1")
        .await
        .expect("receiving.get should decode");
    assert_eq!(received.domain_id.as_deref(), Some("dom_1"));
    let raw = received.raw.expect("raw pointer present");
    assert_eq!(raw.download_url, "https://x/raw");
    assert!(raw.expires_at.is_none());
    handle.join().unwrap();
}

#[tokio::test]
async fn deleted_contact_response_reads_the_id_field() {
    // The route returns `{object,id,deleted}` — an `id` typo here made every
    // contacts.remove() call fail to decode.
    let (base_url, handle) = spawn_stub(200, r#"{"object":"contact","id":"con_1","deleted":true}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let removed = mb
        .contacts
        .remove(sendping::ContactLookup::new("con_1"))
        .await
        .expect("remove should decode");
    assert_eq!(removed.id, "con_1");
    assert!(removed.deleted);
    handle.join().unwrap();
}

#[tokio::test]
async fn contact_segments_are_reduced_refs() {
    // `GET /contacts/:id/segments` returns {id,name,created_at} only — not the
    // full segment object.
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"object":"list","has_more":false,"data":[{"id":"seg_1","name":"VIP","created_at":null}]}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let page = mb
        .contacts
        .list_segments("con_1", None)
        .await
        .expect("list_segments should decode");
    assert_eq!(page.data[0].name, "VIP");
    handle.join().unwrap();
}

#[tokio::test]
async fn segment_contacts_are_the_reduced_shape() {
    // The resolver returns rows with no `object` and no `properties`.
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"object":"list","has_more":false,"data":[{"id":"con_1","email":"a@x.com",
            "first_name":null,"last_name":null,"created_at":null,"unsubscribed":false}]}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let page = mb
        .segments
        .contacts("seg_1", Some(PaginationParams::new().with_limit(50)))
        .await
        .expect("segment contacts should decode");
    assert_eq!(page.data[0].email, "a@x.com");

    let request = handle.join().unwrap();
    assert!(
        request.starts_with("GET /segments/seg_1/contacts?limit=50 HTTP/1.1"),
        "got: {request}"
    );
}

#[tokio::test]
async fn template_list_rows_omit_the_object_key() {
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"object":"list","has_more":false,"data":[{"id":"tmpl_1","name":"Welcome",
            "subject":null,"html":null,"status":"draft","published_at":null,
            "created_at":"2026-08-08T00:00:00.000Z","updated_at":"2026-08-08T00:00:00.000Z",
            "alias":null,"has_unpublished_versions":false}]}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let page = mb.templates.list(None).await.expect("list should decode");
    assert_eq!(page.data[0].id, "tmpl_1");
    assert_eq!(page.data[0].status.as_deref(), Some("draft"));
    handle.join().unwrap();
}

/// `GET /campaigns` sends a narrower row than `GET /campaigns/:id`: no
/// bodies, no `from`/`topic_id`/`reply_to`/`preview_text`, no schedule detail,
/// follow-ups, recurrence or statistics. Typing the list as `Campaign` would
/// promise all of those; it decodes as [`CampaignListItem`] instead.
#[tokio::test]
async fn campaign_list_rows_are_the_trimmed_shape() {
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"object":"list","has_more":false,"data":[{"object":"campaign","id":"cmp_1",
            "name":"Launch","subject":"Hi","audience_id":"aud_1","segment_id":null,
            "status":"sent","ab_test":{"enabled":false},
            "created_at":"2026-08-08T00:00:00.000Z","scheduled_at":null,
            "sent_at":"2026-08-08T01:00:00.000Z","failure_reason":null}]}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let page = mb.campaigns.list(None).await.expect("list should decode");
    let row: &CampaignListItem = &page.data[0];
    assert_eq!(row.id, "cmp_1");
    assert_eq!(row.subject.as_deref(), Some("Hi"));
    assert_eq!(row.audience_id, "aud_1");
    assert_eq!(row.status, "sent");
    assert!(row.segment_id.is_none());
    assert!(!row.ab_test.as_ref().expect("ab_test marker").enabled);
    handle.join().unwrap();
}

#[tokio::test]
async fn template_variables_carry_only_the_declaration() {
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"object":"template","id":"tmpl_1","current_version_id":null,"alias":null,
            "name":"Welcome","created_at":"2026-08-08T00:00:00.000Z",
            "updated_at":"2026-08-08T00:00:00.000Z","status":"draft","published_at":null,
            "from":null,"subject":null,"reply_to":null,"html":null,"text":null,
            "variables":[{"key":"first_name","type":"string","fallback_value":null}],
            "has_unpublished_versions":false}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let template = mb.templates.get("tmpl_1").await.expect("get should decode");
    let variables = template.variables.expect("variables present");
    assert_eq!(variables[0].key, "first_name");
    handle.join().unwrap();
}

/// `api_keys` is read-only: key create / re-scope / revoke are dashboard-only,
/// so `list` is the whole surface. Absence of the write methods is a
/// compile-time guarantee, asserted by the `compile_fail` doctest on
/// `ApiKeysSvc` (`cargo test --doc`) — it cannot be checked at runtime here.
#[tokio::test]
async fn api_key_list_reads_prefixes_and_scoping() {
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"object":"list","has_more":false,"data":[
            {"id":"42","name":"CI","token":"mb_ab12","permission":"sending_access",
             "domain_id":null,"domain_ids":["dom_1"],
             "created_at":"2026-08-08T00:00:00.000Z","last_used_at":null}]}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let keys = mb.api_keys.list(None).await.expect("list should decode");
    let key = &keys.data[0];
    assert_eq!(key.permission, ApiKeyPermission::SendingAccess);
    assert_eq!(key.token.as_deref(), Some("mb_ab12"));
    assert_eq!(
        key.domain_ids.as_deref(),
        Some(["dom_1".to_string()].as_slice())
    );

    let request = handle.join().unwrap();
    assert!(
        request.starts_with("GET /api-keys HTTP/1.1"),
        "got: {request}"
    );
}

#[tokio::test]
async fn mx_check_passes_the_domain_name_as_a_query_param() {
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"has_mx":true,"ours":false,"records":[{"exchange":"mx.example.com","priority":10}]}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let result = mb
        .domains
        .mx_check("example.com")
        .await
        .expect("mx_check should decode");
    assert!(result.has_mx);
    assert_eq!(result.records[0].exchange, "mx.example.com");

    let request = handle.join().unwrap();
    assert!(
        request.starts_with("GET /domains/mx-check?name=example.com HTTP/1.1"),
        "got: {request}"
    );
}

#[tokio::test]
async fn every_request_carries_a_user_agent() {
    // A blank User-Agent is a hard 403 on every documented endpoint, so the
    // header must ride on plain GETs too — not just the JSON POST paths.
    let (base_url, handle) = spawn_stub(200, r#"{"object":"list","has_more":false,"data":[]}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    mb.emails.sources().await.expect("sources should succeed");

    let request = handle.join().unwrap();
    let lower = request.to_lowercase();
    assert!(
        request.starts_with("GET /emails/sources HTTP/1.1"),
        "got: {request}"
    );
    assert!(
        lower.contains("user-agent: sendping-rust/"),
        "got: {request}"
    );
    assert!(
        lower.contains("authorization: bearer mb_test_key"),
        "got: {request}"
    );
}

#[tokio::test]
async fn pagination_params_apply_to_list_endpoints() {
    let (base_url, handle) = spawn_stub(200, r#"{"object":"list","has_more":true,"data":[]}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let page = mb
        .emails
        .list(Some(
            PaginationParams::new().with_limit(25).with_after("em_5"),
        ))
        .await
        .expect("list should succeed");
    assert!(page.has_more);

    let request = handle.join().unwrap();
    assert!(
        request.starts_with("GET /emails?limit=25&after=em_5 HTTP/1.1"),
        "got: {request}"
    );
}

#[tokio::test]
async fn contact_topics_are_paginated_like_their_siblings() {
    // `GET /contacts/:id/topics` is a paginated list endpoint (forceLimit
    // false). Before 3.0.0 `get_topics` took no params, so limit/after/before
    // were unreachable from Rust and `has_more` was not even modelled.
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"object":"list","has_more":true,"data":[{"id":"top_1","name":"Product","description":null,"subscription":"opt_in"}]}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let topics = mb
        .contacts
        .get_topics(
            "con_1",
            Some(PaginationParams::new().with_limit(2).with_after("top_9")),
        )
        .await
        .expect("get_topics should decode");

    assert!(topics.has_more, "has_more must round-trip off the envelope");
    assert_eq!(topics.data.len(), 1);

    let request = handle.join().unwrap();
    assert!(
        request.contains("limit=2"),
        "limit must reach the query string: {request}"
    );
    assert!(
        request.contains("after=top_9"),
        "after must reach the query string: {request}"
    );
}

#[tokio::test]
async fn template_update_can_clear_fields_with_an_explicit_null() {
    // PATCH semantics are `'key' in body`-based: a key present with null
    // clears the field, an absent key leaves it untouched. Before 3.0.0 the
    // clearable template fields were plain `Option<T>`, so "clear" could not
    // be expressed at all.
    let (base_url, handle) = spawn_stub(200, r#"{"object":"template","id":"tpl_1"}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    mb.templates
        .update(
            "tpl_1",
            UpdateTemplateOptions::new()
                .with_name("Receipt")
                .clear_alias()
                .clear_subject()
                .clear_from()
                .clear_reply_to()
                .clear_html()
                .clear_text(),
        )
        .await
        .expect("update should decode");

    let request = handle.join().unwrap();
    for key in ["alias", "subject", "from", "reply_to", "html", "text"] {
        assert!(
            request.contains(&format!("\"{key}\":null")),
            "{key} must be sent as an explicit null: {request}"
        );
    }
    assert!(request.contains("\"name\":\"Receipt\""));
}

#[tokio::test]
async fn segment_update_can_clear_the_engagement_predicate() {
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"object":"segment","id":"seg_1","audience_id":"aud_1","name":"VIP",
            "filter":{"status":"all","email_contains":null,"property_filters":[],"engagement":null},
            "created_at":null,"updated_at":null}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    mb.segments
        .update(
            "seg_1",
            UpdateSegmentOptions::new().with_filter(
                SegmentFilterOptions::new()
                    .clear_engagement()
                    .clear_property_filters(),
            ),
        )
        .await
        .expect("update should decode");

    let request = handle.join().unwrap();
    assert!(
        request.contains("\"engagement\":null"),
        "engagement must be sent as an explicit null: {request}"
    );
    assert!(
        request.contains("\"property_filters\":[]"),
        "property_filters must be sent as an empty array: {request}"
    );
}

#[tokio::test]
async fn topic_update_can_clear_the_description() {
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"object":"topic","id":"top_1","audience_id":"aud_1","name":"Product",
            "description":null,"default_subscription":"opt_in","visibility":"public",
            "created_at":"2026-08-09T00:00:00Z"}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    mb.topics
        .update("top_1", UpdateTopicOptions::new().clear_description())
        .await
        .expect("update should decode");

    let request = handle.join().unwrap();
    assert!(
        request.contains("\"description\":null"),
        "description must be sent as an explicit null: {request}"
    );
}

/// A batch above the inline ceiling (40 emails) is QUEUED, not sent: the route
/// answers 202 with `queued: true` and the ids belong to `scheduled` rows the
/// worker has not transmitted yet. Modelling only `data` made a queued batch
/// indistinguishable from a delivered one.
#[tokio::test]
async fn batch_send_reports_a_queued_batch() {
    let (base_url, handle) = spawn_stub(
        202,
        r#"{"data":[{"id":"em_1"},{"id":"em_2"}],"queued":true,"queued_count":2}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);
    let email =
        BatchEmailOptions::new("Acme <hi@x.com>", ["delivered@test.sendping.co"], "Hi").with_html("<p>x</p>");

    let sent = mb
        .batch
        .send_emails(vec![email])
        .await
        .expect("a 202 is a success status");
    assert!(sent.queued, "a 202 batch was queued, not transmitted");
    assert_eq!(sent.queued_count, Some(2));
    assert_eq!(sent.data.len(), 2);

    let request = handle.join().unwrap();
    assert!(
        request.starts_with("POST /emails/batch HTTP/1.1"),
        "got: {request}"
    );
}

/// The inline path answers 200 with no `queued` key at all — that must read as
/// "sent", not fail to decode.
#[tokio::test]
async fn batch_send_inline_reads_as_not_queued() {
    let (base_url, _handle) = spawn_stub(200, r#"{"data":[{"id":"em_1"}]}"#);
    let mb = SendPing::with_base_url("mb_test_key", base_url);
    let email =
        BatchEmailOptions::new("Acme <hi@x.com>", ["delivered@test.sendping.co"], "Hi").with_html("<p>x</p>");

    let sent = mb
        .batch
        .send_emails(vec![email])
        .await
        .expect("inline batch should decode");
    assert!(!sent.queued);
    assert_eq!(sent.queued_count, None);
}

/// `PATCH /automations/:id/steps/:step_id` runs the SAME step validator as the
/// add route, which rejects a body without `type` as a 422 — so the type must
/// always ride along, even when only the config changes.
#[tokio::test]
async fn automation_step_update_always_sends_the_type() {
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"id":"stp_1","key":"stp_1","type":"delay","position":1,"config":{"duration":"2 days"}}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let step = mb
        .automations
        .update_step(
            "aut_1",
            "stp_1",
            UpdateAutomationStepOptions::new("delay")
                .with_config(serde_json::json!({ "duration": "2 days" })),
        )
        .await
        .expect("step update should decode");
    assert_eq!(step.step_type, "delay");

    let request = handle.join().unwrap();
    assert!(
        request.starts_with("PATCH /automations/aut_1/steps/stp_1 HTTP/1.1"),
        "got: {request}"
    );
    assert!(
        request.contains(r#""type":"delay""#),
        "`type` is required by the route: {request}"
    );
    // The route forwards only type+config to storage; a `key` here would be a
    // silent no-op, so the body must not pretend the graph key is settable.
    assert!(
        !request.contains("\"key\""),
        "update must not send a graph key the route ignores: {request}"
    );
}

/// The received-attachment LIST route serializes `size` as `size ?? null`, so a
/// legacy row without one must not make the whole page undecodable.
#[tokio::test]
async fn received_attachment_size_tolerates_an_explicit_null() {
    let (base_url, _handle) = spawn_stub(
        200,
        r#"{"object":"list","has_more":false,"data":[
            {"object":"attachment","id":"0","filename":"legacy.pdf","size":null,
             "content_type":null,"content_disposition":"attachment","content_id":null,
             "downloadable":false}]}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let page = mb
        .emails
        .receiving
        .list_attachments("rec_1", None)
        .await
        .expect("a null size must not fail the page");
    assert_eq!(page.data.len(), 1);
    assert_eq!(page.data[0].size, 0);
    assert!(!page.data[0].downloadable);
}

/// An unpaginated list is capped at UNPAGINATED_MAX (1,000) server-side and
/// says so through `has_more` — the SDK must surface that, not imply the page
/// was the whole collection.
#[tokio::test]
async fn unpaginated_list_surfaces_a_truncating_has_more() {
    let (base_url, handle) = spawn_stub(
        200,
        r#"{"object":"list","has_more":true,"data":[
            {"id":"con_1","email":"a@x.com","first_name":null,"last_name":null,
             "unsubscribed":false,"created_at":null}]}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let page = mb
        .segments
        .contacts("seg_1", None)
        .await
        .expect("segment membership should decode");
    assert!(
        page.has_more,
        "an unpaginated page can still be truncated at 1,000 rows"
    );

    let request = handle.join().unwrap();
    assert!(
        request.starts_with("GET /segments/seg_1/contacts HTTP/1.1"),
        "got: {request}"
    );
}

#[tokio::test]
async fn batch_in_domain_posts_the_flat_bulk_door() {
    // The domain-first bulk door. One batch takes the account's contact-limit
    // lock once, where a `create` loop takes it per contact.
    let (base_url, handle) = spawn_stub(
        201,
        r#"{"object":"contact_import","imported":2,"updated":0,"skipped":0,"total":2}"#,
    );
    let mb = SendPing::with_base_url("mb_test_key", base_url);

    let result = mb
        .contacts
        .batch_in_domain(
            "x.com",
            vec![
                sendping::ContactInput::new("a@b.com"),
                sendping::ContactInput::new("c@d.com"),
            ],
            Some(sendping::OnConflict::Skip),
        )
        .await
        .expect("batch_in_domain should succeed");
    assert_eq!(result.imported, 2);

    let request = handle.join().unwrap();
    assert!(
        request.starts_with("POST /contacts/batch?on_conflict=skip HTTP/1.1"),
        "got: {request}"
    );
    // `domain` travels in the BODY on the flat route, same as POST /contacts.
    let body = json_body(&request);
    assert_eq!(body["domain"], "x.com");
    assert_eq!(body["contacts"][0]["email"], "a@b.com");
}

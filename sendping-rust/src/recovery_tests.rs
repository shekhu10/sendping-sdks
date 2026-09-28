use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::thread::{self, JoinHandle};

// Bounded, joined HTTP fixture: even a wrong retry count cannot leave an
// accept thread running forever or hang the test process.
struct Server {
    url: String,
    requests: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Server {
    fn new(status: u16, body: String, extra_headers: String) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&requests);
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = Arc::clone(&stop);
        let thread = thread::spawn(move || {
            while !stopped.load(Ordering::SeqCst) {
                let (mut stream, _) = match listener.accept() {
                    Ok(s) => s,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(e) => panic!("accept: {e}"),
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buf = [0; 4096];
                loop {
                    let n = stream.read(&mut buf).unwrap();
                    if n == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buf[..n]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]);
                        let len = headers
                            .lines()
                            .find_map(|l| {
                                let (key, value) = l.split_once(':')?;
                                if key.eq_ignore_ascii_case("content-length") {
                                    value.trim().parse::<usize>().ok()
                                } else {
                                    None
                                }
                            })
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + len {
                            break;
                        }
                    }
                }
                let first = {
                    let mut all = captured.lock().unwrap();
                    all.push(String::from_utf8(bytes).unwrap());
                    all.len() == 1
                };
                let (code, payload) = if first {
                    (status, body.as_str())
                } else {
                    (200, "{\"id\":\"em_retry\"}")
                };
                let response = format!("HTTP/1.1 {code} Status\r\nContent-Type: application/json\r\nRetry-After: 0\r\n{extra_headers}Content-Length: {}\r\nConnection: close\r\n\r\n{payload}", payload.len());
                let _ = stream.write_all(response.as_bytes());
            }
        });
        Self {
            url,
            requests,
            stop,
            thread: Some(thread),
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let result = thread.join();
            if !thread::panicking() {
                result.unwrap();
            }
        }
    }
}

#[tokio::test]
async fn shared_recovery_corpus() {
    let local = include_str!("http-recovery-corpus.json");
    if let Ok(shared) = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../scripts/http-recovery-corpus.json"
    )) {
        assert_eq!(
            local, shared,
            "refresh src/http-recovery-corpus.json from the shared corpus"
        );
    }
    let cases: Vec<Value> = serde_json::from_str(local).unwrap();
    for c in cases {
        let server = Server::new(
            c["status"].as_u64().unwrap() as u16,
            c["body"].to_string(),
            String::new(),
        );
        let config = Config {
            api_key: "mb_test".into(),
            base_url: server.url.clone(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(2))
                .build()
                .unwrap(),
            max_retries: 1,
        };
        let mut req = config
            .request(
                Method::from_bytes(c["method"].as_str().unwrap().as_bytes()).unwrap(),
                c["path"].as_str().unwrap(),
            )
            .json(&serde_json::json!({"text":"a  b\n\n c"}));
        if let Some(key) = c["key"].as_str() {
            req = req.header("Idempotency-Key", key);
        }
        let result: Result<Value> = config.send(req).await;
        let requests = server.requests.lock().unwrap();
        assert_eq!(
            requests.len(),
            c["attempts"].as_u64().unwrap() as usize,
            "{}",
            c["name"]
        );
        if requests.len() == 1 {
            match result.unwrap_err() {
                Error::Api(e) => assert_eq!(e.status_code as u64, c["status"].as_u64().unwrap()),
                other => panic!("{other:?}"),
            }
        } else {
            assert!(result.is_ok(), "{}", c["name"]);
        }
        for req in requests.iter() {
            if let Some(key) = c["key"].as_str() {
                assert!(req.contains(&format!("idempotency-key: {key}\r\n")));
            }
            let body: Value = serde_json::from_str(req.split_once("\r\n\r\n").unwrap().1).unwrap();
            assert_eq!(body["text"], "a  b\n\n c");
        }
    }
}

#[tokio::test]
async fn reply_forward_keys_and_tracking_health() {
    let server = Server::new(200, "{\"id\":\"em_one\"}".into(), String::new());
    let mb = SendPing::with_base_url("mb_test", server.url.clone());
    mb.emails
        .receiving
        .reply_with_idempotency_key(
            "rcv_one",
            ReplyReceivedEmailOptions::new("a@b.test").with_text("a  b\n\n c"),
            "reply-1",
        )
        .await
        .unwrap();
    mb.emails
        .receiving
        .forward_with_idempotency_key(
            "rcv_one",
            ForwardReceivedEmailOptions::new("a@b.test", ["c@d.test"]),
            "forward-1",
        )
        .await
        .unwrap();
    let requests = server.requests.lock().unwrap();
    assert!(requests[0].contains("idempotency-key: reply-1\r\n"));
    assert!(requests[1].contains("idempotency-key: forward-1\r\n"));
    let body: Value = serde_json::from_str(requests[0].split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(body["text"], "a  b\n\n c");
    drop(requests);
    let health = Server::new(
        200,
        r#"{"custom_host":null,"status":"shared","checked_at":"2026-09-10T00:00:00Z"}"#.into(),
        String::new(),
    );
    let mb = SendPing::with_base_url("mb_test", health.url.clone());
    let result = mb.domains.tracking_health("domain one").await.unwrap();
    assert_eq!(result.status, "shared");
    assert!(result.custom_host.is_none());
    assert!(health.requests.lock().unwrap()[0]
        .starts_with("GET /domains/domain%20one/tracking-health "));
}

#[tokio::test]
async fn default_client_refuses_redirects() {
    let target = Server::new(200, "{\"id\":\"redirected\"}".into(), String::new());
    let origin = Server::new(
        307,
        "{}".into(),
        format!("Location: {}/collect\r\n", target.url),
    );
    let mb = SendPing::with_base_url("mb_test", origin.url.clone());
    let error = mb
        .emails
        .send(SendEmailOptions::new("a@b.test", ["c@d.test"], "private").with_text("private body"))
        .await
        .unwrap_err();
    match error {
        Error::Api(e) => assert_eq!(e.status_code, 307),
        other => panic!("{other:?}"),
    }
    assert!(target.requests.lock().unwrap().is_empty());
}

#[test]
fn recovery_metadata_uses_transport_status() {
    let error = api_error(422, br#"{"statusCode":503,"name":"validation_error","id":"em_one","reserved":[{"id":"em_one"}],"unsent_count":0}"#);
    match error {
        Error::Api(e) => {
            assert_eq!(e.status_code, 422);
            assert_eq!(e.id(), Some("em_one"));
            assert_eq!(e.reserved().unwrap()[0].id, "em_one");
            assert_eq!(e.unsent_count(), Some(0));
        }
        other => panic!("{other:?}"),
    }
}

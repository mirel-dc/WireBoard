use serde_json::{Value, json};
use std::time::Duration;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn container_listener_keeps_internal_cli_and_external_browser_authenticated() {
    let dir = tempfile::tempdir().unwrap();
    let exe = env!("CARGO_BIN_EXE_wireboard");
    let public = "http://127.0.0.1:19848";
    let mut server = tokio::process::Command::new(exe)
        .args([
            "serve",
            "--listen",
            "0.0.0.0",
            "--port",
            "0",
            "--public-origin",
            public,
            "--data-dir",
        ])
        .arg(dir.path())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let runtime_path = dir.path().join("runtime.json");
    let mut runtime = None;
    for _ in 0..150 {
        assert!(
            server.try_wait().unwrap().is_none(),
            "Container serve flags must start a server"
        );
        if let Ok(bytes) = std::fs::read(&runtime_path) {
            runtime = serde_json::from_slice::<Value>(&bytes).ok();
            if runtime.is_some() {
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let runtime = runtime.expect("Runtime must be ready");
    let endpoint = runtime["endpoint"].as_str().unwrap();
    assert!(endpoint.starts_with("http://127.0.0.1:"));
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let output = tokio::process::Command::new(exe)
        .arg("--data-dir")
        .arg(dir.path())
        .args(["open", "--print-url"])
        .output()
        .await
        .unwrap();
    assert!(
        output.status.success(),
        "CLI must create browser grant with internal endpoint"
    );
    let url = String::from_utf8(output.stdout).unwrap();
    assert_eq!(
        url.trim(),
        format!("{public}/"),
        "CLI must return the ordinary published URL"
    );
    let read = client
        .get(format!("{endpoint}/api/boards"))
        .header("Host", "127.0.0.1:19848")
        .send()
        .await
        .unwrap();
    assert_eq!(read.status(), 200);
    let create = client
        .post(format!("{endpoint}/api/boards"))
        .header("Host", "127.0.0.1:19848")
        .header("Origin", public)
        .json(&json!({"title":"Container board"}))
        .send()
        .await
        .unwrap();
    assert_eq!(create.status(), 200);
    let inspect = tokio::process::Command::new(exe)
        .arg("--data-dir")
        .arg(dir.path())
        .arg("boards")
        .output()
        .await
        .unwrap();
    assert!(inspect.status.success());
    let boards: Value = serde_json::from_slice(&inspect.stdout).unwrap();
    assert!(
        boards
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["title"] == "Container board")
    );
    for (host, origin) in [
        ("evil.example", public),
        ("127.0.0.1:19848", "https://evil.example"),
        ("127.0.0.1:19848", endpoint),
    ] {
        let response = client
            .post(format!("{endpoint}/api/boards"))
            .header("Host", host)
            .header("Origin", origin)
            .json(&json!({"title":"Rejected"}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 403);
    }
    server.kill().await.unwrap();
}

#[tokio::test]
async fn unsafe_public_origins_and_specific_lan_listeners_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let exe = env!("CARGO_BIN_EXE_wireboard");
    for origin in [
        "http://evil.example:9843",
        "http://127.0.0.1:9843/path",
        "http://user@127.0.0.1:9843",
        "https://127.0.0.1:9843",
        "http://127.0.0.1:9843/#secret",
    ] {
        let result = tokio::process::Command::new(exe)
            .args(["serve", "--public-origin", origin, "--data-dir"])
            .arg(dir.path())
            .output()
            .await
            .unwrap();
        assert!(!result.status.success());
        let error: Value = serde_json::from_slice(&result.stderr)
            .expect("Invalid origin must be structured validation");
        assert_eq!(error["code"], "validation");
        assert!(!runtime_exists(dir.path()));
    }
    let result = tokio::process::Command::new(exe)
        .args(["serve", "--listen", "192.168.1.1", "--data-dir"])
        .arg(dir.path())
        .output()
        .await
        .unwrap();
    assert!(!result.status.success());
    let error: Value = serde_json::from_slice(&result.stderr).unwrap();
    assert_eq!(error["code"], "validation");
}
fn runtime_exists(root: &std::path::Path) -> bool {
    root.join("runtime.json").exists()
}

#[tokio::test]
async fn different_local_ports_have_independent_libraries_without_cookies() {
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;
    use wireboard::{
        api::{ApiState, router},
        store::Store,
    };
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    for (dir, port) in [(&first, 19849), (&second, 19850)] {
        let origin = format!("http://127.0.0.1:{port}");
        let state = ApiState::new(
            Store::open(dir.path()).unwrap(),
            "http://127.0.0.1:9843".into(),
            "cli-token".into(),
        )
        .with_browser_origin(origin.clone());
        assert_eq!(state.browser_url(), format!("{origin}/"));
        let app = router(state);
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/boards")
                    .header("Host", format!("127.0.0.1:{port}"))
                    .header("Origin", &origin)
                    .header("Content-Type", "application/json")
                    .body(Body::from(
                        json!({"title":format!("Library {port}")}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/boards")
                    .header("Host", format!("127.0.0.1:{port}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let boards: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(boards.as_array().unwrap().len(), 1);
        assert_eq!(boards[0]["title"], format!("Library {port}"));
    }
}

use serde_json::{Value, json};
use wireboard::{
    api::{ApiState, router},
    store::Store,
};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shared_runtime_uses_the_published_port_and_blocks_a_second_server() {
    let dir = tempfile::tempdir().unwrap();
    let shared = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    store.create("Shared library").unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let state = ApiState::new(store, url.clone(), "shared-secret".into());
    let task = tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
    wireboard::platform::write_private_runtime(&shared.path().join("runtime.json"), &serde_json::to_vec(&json!({"endpoint":"http://127.0.0.1:1","browser_endpoint":url,"token":"shared-secret","pid":99999})).unwrap()).unwrap();
    let exe = env!("CARGO_BIN_EXE_wireboard");
    let output = tokio::process::Command::new(exe)
        .arg("--data-dir")
        .arg(shared.path())
        .arg("boards")
        .output()
        .await
        .unwrap();
    assert!(
        output.status.success(),
        "Native CLI must reach a container's published port: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let boards: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(boards[0]["title"], "Shared library");
    let mut command = tokio::process::Command::new(exe);
    command
        .arg("--data-dir")
        .arg(shared.path())
        .args(["serve", "--port", "0"])
        .kill_on_drop(true);
    let output = tokio::time::timeout(std::time::Duration::from_secs(5), command.output())
        .await
        .expect("A second server must be rejected before overwriting the shared runtime")
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("Библиотека уже открыта"));
    let runtime: Value =
        serde_json::from_slice(&std::fs::read(shared.path().join("runtime.json")).unwrap())
            .unwrap();
    assert_eq!(runtime["token"], "shared-secret");
    task.abort();
}

#[tokio::test]
async fn local_library_opens_without_a_grant_and_survives_reopening() {
    let dir = tempfile::tempdir().unwrap();
    let id = {
        let mut store = Store::open(dir.path()).unwrap();
        store.create("Старая доска").unwrap().id
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let state = ApiState::new(
        Store::open(dir.path()).unwrap(),
        url.clone(),
        "cli-secret".into(),
    );
    let task = tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let read = client
        .get(format!("{url}/api/boards"))
        .send()
        .await
        .unwrap();
    assert_eq!(
        read.status(),
        200,
        "An ordinary local URL opens the library"
    );
    let boards: Value = read.json().await.unwrap();
    assert_eq!(boards[0]["id"], id);
    assert_eq!(
        client
            .get(format!("{url}/api/boards"))
            .bearer_auth("stale-other-library-token")
            .send()
            .await
            .unwrap()
            .status(),
        401,
        "A CLI with a stale runtime must not read another library"
    );
    let info: Value = client
        .get(format!("{url}/api/library"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(info["boardCount"], 1);
    assert!(info["path"].as_str().unwrap().contains("boards"));
    let alias = url.replace("127.0.0.1", "localhost");
    let create = client
        .post(format!("{url}/api/boards"))
        .header("Host", alias.strip_prefix("http://").unwrap())
        .header("Origin", &alias)
        .header("Sec-Fetch-Site", "same-origin")
        .json(&json!({"title":"Из другого браузера"}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        create.status(),
        200,
        "localhost and the browser need no cookie"
    );
    assert_eq!(
        client
            .get(format!("{url}/api/boards"))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        2
    );
    for origin in ["https://evil.example", "http://127.0.0.1:1"] {
        assert_eq!(
            client
                .get(format!("{url}/api/boards"))
                .header("Origin", origin)
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
    }
    for site in ["cross-site", "same-site"] {
        assert_eq!(
            client
                .get(format!("{url}/api/boards"))
                .header("Sec-Fetch-Site", site)
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
    }
    assert_eq!(
        client
            .post(format!("{url}/api/boards"))
            .json(&json!({"title":"Blind write"}))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        client
            .get(format!("{url}/api/boards"))
            .header("Host", "evil.example")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    task.abort();
}

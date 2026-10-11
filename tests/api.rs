use serde_json::{Value, json};
use wireboard::{
    api::{ApiState, router},
    store::Store,
};
async fn server() -> (tempfile::TempDir, String, tokio::task::JoinHandle<()>) {
    let dir = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let state = ApiState::new(
        Store::open(dir.path()).unwrap(),
        format!("http://{addr}"),
        "secret".into(),
    );
    let task = tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
    (dir, format!("http://{addr}"), task)
}
#[tokio::test]
async fn two_clients_only_one_wins() {
    let (_dir, url, task) = server().await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let board: Value = client
        .post(format!("{url}/api/boards"))
        .bearer_auth("secret")
        .json(&json!({"title":"Test"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id = board["id"].as_str().unwrap();
    let endpoint = format!("{url}/api/boards/{id}/apply");
    let body = json!({"revision":0,"operations":[{"op":"create","element":{"kind":"rectangle","text":"winner"}}]});
    let (a, b) = tokio::join!(
        client
            .post(&endpoint)
            .bearer_auth("secret")
            .json(&body)
            .send(),
        client
            .post(&endpoint)
            .bearer_auth("secret")
            .json(&body)
            .send()
    );
    let mut statuses = vec![a.unwrap().status().as_u16(), b.unwrap().status().as_u16()];
    statuses.sort();
    assert_eq!(statuses, vec![200, 409]);
    let board: Value = client
        .get(format!("{url}/api/boards/{id}"))
        .bearer_auth("secret")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(board["revision"], 1);
    assert_eq!(board["elements"].as_array().unwrap().len(), 1);
    task.abort();
}
#[tokio::test]
async fn auth_origin_and_limits() {
    let (_dir, url, task) = server().await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    assert_eq!(
        client
            .get(format!("{url}/api/boards"))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        client
            .get(format!("{url}/api/boards"))
            .bearer_auth("secret")
            .header("Origin", "https://evil.example")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .get(format!("{url}/api/boards"))
            .bearer_auth("secret")
            .header("Host", "evil.example")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .get(&url)
            .header("Sec-Fetch-Site", "cross-site")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let home = client.get(&url).send().await.unwrap();
    assert!(
        home.headers().get("set-cookie").is_none(),
        "Unauthenticated GET must not grant a session"
    );
    assert_eq!(
        client
            .post(format!("{url}/api/boards"))
            .json(&json!({"title":"bad"}))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .post(format!("{url}/api/boards"))
            .header("Origin", &url)
            .json(&json!({"title":"Local"}))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let address = url.strip_prefix("http://").unwrap();
    let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
    socket.write_all(format!("POST /api/import HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer secret\r\nContent-Type: application/json\r\nContent-Length: 34603008\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
    let mut response = Vec::new();
    socket.read_to_end(&mut response).await.unwrap();
    assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 413"));
    task.abort();
}

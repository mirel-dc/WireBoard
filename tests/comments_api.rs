use serde_json::{Value, json};
use wireboard::{
    api::{ApiState, router},
    store::Store,
};
#[tokio::test]
async fn agent_context_auth_filter_and_stale_batch() {
    let dir = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let state = ApiState::new(
        Store::open(dir.path()).unwrap(),
        url.clone(),
        "secret".into(),
    );
    let task = tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let b: Value = client
        .post(format!("{url}/api/boards"))
        .bearer_auth("secret")
        .json(&json!({"title":"Context"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id = b["id"].as_str().unwrap();
    let apply = format!("{url}/api/boards/{id}/apply");
    let read = format!("{url}/api/boards/{id}/comments");
    let b:Value=client.post(&apply).bearer_auth("secret").json(&json!({"revision":0,"operations":[{"op":"create","element":{"kind":"rectangle","title":"Сервис"}},{"op":"comment_create","author":"user","text":"Уточни","anchor":{"type":"element","elementId":1,"u":1,"v":0}}]})).send().await.unwrap().json().await.unwrap();
    assert_eq!(b["revision"], 1);
    assert_eq!(client.get(&read).send().await.unwrap().status(), 200);
    let context = client
        .get(&read)
        .bearer_auth("secret")
        .send()
        .await
        .unwrap();
    assert_eq!(context.status(), 200);
    let context: Value = context.json().await.unwrap();
    assert_eq!(context["revision"], 1);
    assert_eq!(context["threads"][0]["target"]["title"], "Сервис");
    assert_eq!(context["threads"][0]["orphaned"], false);
    assert_eq!(
        client
            .get(format!("{read}?thread=99"))
            .bearer_auth("secret")
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        client
            .get(format!("{read}?status=bad"))
            .bearer_auth("secret")
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    let agent = json!({"revision":1,"operations":[{"op":"update","id":1,"patch":{"text":"Готово"}},{"op":"comment_reply","threadId":1,"author":"codex","text":"Обновил","submitForReview":true}]});
    let human = json!({"revision":1,"operations":[{"op":"comment_reply","threadId":1,"author":"user","text":"Дополнение","submitForReview":false}]});
    assert_eq!(
        client
            .post(&apply)
            .bearer_auth("secret")
            .json(&human)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        client
            .post(&apply)
            .bearer_auth("secret")
            .json(&agent)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    let b: Value = client
        .get(format!("{url}/api/boards/{id}"))
        .bearer_auth("secret")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(b["elements"][0]["text"], "");
    assert_eq!(b["comments"][0]["messages"].as_array().unwrap().len(), 2);
    let empty: Value = client
        .get(format!("{read}?status=resolved&thread=1"))
        .bearer_auth("secret")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(empty["threads"], json!([]));
    task.abort();
}

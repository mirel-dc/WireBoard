mod common;
use serde_json::{Value, json};
use wireboard::{
    api::{ApiState, router},
    history::{self, Actor, CommandRequest, FieldGuard, Source},
    model::{Board, Operation},
    store::Store,
};
async fn server() -> (
    tempfile::TempDir,
    String,
    ApiState,
    Board,
    tokio::task::JoinHandle<()>,
) {
    let dir = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let b = store.create("Test").unwrap();
    let b = store
        .apply(
            &b.id,
            0,
            &ops(json!([{"op":"create","element":{"kind":"rectangle"}}])),
        )
        .unwrap();
    let state = ApiState::new(store, format!("http://{addr}"), "secret".into());
    let router = router(state.clone());
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (dir, format!("http://{addr}"), state, b, task)
}
fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}
fn ops(v: Value) -> Vec<Operation> {
    serde_json::from_value(v).unwrap()
}
async fn send(url: &str, id: &str, request: &CommandRequest) -> reqwest::Response {
    client()
        .post(format!("{url}/api/boards/{id}/apply"))
        .bearer_auth("secret")
        .json(request)
        .send()
        .await
        .unwrap()
}
#[tokio::test]
async fn legacy_apply_stays_compatible() {
    let (_d, url, _, b, task) = server().await;
    let r = send(
        &url,
        &b.id,
        &CommandRequest {
            revision: 1,
            operations: ops(json!([{"op":"move","ids":[1],"dx":20,"dy":0}])),
            command: None,
            guards: None,
        },
    )
    .await;
    assert_eq!(r.status(), 200);
    let b: Board = r.json().await.unwrap();
    assert_eq!(b.element(1).unwrap().x, 20.0);
    task.abort();
}
#[tokio::test]
async fn guarded_stale_move_merges_text_but_not_position() {
    let (_d, url, state, b, task) = server().await;
    let mut req = common::request(1, ops(json!([{"op":"move","ids":[1],"dx":40,"dy":0}])));
    let stamps = state.store.lock().await.stamps(&b.id).unwrap();
    req.guards = Some(
        history::required_guards(&b, &req.operations)
            .unwrap()
            .into_iter()
            .map(|key| FieldGuard {
                value: history::read_field(&b, &key),
                stamp: history::stamp(&stamps, &key),
                key,
            })
            .collect(),
    );
    // JavaScript serializes integral geometry as 0, rather than Rust's 0.0.
    for guard in req.guards.as_mut().unwrap() {
        if let Some(v) = &mut guard.value
            && let Some(n) = v.as_f64()
            && n.fract() == 0.0
        {
            *v = json!(n as i64);
        }
    }
    let mut agent = common::request(
        1,
        ops(json!([{"op":"update","id":1,"patch":{"text":"agent text"}}])),
    );
    agent.command.as_mut().unwrap().actor = Actor {
        id: "codex".into(),
        source: Source::Codex,
    };
    assert_eq!(send(&url, &b.id, &agent).await.status(), 200);
    let r = send(&url, &b.id, &req).await;
    assert_eq!(r.status(), 200);
    let b: Board = r.json().await.unwrap();
    assert_eq!(
        (b.element(1).unwrap().x, b.element(1).unwrap().text.as_str()),
        (40.0, "agent text")
    );
    let mut next = common::request(3, ops(json!([{"op":"move","ids":[1],"dx":20,"dy":0}])));
    let stamps = state.store.lock().await.stamps(&b.id).unwrap();
    next.guards = Some(
        history::required_guards(&b, &next.operations)
            .unwrap()
            .into_iter()
            .map(|key| FieldGuard {
                value: history::read_field(&b, &key),
                stamp: history::stamp(&stamps, &key),
                key,
            })
            .collect(),
    );
    agent = common::request(3, ops(json!([{"op":"update","id":1,"patch":{"x":80}}])));
    agent.command.as_mut().unwrap().actor = Actor {
        id: "codex".into(),
        source: Source::Codex,
    };
    assert_eq!(send(&url, &b.id, &agent).await.status(), 200);
    let r = send(&url, &b.id, &next).await;
    assert_eq!(r.status(), 409);
    let error: Value = r.json().await.unwrap();
    assert!(!error["details"]["fields"].as_array().unwrap().is_empty());
    task.abort();
}
#[tokio::test]
async fn history_is_actor_scoped() {
    let (_d, url, state, b, task) = server().await;
    let req = common::request(1, ops(json!([{"op":"move","ids":[1],"dx":40,"dy":0}])));
    assert_eq!(send(&url, &b.id, &req).await.status(), 200);
    let result: Value = client()
        .get(format!(
            "{url}/api/boards/{}/edit-state?actorId=test-user&commandId={}",
            b.id,
            req.command.as_ref().unwrap().id
        ))
        .bearer_auth("secret")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        result["history"]["undo"]["commandId"],
        req.command.as_ref().unwrap().id
    );
    assert_eq!(result["receipt"]["committedRevision"], 2);
    assert!(result.get("token").is_none());
    let mut h = wireboard::history::HistoryCommand {
        revision: 2,
        direction: wireboard::store::HistoryDirection::Undo,
        target_command_id: req.command.as_ref().unwrap().id.clone(),
        command: common::meta(),
    };
    h.command.actor.id = "other-profile".into();
    let r = client()
        .post(format!("{url}/api/boards/{}/history", b.id))
        .bearer_auth("secret")
        .json(&h)
        .send()
        .await
        .unwrap();
    assert!(!r.status().is_success());
    assert_eq!(
        state
            .store
            .lock()
            .await
            .get(&b.id)
            .unwrap()
            .element(1)
            .unwrap()
            .x,
        40.0
    );
    h.command.actor = common::actor();
    let r = client()
        .post(format!("{url}/api/boards/{}/history", b.id))
        .bearer_auth("secret")
        .json(&h)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(
        state
            .store
            .lock()
            .await
            .get(&b.id)
            .unwrap()
            .element(1)
            .unwrap()
            .x,
        0.0
    );
    task.abort();
}
#[tokio::test]
async fn history_uses_journal_guards_for_independent_stale_revision() {
    let (_d, url, _, b, task) = server().await;
    let req = common::request(1, ops(json!([{"op":"move","ids":[1],"dx":40,"dy":0}])));
    assert_eq!(send(&url, &b.id, &req).await.status(), 200);
    let agent = CommandRequest {
        revision: 2,
        operations: ops(json!([{"op":"update","id":1,"patch":{"text":"agent"}}])),
        command: None,
        guards: None,
    };
    assert_eq!(send(&url, &b.id, &agent).await.status(), 200);
    let h = wireboard::history::HistoryCommand {
        revision: 2,
        direction: wireboard::store::HistoryDirection::Undo,
        target_command_id: req.command.unwrap().id,
        command: common::meta(),
    };
    let r = client()
        .post(format!("{url}/api/boards/{}/history", b.id))
        .bearer_auth("secret")
        .json(&h)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let saved: Board = r.json().await.unwrap();
    assert_eq!(saved.element(1).unwrap().x, 0.0);
    assert_eq!(saved.element(1).unwrap().text, "agent");
    task.abort();
}
#[tokio::test]
async fn duplicate_command_emits_one_change() {
    let (_d, url, state, b, task) = server().await;
    let mut events = state.events.subscribe();
    let req = common::request(1, ops(json!([{"op":"move","ids":[1],"dx":20,"dy":0}])));
    assert_eq!(send(&url, &b.id, &req).await.status(), 200);
    assert_eq!(send(&url, &b.id, &req).await.status(), 200);
    let mut changed_events = 0;
    while events.try_recv().is_ok() {
        changed_events += 1;
    }
    assert_eq!(changed_events, 1);
    task.abort();
}
#[tokio::test]
async fn agent_comment_batch_is_one_commit() {
    let (_d, url, state, b, task) = server().await;
    let mut req = common::request(
        1,
        ops(json!([
            {"op":"comment_create","author":"codex","text":"Question","anchor":{"type":"element","elementId":1,"u":0,"v":0}},
            {"op":"update","id":1,"patch":{"text":"done"}},
            {"op":"comment_reply","threadId":1,"author":"codex","text":"Result","submitForReview":true}
        ])),
    );
    req.command.as_mut().unwrap().actor = Actor {
        id: "codex".into(),
        source: Source::Codex,
    };
    let r = send(&url, &b.id, &req).await;
    assert_eq!(r.status(), 200);
    let b: Board = r.json().await.unwrap();
    assert_eq!(b.revision, 2);
    assert_eq!(
        b.comments[0].status,
        wireboard::comments::CommentStatus::AwaitingReview
    );
    assert!(
        state
            .store
            .lock()
            .await
            .history_summary(&b.id, &common::actor())
            .unwrap()
            .undo
            .is_none()
    );
    task.abort();
}
#[tokio::test]
async fn agent_metadata_cannot_claim_user_review() {
    let (_d, url, _, b, task) = server().await;
    let mut req = common::request(
        1,
        ops(
            json!([{"op":"comment_create","author":"user","text":"claim","anchor":{"type":"point","x":0,"y":0}}]),
        ),
    );
    req.command.as_mut().unwrap().actor = Actor {
        id: "codex".into(),
        source: Source::Codex,
    };
    let r = send(&url, &b.id, &req).await;
    assert_eq!(r.status(), 403);
    task.abort();
}

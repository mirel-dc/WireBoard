use serde_json::json;
use wireboard::{
    api::{ApiState, router},
    model::Board,
    store::Store,
};
#[tokio::test]
async fn shutdown_terminates_open_sse_and_render_admission_is_bounded() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let board = store.create("Test").unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("http://{addr}");
    let state = ApiState::new(store, url.clone(), "secret".into());
    let shutdown = state.shutdown.clone();
    let slots = state.render_slots.clone();
    let mut stop = shutdown.subscribe();
    let task = tokio::spawn(async move {
        axum::serve(listener, router(state))
            .with_graceful_shutdown(async move {
                while !*stop.borrow() {
                    stop.changed().await.unwrap();
                }
            })
            .await
            .unwrap()
    });
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let permit1 = slots.clone().acquire_owned().await.unwrap();
    let permit2 = slots.acquire_owned().await.unwrap();
    assert_eq!(
        client
            .get(format!("{url}/api/boards/{}/render?format=png", board.id))
            .bearer_auth("secret")
            .send()
            .await
            .unwrap()
            .status(),
        413
    );
    drop(permit1);
    drop(permit2);
    let response = client
        .get(format!("{url}/api/events"))
        .bearer_auth("secret")
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    shutdown.send_replace(true);
    tokio::time::timeout(std::time::Duration::from_secs(2), task)
        .await
        .expect("Open SSE must not prevent shutdown")
        .unwrap();
    drop(response);
}
#[test]
fn nonfinite_and_oversized_fields_are_rejected() {
    let mut board: Board = serde_json::from_value(
        Board::new("test".into(), "Test".into())
            .apply_json(0, json!([{"op":"create","element":{"kind":"rectangle"}}]))
            .unwrap(),
    )
    .unwrap();
    board.elements[0].x = f64::NAN;
    assert!(board.validate().is_err());
    board.elements[0].x = 0.0;
    board.elements[0].text = "x".repeat(10001);
    assert!(board.validate().is_err());
    board.elements[0].text.clear();
    board.next_id = 1;
    assert!(board.validate().is_err());
}

use serde_json::{Value, json};
use wireboard::{
    api::{ApiState, router},
    document::StoredDocument,
    model::{Board, Operation},
    store::Store,
};

fn slug(store: &Store, id: &str) -> String {
    let list = serde_json::to_value(store.list().unwrap()).unwrap();
    list.as_array()
        .unwrap()
        .iter()
        .find(|b| b["id"] == id)
        .unwrap()["slug"]
        .as_str()
        .expect("The library exposes readable board slugs")
        .to_string()
}

#[test]
fn readable_links_survive_rename_restart_and_duplicate_titles() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let first = store.create("Интер РАО — данные и правила").unwrap();
    let second = store.create("Интер РАО — данные и правила").unwrap();
    assert_eq!(slug(&store, &first.id), "inter-rao-dannye-i-pravila");
    assert_eq!(slug(&store, &second.id), "inter-rao-dannye-i-pravila-2");
    let rename: Vec<Operation> =
        serde_json::from_value(json!([{"op":"rename","title":"Новое имя"}])).unwrap();
    store.apply(&first.id, 0, &rename).unwrap();
    drop(store);
    let mut store = Store::open(dir.path()).unwrap();
    assert_eq!(slug(&store, &first.id), "inter-rao-dannye-i-pravila");
    store.delete(&first.id, 1).unwrap();
    drop(store);
    let mut store = Store::open(dir.path()).unwrap();
    let third = store.create("Интер РАО — данные и правила").unwrap();
    assert_eq!(
        slug(&store, &third.id),
        "inter-rao-dannye-i-pravila-3",
        "Deleted links must never silently point to a new board"
    );
    let imported = store.import(second).unwrap();
    assert_eq!(slug(&store, &imported.id), "inter-rao-dannye-i-pravila-4");
}

#[test]
fn existing_board_gets_a_link_without_rewriting_its_document() {
    let dir = tempfile::tempdir().unwrap();
    let board = Board::new(uuid::Uuid::new_v4().to_string(), "Старая доска".into());
    let bytes = StoredDocument::new(board.clone()).encode().unwrap();
    let boards = dir.path().join("boards");
    std::fs::create_dir(&boards).unwrap();
    let path = boards.join(format!("{}.json", board.id));
    std::fs::write(&path, &bytes).unwrap();
    let store = Store::open(dir.path()).unwrap();
    assert_eq!(slug(&store, &board.id), "staraya-doska");
    assert_eq!(std::fs::read(path).unwrap(), bytes);
}

#[test]
fn a_corrupt_link_index_is_preserved_instead_of_regenerated() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("links.json");
    std::fs::write(&path, "corrupt links").unwrap();
    assert!(Store::open(dir.path()).is_err());
    assert_eq!(std::fs::read_to_string(path).unwrap(), "corrupt links");
}

#[tokio::test]
async fn a_board_path_serves_the_editor_and_keeps_uuid_api_compatibility() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let board = store.create("Интер РАО").unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let state = ApiState::new(store, url.clone(), "cli".into());
    let task = tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let response = client
        .get(format!("{url}/b/inter-rao"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert!(response.text().await.unwrap().contains("board-title"));
    let list: Value = client
        .get(format!("{url}/api/boards"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(list[0]["slug"], "inter-rao");
    assert_eq!(
        client
            .get(format!("{url}/api/boards/{}", board.id))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        client
            .get(format!("{url}/unrelated-path"))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    task.abort();
}

struct FailReservation {
    uncertain: bool,
}
impl wireboard::platform::Persistence for FailReservation {
    fn write(
        &self,
        path: &std::path::Path,
        bytes: &[u8],
    ) -> Result<(), wireboard::platform::CommitError> {
        use wireboard::platform::{CommitError, FilePersistence};
        if path.ends_with("links.json") {
            if self.uncertain {
                FilePersistence.write(path, bytes)?;
                return Err(CommitError::Uncertain);
            }
            return Err(CommitError::Unchanged);
        }
        FilePersistence.write(path, bytes)
    }
}

#[test]
fn failed_link_reservation_cannot_create_an_unreachable_board() {
    for uncertain in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let mut store =
            Store::open_with_persistence(dir.path(), Box::new(FailReservation { uncertain }))
                .unwrap();
        assert!(store.create("Test").is_err());
        assert_eq!(
            std::fs::read_dir(dir.path().join("boards"))
                .unwrap()
                .count(),
            0
        );
        assert_eq!(
            store.list().is_err(),
            uncertain,
            "An uncertain index write freezes the library"
        );
        drop(store);
        let mut store = Store::open(dir.path()).unwrap();
        let board = store.create("Test").unwrap();
        assert_eq!(
            slug(&store, &board.id),
            if uncertain { "test-2" } else { "test" }
        );
    }
}

#[test]
fn ambiguous_or_unsafe_link_indexes_are_rejected() {
    let first = uuid::Uuid::new_v4().to_string();
    let second = uuid::Uuid::new_v4().to_string();
    for entries in [
        json!({first.clone():"same",second:"same"}),
        json!({first.clone():"../outside"}),
        json!({"../bad-id":"test"}),
        json!({first:"Test"}),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let bytes = serde_json::to_vec(&json!({"version":1,"boards":entries})).unwrap();
        let path = dir.path().join("links.json");
        std::fs::write(&path, &bytes).unwrap();
        assert!(Store::open(dir.path()).is_err());
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
}

struct FailBoardCreation {
    uncertain: bool,
}
impl wireboard::platform::Persistence for FailBoardCreation {
    fn write(
        &self,
        path: &std::path::Path,
        bytes: &[u8],
    ) -> Result<(), wireboard::platform::CommitError> {
        use wireboard::platform::{CommitError, FilePersistence};
        if path.parent().is_some_and(|p| p.ends_with("boards")) {
            if self.uncertain {
                FilePersistence.write(path, bytes)?;
                return Err(CommitError::Uncertain);
            }
            return Err(CommitError::Unchanged);
        }
        FilePersistence.write(path, bytes)
    }
}

#[test]
fn a_failed_board_write_keeps_its_link_reserved_after_reopening() {
    for uncertain in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let mut store =
            Store::open_with_persistence(dir.path(), Box::new(FailBoardCreation { uncertain }))
                .unwrap();
        assert!(store.create("Test").is_err());
        drop(store);
        let mut store = Store::open(dir.path()).unwrap();
        let boards = store.list().unwrap();
        assert_eq!(boards.len(), usize::from(uncertain));
        if uncertain {
            assert_eq!(boards[0].slug, "test");
        }
        let next = store.create("Test").unwrap();
        assert_eq!(slug(&store, &next.id), "test-2");
    }
}

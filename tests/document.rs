mod common;
use serde_json::json;
use std::{
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};
use wireboard::{
    model::Operation,
    platform::{CommitError, FilePersistence, Persistence},
    store::Store,
};
fn add() -> Vec<Operation> {
    serde_json::from_value(json!([{"op":"create","element":{"kind":"rectangle"}}])).unwrap()
}
#[test]
fn migration_backup_is_original_bytes() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("boards")).unwrap();
    let bytes=serde_json::to_vec(&json!({"version":1,"id":"legacy","title":"Old","revision":7,"nextId":2,"elements":[{"id":1,"kind":"rectangle","text":"old\ntext"}]})).unwrap();
    let path = dir.path().join("boards/legacy.json");
    std::fs::write(&path, &bytes).unwrap();
    let store = Store::open(dir.path()).unwrap();
    assert_eq!(
        std::fs::read(dir.path().join("backups/ux-v3/legacy.json")).unwrap(),
        bytes
    );
    assert_eq!(store.get("legacy").unwrap().revision, 7);
    assert_eq!(store.get("legacy").unwrap().elements[0].text, "old\ntext");
    let data: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert_eq!(data["storageVersion"], 1);
    assert_eq!(data["board"]["version"], 3);
    drop(store);
    assert_eq!(
        Store::open(dir.path())
            .unwrap()
            .get("legacy")
            .unwrap()
            .revision,
        7
    );
}
#[test]
fn replay_after_restart_and_history_pruning_is_noop() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let b = store.create("Test").unwrap();
    let request = common::request(0, add());
    let first = store.execute(&b.id, &request).unwrap().board;
    let repeated = store.execute(&b.id, &request).unwrap();
    assert!(!repeated.committed);
    assert_eq!(first, repeated.board);
    for i in 0..105 {
        let b = store.get(&b.id).unwrap();
        let ops = serde_json::from_value(json!([{"op":"rename","title":format!("t{i}")}])).unwrap();
        store
            .execute(&b.id, &common::request(b.revision, ops))
            .unwrap();
    }
    let revision = store.get(&b.id).unwrap().revision;
    drop(store);
    let mut store = Store::open(dir.path()).unwrap();
    let replay = store.execute(&b.id, &request).unwrap();
    assert!(!replay.committed);
    assert_eq!(replay.board.revision, revision);
    assert_eq!(replay.board.elements.len(), 1);
    assert!(
        store
            .receipt(&b.id, &request.command.unwrap().id)
            .unwrap()
            .is_some()
    );
}
#[test]
fn same_id_different_payload_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let b = store.create("Test").unwrap();
    let mut req = common::request(0, add());
    store.execute(&b.id, &req).unwrap();
    req.operations = serde_json::from_value(json!([{"op":"rename","title":"other"}])).unwrap();
    assert!(store.execute(&b.id, &req).is_err());
    assert_eq!(store.get(&b.id).unwrap().title, "Test");
}
struct FailCommit {
    calls: Arc<AtomicUsize>,
    uncertain: bool,
}
impl Persistence for FailCommit {
    fn write(&self, path: &Path, bytes: &[u8]) -> Result<(), CommitError> {
        if path.parent().is_some_and(|p| p.ends_with("boards"))
            && self.calls.fetch_add(1, Ordering::SeqCst) == 1
        {
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
fn commit_error_never_splits_board_journal_receipt() {
    for uncertain in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let mut store =
            Store::open_with_persistence(dir.path(), Box::new(FailCommit { calls, uncertain }))
                .unwrap();
        let b = store.create("Test").unwrap();
        let req = common::request(0, add());
        assert!(store.execute(&b.id, &req).is_err());
        drop(store);
        let reopened = Store::open(dir.path()).unwrap();
        let b = reopened.get(&b.id).unwrap();
        assert_eq!(b.revision, u64::from(uncertain));
        assert_eq!(b.elements.len(), usize::from(uncertain));
        assert_eq!(
            reopened
                .receipt(&b.id, &req.command.unwrap().id)
                .unwrap()
                .is_some(),
            uncertain
        );
        assert_eq!(
            reopened
                .history_summary(&b.id, &common::actor())
                .unwrap()
                .undo
                .is_some(),
            uncertain
        );
    }
}
#[test]
fn history_limits_do_not_expire_receipts() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let b = store.create("Test").unwrap();
    let req = common::request(0, add());
    store.execute(&b.id, &req).unwrap();
    for i in 0..102 {
        let b = store.get(&b.id).unwrap();
        common::apply_user(
            &mut store,
            &b.id,
            b.revision,
            &serde_json::from_value::<Vec<Operation>>(
                json!([{"op":"rename","title":format!("{i}")}]),
            )
            .unwrap(),
        );
    }
    for _ in 0..100 {
        let b = store.get(&b.id).unwrap();
        common::history_user(
            &mut store,
            &b.id,
            b.revision,
            wireboard::store::HistoryDirection::Undo,
        )
        .unwrap();
    }
    let b = store.get(&b.id).unwrap();
    assert!(
        common::history_user(
            &mut store,
            &b.id,
            b.revision,
            wireboard::store::HistoryDirection::Undo
        )
        .is_err()
    );
    assert!(
        store
            .receipt(&b.id, &req.command.unwrap().id)
            .unwrap()
            .is_some()
    );
}
#[test]
fn cancelled_batch_ids_are_not_reused_and_history_corruption_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let b = store.create("Test").unwrap();
    let ops = serde_json::from_value(
        json!([{"op":"create","element":{"kind":"rectangle"}},{"op":"delete","ids":[1]}]),
    )
    .unwrap();
    let out = store.execute(&b.id, &common::request(0, ops)).unwrap();
    assert_eq!(out.board.next_id, 2);
    assert!(out.committed);
    assert!(
        store
            .history_summary(&b.id, &common::actor())
            .unwrap()
            .undo
            .is_none()
    );
    let saved = common::apply_user(&mut store, &b.id, 1, &add());
    assert_eq!(saved.element(2).unwrap().id, 2);
    drop(store);
    let path = dir.path().join("boards").join(format!("{}.json", b.id));
    let mut document: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    document["history"]["actors"]["User:test-user"]["undo"] =
        json!([uuid::Uuid::new_v4().to_string()]);
    let bytes = serde_json::to_vec(&document).unwrap();
    std::fs::write(&path, &bytes).unwrap();
    assert!(Store::open(dir.path()).is_err());
    assert_eq!(std::fs::read(path).unwrap(), bytes);
}
#[test]
fn migration_rejects_backup_link_before_creating_outside_directory() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("boards")).unwrap();
    let path = dir.path().join("boards/legacy.json");
    let bytes = serde_json::to_vec(
        &json!({"version":1,"id":"legacy","title":"Old","revision":0,"nextId":1,"elements":[]}),
    )
    .unwrap();
    std::fs::write(&path, &bytes).unwrap();
    let link = dir.path().join("backups");
    #[cfg(unix)]
    std::os::unix::fs::symlink(outside.path(), &link).unwrap();
    #[cfg(windows)]
    {
        let result = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(result.status.success());
    }
    assert!(Store::open(dir.path()).is_err());
    assert!(!outside.path().join("ux-v3").exists());
    assert_eq!(std::fs::read(path).unwrap(), bytes);
}

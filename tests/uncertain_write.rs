use std::{
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};
use wireboard::{
    platform::{CommitError, FilePersistence, Persistence},
    store::Store,
};
struct FailAfterReplacement {
    calls: Arc<AtomicUsize>,
}
impl Persistence for FailAfterReplacement {
    fn write(&self, path: &Path, bytes: &[u8]) -> Result<(), CommitError> {
        FilePersistence.write(path, bytes)?;
        if path.parent().is_some_and(|p| p.ends_with("boards"))
            && self.calls.fetch_add(1, Ordering::SeqCst) == 1
        {
            Err(CommitError::Uncertain)
        } else {
            Ok(())
        }
    }
}
#[test]
fn uncertain_commit_freezes_store_until_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let mut store = Store::open_with_persistence(
        dir.path(),
        Box::new(FailAfterReplacement {
            calls: calls.clone(),
        }),
    )
    .unwrap();
    let board = store.create("Test").unwrap();
    let ops: Vec<wireboard::model::Operation> =
        serde_json::from_value(serde_json::json!([{"op":"rename","title":"New title"}])).unwrap();
    assert!(store.apply(&board.id, 0, &ops).is_err());
    assert!(
        store.get(&board.id).is_err(),
        "A store with uncertain disk state must reject reads/writes until reopened"
    );
    assert!(store.apply(&board.id, 0, &ops).is_err());
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    drop(store);
    let reopened = Store::open(dir.path()).unwrap();
    let board = reopened.get(&board.id).unwrap();
    assert_eq!(board.revision, 1);
    assert_eq!(board.title, "New title");
}

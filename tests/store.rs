use serde_json::json;
mod common;
use wireboard::{
    model::Operation,
    store::{HistoryDirection, Store},
};

fn add() -> Vec<Operation> {
    serde_json::from_value(json!([{"op":"create","element":{"kind":"rectangle","text":"Привет"}}]))
        .unwrap()
}
#[test]
fn saved_board_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let id;
    {
        let mut store = Store::open(dir.path()).unwrap();
        let board = store.create("Доска").unwrap();
        id = board.id;
        store.apply(&id, 0, &add()).unwrap();
    }
    let store = Store::open(dir.path()).unwrap();
    let board = store.get(&id).unwrap();
    assert_eq!(board.revision, 1);
    assert_eq!(board.elements[0].text, "Привет");
}
#[test]
fn undo_redo_revision_and_id_monotonic() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let board = store.create("Test").unwrap();
    common::apply_user(&mut store, &board.id, 0, &add());
    let undone = common::history_user(&mut store, &board.id, 1, HistoryDirection::Undo).unwrap();
    assert!(undone.elements.is_empty());
    assert_eq!(undone.next_id, 2);
    assert_eq!(undone.revision, 2);
    let redone = common::history_user(&mut store, &board.id, 2, HistoryDirection::Redo).unwrap();
    assert_eq!(redone.elements[0].id, 1);
    assert_eq!(redone.revision, 3);
    common::history_user(&mut store, &board.id, 3, HistoryDirection::Undo).unwrap();
    let added = common::apply_user(&mut store, &board.id, 4, &add());
    assert_eq!(added.elements[0].id, 2);
    assert!(common::history_user(&mut store, &board.id, 5, HistoryDirection::Redo).is_err());
}
#[test]
fn failed_write_keeps_state() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let board = store.create("Test").unwrap();
    let file = dir.path().join("boards").join(format!("{}.json", board.id));
    std::fs::remove_file(&file).unwrap();
    std::fs::create_dir(&file).unwrap();
    assert!(store.apply(&board.id, 0, &add()).is_err());
    assert_eq!(store.get(&board.id).unwrap().revision, 0);
    assert!(store.get(&board.id).unwrap().elements.is_empty());
    assert!(store.history(&board.id, 0, HistoryDirection::Undo).is_err());
}
#[test]
fn corrupt_file_is_not_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("boards")).unwrap();
    let path = dir.path().join("boards/bad.json");
    std::fs::write(&path, b"broken").unwrap();
    assert!(Store::open(dir.path()).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"broken");
}
#[test]
fn second_store_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    assert!(Store::open(dir.path()).is_err());
    drop(store);
    assert!(Store::open(dir.path()).is_ok());
}
#[test]
fn import_allocates_new_board_and_paths_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let board = store.create("Test").unwrap();
    let copy = store.import(board.clone()).unwrap();
    assert_ne!(board.id, copy.id);
    assert_eq!(store.list().unwrap().len(), 2);
    for id in ["../bad", "..", "/tmp/a", "a\\b"] {
        assert!(store.get(id).is_err());
    }
}

#[test]
fn history_keeps_only_latest_hundred_actions_and_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let board = store.create("Initial").unwrap();
    let mut current = board;
    for index in 0..105 {
        let ops: Vec<wireboard::model::Operation> = serde_json::from_value(
            serde_json::json!([{"op":"rename","title":format!("Action {index}")}]),
        )
        .unwrap();
        current = common::apply_user(&mut store, &current.id, current.revision, &ops);
    }
    for _ in 0..100 {
        current = common::history_user(
            &mut store,
            &current.id,
            current.revision,
            HistoryDirection::Undo,
        )
        .unwrap();
    }
    assert_eq!(current.title, "Action 4");
    assert!(
        common::history_user(
            &mut store,
            &current.id,
            current.revision,
            HistoryDirection::Undo
        )
        .is_err()
    );
    drop(store);
    let mut reopened = Store::open(dir.path()).unwrap();
    assert_eq!(
        reopened.get(&current.id).unwrap().revision,
        current.revision
    );
    let redone = common::history_user(
        &mut reopened,
        &current.id,
        current.revision,
        HistoryDirection::Redo,
    )
    .unwrap();
    assert_eq!(redone.title, "Action 5");
}

#[test]
fn only_a_brand_new_empty_directory_is_fresh() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    assert!(store.is_fresh());
    drop(store);
    assert!(!Store::open(dir.path()).unwrap().is_fresh());
    let existing = tempfile::tempdir().unwrap();
    std::fs::write(existing.path().join("keep.txt"), "user content").unwrap();
    assert!(!Store::open(existing.path()).unwrap().is_fresh());
}

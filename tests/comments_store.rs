use serde_json::{Value, json};
mod common;
use wireboard::{
    model::Operation,
    store::{HistoryDirection, Store},
};
fn ops(v: Value) -> Vec<Operation> {
    serde_json::from_value(v).unwrap()
}
fn comment() -> Vec<Operation> {
    ops(
        json!([{"op":"comment_create","author":"user","text":"Проверь","anchor":{"type":"point","x":1,"y":2}}]),
    )
}
#[test]
fn legacy_open_migrates_with_backup_without_reinterpreting_text() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("boards")).unwrap();
    let path = dir.path().join("boards/legacy.json");
    let bytes=serde_json::to_vec(&json!({"version":1,"id":"legacy","title":"Старая","revision":7,"nextId":2,"elements":[{"id":1,"kind":"rectangle","text":"Заголовок\nОписание","fill":"#123456","stroke":"#abcdef","fontSize":20,"x":20,"y":30,"width":220,"height":100}]})).unwrap();
    std::fs::write(&path, &bytes).unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let board = store.get("legacy").unwrap();
    assert_eq!(board.version, 3);
    assert_eq!(
        std::fs::read(dir.path().join("backups/ux-v3/legacy.json")).unwrap(),
        bytes
    );
    assert_eq!(board.elements[0].title, "");
    let changed = store.apply("legacy", 7, &comment()).unwrap();
    assert_eq!(changed.elements[0].text, "Заголовок\nОписание");
    assert_eq!(changed.elements[0].fill, "#123456");
    let file: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert_eq!(file["board"]["version"], 3);
    drop(store);
    let store = Store::open(dir.path()).unwrap();
    assert_eq!(store.get("legacy").unwrap(), changed);
}
#[test]
fn comment_history_keeps_counters_and_import_normalizes_review() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let b = store.create("Test").unwrap();
    let b = common::apply_user(&mut store, &b.id, 0, &comment());
    let b = common::history_user(&mut store, &b.id, 1, HistoryDirection::Undo).unwrap();
    assert!(b.comments.is_empty());
    assert_eq!(b.next_comment_id, 2);
    assert_eq!(b.next_message_id, 2);
    let b = store.apply(&b.id, b.revision, &comment()).unwrap();
    assert_eq!(b.comments[0].id, 2);
    assert_eq!(b.comments[0].messages[0].id, 2);
    let b=store.apply(&b.id,b.revision,&ops(json!([{"op":"comment_reply","threadId":2,"author":"codex","text":"Готово","submitForReview":true}]))).unwrap();
    let copy = store.import(b).unwrap();
    assert_eq!(copy.revision, 0);
    assert_eq!(copy.comments[0].review_revision, Some(0));
    copy.validate().unwrap();
}
#[test]
fn invalid_legacy_fields_are_not_silently_migrated() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("boards")).unwrap();
    let path = dir.path().join("boards/legacy.json");
    let bytes=serde_json::to_vec(&json!({"version":1,"id":"legacy","title":"Test","revision":0,"nextId":1,"elements":[],"comments":[]})).unwrap();
    std::fs::write(&path, &bytes).unwrap();
    assert!(Store::open(dir.path()).is_err());
    assert_eq!(std::fs::read(path).unwrap(), bytes);
}

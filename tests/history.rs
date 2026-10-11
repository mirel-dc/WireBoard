use serde_json::{Value, json};
use wireboard::{
    history::{self, Actor, CommandMeta, FieldStamps, Source},
    model::Board,
    store::HistoryDirection,
};
fn apply(b: &Board, v: Value) -> Board {
    b.apply(b.revision, &serde_json::from_value::<Vec<_>>(v).unwrap())
        .unwrap()
}
fn meta(source: Source, id: &str) -> CommandMeta {
    CommandMeta {
        id: id.into(),
        actor: Actor {
            id: format!("{source:?}"),
            source,
        },
        label: "Перенос".into(),
    }
}
fn base() -> Board {
    apply(
        &Board::new("test".into(), "Test".into()),
        json!([
            {"op":"create","element":{"kind":"rectangle"}},
            {"op":"create","element":{"kind":"rectangle","x":400}}
        ]),
    )
}
fn record(
    before: &Board,
    after: &Board,
    m: &CommandMeta,
    stamps: &mut FieldStamps,
) -> history::JournalEntry {
    let entry = history::record(before, after, m, stamps);
    history::commit_stamps(stamps, &entry);
    entry
}
#[test]
fn undo_move_preserves_agent_text() {
    let b = base();
    let mut stamps = FieldStamps::new();
    let moved = apply(&b, json!([{"op":"move","ids":[1],"dx":40,"dy":20}]));
    let entry = record(&b, &moved, &meta(Source::User, "move"), &mut stamps);
    let edited = apply(
        &moved,
        json!([{"op":"update","id":1,"patch":{"text":"agent text"}}]),
    );
    record(&moved, &edited, &meta(Source::Codex, "agent"), &mut stamps);
    let (undone, stamps) =
        history::inverse(&edited, &entry, &stamps, HistoryDirection::Undo).unwrap();
    assert_eq!(undone.element(1).unwrap().x, 0.0);
    assert_eq!(undone.element(1).unwrap().text, "agent text");
    let (redone, _) = history::inverse(&undone, &entry, &stamps, HistoryDirection::Redo).unwrap();
    assert_eq!(redone.element(1).unwrap().x, 40.0);
    assert_eq!(redone.element(1).unwrap().text, "agent text");
}
#[test]
fn undo_conflicts_after_agent_move_and_aba() {
    let b = base();
    let mut stamps = FieldStamps::new();
    let moved = apply(&b, json!([{"op":"move","ids":[1],"dx":40,"dy":20}]));
    let entry = record(&b, &moved, &meta(Source::User, "move"), &mut stamps);
    let a = apply(&moved, json!([{"op":"update","id":1,"patch":{"x":80}}]));
    record(&moved, &a, &meta(Source::Codex, "a"), &mut stamps);
    assert!(history::inverse(&a, &entry, &stamps, HistoryDirection::Undo).is_err());
    let restored = apply(&a, json!([{"op":"update","id":1,"patch":{"x":40}}]));
    record(&a, &restored, &meta(Source::Codex, "b"), &mut stamps);
    assert!(history::inverse(&restored, &entry, &stamps, HistoryDirection::Undo).is_err());
}
#[test]
fn undo_create_guards_foreign_dependencies() {
    let b = base();
    let mut stamps = FieldStamps::new();
    let created = apply(
        &b,
        json!([{"op":"create","element":{"kind":"rectangle","x":800}}]),
    );
    let entry = record(&b, &created, &meta(Source::User, "create"), &mut stamps);
    for ops in [
        json!([{"op":"create","element":{"kind":"connector","from":1,"to":3}}]),
        json!([{"op":"comment_create","author":"codex","text":"new","anchor":{"type":"element","elementId":3,"u":0,"v":0}}]),
    ] {
        let edited = apply(&created, ops);
        assert!(history::inverse(&edited, &entry, &stamps, HistoryDirection::Undo).is_err());
        assert_eq!(edited.element(3).unwrap().x, 800.0);
    }
}
#[test]
fn undo_delete_and_duplicate_are_atomic() {
    let b = apply(
        &base(),
        json!([{"op":"create","element":{"kind":"connector","from":1,"to":2}}]),
    );
    let mut stamps = FieldStamps::new();
    let deleted = apply(&b, json!([{"op":"delete","ids":[1]}]));
    let entry = record(&b, &deleted, &meta(Source::User, "delete"), &mut stamps);
    let (restored, _) =
        history::inverse(&deleted, &entry, &stamps, HistoryDirection::Undo).unwrap();
    assert_eq!(restored.elements.len(), 3);
    assert_eq!(restored.element(3).unwrap().from, Some(1));
    let dup = apply(&b, json!([{"op":"duplicate","ids":[1,2],"dx":30,"dy":30}]));
    let mut stamps = FieldStamps::new();
    let entry = record(&b, &dup, &meta(Source::User, "duplicate"), &mut stamps);
    let (undone, _) = history::inverse(&dup, &entry, &stamps, HistoryDirection::Undo).unwrap();
    assert_eq!(undone.elements.len(), 3);
    assert_eq!(undone.next_id, 7);
}
#[test]
fn own_redo_survives_unrelated_agent_command() {
    let b = base();
    let mut stamps = FieldStamps::new();
    let moved = apply(&b, json!([{"op":"move","ids":[1],"dx":20,"dy":0}]));
    let entry = record(&b, &moved, &meta(Source::User, "move"), &mut stamps);
    let (undone, mut stamps) =
        history::inverse(&moved, &entry, &stamps, HistoryDirection::Undo).unwrap();
    let agent = apply(
        &undone,
        json!([{"op":"update","id":2,"patch":{"text":"other"}}]),
    );
    record(&undone, &agent, &meta(Source::Claude, "agent"), &mut stamps);
    let (redone, _) = history::inverse(&agent, &entry, &stamps, HistoryDirection::Redo).unwrap();
    assert_eq!(redone.element(1).unwrap().x, 20.0);
    assert_eq!(redone.element(2).unwrap().text, "other");
}
#[test]
fn persisted_deltas_preserve_json_null_and_two_own_undos() {
    let b = base();
    let mut stamps = FieldStamps::new();
    let moved = apply(&b, json!([{"op":"move","ids":[1],"dx":20,"dy":0}]));
    let first = record(&b, &moved, &meta(Source::User, "first"), &mut stamps);
    let moved_again = apply(&moved, json!([{"op":"move","ids":[1],"dx":30,"dy":0}]));
    let second = record(
        &moved,
        &moved_again,
        &meta(Source::User, "second"),
        &mut stamps,
    );
    let (undone, stamps) =
        history::inverse(&moved_again, &second, &stamps, HistoryDirection::Undo).unwrap();
    let (undone, _) = history::inverse(&undone, &first, &stamps, HistoryDirection::Undo).unwrap();
    assert_eq!(undone.element(1).unwrap().x, 0.0);
    let created = apply(
        &b,
        json!([{"op":"create","element":{"kind":"rectangle","x":800}}]),
    );
    let entry = history::record(
        &b,
        &created,
        &meta(Source::User, "create"),
        &FieldStamps::new(),
    );
    let bytes = serde_json::to_vec(&entry).unwrap();
    let reread: history::JournalEntry = serde_json::from_slice(&bytes).unwrap();
    let parent = reread
        .deltas
        .iter()
        .find(|d| d.key.field == "parentFrameId")
        .unwrap();
    assert_eq!(parent.after, Some(Value::Null));
    assert_eq!(parent.before, None);
}

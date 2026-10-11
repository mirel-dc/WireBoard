use serde_json::{Value, json};
use wireboard::model::Board;

fn run(board: &Board, operations: Value) -> Board {
    let operations: Vec<wireboard::model::Operation> = serde_json::from_value(operations).unwrap();
    board.apply(board.revision, &operations).unwrap()
}
fn nested() -> Board {
    run(
        &Board::new("tree".into(), "Tree".into()),
        json!([
            {"op":"create","element":{"kind":"frame","width":960,"height":540}},
            {"op":"create","element":{"kind":"frame","x":40,"y":40,"width":400,"height":225,"parentFrameId":1}},
            {"op":"create","element":{"kind":"rectangle","x":60,"y":60,"parentFrameId":2}},
            {"op":"create","element":{"kind":"rectangle","x":700,"y":100,"parentFrameId":1}}
        ]),
    )
}

#[test]
fn free_frame_resize_keeps_children_and_origin() {
    let board = nested();
    let resized = run(
        &board,
        json!([{"op":"resize","id":1,"width":600,"height":300}]),
    );
    assert_eq!(resized.element(4).unwrap().x, 700.0);
    assert_eq!(
        serde_json::to_value(resized.element(4).unwrap()).unwrap()["parentFrameId"],
        1
    );
    let moved = run(&resized, json!([{"op":"move","ids":[1],"dx":40,"dy":20}]));
    assert_eq!(moved.element(4).unwrap().x, 740.0);
    assert_eq!(moved.element(4).unwrap().width, 220.0);
    assert_eq!(moved.element(3).unwrap().x, 100.0);
}

#[test]
fn moving_nested_selection_moves_each_id_once() {
    let moved = run(
        &nested(),
        json!([{"op":"move","ids":[1,2,3],"dx":40,"dy":20}]),
    );
    assert_eq!(moved.element(2).unwrap().x, 80.0);
    assert_eq!(moved.element(3).unwrap().x, 100.0);
}

#[test]
fn migration_equal_frames_is_stable() {
    let mut old = serde_json::to_value(Board::new("old".into(), "Old".into())).unwrap();
    old["version"] = json!(2);
    old["nextId"] = json!(5);
    old["elements"] = json!([
        {"id":1,"kind":"frame","width":960,"height":540},
        {"id":2,"kind":"frame","width":960,"height":540},
        {"id":3,"kind":"rectangle","x":30,"y":30},
        {"id":4,"kind":"rectangle","x":900,"y":30}
    ]);
    let migrated = Board::from_json(&serde_json::to_vec(&old).unwrap()).unwrap();
    let value = serde_json::to_value(&migrated).unwrap();
    assert_eq!(value["version"], 3);
    assert!(value["elements"][0]["parentFrameId"].is_null());
    assert_eq!(value["elements"][1]["parentFrameId"], 1);
    assert_eq!(value["elements"][2]["parentFrameId"], 1);
    assert!(value["elements"][3]["parentFrameId"].is_null());
    let reread = Board::from_json(&serde_json::to_vec(&migrated).unwrap()).unwrap();
    assert_eq!(migrated, reread);
}

#[test]
fn parent_patch_null_is_distinct_from_missing() {
    let unchanged = run(
        &nested(),
        json!([{"op":"update","id":3,"patch":{"text":"hello"}}]),
    );
    assert_eq!(
        serde_json::to_value(unchanged.element(3).unwrap()).unwrap()["parentFrameId"],
        2
    );
    let detached = run(
        &unchanged,
        json!([{"op":"update","id":3,"patch":{"parentFrameId":null}}]),
    );
    assert!(serde_json::to_value(detached.element(3).unwrap()).unwrap()["parentFrameId"].is_null());
}

#[test]
fn delete_frame_releases_direct_children() {
    let deleted = run(&nested(), json!([{"op":"delete","ids":[1]}]));
    assert_eq!(deleted.elements.len(), 3);
    assert!(serde_json::to_value(deleted.element(2).unwrap()).unwrap()["parentFrameId"].is_null());
    assert_eq!(
        serde_json::to_value(deleted.element(3).unwrap()).unwrap()["parentFrameId"],
        2
    );
}

#[test]
fn cycles_and_non_frame_parents_are_rejected() {
    let board = nested();
    for ops in [
        json!([{"op":"update","id":1,"patch":{"parentFrameId":2}}]),
        json!([{"op":"update","id":2,"patch":{"parentFrameId":3}}]),
    ] {
        assert!(board.apply_json(board.revision, ops).is_err());
    }
}

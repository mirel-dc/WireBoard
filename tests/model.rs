use serde_json::{Value, json};
use wireboard::model::Board;

fn apply(ops: Value) -> Value {
    Board::new("test".into(), "Доска".into())
        .apply_json(0, ops)
        .unwrap()
}

#[test]
fn sequential_ids_connect_inside_atomic_batch() {
    let board = apply(json!([
        {"op":"create","element":{"id":1,"kind":"rectangle","text":"Привет"}},
        {"op":"create","element":{"id":2,"kind":"rectangle","x":300}},
        {"op":"create","element":{"kind":"connector","from":1,"to":2}}
    ]));
    assert_eq!(board["revision"], 1);
    assert_eq!(board["nextId"], 4);
    assert_eq!(board["elements"][2]["from"], 1);
}

#[test]
fn atomic_batch_rejects_invalid_reference() {
    let board = Board::new("test".into(), "Test".into());
    assert!(
        board
            .apply_json(
                0,
                json!([
                    {"op":"create","element":{"kind":"rectangle"}},
                    {"op":"create","element":{"kind":"connector","from":1,"to":99}}
                ])
            )
            .is_err()
    );
    let next = board
        .apply_json(0, json!([{"op":"create","element":{"kind":"rectangle"}}]))
        .unwrap();
    assert_eq!(next["elements"][0]["id"], 1);
    assert_eq!(next["revision"], 1);
}

#[test]
fn frame_and_child_move_once() {
    let board = apply(json!([
        {"op":"create","element":{"kind":"frame","width":960,"height":540}},
        {"op":"create","element":{"kind":"rectangle","x":50,"y":50}},
        {"op":"move","ids":[1,2],"dx":80,"dy":0}
    ]));
    assert_eq!(board["elements"][1]["x"].as_f64(), Some(130.0));
    assert_eq!(board["elements"][0]["x"].as_f64(), Some(80.0));
}

#[test]
fn deleting_block_removes_connectors() {
    let board = apply(json!([
        {"op":"create","element":{"kind":"rectangle"}},
        {"op":"create","element":{"kind":"rectangle","x":300}},
        {"op":"create","element":{"kind":"connector","from":1,"to":2}},
        {"op":"delete","ids":[1]}
    ]));
    assert_eq!(board["elements"].as_array().unwrap().len(), 1);
    assert_eq!(board["elements"][0]["id"], 2);
}

#[test]
fn unsafe_payloads_rejected() {
    for element in [
        json!({"kind":"javascript"}),
        json!({"kind":"rectangle","width":-1}),
        json!({"kind":"image","image":"data:image/svg+xml;base64,PHN2Zz4="}),
        json!({"kind":"rectangle","fill":"url(https://evil.example)"}),
        json!({"kind":"rectangle","unknown":true}),
        json!({"kind":"rectangle","id":999}),
    ] {
        assert!(
            Board::new("test".into(), "Test".into())
                .apply_json(0, json!([{"op":"create","element":element}]))
                .is_err()
        );
    }
}

#[test]
fn stale_revision_and_unknown_operation_fields_rejected() {
    let board = Board::new("test".into(), "Test".into());
    assert!(
        board
            .apply_json(9, json!([{"op":"rename","title":"new"}]))
            .is_err()
    );
    assert!(
        board
            .apply_json(0, json!([{"op":"rename","title":"new","extra":true}]))
            .is_err()
    );
}

#[test]
fn duplicate_remaps_internal_links() {
    let board = apply(json!([
        {"op":"create","element":{"kind":"rectangle"}},
        {"op":"create","element":{"kind":"rectangle","x":300}},
        {"op":"create","element":{"kind":"connector","from":1,"to":2}},
        {"op":"duplicate","ids":[1,2,3],"dx":40,"dy":40}
    ]));
    assert_eq!(board["elements"][5]["from"], 4);
    assert_eq!(board["elements"][5]["to"], 5);
}

#[test]
fn duplicated_frame_includes_internal_connectors() {
    let board = apply(json!([
        {"op":"create","element":{"kind":"frame","width":960,"height":540}},
        {"op":"create","element":{"kind":"rectangle","x":50,"y":50}},
        {"op":"create","element":{"kind":"rectangle","x":400,"y":50}},
        {"op":"create","element":{"kind":"connector","from":2,"to":3}},
        {"op":"duplicate","ids":[1],"dx":1100,"dy":0}
    ]));
    assert_eq!(board["elements"].as_array().unwrap().len(), 8);
    assert_eq!(board["elements"][7]["from"], 6);
    assert_eq!(board["elements"][7]["to"], 7);
}

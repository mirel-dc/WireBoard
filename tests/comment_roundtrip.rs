use serde_json::json;
use wireboard::{document::StoredDocument, model::Board};

#[test]
fn fractional_comment_anchors_survive_a_document_roundtrip() {
    for (x, y, u, v) in [
        (945.0, 215.0, 0.46793975732283194, 0.39009739869300714),
        (1385.0, 215.0, 0.5090738941010916, 0.5083757298448055),
        (505.0, 490.0, 0.5137972288804336, 0.5584405238307584),
        (1385.0, 1030.0, 0.46992619562388976, 0.5112295888705657),
    ] {
        let board = Board::new("roundtrip".into(), "Roundtrip".into());
        let board: Board = serde_json::from_value(board.apply_json(0,json!([
            {"op":"create","element":{"kind":"rectangle","x":x,"y":y,"width":330,"height":210}},
            {"op":"comment_create","author":"user","text":"Fractional anchor","anchor":{"type":"element","elementId":1,"u":u,"v":v}}
        ])).unwrap()).unwrap();
        let bytes = StoredDocument::new(board.clone()).encode().unwrap();
        let (reopened, _) = StoredDocument::decode(&bytes)
            .expect("Persisted fractional anchors must validate when reopened");
        assert_eq!(
            serde_json::to_value(reopened.board).unwrap(),
            serde_json::to_value(board).unwrap()
        );
    }
}

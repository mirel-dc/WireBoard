use serde_json::{Value, json};
use wireboard::model::Board;

fn board() -> Board {
    let b = Board::new("comments".into(), "Комментарии".into());
    serde_json::from_value(b.apply_json(0, json!([
        {"op":"create","element":{"kind":"rectangle","x":10,"y":20,"width":240,"height":160}},
        {"op":"create","element":{"kind":"rectangle","x":400,"y":20}},
        {"op":"create","element":{"kind":"connector","from":1,"to":2}}
    ])).unwrap()).unwrap()
}
fn change(b: &Board, ops: Value) -> Board {
    serde_json::from_value(b.apply_json(b.revision, ops).unwrap()).unwrap()
}
fn comment(b: &Board) -> Board {
    change(
        b,
        json!([{"op":"comment_create","author":"user","text":"Уточни описание", "anchor":{"type":"element","elementId":1,"u":1,"v":0}}]),
    )
}
fn value(b: &Board) -> Value {
    serde_json::to_value(b).unwrap()
}

#[test]
fn discussion_and_scheme_commit_together() {
    let b = comment(&board());
    assert_eq!(value(&b)["version"], 3);
    assert_eq!(value(&b)["comments"][0]["id"], 1);
    assert_eq!(value(&b)["nextCommentId"], 2);
    let next = change(
        &b,
        json!([
            {"op":"update","id":1,"patch":{"title":"Пользователь","text":"Уточнённый текст","fontWeight":600}},
            {"op":"comment_reply","threadId":1,"author":"codex","text":"Обновил описание","submitForReview":true}
        ]),
    );
    let v = value(&next);
    assert_eq!(v["comments"][0]["status"], "awaiting_review");
    assert_eq!(v["comments"][0]["reviewRevision"], next.revision);
    assert_eq!(v["elements"][0]["title"], "Пользователь");
    assert_eq!(v["comments"][0]["messages"][1]["id"], 2);
    assert_eq!(v["nextMessageId"], 3);
    assert_eq!(
        v["comments"][0]["anchorSnapshot"]["text"],
        "Уточнённый текст"
    );
    assert!(
        next.apply_json(b.revision, json!([{"op":"rename","title":"stale"}]))
            .is_err()
    );
}

#[test]
fn user_reviews_and_reopens_agent_cannot_resolve() {
    let b = comment(&board());
    assert!(
        b.apply_json(
            b.revision,
            json!([{"op":"comment_status","threadId":1,"author":"codex","status":"resolved"}])
        )
        .is_err()
    );
    let b = change(
        &b,
        json!([{"op":"comment_reply","threadId":1,"author":"claude","text":"Готово","submitForReview":true}]),
    );
    let b = change(
        &b,
        json!([{"op":"comment_status","threadId":1,"author":"user","status":"resolved"}]),
    );
    assert!(b.apply_json(b.revision,json!([{"op":"comment_reply","threadId":1,"author":"codex","text":"Поздний ответ","submitForReview":true}])).is_err());
    let b = change(
        &b,
        json!([{"op":"comment_reply","threadId":1,"author":"user","text":"Ещё одна правка","submitForReview":false}]),
    );
    assert_eq!(value(&b)["comments"][0]["status"], "open");
    assert!(value(&b)["comments"][0]["reviewRevision"].is_null());
}

#[test]
fn failed_message_operation_rolls_back_scheme() {
    let b = comment(&board());
    assert!(b.apply_json(b.revision,json!([
        {"op":"update","id":1,"patch":{"text":"Не должно сохраниться"}},
        {"op":"comment_reply","threadId":999,"author":"codex","text":"Готово","submitForReview":true}
    ])).is_err());
    assert_eq!(b.elements[0].text, "");
    assert_eq!(
        value(&b)["comments"][0]["messages"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn deletion_of_connector_endpoint_keeps_last_anchor_and_duplicate_keeps_threads_unique() {
    let b = comment(&board());
    let b = change(
        &b,
        json!([{"op":"comment_create","author":"user","text":"Проверь связь","anchor":{"type":"connector","elementId":3,"t":0.5}}]),
    );
    let before = value(&b)["comments"][1]["anchorSnapshot"].clone();
    let b = change(&b, json!([{"op":"duplicate","ids":[1],"dx":80,"dy":80}]));
    assert_eq!(value(&b)["comments"].as_array().unwrap().len(), 2);
    let b = change(&b, json!([{"op":"delete","ids":[1]}]));
    assert_eq!(value(&b)["comments"][1]["anchorSnapshot"], before);
    assert_eq!(value(&b)["comments"][0]["status"], "open");
    assert_eq!(value(&b)["comments"][0]["anchorSnapshot"]["worldX"], 250.0);
}

#[test]
fn moving_anchor_updates_snapshot_point_stays_fixed() {
    let b = comment(&board());
    let b = change(
        &b,
        json!([{"op":"comment_create","author":"user","text":"Точка","anchor":{"type":"point","x":30,"y":50}}]),
    );
    let b = change(&b, json!([{"op":"move","ids":[1],"dx":50,"dy":70}]));
    assert_eq!(value(&b)["comments"][0]["anchorSnapshot"]["worldX"], 300.0);
    assert_eq!(value(&b)["comments"][0]["anchorSnapshot"]["worldY"], 90.0);
    assert_eq!(value(&b)["comments"][1]["anchor"]["x"], 30.0);
}

#[test]
fn invalid_anchors_messages_and_roles_are_rejected() {
    let b = comment(&board());
    for anchor in [
        json!({"type":"element","elementId":99,"u":1,"v":0}),
        json!({"type":"element","elementId":3,"u":1,"v":0}),
        json!({"type":"connector","elementId":1,"t":0.5}),
        json!({"type":"point","x":100001,"y":0}),
        json!({"type":"element","elementId":1,"u":1.01,"v":0}),
    ] {
        assert!(
            b.apply_json(
                b.revision,
                json!([{"op":"comment_create","author":"user","text":"X","anchor":anchor}])
            )
            .is_err()
        );
    }
    for text in ["   ".to_owned(), "x".repeat(4001)] {
        assert!(b.apply_json(b.revision,json!([{"op":"comment_reply","threadId":1,"author":"user","text":text,"submitForReview":false}])).is_err());
    }
    assert!(b.apply_json(b.revision,json!([{"op":"comment_reply","threadId":1,"author":"user","text":"x","submitForReview":true}])).is_err());
    assert!(b.apply_json(b.revision,json!([{"op":"comment_reanchor","threadId":1,"author":"codex","anchor":{"type":"point","x":0,"y":0}}])).is_err());
}

#[test]
fn agent_can_return_a_problematic_result_to_open() {
    let b = comment(&board());
    let b = change(
        &b,
        json!([{"op":"comment_reply","threadId":1,"author":"codex","text":"Готово","submitForReview":true}]),
    );
    let b = change(
        &b,
        json!([{"op":"comment_reply","threadId":1,"author":"codex","text":"Проверка обнаружила проблему","submitForReview":false}]),
    );
    assert_eq!(value(&b)["comments"][0]["status"], "open");
}

#[test]
fn reanchor_an_orphan_requires_a_real_target() {
    let b = comment(&board());
    let b = change(&b, json!([{"op":"delete","ids":[1]}]));
    let b = change(
        &b,
        json!([{"op":"comment_reanchor","threadId":1,"author":"user","anchor":{"type":"element","elementId":2,"u":0,"v":0}}]),
    );
    assert_eq!(value(&b)["comments"][0]["anchorSnapshot"]["elementId"], 2);
    assert_eq!(value(&b)["comments"][0]["status"], "open");
}
#[test]
fn orphan_anchor_cannot_reuse_an_unallocated_element_id() {
    let b = comment(&board());
    let mut b = change(&b, json!([{"op":"delete","ids":[1,2]}]));
    b.next_id = 1;
    assert!(b.validate().is_err());
}
#[test]
fn context_uses_point_and_connector_geometry_for_enclosing_frame() {
    let b = Board::new("frames".into(), "Frames".into());
    let b = change(
        &b,
        json!([
        {"op":"create","element":{"kind":"frame","x":1000,"y":1000,"width":960,"height":540}},
        {"op":"create","element":{"kind":"rectangle","x":1100,"y":1100}},
        {"op":"create","element":{"kind":"rectangle","x":1500,"y":1100}},
        {"op":"create","element":{"kind":"connector","from":2,"to":3}},
        {"op":"comment_create","author":"user","text":"Point","anchor":{"type":"point","x":1200,"y":1200}},
        {"op":"comment_create","author":"user","text":"Link","anchor":{"type":"connector","elementId":4,"t":0.5}}
        ]),
    );
    let context = b.comments_context("all", None).unwrap();
    for thread in context["threads"].as_array().unwrap() {
        assert_eq!(thread["frame"]["id"], 1);
    }
}
#[test]
fn imported_threads_are_ordered_and_counters_cannot_wrap() {
    let b = comment(&board());
    let b = change(
        &b,
        json!([{"op":"comment_create","author":"user","text":"Second","anchor":{"type":"point","x":0,"y":0}}]),
    );
    let mut reversed = b.clone();
    reversed.comments.reverse();
    assert!(reversed.validate().is_err());
    for field in ["nextCommentId", "nextMessageId"] {
        let mut v = value(&b);
        v[field] = json!(wireboard::model::MAX_SAFE_ID);
        let b: Board = serde_json::from_value(v).unwrap();
        assert!(b.apply_json(b.revision,json!([{"op":"comment_create","author":"user","text":"Limit","anchor":{"type":"point","x":0,"y":0}}])).is_err());
    }
}
#[test]
fn discussion_capacity_and_timestamp_limits_are_enforced() {
    let b = comment(&board());
    let thread = b.comments[0].clone();
    let mut full = b.clone();
    full.comments.clear();
    let mut message = 1;
    for id in 1..=100 {
        let mut c = thread.clone();
        c.id = id;
        c.messages.clear();
        for _ in 0..100 {
            let mut m = thread.messages[0].clone();
            m.id = message;
            message += 1;
            c.messages.push(m);
        }
        full.comments.push(c);
    }
    full.next_comment_id = 101;
    full.next_message_id = message;
    full.validate().unwrap();
    assert!(full.apply_json(full.revision,json!([{"op":"comment_create","author":"user","text":"Over total limit","anchor":{"type":"point","x":0,"y":0}}])).is_err());
    assert!(full.apply_json(full.revision,json!([{"op":"comment_reply","threadId":1,"author":"user","text":"Over thread limit","submitForReview":false}])).is_err());
    let mut invalid = b.clone();
    invalid.comments[0].updated_at = "1999-01-01T00:00:00Z".into();
    assert!(invalid.validate().is_err());
    invalid = b.clone();
    invalid.comments[0].created_at = "2000-01-01T05:00:00+05:00".into();
    assert!(invalid.validate().is_err());
    let mut full = b.clone();
    full.comments.clear();
    for id in 1..=500 {
        let mut c = thread.clone();
        c.id = id;
        c.messages[0].id = id;
        full.comments.push(c);
    }
    full.next_comment_id = 501;
    full.next_message_id = 501;
    full.validate().unwrap();
    assert!(full.apply_json(full.revision,json!([{"op":"comment_create","author":"user","text":"Over threads limit","anchor":{"type":"point","x":0,"y":0}}])).is_err());
}
#[test]
fn agent_context_does_not_repeat_embedded_image_bytes() {
    use base64::Engine;
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(1, 1)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    let uri = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes.into_inner())
    );
    let b = Board::new("image-context".into(), "Image".into());
    let b = change(
        &b,
        json!([{"op":"create","element":{"kind":"image","image":uri}},{"op":"comment_create","author":"user","text":"Посмотри","anchor":{"type":"element","elementId":1,"u":1,"v":0}}]),
    );
    let context = b.comments_context("all", None).unwrap();
    assert!(!context.to_string().contains("base64,"));
    assert_eq!(context["threads"][0]["target"]["imageEmbedded"], true);
    assert_eq!(context["threads"][0]["target"]["imageMime"], "image/png");
    assert!(b.elements[0].image.is_some());
}

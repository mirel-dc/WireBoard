use serde_json::json;
use wireboard::{
    layout,
    model::{Board, Operation},
    render,
};
fn scene() -> Board {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/ux-layout.json")).unwrap();
    Board::new(uuid::Uuid::new_v4().to_string(), "Layout".into())
        .apply(
            0,
            &serde_json::from_value::<Vec<Operation>>(fixture["operations"].clone()).unwrap(),
        )
        .unwrap()
}
#[test]
fn shared_scene_rows_are_the_rendered_rows() {
    let b = scene();
    let s = layout::scene(&b).unwrap();
    let svg = render::render_svg(&b, None).unwrap();
    for row in s
        .elements
        .iter()
        .flat_map(|e| e.title.iter().chain(&e.body))
    {
        assert!(svg.contains(&render::escape(&row.text)));
        assert!(row.x.is_finite() && row.y.is_finite());
    }
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/ux-layout.json")).unwrap();
    approx(&serde_json::to_value(s).unwrap(), &fixture["scene"]);
}
#[test]
fn live_caption_avoids_cards() {
    let b = scene();
    let s = layout::scene(&b).unwrap();
    let c = &s.connectors[0].caption_bounds;
    for e in b
        .elements
        .iter()
        .filter(|e| e.kind == wireboard::model::ElementKind::Rectangle)
    {
        assert!(
            c.x + c.width <= e.x
                || c.x >= e.x + e.width
                || c.y + c.height <= e.y
                || c.y >= e.y + e.height
        );
    }
    assert!(layout::font_metrics().regular.contains_key("я"));
}
#[test]
fn free_frame_png_preserves_ratio() {
    let b = Board::new(uuid::Uuid::new_v4().to_string(), "Free".into())
        .apply(
            0,
            &serde_json::from_value::<Vec<Operation>>(
                json!([{"op":"create","element":{"kind":"frame","width":600,"height":300}}]),
            )
            .unwrap(),
        )
        .unwrap();
    let png = render::render_png(&b, Some(1)).unwrap();
    assert_eq!(u32::from_be_bytes(png[16..20].try_into().unwrap()), 1920);
    assert_eq!(u32::from_be_bytes(png[20..24].try_into().unwrap()), 960);
}

fn approx(a: &serde_json::Value, b: &serde_json::Value) {
    match (a, b) {
        (serde_json::Value::Number(a), serde_json::Value::Number(b)) => {
            assert!((a.as_f64().unwrap() - b.as_f64().unwrap()).abs() < 1e-9)
        }
        (serde_json::Value::Array(a), serde_json::Value::Array(b)) => {
            assert_eq!(a.len(), b.len());
            for (a, b) in a.iter().zip(b) {
                approx(a, b);
            }
        }
        (serde_json::Value::Object(a), serde_json::Value::Object(b)) => {
            assert_eq!(a.len(), b.len());
            for (k, v) in a {
                approx(v, &b[k]);
            }
        }
        _ => assert_eq!(a, b),
    }
}

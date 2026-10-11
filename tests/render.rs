use serde_json::json;
use wireboard::{
    model::Board,
    render::{render_png, render_svg},
};
fn sample() -> Board {
    serde_json::from_value(Board::new("test".into(),"Test".into()).apply_json(0,json!([
        {"op":"create","element":{"kind":"frame","width":960,"height":540}},
        {"op":"create","element":{"kind":"rectangle","x":60,"y":60,"text":"Привет <script>alert(1)</script>"}},
        {"op":"create","element":{"kind":"rectangle","x":1100,"y":100,"text":"Сосед"}}
    ])).unwrap()).unwrap()
}
#[test]
fn svg_escapes_text_and_clips_frame() {
    let svg = render_svg(&sample(), Some(1)).unwrap();
    assert!(svg.contains("width=\"960\""));
    assert!(svg.contains("height=\"540\""));
    assert!(!svg.contains("<script>"));
    assert!(svg.contains("&lt;script&gt;"));
    assert!(svg.contains("clip-path="));
    assert!(svg.contains("data-id=\"2\""));
}
#[test]
fn png_is_decodable_with_cyrillic() {
    let png = render_png(&sample(), Some(1)).unwrap();
    let img = image::load_from_memory(&png).unwrap();
    assert_eq!((img.width(), img.height()), (1920, 1080));
    assert!(png.len() > 5000);
}
#[test]
fn enormous_board_png_is_rejected() {
    let mut board = sample();
    board.elements[2].x = 100000.0;
    assert!(render_png(&board, None).is_err());
}
#[test]
fn title_weight_ellipsis_and_comments_do_not_leak_into_render() {
    let b = Board::new("layout".into(), "Layout".into());
    let b:Board=serde_json::from_value(b.apply_json(0,json!([
 {"op":"create","element":{"kind":"rectangle","width":240,"height":100,"title":"Заголовок <&>","text":"Очень длинное описание повторяется ".repeat(20),"fontWeight":600}},
 {"op":"comment_create","anchor":{"type":"point","x":10,"y":10},"author":"user","text":"SECRET DISCUSSION"}
 ])).unwrap()).unwrap();
    let svg = render_svg(&b, None).unwrap();
    assert!(svg.contains("Заголовок &lt;&amp;&gt;"));
    assert!(svg.contains("font-weight=\"600\""));
    assert!(svg.contains("…"));
    assert!(svg.contains("data-fit-height="));
    assert!(svg.contains("data-text-overflow=\"true\""));
    assert!(!svg.contains("SECRET DISCUSSION"));
    let png = render_png(&b, None).unwrap();
    assert!(png.len() > 1000);
}
#[test]
fn png_uses_a_real_semibold_face() {
    let b = Board::new("weight".into(), "Weight".into());
    let b:Board=serde_json::from_value(b.apply_json(0,json!([{"op":"create","element":{"kind":"text","text":"Кириллица Golos","width":400,"height":100}}])).unwrap()).unwrap();
    let regular = render_png(&b, None).unwrap();
    let bold: Board = serde_json::from_value(
        b.apply_json(
            1,
            json!([{"op":"update","id":1,"patch":{"fontWeight":600}}]),
        )
        .unwrap(),
    )
    .unwrap();
    assert_ne!(regular, render_png(&bold, None).unwrap());
    std::fs::create_dir_all("work").unwrap();
    std::fs::write("work/golos-400.png", regular).unwrap();
    std::fs::write("work/golos-600.png", render_png(&bold, None).unwrap()).unwrap();
}
#[test]
fn connector_and_frame_use_their_stored_font_weight() {
    let b = sample();
    let b:Board=serde_json::from_value(b.apply_json(b.revision,json!([
 {"op":"update","id":1,"patch":{"text":"Frame weight","fontWeight":600}},
 {"op":"create","element":{"kind":"connector","from":2,"to":3,"text":"Link weight","fontWeight":600}}
 ])).unwrap()).unwrap();
    let svg = render_svg(&b, None).unwrap();
    for id in [1, 4] {
        let group = svg
            .split(&format!("data-id=\"{id}\""))
            .nth(1)
            .unwrap()
            .split("</g>")
            .next()
            .unwrap();
        assert!(group.contains("font-weight=\"600\""));
    }
}

#[test]
fn narrow_gap_link_caption_keeps_its_font_and_avoids_cards() {
    let b: Board = serde_json::from_value(Board::new("captions".into(), "Captions".into()).apply_json(0, json!([
        {"op":"create","element":{"kind":"rectangle","x":0,"y":0,"width":200,"height":112}},
        {"op":"create","element":{"kind":"rectangle","x":220,"y":0,"width":200,"height":112}},
        {"op":"create","element":{"kind":"connector","from":1,"to":2,"text":"редактируете","fontSize":20}}
    ])).unwrap()).unwrap();
    let svg = render_svg(&b, None).unwrap();
    let group = svg
        .split("data-id=\"3\"")
        .nth(1)
        .unwrap()
        .split("</g>")
        .next()
        .unwrap();
    assert!(
        group.contains("font-size=\"20\""),
        "Link ignores its readable stored font size"
    );
    assert!(group.contains(">редактируете</text>"));
    let caption = group
        .split("data-connector-label=\"true\"")
        .nth(1)
        .expect("Caption geometry must be inspectable")
        .split('/')
        .next()
        .unwrap();
    let attr = |name: &str| {
        caption
            .split(&format!("{name}=\""))
            .nth(1)
            .unwrap()
            .split('"')
            .next()
            .unwrap()
            .parse::<f64>()
            .unwrap()
    };
    let (x, y, w, h) = (attr("x"), attr("y"), attr("width"), attr("height"));
    for card in &b.elements[..2] {
        assert!(
            !(x < card.x + card.width
                && x + w > card.x
                && y < card.y + card.height
                && y + h > card.y),
            "Caption is occluded by a card"
        );
    }
}

#[test]
fn compact_card_has_readable_title_and_full_short_description() {
    let b:Board=serde_json::from_value(Board::new("compact".into(),"Compact".into()).apply_json(0,json!([
        {"op":"create","element":{"kind":"rectangle","title":"Вы","text":"Редактор в браузере"}}
    ])).unwrap()).unwrap();
    assert_eq!((b.elements[0].width, b.elements[0].height), (220.0, 112.0));
    let svg = render_svg(&b, None).unwrap();
    assert!(svg.contains("Редактор в браузере</tspan>"));
    assert!(svg.contains("data-text-overflow=\"false\""));
    assert!(svg.contains("text-anchor=\"middle\""));
    assert!(svg.contains("font-size=\"20\""));
}

#[test]
fn link_caption_stays_visible_when_exporting_its_slide() {
    let b:Board=serde_json::from_value(Board::new("slide-captions".into(),"Slide captions".into()).apply_json(0,json!([
        {"op":"create","element":{"kind":"frame","width":960,"height":540}},
        {"op":"create","element":{"kind":"rectangle","x":0,"y":0,"width":200,"height":112}},
        {"op":"create","element":{"kind":"rectangle","x":220,"y":0,"width":200,"height":112}},
        {"op":"create","element":{"kind":"connector","from":2,"to":3,"text":"редактируете","fontSize":20}}
    ])).unwrap()).unwrap();
    let svg = render_svg(&b, Some(1)).unwrap();
    let rect = svg
        .split("data-connector-label=\"true\"")
        .nth(1)
        .unwrap()
        .split('/')
        .next()
        .unwrap();
    let attr = |name: &str| {
        rect.split(&format!("{name}=\""))
            .nth(1)
            .unwrap()
            .split('"')
            .next()
            .unwrap()
            .parse::<f64>()
            .unwrap()
    };
    assert!(
        attr("y") >= 0.0 && attr("y") + attr("height") <= 540.0,
        "Slide clips its caption"
    );
    assert!(
        attr("y") >= 112.0,
        "Caption should fit below the top-edge cards"
    );
}

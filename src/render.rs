use crate::layout::{connector_caption, text_layout};
use crate::{
    error::AppError,
    geometry::connector_path,
    model::{Board, Element, ElementKind},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use std::{fmt::Write, sync::OnceLock};
pub const FONT: &[u8] = include_bytes!("../frontend/public/fonts/GolosText.ttf");
pub const FONT_REGULAR: &[u8] = include_bytes!("../frontend/public/fonts/GolosText-400.ttf");
pub const FONT_SEMIBOLD: &[u8] = include_bytes!("../frontend/public/fonts/GolosText-600.ttf");
pub fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
pub fn bounds(board: &Board, frame: Option<u64>) -> Result<(f64, f64, f64, f64), AppError> {
    if let Some(id) = frame {
        let f = board.element(id)?;
        if f.kind != ElementKind::Frame {
            return Err(AppError::validation("Выбранный объект не является слайдом"));
        }
        return Ok((f.x, f.y, f.width, f.height));
    }
    if board.elements.is_empty() {
        return Ok((0.0, 0.0, 960.0, 540.0));
    }
    let elements: Vec<_> = board
        .elements
        .iter()
        .filter(|e| e.kind != ElementKind::Connector)
        .collect();
    if elements.is_empty() {
        return Ok((0.0, 0.0, 960.0, 540.0));
    }
    let mut x = elements.iter().map(|e| e.x).fold(f64::INFINITY, f64::min) - 40.0;
    let mut y = elements
        .iter()
        .map(|e| {
            e.y - if e.kind == ElementKind::Frame {
                32.0
            } else {
                0.0
            }
        })
        .fold(f64::INFINITY, f64::min)
        - 40.0;
    let mut right = elements
        .iter()
        .map(|e| e.x + e.width)
        .fold(f64::NEG_INFINITY, f64::max)
        + 40.0;
    let mut bottom = elements
        .iter()
        .map(|e| e.y + e.height)
        .fold(f64::NEG_INFINITY, f64::max)
        + 40.0;
    for e in board
        .elements
        .iter()
        .filter(|e| e.kind == ElementKind::Connector && !e.text.is_empty())
    {
        let label = connector_caption(board, e)?;
        x = x.min(label.x - 40.0);
        y = y.min(label.y - 40.0);
        right = right.max(label.x + label.width + 40.0);
        bottom = bottom.max(label.y + label.height + 40.0);
    }
    Ok((x, y, right - x, bottom - y))
}
fn element_text(svg: &mut String, e: &Element) {
    let layout = text_layout(e);
    let padding = layout.padding;
    let _ = write!(
        svg,
        "<g data-fit-height=\"{}\" data-text-overflow=\"{}\"><clipPath id=\"text-{}\"><rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"/></clipPath><g clip-path=\"url(#text-{})\">",
        layout.fit_height, layout.overflow, e.id, e.x, e.y, e.width, e.height, e.id
    );
    let centered = e.kind == ElementKind::Rectangle;
    let content_height = layout.title.len() as f64 * layout.title_size * 1.25
        + if layout.title.is_empty() { 0.0 } else { 8.0 }
        + layout.body.len() as f64 * e.font_size * 1.4;
    let mut y = e.y
        + if centered {
            ((e.height - content_height) / 2.0).max(padding)
        } else {
            padding
        };
    let anchor = if centered { "middle" } else { "start" };
    let text_x = if centered {
        e.x + e.width / 2.0
    } else {
        e.x + padding
    };
    for (lines, size, weight) in [
        (&layout.title, layout.title_size, 600),
        (&layout.body, e.font_size, e.font_weight),
    ] {
        if lines.is_empty() {
            continue;
        }
        let _ = write!(
            svg,
            "<text text-anchor=\"{anchor}\" font-family=\"Golos Text\" font-size=\"{size}\" font-weight=\"{weight}\" font-kerning=\"none\" font-variant-ligatures=\"none\" fill=\"#302b3b\">"
        );
        for line in lines {
            let _ = write!(
                svg,
                "<tspan x=\"{}\" y=\"{}\">{}</tspan>",
                text_x,
                y + size,
                escape(line)
            );
            y += size
                * if std::ptr::eq(lines, &layout.title) {
                    1.25
                } else {
                    1.4
                };
        }
        svg.push_str("</text>");
        if std::ptr::eq(lines, &layout.title) {
            y += 8.0;
        }
    }
    svg.push_str("</g></g>");
}
pub fn render_svg(board: &Board, frame: Option<u64>) -> Result<String, AppError> {
    let (x, y, w, h) = bounds(board, frame)?;
    let mut svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{h}\" viewBox=\"{x} {y} {w} {h}\"><defs><style>@font-face{{font-family:'Golos Text';font-weight:400;src:url(data:font/ttf;base64,{})}}@font-face{{font-family:'Golos Text';font-weight:600;src:url(data:font/ttf;base64,{})}}</style><clipPath id=\"board-clip\"><rect x=\"{x}\" y=\"{y}\" width=\"{w}\" height=\"{h}\"/></clipPath>",
        STANDARD.encode(FONT_REGULAR),
        STANDARD.encode(FONT_SEMIBOLD)
    );
    for e in board
        .elements
        .iter()
        .filter(|e| e.kind == ElementKind::Connector)
    {
        let _ = write!(
            svg,
            "<marker id=\"arrow-{}\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M 0 0 L 10 5 L 0 10 z\" fill=\"{}\"/></marker>",
            e.id, e.stroke
        );
    }
    svg.push_str("</defs>");
    let _ = write!(
        svg,
        "<rect x=\"{x}\" y=\"{y}\" width=\"{w}\" height=\"{h}\" fill=\"#ffffff\"/><g id=\"scene\" clip-path=\"url(#board-clip)\">"
    );
    for e in board
        .elements
        .iter()
        .filter(|e| e.kind == ElementKind::Frame)
    {
        if frame.is_some() {
            continue;
        }
        let _ = write!(
            svg,
            "<g data-id=\"{}\" data-kind=\"frame\"><rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"12\" fill=\"{}\" stroke=\"#b0bdb4\" stroke-width=\"1.5\"/><text x=\"{}\" y=\"{}\" font-family=\"Golos Text\" font-size=\"15\" font-weight=\"{}\" fill=\"#66786c\">{}</text></g>",
            e.id,
            e.x,
            e.y,
            e.width,
            e.height,
            e.fill,
            e.x,
            e.y - 12.0,
            e.font_weight,
            escape(&e.text)
        );
    }
    for e in board
        .elements
        .iter()
        .filter(|e| e.kind == ElementKind::Connector)
    {
        let path = connector_path(board, e.id)?;
        let _ = write!(
            svg,
            "<g data-id=\"{}\" data-kind=\"connector\"><path d=\"{}\" fill=\"none\" stroke=\"{}\" stroke-width=\"2\" marker-end=\"url(#arrow-{})\"/><path d=\"{}\" fill=\"none\" stroke=\"transparent\" stroke-width=\"16\"/>",
            e.id, path, e.stroke, e.id, path
        );
        if !e.text.is_empty() {
            let label = connector_caption(board, e)?;
            let _ = write!(
                svg,
                "<rect data-connector-label=\"true\" x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"3\" fill=\"#ffffff\"/>",
                label.x, label.y, label.width, label.height
            );
            for (row, line) in label.lines.iter().enumerate() {
                let _ = write!(
                    svg,
                    "<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-family=\"Golos Text\" font-size=\"{}\" font-weight=\"{}\" font-kerning=\"none\" font-variant-ligatures=\"none\" fill=\"#302b3b\">{}</text>",
                    label.x + label.width / 2.0,
                    label.y + 6.0 + e.font_size + row as f64 * e.font_size * 1.4,
                    e.font_size,
                    e.font_weight,
                    escape(line)
                );
            }
        }
        svg.push_str("</g>");
    }
    for e in board
        .elements
        .iter()
        .filter(|e| !matches!(e.kind, ElementKind::Frame | ElementKind::Connector))
    {
        let _ = write!(svg, "<g data-id=\"{}\" data-kind=\"{:?}\">", e.id, e.kind);
        match e.kind {
            ElementKind::Rectangle => {
                let _ = write!(
                    svg,
                    "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"5\" fill=\"{}\" stroke=\"{}\" stroke-width=\"2\"/>",
                    e.x, e.y, e.width, e.height, e.fill, e.stroke
                );
            }
            ElementKind::Image => {
                let _ = write!(
                    svg,
                    "<image x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" href=\"{}\" preserveAspectRatio=\"xMidYMid meet\"/>",
                    e.x,
                    e.y,
                    e.width,
                    e.height,
                    escape(e.image.as_deref().unwrap_or(""))
                );
            }
            _ => {
                let _ = write!(
                    svg,
                    "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"transparent\"/>",
                    e.x, e.y, e.width, e.height
                );
            }
        }
        element_text(&mut svg, e);
        svg.push_str("</g>");
    }
    svg.push_str("</g></svg>");
    Ok(svg)
}
pub fn render_png(board: &Board, frame: Option<u64>) -> Result<Vec<u8>, AppError> {
    let (_, _, w, h) = bounds(board, frame)?;
    let scale = if frame.is_some() { 1920.0 / w } else { 1.0 };
    let pw = (w * scale).ceil() as u32;
    let ph = (h * scale).ceil() as u32;
    if pw == 0 || ph == 0 || pw > 8192 || ph > 8192 || u64::from(pw) * u64::from(ph) > 16_000_000 {
        return Err(AppError::limit(
            "PNG слишком велик. Экспортируйте отдельный слайд или SVG",
        ));
    }
    static OPTIONS: OnceLock<resvg::usvg::Options<'static>> = OnceLock::new();
    let options = OPTIONS.get_or_init(|| {
        let mut options = resvg::usvg::Options {
            font_family: "Golos Text".into(),
            ..Default::default()
        };
        options.fontdb_mut().load_font_data(FONT_REGULAR.to_vec());
        options.fontdb_mut().load_font_data(FONT_SEMIBOLD.to_vec());
        options
    });
    let tree = resvg::usvg::Tree::from_str(&render_svg(board, frame)?, options)
        .map_err(|_| AppError::validation("Не удалось построить SVG"))?;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(pw, ph)
        .ok_or_else(|| AppError::limit("Недостаточно памяти для PNG"))?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale as f32, scale as f32),
        &mut pixmap.as_mut(),
    );
    pixmap
        .encode_png()
        .map_err(|_| AppError::validation("Не удалось записать PNG"))
}

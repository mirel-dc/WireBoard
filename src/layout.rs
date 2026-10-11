use crate::{
    comments::{Anchor, anchor_position},
    error::AppError,
    geometry::connector_points,
    model::{Board, Element, ElementKind},
};
use serde::Serialize;
use std::{collections::BTreeMap, sync::OnceLock};
#[derive(Debug, Serialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Debug, Serialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}
#[derive(Debug, Serialize)]
pub struct TextRow {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub size: f64,
    pub weight: u16,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementLayout {
    pub id: u64,
    pub bounds: Bounds,
    pub title: Vec<TextRow>,
    pub body: Vec<TextRow>,
    pub fit_height: f64,
    pub overflow: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorLayout {
    pub id: u64,
    pub points: Vec<Point>,
    pub caption_bounds: Bounds,
    pub caption: Vec<TextRow>,
}
#[derive(Debug, Serialize)]
pub struct SceneLayout {
    pub elements: Vec<ElementLayout>,
    pub connectors: Vec<ConnectorLayout>,
}
pub fn scene(board: &Board) -> Result<SceneLayout, AppError> {
    let mut elements = Vec::new();
    let mut connectors = Vec::new();
    for e in &board.elements {
        if e.kind == ElementKind::Connector {
            let points = connector_points(board, e.id)?
                .into_iter()
                .map(|(x, y)| Point { x, y })
                .collect();
            let c = connector_caption(board, e)?;
            let caption = c
                .lines
                .iter()
                .enumerate()
                .map(|(i, text)| TextRow {
                    text: text.clone(),
                    x: c.x + c.width / 2.0,
                    y: c.y + 6.0 + e.font_size + i as f64 * e.font_size * 1.4,
                    size: e.font_size,
                    weight: e.font_weight,
                })
                .collect();
            connectors.push(ConnectorLayout {
                id: e.id,
                points,
                caption_bounds: Bounds {
                    x: c.x,
                    y: c.y,
                    width: c.width,
                    height: c.height,
                },
                caption,
            });
            continue;
        }
        let l = text_layout(e);
        let centered = e.kind == ElementKind::Rectangle;
        let content_height = l.title.len() as f64 * l.title_size * 1.25
            + if l.title.is_empty() { 0.0 } else { 8.0 }
            + l.body.len() as f64 * e.font_size * 1.4;
        let mut y = e.y
            + if centered {
                ((e.height - content_height) / 2.0).max(l.padding)
            } else {
                l.padding
            };
        let x = if centered {
            e.x + e.width / 2.0
        } else {
            e.x + l.padding
        };
        let mut rows = |lines: &[String], size: f64, weight: u16, spacing: f64| {
            lines
                .iter()
                .map(|text| {
                    let row = TextRow {
                        text: text.clone(),
                        x,
                        y: y + size,
                        size,
                        weight,
                    };
                    y += size * spacing;
                    row
                })
                .collect::<Vec<_>>()
        };
        let title = rows(&l.title, l.title_size, 600, 1.25);
        if !l.title.is_empty() {
            y += 8.0;
        }
        let body = l
            .body
            .iter()
            .map(|text| {
                let row = TextRow {
                    text: text.clone(),
                    x,
                    y: y + e.font_size,
                    size: e.font_size,
                    weight: e.font_weight,
                };
                y += e.font_size * 1.4;
                row
            })
            .collect();
        elements.push(ElementLayout {
            id: e.id,
            bounds: Bounds {
                x: e.x,
                y: e.y,
                width: e.width,
                height: e.height,
            },
            title,
            body,
            fit_height: l.fit_height,
            overflow: l.overflow,
        });
    }
    Ok(SceneLayout {
        elements,
        connectors,
    })
}
#[derive(Debug, Serialize)]
pub struct FontMetrics {
    pub regular: BTreeMap<String, f64>,
    pub semibold: BTreeMap<String, f64>,
    pub fallback: f64,
}
pub fn font_metrics() -> &'static FontMetrics {
    static METRICS: OnceLock<FontMetrics> = OnceLock::new();
    METRICS.get_or_init(|| {
        fn widths(bytes: &[u8]) -> BTreeMap<String, f64> {
            let face = ttf_parser::Face::parse(bytes, 0).expect("Bundled font is valid");
            let mut result = BTreeMap::new();
            for sub in face
                .tables()
                .cmap
                .expect("Bundled cmap")
                .subtables
                .into_iter()
                .filter(|s| s.is_unicode())
            {
                sub.codepoints(|cp| {
                    if let Some(c) = char::from_u32(cp)
                        && let Some(advance) =
                            face.glyph_index(c).and_then(|g| face.glyph_hor_advance(g))
                    {
                        result.insert(
                            c.to_string(),
                            f64::from(advance) / f64::from(face.units_per_em()),
                        );
                    }
                });
            }
            result
        }
        FontMetrics {
            regular: widths(crate::render::FONT_REGULAR),
            semibold: widths(crate::render::FONT_SEMIBOLD),
            fallback: 0.5,
        }
    })
}
pub fn text_width(text: &str, size: f64, weight: u16) -> f64 {
    let metrics = font_metrics();
    let map = if weight == 600 {
        &metrics.semibold
    } else {
        &metrics.regular
    };
    text.chars()
        .map(|c| map.get(&c.to_string()).copied().unwrap_or(metrics.fallback))
        .sum::<f64>()
        * size
}
pub fn wrap(text: &str, size: f64, width: f64, weight: u16) -> Vec<String> {
    let mut result = Vec::new();
    for paragraph in text.split('\n') {
        let mut line = String::new();
        for word in paragraph.split_whitespace() {
            let candidate = if line.is_empty() {
                word.into()
            } else {
                format!("{line} {word}")
            };
            if text_width(&candidate, size, weight) <= width {
                line = candidate;
                continue;
            }
            if !line.is_empty() {
                result.push(std::mem::take(&mut line));
            }
            for c in word.chars() {
                let mut candidate = line.clone();
                candidate.push(c);
                if !line.is_empty() && text_width(&candidate, size, weight) > width {
                    result.push(std::mem::take(&mut line));
                }
                line.push(c);
            }
        }
        result.push(line);
    }
    result
}
pub struct TextLayout {
    pub title: Vec<String>,
    pub body: Vec<String>,
    pub fit_height: f64,
    pub overflow: bool,
    pub padding: f64,
    pub title_size: f64,
}
pub fn truncated(
    mut lines: Vec<String>,
    rows: usize,
    size: f64,
    width: f64,
    weight: u16,
) -> Vec<String> {
    if lines.len() <= rows {
        return lines;
    }
    lines.truncate(rows);
    if let Some(last) = lines.last_mut() {
        while !last.is_empty() && text_width(&format!("{last}…"), size, weight) > width {
            last.pop();
        }
        last.push('…');
    }
    lines
}

pub struct ConnectorCaption {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub lines: Vec<String>,
}
pub fn connector_caption(board: &Board, e: &Element) -> Result<ConnectorCaption, AppError> {
    let (cx, cy) = anchor_position(
        board,
        &Anchor::Connector {
            element_id: e.id,
            t: 0.5,
        },
    )?;
    let lines = truncated(
        wrap(&e.text, e.font_size, 260.0, e.font_weight),
        2,
        e.font_size,
        260.0,
        e.font_weight,
    );
    let width = lines
        .iter()
        .map(|s| text_width(s, e.font_size, e.font_weight))
        .fold(0.0, f64::max)
        + 16.0;
    let height = lines.len() as f64 * e.font_size * 1.4 + 12.0;
    let endpoints = [
        board.element(e.from.ok_or_else(AppError::missing)?)?,
        board.element(e.to.ok_or_else(AppError::missing)?)?,
    ];
    let frame = board
        .elements
        .iter()
        .filter(|f| {
            f.kind == ElementKind::Frame
                && endpoints.iter().all(|n| {
                    n.x >= f.x
                        && n.y >= f.y
                        && n.x + n.width <= f.x + f.width
                        && n.y + n.height <= f.y + f.height
                })
        })
        .min_by(|a, b| {
            (a.width * a.height)
                .total_cmp(&(b.width * b.height))
                .then(a.id.cmp(&b.id))
        });
    let mut x = cx - width / 2.0;
    let (min_y, max_y) = frame
        .filter(|f| f.height >= height + 16.0)
        .map(|f| (f.y + 8.0, f.y + f.height - height - 8.0))
        .unwrap_or((f64::NEG_INFINITY, f64::INFINITY));
    if let Some(f) = frame.filter(|f| f.width >= width + 16.0) {
        x = x.clamp(f.x + 8.0, f.x + f.width - width - 8.0);
    }
    // A caption's top must stay outside these intervals to clear visible objects.
    // Merge them once instead of repeatedly searching every candidate/object pair.
    let mut intervals: Vec<_> = board
        .elements
        .iter()
        .filter(|n| {
            !matches!(n.kind, ElementKind::Frame | ElementKind::Connector)
                && x < n.x + n.width + 8.0
                && x + width > n.x - 8.0
        })
        .map(|n| (n.y - height - 8.0, n.y + n.height + 8.0))
        .collect();
    intervals.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut merged: Vec<(f64, f64)> = Vec::new();
    for (start, end) in intervals {
        if let Some(last) = merged.last_mut().filter(|last| start <= last.1) {
            last.1 = last.1.max(end);
        } else {
            merged.push((start, end));
        }
    }
    let desired = (cy - height - 8.0).clamp(min_y, max_y);
    let y = std::iter::once(desired)
        .chain(merged.iter().flat_map(|&(a, b)| [a, b]))
        .filter(|&y| y >= min_y && y <= max_y)
        .filter(|&y| {
            let index = merged.partition_point(|&(start, _)| start < y);
            index == 0 || y >= merged[index - 1].1
        })
        .min_by(|a, b| {
            (a - desired)
                .abs()
                .total_cmp(&(b - desired).abs())
                .then(a.total_cmp(b))
        })
        .unwrap_or(desired);
    Ok(ConnectorCaption {
        x,
        y,
        width,
        height,
        lines,
    })
}
pub fn text_layout(e: &Element) -> TextLayout {
    let padding = if e.kind == ElementKind::Text {
        4.0
    } else {
        16.0
    };
    let width = (e.width - padding * 2.0).max(1.0);
    let title_size = (e.font_size + 4.0).min(96.0);
    let all_title = if e.title.is_empty() {
        vec![]
    } else {
        wrap(&e.title, title_size, width, 600)
    };
    let title_overflow = all_title.len() > 2;
    let title = truncated(all_title, 2, title_size, width, 600);
    let title_height =
        title.len() as f64 * title_size * 1.25 + if title.is_empty() { 0.0 } else { 8.0 };
    let all_body = if e.text.is_empty() {
        vec![]
    } else {
        wrap(&e.text, e.font_size, width, e.font_weight)
    };
    let fit_height = (padding * 2.0 + title_height + all_body.len() as f64 * e.font_size * 1.4)
        .clamp(20.0, 10000.0);
    let available = (e.height - padding * 2.0 - title_height).max(0.0);
    let rows = (available / (e.font_size * 1.4)).floor() as usize;
    let overflow = title_overflow || all_body.len() > rows;
    let mut body = truncated(all_body, rows, e.font_size, width, e.font_weight);
    // Even a card too short for one row must visibly signal hidden text.
    if overflow && body.is_empty() && !e.text.is_empty() && e.height >= padding + e.font_size {
        body.push("…".into());
    }
    TextLayout {
        title,
        body,
        fit_height,
        overflow,
        padding,
        title_size,
    }
}

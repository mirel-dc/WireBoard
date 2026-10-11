use crate::{
    error::AppError,
    model::{Board, Element, ElementKind, Port},
};
pub fn frame_members(board: &Board, frame_id: u64) -> Vec<u64> {
    let mut members = std::collections::BTreeSet::new();
    let mut frontier = vec![frame_id];
    while let Some(parent) = frontier.pop() {
        for e in &board.elements {
            if e.id != frame_id && e.parent_frame_id == Some(parent) && members.insert(e.id) {
                frontier.push(e.id);
            }
        }
    }
    members.into_iter().collect()
}
pub fn containing_frame(board: &Board, e: &Element) -> Option<u64> {
    board
        .elements
        .iter()
        .filter(|p| {
            p.kind == ElementKind::Frame
                && p.id != e.id
                && e.x >= p.x
                && e.y >= p.y
                && e.x + e.width <= p.x + p.width
                && e.y + e.height <= p.y + p.height
                && (e.kind != ElementKind::Frame
                    || p.width * p.height > e.width * e.height
                    || (p.width * p.height == e.width * e.height && p.id < e.id))
        })
        .min_by(|a, b| {
            (a.width * a.height)
                .total_cmp(&(b.width * b.height))
                .then(a.id.cmp(&b.id))
        })
        .map(|p| p.id)
}
pub fn migrate_membership(board: &mut Board) {
    let parents: Vec<_> = board
        .elements
        .iter()
        .map(|e| {
            if e.kind == ElementKind::Connector {
                None
            } else {
                containing_frame(board, e)
            }
        })
        .collect();
    for (e, parent) in board.elements.iter_mut().zip(parents) {
        e.parent_frame_id = parent;
    }
}
pub fn drop_target(board: &Board, id: u64, x: f64, y: f64) -> Option<u64> {
    let descendants = frame_members(board, id);
    board
        .elements
        .iter()
        .filter(|p| {
            p.kind == ElementKind::Frame
                && p.id != id
                && !descendants.contains(&p.id)
                && x >= p.x
                && y >= p.y
                && x <= p.x + p.width
                && y <= p.y + p.height
        })
        .min_by(|a, b| {
            let depth = |e: &Element| {
                let mut parent = e.parent_frame_id;
                let mut depth = 0;
                while let Some(id) = parent {
                    depth += 1;
                    if depth > board.elements.len() {
                        break;
                    }
                    parent = board.element(id).ok().and_then(|p| p.parent_frame_id);
                }
                depth
            };
            depth(b)
                .cmp(&depth(a))
                .then((a.width * a.height).total_cmp(&(b.width * b.height)))
                .then(a.id.cmp(&b.id))
        })
        .map(|p| p.id)
}
pub fn fit_frame(board: &Board, id: u64, padding: f64) -> Result<(f64, f64, f64, f64), AppError> {
    let frame = board.element(id)?;
    if frame.kind != ElementKind::Frame || !padding.is_finite() || padding < 0.0 {
        return Err(AppError::validation("Выберите фрейм"));
    }
    let ids = frame_members(board, id);
    let elements: Vec<_> = board
        .elements
        .iter()
        .filter(|e| ids.contains(&e.id))
        .collect();
    if elements.is_empty() {
        return Ok((frame.x, frame.y, frame.width, frame.height));
    }
    let x = elements.iter().map(|e| e.x).fold(f64::INFINITY, f64::min) - padding;
    let y = elements.iter().map(|e| e.y).fold(f64::INFINITY, f64::min) - padding;
    let right = elements
        .iter()
        .map(|e| e.x + e.width)
        .fold(f64::NEG_INFINITY, f64::max)
        + padding;
    let bottom = elements
        .iter()
        .map(|e| e.y + e.height)
        .fold(f64::NEG_INFINITY, f64::max)
        + padding;
    Ok((x, y, (right - x).max(20.0), (bottom - y).max(20.0)))
}
pub fn ordered_frames(board: &Board) -> Vec<u64> {
    let mut frames: Vec<_> = board
        .elements
        .iter()
        .filter(|e| e.kind == ElementKind::Frame)
        .collect();
    frames.sort_by(|a, b| {
        a.y.total_cmp(&b.y)
            .then(a.x.total_cmp(&b.x))
            .then(a.id.cmp(&b.id))
    });
    frames.into_iter().map(|e| e.id).collect()
}
fn anchor(e: &Element, port: Port, target: &Element) -> (f64, f64, bool) {
    let port = if port == Port::Auto {
        let dx = target.x + target.width / 2.0 - e.x - e.width / 2.0;
        let dy = target.y + target.height / 2.0 - e.y - e.height / 2.0;
        if dx.abs() >= dy.abs() {
            if dx >= 0.0 { Port::Right } else { Port::Left }
        } else if dy >= 0.0 {
            Port::Bottom
        } else {
            Port::Top
        }
    } else {
        port
    };
    match port {
        Port::Left => (e.x, e.y + e.height / 2.0, true),
        Port::Right => (e.x + e.width, e.y + e.height / 2.0, true),
        Port::Top => (e.x + e.width / 2.0, e.y, false),
        _ => (e.x + e.width / 2.0, e.y + e.height, false),
    }
}
pub fn connector_points(board: &Board, id: u64) -> Result<Vec<(f64, f64)>, AppError> {
    let e = board.element(id)?;
    let a = board.element(e.from.ok_or_else(AppError::missing)?)?;
    let b = board.element(e.to.ok_or_else(AppError::missing)?)?;
    let (ax, ay, ah) = anchor(a, e.from_port, b);
    let (bx, by, bh) = anchor(b, e.to_port, a);
    Ok(if ah && bh {
        vec![
            (ax, ay),
            ((ax + bx) / 2.0, ay),
            ((ax + bx) / 2.0, by),
            (bx, by),
        ]
    } else if !ah && !bh {
        vec![
            (ax, ay),
            (ax, (ay + by) / 2.0),
            (bx, (ay + by) / 2.0),
            (bx, by),
        ]
    } else if ah {
        vec![(ax, ay), (bx, ay), (bx, by)]
    } else {
        vec![(ax, ay), (ax, by), (bx, by)]
    })
}
pub fn connector_path(board: &Board, id: u64) -> Result<String, AppError> {
    Ok(connector_points(board, id)?
        .iter()
        .enumerate()
        .map(|(i, (x, y))| format!("{} {x} {y}", if i == 0 { "M" } else { "L" }))
        .collect::<Vec<_>>()
        .join(" "))
}

use crate::{
    error::AppError,
    geometry::connector_points,
    model::{Board, Element, ElementKind, MAX_SAFE_ID, valid_text},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Author {
    User,
    Codex,
    Claude,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CommentStatus {
    Open,
    AwaitingReview,
    Resolved,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Anchor {
    Element {
        #[serde(rename = "elementId")]
        element_id: u64,
        u: f64,
        v: f64,
    },
    Connector {
        #[serde(rename = "elementId")]
        element_id: u64,
        t: f64,
    },
    Point {
        x: f64,
        y: f64,
    },
}
impl Anchor {
    pub fn element_id(&self) -> Option<u64> {
        match self {
            Self::Element { element_id, .. } | Self::Connector { element_id, .. } => {
                Some(*element_id)
            }
            Self::Point { .. } => None,
        }
    }
    fn validate(&self) -> Result<(), AppError> {
        let unit = |n: f64| n.is_finite() && (0.0..=1.0).contains(&n);
        let valid = match self {
            Self::Element { element_id, u, v } => {
                *element_id > 0 && *element_id < MAX_SAFE_ID && unit(*u) && unit(*v)
            }
            Self::Connector { element_id, t } => {
                *element_id > 0 && *element_id < MAX_SAFE_ID && unit(*t)
            }
            Self::Point { x, y } => [x, y].iter().all(|n| n.is_finite() && n.abs() <= 100000.0),
        };
        if valid {
            Ok(())
        } else {
            Err(AppError::validation("Некорректная привязка комментария"))
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnchorSnapshot {
    pub element_id: u64,
    pub kind: ElementKind,
    pub title: String,
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub world_x: f64,
    pub world_y: f64,
    pub from: Option<u64>,
    pub to: Option<u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommentMessage {
    pub id: u64,
    pub author: Author,
    pub text: String,
    pub created_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommentThread {
    pub id: u64,
    pub anchor: Anchor,
    pub anchor_snapshot: Option<AnchorSnapshot>,
    pub status: CommentStatus,
    pub messages: Vec<CommentMessage>,
    pub created_at: String,
    pub updated_at: String,
    pub review_revision: Option<u64>,
}
pub fn timestamp(value: &str) -> Result<OffsetDateTime, AppError> {
    let parsed = OffsetDateTime::parse(value, &Rfc3339)
        .map_err(|_| AppError::validation("Некорректное время комментария"))?;
    if parsed.offset() != time::UtcOffset::UTC {
        return Err(AppError::validation("Время комментария должно быть UTC"));
    }
    Ok(parsed)
}
fn message_text(text: &str) -> Result<(), AppError> {
    if text.trim().is_empty() || !valid_text(text, 4000) {
        Err(AppError::validation(
            "Сообщение должно содержать от 1 до 4000 символов",
        ))
    } else {
        Ok(())
    }
}
fn allocate(counter: &mut u64) -> Result<u64, AppError> {
    if *counter == 0 || *counter >= MAX_SAFE_ID {
        return Err(AppError::limit("ID комментариев исчерпаны"));
    }
    let id = *counter;
    *counter += 1;
    Ok(id)
}
pub fn anchor_position(board: &Board, anchor: &Anchor) -> Result<(f64, f64), AppError> {
    anchor.validate()?;
    match anchor {
        Anchor::Point { x, y } => Ok((*x, *y)),
        Anchor::Element { element_id, u, v } => {
            let e = board.element(*element_id)?;
            if e.kind == ElementKind::Connector {
                return Err(AppError::validation("Для связи нужна привязка connector"));
            }
            Ok((e.x + e.width * u, e.y + e.height * v))
        }
        Anchor::Connector { element_id, t } => {
            if board.element(*element_id)?.kind != ElementKind::Connector {
                return Err(AppError::validation("Привязка connector требует связь"));
            }
            let points = connector_points(board, *element_id)?;
            let lengths: Vec<f64> = points
                .windows(2)
                .map(|p| (p[1].0 - p[0].0).hypot(p[1].1 - p[0].1))
                .collect();
            let mut distance = lengths.iter().sum::<f64>() * t;
            for (p, len) in points.windows(2).zip(lengths) {
                if distance <= len && len > 0.0 {
                    let ratio = distance / len;
                    return Ok((
                        p[0].0 + (p[1].0 - p[0].0) * ratio,
                        p[0].1 + (p[1].1 - p[0].1) * ratio,
                    ));
                }
                distance -= len;
            }
            points.last().copied().ok_or_else(AppError::missing)
        }
    }
}
fn snapshot(board: &Board, anchor: &Anchor) -> Result<Option<AnchorSnapshot>, AppError> {
    let (world_x, world_y) = anchor_position(board, anchor)?;
    let Some(id) = anchor.element_id() else {
        return Ok(None);
    };
    let e = board.element(id)?;
    Ok(Some(AnchorSnapshot {
        element_id: id,
        kind: e.kind,
        title: e.title.clone(),
        text: e.text.clone(),
        x: e.x,
        y: e.y,
        width: e.width,
        height: e.height,
        world_x,
        world_y,
        from: e.from,
        to: e.to,
    }))
}
impl Board {
    pub(crate) fn refresh_comment_snapshots(&mut self) -> Result<(), AppError> {
        for i in 0..self.comments.len() {
            let anchor = &self.comments[i].anchor;
            if anchor
                .element_id()
                .is_none_or(|id| self.elements.iter().any(|e| e.id == id))
            {
                self.comments[i].anchor_snapshot = snapshot(self, anchor)?;
            }
        }
        Ok(())
    }
    pub(crate) fn create_comment(
        &mut self,
        anchor: &Anchor,
        author: Author,
        text: &str,
        now: &str,
    ) -> Result<(), AppError> {
        message_text(text)?;
        let anchor_snapshot = snapshot(self, anchor)?;
        let id = allocate(&mut self.next_comment_id)?;
        let message_id = allocate(&mut self.next_message_id)?;
        self.comments.push(CommentThread {
            id,
            anchor: anchor.clone(),
            anchor_snapshot,
            status: CommentStatus::Open,
            messages: vec![CommentMessage {
                id: message_id,
                author,
                text: text.into(),
                created_at: now.into(),
            }],
            created_at: now.into(),
            updated_at: now.into(),
            review_revision: None,
        });
        Ok(())
    }
    pub(crate) fn reply_comment(
        &mut self,
        id: u64,
        author: Author,
        text: &str,
        review: bool,
        now: &str,
    ) -> Result<(), AppError> {
        message_text(text)?;
        let index = self
            .comments
            .iter()
            .position(|c| c.id == id)
            .ok_or_else(AppError::missing)?;
        if (author == Author::User && review)
            || (author != Author::User && self.comments[index].status == CommentStatus::Resolved)
        {
            return Err(AppError::validation(
                "Пользователь проверяет результат; агент отвечает только в активной ветке",
            ));
        }
        let message_id = allocate(&mut self.next_message_id)?;
        let c = &mut self.comments[index];
        c.messages.push(CommentMessage {
            id: message_id,
            author,
            text: text.into(),
            created_at: now.into(),
        });
        c.status = if review {
            CommentStatus::AwaitingReview
        } else {
            CommentStatus::Open
        };
        c.review_revision = review.then_some(self.revision);
        c.updated_at = now.into();
        Ok(())
    }
    pub(crate) fn set_comment_status(
        &mut self,
        id: u64,
        author: Author,
        status: CommentStatus,
        now: &str,
    ) -> Result<(), AppError> {
        if author != Author::User || status == CommentStatus::AwaitingReview {
            return Err(AppError::validation(
                "Только пользователь может закрыть или открыть обсуждение",
            ));
        }
        let c = self
            .comments
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(AppError::missing)?;
        c.status = status;
        if status == CommentStatus::Open {
            c.review_revision = None;
        }
        c.updated_at = now.into();
        Ok(())
    }
    pub(crate) fn reanchor_comment(
        &mut self,
        id: u64,
        author: Author,
        anchor: &Anchor,
        now: &str,
    ) -> Result<(), AppError> {
        if author != Author::User {
            return Err(AppError::validation(
                "Только пользователь может переместить комментарий",
            ));
        }
        let s = snapshot(self, anchor)?;
        let c = self
            .comments
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(AppError::missing)?;
        c.anchor = anchor.clone();
        c.anchor_snapshot = s;
        c.status = CommentStatus::Open;
        c.review_revision = None;
        c.updated_at = now.into();
        Ok(())
    }
    pub(crate) fn validate_comments(&self) -> Result<(), AppError> {
        if self
            .comments
            .windows(2)
            .any(|pair| pair[0].id >= pair[1].id)
        {
            return Err(AppError::validation(
                "Ветки должны следовать по возрастанию ID",
            ));
        }
        if self.comments.len() > 500
            || self
                .comments
                .iter()
                .map(|c| c.messages.len())
                .sum::<usize>()
                > 10000
        {
            return Err(AppError::limit("Превышен лимит обсуждений"));
        }
        if [self.next_comment_id, self.next_message_id]
            .iter()
            .any(|n| *n == 0 || *n > MAX_SAFE_ID)
        {
            return Err(AppError::validation("Некорректный счётчик комментариев"));
        }
        let mut threads = BTreeSet::new();
        let mut messages = BTreeSet::new();
        for c in &self.comments {
            if c.id == 0
                || c.id >= self.next_comment_id
                || !threads.insert(c.id)
                || c.messages.is_empty()
                || c.messages.len() > 100
            {
                return Err(AppError::validation("Некорректная ветка комментариев"));
            }
            let created = timestamp(&c.created_at)?;
            let updated = timestamp(&c.updated_at)?;
            if updated < created
                || c.review_revision.is_some_and(|r| r > self.revision)
                || (c.status == CommentStatus::Open && c.review_revision.is_some())
                || (c.status == CommentStatus::AwaitingReview && c.review_revision.is_none())
            {
                return Err(AppError::validation(
                    "Несогласованный статус или время обсуждения",
                ));
            }
            let mut previous = 0;
            let mut previous_time = created;
            for m in &c.messages {
                let t = timestamp(&m.created_at)?;
                message_text(&m.text)?;
                if m.id <= previous
                    || m.id >= self.next_message_id
                    || !messages.insert(m.id)
                    || t < previous_time
                    || t > updated
                {
                    return Err(AppError::validation("Некорректный ID или время сообщения"));
                }
                previous = m.id;
                previous_time = t;
            }
            if c.messages[0].created_at != c.created_at {
                return Err(AppError::validation(
                    "Первое сообщение должно совпадать со временем ветки",
                ));
            }
            c.anchor.validate()?;
            match (c.anchor.element_id(), &c.anchor_snapshot) {
                (None, None) => {}
                (Some(id), Some(s)) => {
                    if id >= self.next_id
                        || id != s.element_id
                        || matches!(c.anchor, Anchor::Connector { .. })
                            != (s.kind == ElementKind::Connector)
                        || !valid_text(&s.title, 256)
                        || (s.kind != ElementKind::Rectangle && !s.title.is_empty())
                        || (s.kind == ElementKind::Connector
                            && (s.from.is_none()
                                || s.to.is_none()
                                || s.from == s.to
                                || [s.from, s.to]
                                    .iter()
                                    .flatten()
                                    .any(|id| *id == 0 || *id >= self.next_id)))
                        || (s.kind != ElementKind::Connector
                            && (s.from.is_some() || s.to.is_some()))
                        || !valid_text(&s.text, 10000)
                        || ![s.x, s.y, s.world_x, s.world_y]
                            .iter()
                            .all(|n| n.is_finite() && n.abs() <= 110000.0)
                        || ![s.width, s.height]
                            .iter()
                            .all(|n| n.is_finite() && (20.0..=10000.0).contains(n))
                    {
                        return Err(AppError::validation("Некорректный снимок привязки"));
                    }
                    if self.elements.iter().any(|e| e.id == id)
                        && snapshot(self, &c.anchor)?.as_ref() != Some(s)
                    {
                        return Err(AppError::validation(
                            "Снимок привязки не соответствует объекту",
                        ));
                    }
                }
                _ => return Err(AppError::validation("Отсутствует снимок привязки")),
            }
        }
        Ok(())
    }
    pub fn comments_context(&self, status: &str, thread: Option<u64>) -> Result<Value, AppError> {
        let filter = match status {
            "open" => Some(CommentStatus::Open),
            "awaiting_review" => Some(CommentStatus::AwaitingReview),
            "resolved" => Some(CommentStatus::Resolved),
            "all" => None,
            _ => return Err(AppError::validation("Неизвестный статус комментария")),
        };
        if thread.is_some_and(|id| !self.comments.iter().any(|c| c.id == id)) {
            return Err(AppError::missing());
        }
        let mut threads = Vec::new();
        for c in self
            .comments
            .iter()
            .filter(|c| filter.is_none_or(|s| s == c.status) && thread.is_none_or(|id| id == c.id))
        {
            let target = c
                .anchor
                .element_id()
                .and_then(|id| self.elements.iter().find(|e| e.id == id));
            let related: Vec<_> = target
                .map(|e| {
                    self.elements
                        .iter()
                        .filter(|link| {
                            link.kind == ElementKind::Connector
                                && (link.from == Some(e.id) || link.to == Some(e.id))
                        })
                        .collect()
                })
                .unwrap_or_default();
            let endpoints: Vec<_> = target
                .filter(|e| e.kind == ElementKind::Connector)
                .map(|e| {
                    self.elements
                        .iter()
                        .filter(|n| Some(n.id) == e.from || Some(n.id) == e.to)
                        .collect()
                })
                .unwrap_or_default();
            let area = if let Some(e) = target {
                if e.kind == ElementKind::Connector {
                    let points = connector_points(self, e.id)?;
                    (
                        points.iter().map(|p| p.0).fold(f64::INFINITY, f64::min),
                        points.iter().map(|p| p.1).fold(f64::INFINITY, f64::min),
                        points.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max),
                        points.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max),
                    )
                } else {
                    (e.x, e.y, e.x + e.width, e.y + e.height)
                }
            } else if let Anchor::Point { x, y } = c.anchor {
                (x, y, x, y)
            } else {
                let s = c.anchor_snapshot.as_ref().ok_or_else(AppError::missing)?;
                (s.world_x, s.world_y, s.world_x, s.world_y)
            };
            let frame = {
                self.elements
                    .iter()
                    .filter(|f| {
                        f.kind == ElementKind::Frame
                            && target.is_none_or(|e| f.id != e.id)
                            && area.0 >= f.x
                            && area.1 >= f.y
                            && area.2 <= f.x + f.width
                            && area.3 <= f.y + f.height
                    })
                    .min_by(|a, b| {
                        (a.width * a.height)
                            .total_cmp(&(b.width * b.height))
                            .then(a.id.cmp(&b.id))
                    })
            };
            let mut value =
                serde_json::to_value(c).map_err(|_| AppError::validation("Ошибка сериализации"))?;
            let obj = value
                .as_object_mut()
                .ok_or_else(|| AppError::validation("Ошибка сериализации"))?;
            obj.insert(
                "orphaned".into(),
                json!(c.anchor.element_id().is_some() && target.is_none()),
            );
            obj.insert(
                "target".into(),
                target.map(context_element).unwrap_or(Value::Null),
            );
            obj.insert(
                "connectors".into(),
                json!(related.into_iter().map(context_element).collect::<Vec<_>>()),
            );
            obj.insert(
                "endpoints".into(),
                json!(
                    endpoints
                        .into_iter()
                        .map(context_element)
                        .collect::<Vec<_>>()
                ),
            );
            obj.insert(
                "frame".into(),
                frame.map(context_element).unwrap_or(Value::Null),
            );
            threads.push(value);
        }
        Ok(json!({"boardId":self.id,"title":self.title,"revision":self.revision,"threads":threads}))
    }
}

fn context_element(element: &Element) -> Value {
    let mut element_without_image = element.clone();
    element_without_image.image = None;
    let mut value = json!(element_without_image);
    if let Some(uri) = element.image.as_deref() {
        value["imageEmbedded"] = json!(true);
        value["imageMime"] = json!(uri.strip_prefix("data:").and_then(|s| s.split(';').next()));
    }
    value
}

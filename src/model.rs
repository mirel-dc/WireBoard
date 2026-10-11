use crate::{
    comments::{Anchor, Author, CommentStatus, CommentThread},
    error::AppError,
    geometry::frame_members,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use image::ImageDecoder;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap},
    io::Cursor,
};

pub const MAX_BOARD_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_SAFE_ID: u64 = 9_007_199_254_740_991;
pub const MAX_IMAGE_PIXELS: u64 = 16_000_000;
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ElementKind {
    #[default]
    Rectangle,
    Text,
    Connector,
    Frame,
    Image,
}
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Port {
    #[default]
    Auto,
    Left,
    Right,
    Top,
    Bottom,
}
fn width() -> f64 {
    220.0
}
fn height() -> f64 {
    112.0
}
fn fill() -> String {
    "#ffffff".into()
}
fn stroke() -> String {
    "#ddd7e5".into()
}
fn font_size() -> f64 {
    16.0
}
fn font_weight() -> u16 {
    400
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Element {
    #[serde(default)]
    pub id: u64,
    pub kind: ElementKind,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "width")]
    pub width: f64,
    #[serde(default = "height")]
    pub height: f64,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub title: String,
    #[serde(default = "font_weight")]
    pub font_weight: u16,
    #[serde(default = "fill")]
    pub fill: String,
    #[serde(default = "stroke")]
    pub stroke: String,
    #[serde(default = "font_size")]
    pub font_size: f64,
    #[serde(default)]
    pub from: Option<u64>,
    #[serde(default)]
    pub to: Option<u64>,
    #[serde(default)]
    pub from_port: Port,
    #[serde(default)]
    pub to_port: Port,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub parent_frame_id: Option<u64>,
}
fn parent_patch<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<u64>>, D::Error> {
    Option::<u64>::deserialize(d).map(Some)
}
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ElementPatch {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub text: Option<String>,
    pub title: Option<String>,
    pub font_weight: Option<u16>,
    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub font_size: Option<f64>,
    pub from: Option<u64>,
    pub to: Option<u64>,
    pub from_port: Option<Port>,
    pub to_port: Option<Port>,
    #[serde(
        default,
        deserialize_with = "parent_patch",
        skip_serializing_if = "Option::is_none"
    )]
    pub parent_frame_id: Option<Option<u64>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase", deny_unknown_fields)]
pub enum Operation {
    Create {
        element: Element,
    },
    Update {
        id: u64,
        patch: ElementPatch,
    },
    Move {
        ids: Vec<u64>,
        dx: f64,
        dy: f64,
    },
    Resize {
        id: u64,
        width: f64,
        height: f64,
    },
    Delete {
        ids: Vec<u64>,
    },
    Duplicate {
        ids: Vec<u64>,
        dx: f64,
        dy: f64,
    },
    Rename {
        title: String,
    },
    #[serde(rename = "comment_create")]
    CommentCreate {
        anchor: Anchor,
        author: Author,
        text: String,
    },
    #[serde(rename = "comment_reply")]
    CommentReply {
        #[serde(rename = "threadId")]
        thread_id: u64,
        author: Author,
        text: String,
        #[serde(rename = "submitForReview")]
        submit_for_review: bool,
    },
    #[serde(rename = "comment_status")]
    CommentStatus {
        #[serde(rename = "threadId")]
        thread_id: u64,
        author: Author,
        status: CommentStatus,
    },
    #[serde(rename = "comment_reanchor")]
    CommentReanchor {
        #[serde(rename = "threadId")]
        thread_id: u64,
        author: Author,
        anchor: Anchor,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Board {
    pub version: u32,
    pub id: String,
    pub title: String,
    pub revision: u64,
    pub next_id: u64,
    pub elements: Vec<Element>,
    pub next_comment_id: u64,
    pub next_message_id: u64,
    pub comments: Vec<CommentThread>,
}
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
pub fn valid_text(text: &str, max: usize) -> bool {
    text.chars().count() <= max
        && text
            .chars()
            .all(|c| c == '\n' || c == '\t' || (c >= ' ' && c != '\u{fffe}' && c != '\u{ffff}'))
}
fn valid_color(color: &str) -> bool {
    color == "none"
        || (color.len() == 7
            && color.starts_with('#')
            && color[1..].bytes().all(|c| c.is_ascii_hexdigit()))
}
pub fn raster_bytes(data: &str) -> Result<Vec<u8>, AppError> {
    let (mime, encoded) = data
        .split_once(";base64,")
        .ok_or_else(|| AppError::validation("Изображение должно быть растровым data URI"))?;
    if encoded.len() > 12 * 1024 * 1024 {
        return Err(AppError::limit("Изображение больше 8 MiB"));
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| AppError::validation("Некорректный base64 изображения"))?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(AppError::limit("Изображение больше 8 MiB"));
    }
    let format = image::guess_format(&bytes)
        .map_err(|_| AppError::validation("Не удалось распознать изображение"))?;
    let expected = match format {
        image::ImageFormat::Png => "data:image/png",
        image::ImageFormat::Jpeg => "data:image/jpeg",
        image::ImageFormat::WebP => "data:image/webp",
        _ => return Err(AppError::validation("Поддерживаются PNG, JPEG и WebP")),
    };
    if mime != expected {
        return Err(AppError::validation("MIME не соответствует изображению"));
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(&bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let decoder = reader
        .into_decoder()
        .map_err(|_| AppError::validation("Повреждённое или слишком большое изображение"))?;
    let (w, h) = decoder.dimensions();
    if u64::from(w) * u64::from(h) > MAX_IMAGE_PIXELS {
        return Err(AppError::limit("Изображение больше 16 миллионов пикселей"));
    }
    image::DynamicImage::from_decoder(decoder)
        .map_err(|_| AppError::validation("Повреждённые данные изображения"))?;
    Ok(bytes)
}
impl Board {
    /// Validate the legacy shape before adding v2 fields. Reading never rewrites a file.
    pub fn from_json(bytes: &[u8]) -> Result<Self, AppError> {
        if bytes.len() > MAX_BOARD_BYTES {
            return Err(AppError::limit("JSON доски больше 32 MiB"));
        }
        let mut value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| {
            AppError::validation("Повреждённый JSON доски. Исходные данные сохранены")
        })?;
        if value.get("version").and_then(|v| v.as_u64()) == Some(1) {
            let obj = value
                .as_object_mut()
                .ok_or_else(|| AppError::validation("Некорректная доска"))?;
            if obj.keys().any(|k| {
                !["version", "id", "title", "revision", "nextId", "elements"].contains(&k.as_str())
            }) {
                return Err(AppError::validation("Неизвестное поле доски v1"));
            }
            let elements = obj
                .get_mut("elements")
                .and_then(|v| v.as_array_mut())
                .ok_or_else(|| AppError::validation("Нет объектов доски"))?;
            for e in elements {
                let e = e
                    .as_object_mut()
                    .ok_or_else(|| AppError::validation("Некорректный объект"))?;
                if e.keys().any(|k| {
                    ![
                        "id", "kind", "x", "y", "width", "height", "text", "fill", "stroke",
                        "fontSize", "from", "to", "fromPort", "toPort", "image",
                    ]
                    .contains(&k.as_str())
                }) {
                    return Err(AppError::validation("Неизвестное поле объекта v1"));
                }
                // The previous defaults belong to v1, not to newly created cards.
                for (key, val) in [
                    ("width", serde_json::json!(220)),
                    ("height", serde_json::json!(100)),
                    ("fontSize", serde_json::json!(20)),
                    ("stroke", serde_json::json!("#446b57")),
                ] {
                    e.entry(key).or_insert(val);
                }
                e.insert("title".into(), serde_json::json!(""));
                e.insert("fontWeight".into(), serde_json::json!(400));
            }
            obj.insert("version".into(), serde_json::json!(2));
            obj.insert("nextCommentId".into(), serde_json::json!(1));
            obj.insert("nextMessageId".into(), serde_json::json!(1));
            obj.insert("comments".into(), serde_json::json!([]));
        }
        let migrating = value.get("version").and_then(|v| v.as_u64()) == Some(2);
        if migrating {
            value["version"] = serde_json::json!(3);
        }
        let mut board: Self = serde_json::from_value(value)
            .map_err(|_| AppError::validation("Некорректная доска или неизвестное поле"))?;
        if migrating {
            crate::geometry::migrate_membership(&mut board);
        }
        board.validate()?;
        Ok(board)
    }
    pub fn new(id: String, title: String) -> Self {
        Self {
            version: 3,
            id,
            title,
            revision: 0,
            next_id: 1,
            elements: Vec::new(),
            next_comment_id: 1,
            next_message_id: 1,
            comments: Vec::new(),
        }
    }
    pub fn element(&self, id: u64) -> Result<&Element, AppError> {
        self.elements
            .iter()
            .find(|e| e.id == id)
            .ok_or_else(AppError::missing)
    }
    pub fn validate(&self) -> Result<(), AppError> {
        if self.version != 3 || !valid_id(&self.id) {
            return Err(AppError::validation("Неподдерживаемая версия или ID доски"));
        }
        if self.title.trim().is_empty() || !valid_text(&self.title, 256) {
            return Err(AppError::validation(
                "Название должно содержать от 1 до 256 символов",
            ));
        }
        if self.elements.len() > 2000 {
            return Err(AppError::limit("На доске больше 2000 объектов"));
        }
        if self.next_id == 0 || self.next_id > MAX_SAFE_ID || self.revision > MAX_SAFE_ID {
            return Err(AppError::validation("Недопустимый счётчик ID или revision"));
        }
        let mut ids = BTreeSet::new();
        for e in &self.elements {
            if e.id == 0 || e.id >= self.next_id || !ids.insert(e.id) {
                return Err(AppError::validation(
                    "Повторяющийся ID или несогласованный nextId",
                ));
            }
            if !e.x.is_finite() || !e.y.is_finite() || e.x.abs() > 100000.0 || e.y.abs() > 100000.0
            {
                return Err(AppError::validation("Координаты вне диапазона ±100000"));
            }
            if ![e.width, e.height]
                .iter()
                .all(|n| n.is_finite() && (20.0..=10000.0).contains(n))
            {
                return Err(AppError::validation("Размер должен быть от 20 до 10000"));
            }
            if !e.font_size.is_finite()
                || !(10.0..=96.0).contains(&e.font_size)
                || !valid_text(&e.text, 10000)
                || !valid_text(&e.title, 256)
                || (e.kind != ElementKind::Rectangle && !e.title.is_empty())
                || !matches!(e.font_weight, 400 | 600)
                || !valid_color(&e.fill)
                || !valid_color(&e.stroke)
            {
                return Err(AppError::validation(
                    "Некорректный текст, цвет или размер шрифта",
                ));
            }
            let mut visited = BTreeSet::from([e.id]);
            let mut parent = e.parent_frame_id;
            if e.kind == ElementKind::Connector && parent.is_some() {
                return Err(AppError::validation("Связь не может принадлежать фрейму"));
            }
            while let Some(id) = parent {
                if !visited.insert(id) {
                    return Err(AppError::validation("Принадлежность фреймов образует цикл"));
                }
                let p = self.element(id)?;
                if p.kind != ElementKind::Frame {
                    return Err(AppError::validation("Родитель объекта должен быть фреймом"));
                }
                parent = p.parent_frame_id;
            }
            if e.kind == ElementKind::Image {
                raster_bytes(
                    e.image
                        .as_deref()
                        .ok_or_else(|| AppError::validation("Нет изображения"))?,
                )?;
            } else if e.image.is_some() {
                return Err(AppError::validation(
                    "Изображение допустимо только у объекта image",
                ));
            }
            if e.kind != ElementKind::Connector && (e.from.is_some() || e.to.is_some()) {
                return Err(AppError::validation(
                    "Концы связи допустимы только у connector",
                ));
            }
        }
        for e in self
            .elements
            .iter()
            .filter(|e| e.kind == ElementKind::Connector)
        {
            let a = self.element(
                e.from
                    .ok_or_else(|| AppError::validation("Нет начала связи"))?,
            )?;
            let b = self.element(e.to.ok_or_else(|| AppError::validation("Нет конца связи"))?)?;
            if a.id == b.id
                || [a, b]
                    .iter()
                    .any(|e| matches!(e.kind, ElementKind::Connector | ElementKind::Frame))
            {
                return Err(AppError::validation(
                    "Связь должна соединять два разных блока",
                ));
            }
        }
        self.validate_comments()?;
        if serde_json::to_vec(self)
            .map_err(|_| AppError::validation("Некорректные данные"))?
            .len()
            > MAX_BOARD_BYTES
        {
            return Err(AppError::limit("JSON доски больше 32 MiB"));
        }
        Ok(())
    }
    pub fn apply_json(
        &self,
        revision: u64,
        operations: serde_json::Value,
    ) -> Result<serde_json::Value, AppError> {
        let operations: Vec<Operation> = serde_json::from_value(operations)
            .map_err(|_| AppError::validation("Некорректная операция или неизвестное поле"))?;
        serde_json::to_value(self.apply(revision, &operations)?)
            .map_err(|_| AppError::validation("Ошибка сериализации"))
    }
    pub fn apply(
        &self,
        expected_revision: u64,
        operations: &[Operation],
    ) -> Result<Self, AppError> {
        self.apply_with_context(expected_revision, operations, "2000-01-01T00:00:00Z")
    }
    pub fn apply_with_context(
        &self,
        expected_revision: u64,
        operations: &[Operation],
        now: &str,
    ) -> Result<Self, AppError> {
        crate::comments::timestamp(now)?;
        if self.revision != expected_revision {
            return Err(AppError::conflict());
        }
        if operations.is_empty() || operations.len() > 100 {
            return Err(AppError::limit(
                "Пакет должен содержать от 1 до 100 операций",
            ));
        }
        let mut next = self.clone();
        next.revision = self
            .revision
            .checked_add(1)
            .filter(|v| *v <= MAX_SAFE_ID)
            .ok_or_else(|| AppError::limit("Revision исчерпана"))?;
        for op in operations {
            next.refresh_comment_snapshots()?;
            match op {
                Operation::Create { element } => {
                    let mut e = element.clone();
                    if e.id != 0 && e.id != next.next_id {
                        return Err(AppError::validation(
                            "ID нового объекта должен быть 0 или nextId",
                        ));
                    }
                    e.id = next.allocate_id()?;
                    if e.parent_frame_id.is_none() && e.kind != ElementKind::Connector {
                        e.parent_frame_id = crate::geometry::containing_frame(&next, &e);
                    }
                    next.elements.push(e);
                }
                Operation::Update { id, patch } => {
                    let e = next
                        .elements
                        .iter_mut()
                        .find(|e| e.id == *id)
                        .ok_or_else(AppError::missing)?;
                    macro_rules! patch { ($($field:ident),*) => { $(if let Some(v) = &patch.$field { e.$field = v.clone(); })* }; }
                    patch!(
                        x,
                        y,
                        width,
                        height,
                        text,
                        title,
                        font_weight,
                        fill,
                        stroke,
                        font_size,
                        from_port,
                        to_port
                    );
                    if let Some(v) = patch.from {
                        e.from = Some(v);
                    }
                    if let Some(v) = patch.to {
                        e.to = Some(v);
                    }
                    if let Some(v) = patch.parent_frame_id {
                        e.parent_frame_id = v;
                    }
                }
                Operation::Move { ids, dx, dy } => {
                    if !dx.is_finite() || !dy.is_finite() {
                        return Err(AppError::validation("Некорректное смещение"));
                    }
                    let moving = next.moving_ids(ids)?;
                    for e in &mut next.elements {
                        if moving.contains(&e.id) && e.kind != ElementKind::Connector {
                            e.x += dx;
                            e.y += dy;
                        }
                    }
                }
                Operation::Resize { id, width, height } => {
                    let e = next
                        .elements
                        .iter_mut()
                        .find(|e| e.id == *id)
                        .ok_or_else(AppError::missing)?;
                    e.width = *width;
                    e.height = *height;
                }
                Operation::Delete { ids } => {
                    next.check_ids(ids)?;
                    let ids: BTreeSet<_> = ids.iter().copied().collect();
                    next.elements.retain(|e| {
                        !ids.contains(&e.id)
                            && !e.from.is_some_and(|v| ids.contains(&v))
                            && !e.to.is_some_and(|v| ids.contains(&v))
                    });
                    for e in &mut next.elements {
                        if e.parent_frame_id.is_some_and(|p| ids.contains(&p)) {
                            e.parent_frame_id = None;
                        }
                    }
                }
                Operation::Duplicate { ids, dx, dy } => {
                    if !dx.is_finite() || !dy.is_finite() {
                        return Err(AppError::validation("Некорректное смещение"));
                    }
                    let mut ids = next.moving_ids(ids)?;
                    let links: Vec<_> = next
                        .elements
                        .iter()
                        .filter(|e| {
                            e.kind == ElementKind::Connector
                                && e.from.is_some_and(|id| ids.contains(&id))
                                && e.to.is_some_and(|id| ids.contains(&id))
                        })
                        .map(|e| e.id)
                        .collect();
                    ids.extend(links);
                    let originals: Vec<_> = next
                        .elements
                        .iter()
                        .filter(|e| ids.contains(&e.id))
                        .cloned()
                        .collect();
                    let mut mapping = HashMap::new();
                    for e in &originals {
                        mapping.insert(e.id, next.allocate_id()?);
                    }
                    for mut e in originals {
                        e.id = mapping[&e.id];
                        e.x += dx;
                        e.y += dy;
                        if let Some(v) = e.from {
                            e.from = Some(*mapping.get(&v).unwrap_or(&v));
                        }
                        if let Some(v) = e.to {
                            e.to = Some(*mapping.get(&v).unwrap_or(&v));
                        }
                        if let Some(v) = e.parent_frame_id {
                            e.parent_frame_id = Some(*mapping.get(&v).unwrap_or(&v));
                        }
                        next.elements.push(e);
                    }
                }
                Operation::Rename { title } => next.title = title.trim().into(),
                Operation::CommentCreate {
                    anchor,
                    author,
                    text,
                } => next.create_comment(anchor, *author, text, now)?,
                Operation::CommentReply {
                    thread_id,
                    author,
                    text,
                    submit_for_review,
                } => next.reply_comment(*thread_id, *author, text, *submit_for_review, now)?,
                Operation::CommentStatus {
                    thread_id,
                    author,
                    status,
                } => next.set_comment_status(*thread_id, *author, *status, now)?,
                Operation::CommentReanchor {
                    thread_id,
                    author,
                    anchor,
                } => next.reanchor_comment(*thread_id, *author, anchor, now)?,
            }
            if next.elements.len() > 2000 {
                return Err(AppError::limit("На доске больше 2000 объектов"));
            }
        }
        next.refresh_comment_snapshots()?;
        next.validate()?;
        Ok(next)
    }
    fn allocate_id(&mut self) -> Result<u64, AppError> {
        if self.next_id >= MAX_SAFE_ID {
            return Err(AppError::limit("ID исчерпаны"));
        }
        let id = self.next_id;
        self.next_id += 1;
        Ok(id)
    }
    fn check_ids(&self, ids: &[u64]) -> Result<(), AppError> {
        if ids.is_empty() || ids.len() > 2000 {
            return Err(AppError::validation("Нужно выбрать объекты"));
        }
        for id in ids {
            self.element(*id)?;
        }
        Ok(())
    }
    fn moving_ids(&self, ids: &[u64]) -> Result<BTreeSet<u64>, AppError> {
        self.check_ids(ids)?;
        let mut set: BTreeSet<_> = ids.iter().copied().collect();
        for id in ids {
            if self.element(*id)?.kind == ElementKind::Frame {
                set.extend(frame_members(self, *id));
            }
        }
        Ok(set)
    }
}

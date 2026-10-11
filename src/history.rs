use crate::{
    error::AppError,
    model::{Board, MAX_SAFE_ID, Operation},
    store::HistoryDirection,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    User,
    Codex,
    Claude,
    Legacy,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Actor {
    pub id: String,
    pub source: Source,
}
impl Actor {
    pub fn key(&self) -> String {
        format!("{:?}:{}", self.source, self.id)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandMeta {
    pub id: String,
    pub actor: Actor,
    pub label: String,
}
impl CommandMeta {
    pub fn validate(&self) -> Result<(), AppError> {
        if uuid::Uuid::parse_str(&self.id).is_err()
            || self.actor.id.trim().is_empty()
            || self.actor.id.len() > 128
            || self.label.trim().is_empty()
            || self.label.chars().count() > 256
        {
            return Err(AppError::validation(
                "Некорректный ID, участник или название команды",
            ));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "type", content = "id", rename_all = "lowercase")]
pub enum EntityKey {
    Board,
    Element(u64),
    Comment(u64),
}
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldKey {
    pub entity: EntityKey,
    pub field: String,
}
pub type FieldStamp = String;
pub type FieldStamps = BTreeMap<FieldKey, FieldStamp>;
pub mod optional_value {
    use super::*;
    pub fn serialize<S: serde::Serializer>(value: &Option<Value>, s: S) -> Result<S::Ok, S::Error> {
        match value {
            Some(v) => json!({"present":true,"value":v}),
            None => json!({"present":false}),
        }
        .serialize(s)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> {
        let v = Value::deserialize(d)?;
        let obj = v
            .as_object()
            .ok_or_else(|| serde::de::Error::custom("Expected presence wrapper"))?;
        match obj.get("present").and_then(Value::as_bool) {
            Some(false) if obj.len() == 1 => Ok(None),
            Some(true) if obj.len() == 2 && obj.contains_key("value") => {
                Ok(Some(obj["value"].clone()))
            }
            _ => Err(serde::de::Error::custom("Invalid presence wrapper")),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldStampEntry {
    pub key: FieldKey,
    pub stamp: FieldStamp,
}
pub mod stamps_serde {
    use super::*;
    pub fn serialize<S: serde::Serializer>(value: &FieldStamps, s: S) -> Result<S::Ok, S::Error> {
        value
            .iter()
            .map(|(key, stamp)| FieldStampEntry {
                key: key.clone(),
                stamp: stamp.clone(),
            })
            .collect::<Vec<_>>()
            .serialize(s)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(d: D) -> Result<FieldStamps, D::Error> {
        let entries = Vec::<FieldStampEntry>::deserialize(d)?;
        let mut map = FieldStamps::new();
        for e in entries {
            if map.insert(e.key, e.stamp).is_some() {
                return Err(serde::de::Error::custom("Duplicate stamp"));
            }
        }
        Ok(map)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldGuard {
    pub key: FieldKey,
    #[serde(with = "optional_value")]
    pub value: Option<Value>,
    pub stamp: FieldStamp,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandRequest {
    pub revision: u64,
    pub operations: Vec<Operation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<CommandMeta>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guards: Option<Vec<FieldGuard>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryCommand {
    pub revision: u64,
    pub direction: HistoryDirection,
    pub target_command_id: String,
    pub command: CommandMeta,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandReceipt {
    pub id: String,
    pub fingerprint: String,
    pub committed_revision: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDelta {
    pub key: FieldKey,
    #[serde(with = "optional_value")]
    pub before: Option<Value>,
    #[serde(with = "optional_value")]
    pub after: Option<Value>,
    pub before_stamp: FieldStamp,
    pub after_stamp: FieldStamp,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalEntry {
    pub command: CommandMeta,
    pub deltas: Vec<FieldDelta>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandConflict {
    pub command_id: String,
    pub elements: Vec<u64>,
    pub fields: Vec<FieldKey>,
    pub reason: String,
}
impl CommandConflict {
    pub fn error(self) -> AppError {
        let mut error = AppError::new(crate::error::ErrorCode::Conflict, self.reason.clone());
        error.details = Some(serde_json::to_value(self).expect("Conflict is serializable"));
        error
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryAction {
    pub command_id: String,
    pub label: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HistorySummary {
    pub undo: Option<HistoryAction>,
    pub redo: Option<HistoryAction>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ActorHistory {
    pub undo: Vec<String>,
    pub redo: Vec<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HistoryState {
    pub entries: Vec<JournalEntry>,
    pub actors: BTreeMap<String, ActorHistory>,
}
impl HistoryState {
    pub fn validate(&self) -> Result<(), AppError> {
        let invalid =
            || AppError::validation("Повреждённый журнал истории. Исходные данные сохранены");
        if serde_json::to_vec(&self.entries)
            .map_err(|_| invalid())?
            .len()
            > 128 * 1024 * 1024
        {
            return Err(invalid());
        }
        let mut ids = BTreeMap::new();
        for entry in &self.entries {
            entry.command.validate()?;
            if entry.command.actor.source != Source::User
                || entry.deltas.is_empty()
                || ids
                    .insert(&entry.command.id, &entry.command.actor)
                    .is_some()
            {
                return Err(invalid());
            }
            let keys: BTreeSet<_> = entry.deltas.iter().map(|d| &d.key).collect();
            if keys.len() != entry.deltas.len()
                || entry.deltas.iter().any(|d| {
                    [&d.before_stamp, &d.after_stamp]
                        .iter()
                        .any(|s| s.as_str() != "baseline" && uuid::Uuid::parse_str(s).is_err())
                })
            {
                return Err(invalid());
            }
        }
        let mut referenced = BTreeSet::new();
        for (actor, h) in &self.actors {
            if h.undo.len() + h.redo.len() > 100 || h.undo.is_empty() && h.redo.is_empty() {
                return Err(invalid());
            }
            for id in h.undo.iter().chain(&h.redo) {
                if ids.get(id).is_none_or(|a| a.key() != *actor) || !referenced.insert(id) {
                    return Err(invalid());
                }
            }
        }
        if referenced.len() != ids.len() {
            return Err(invalid());
        }
        Ok(())
    }
    pub fn summary(&self, actor: &Actor) -> HistorySummary {
        let action = |id: Option<&String>| {
            id.and_then(|id| self.entries.iter().find(|e| &e.command.id == id))
                .map(|e| HistoryAction {
                    command_id: e.command.id.clone(),
                    label: e.command.label.clone(),
                })
        };
        self.actors
            .get(&actor.key())
            .map(|h| HistorySummary {
                undo: action(h.undo.last()),
                redo: action(h.redo.last()),
            })
            .unwrap_or_default()
    }
    pub fn push(&mut self, entry: JournalEntry) {
        if entry.command.actor.source != Source::User || entry.deltas.is_empty() {
            return;
        }
        let h = self.actors.entry(entry.command.actor.key()).or_default();
        h.undo.push(entry.command.id.clone());
        h.redo.clear();
        self.entries.push(entry);
        self.prune();
    }
    pub fn prune(&mut self) {
        for h in self.actors.values_mut() {
            while h.undo.len() + h.redo.len() > 100 {
                if !h.undo.is_empty() {
                    h.undo.remove(0);
                } else {
                    h.redo.remove(0);
                }
            }
        }
        let live: BTreeSet<_> = self
            .actors
            .values()
            .flat_map(|h| h.undo.iter().chain(h.redo.iter()))
            .cloned()
            .collect();
        self.entries.retain(|e| live.contains(&e.command.id));
        while serde_json::to_vec(&self.entries).map_or(usize::MAX, |v| v.len()) > 128 * 1024 * 1024
            && !self.entries.is_empty()
        {
            let id = self.entries.remove(0).command.id;
            for h in self.actors.values_mut() {
                h.undo.retain(|v| v != &id);
                h.redo.retain(|v| v != &id);
            }
        }
        self.actors
            .retain(|_, h| !h.undo.is_empty() || !h.redo.is_empty());
    }
}
pub fn stamp(stamps: &FieldStamps, key: &FieldKey) -> String {
    stamps
        .get(key)
        .cloned()
        .unwrap_or_else(|| "baseline".into())
}
pub fn guard_value_eq(a: &Option<Value>, b: &Option<Value>) -> bool {
    fn equal(a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Number(a), Value::Number(b)) => a == b || a.as_f64() == b.as_f64(),
            (Value::Array(a), Value::Array(b)) => {
                a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equal(a, b))
            }
            (Value::Object(a), Value::Object(b)) => {
                a.len() == b.len()
                    && a.iter()
                        .all(|(k, v)| b.get(k).is_some_and(|other| equal(v, other)))
            }
            _ => a == b,
        }
    }
    match (a, b) {
        (Some(a), Some(b)) => equal(a, b),
        (None, None) => true,
        _ => false,
    }
}
fn key(entity: &EntityKey, field: &str) -> FieldKey {
    FieldKey {
        entity: entity.clone(),
        field: field.into(),
    }
}
fn object(board: &Board, entity: &EntityKey) -> Option<Value> {
    match entity {
        EntityKey::Board => Some(json!({"title":board.title})),
        EntityKey::Element(id) => board
            .elements
            .iter()
            .find(|e| e.id == *id)
            .map(|e| serde_json::to_value(e).expect("Element is serializable")),
        EntityKey::Comment(id) => board.comments.iter().find(|e| e.id == *id).map(|e| {
            let mut v = serde_json::to_value(e).expect("Comment is serializable");
            v["anchorSnapshot"] = Value::Null;
            v
        }),
    }
}
pub fn read_field(board: &Board, key: &FieldKey) -> Option<Value> {
    if key.entity == EntityKey::Board {
        if key.field == "nextId" {
            return Some(json!(board.next_id));
        }
        if key.field == "nextCommentId" {
            return Some(json!(board.next_comment_id));
        }
        if key.field == "nextMessageId" {
            return Some(json!(board.next_message_id));
        }
        if key.field == "__frames__" {
            let mut ids = board
                .elements
                .iter()
                .filter(|e| e.kind == crate::model::ElementKind::Frame)
                .map(|e| e.id)
                .collect::<Vec<_>>();
            ids.sort();
            return Some(json!(ids));
        }
    }
    if key.field == "__children__"
        && let EntityKey::Element(id) = key.entity
    {
        let mut ids = board
            .elements
            .iter()
            .filter(|e| e.parent_frame_id == Some(id))
            .map(|e| e.id)
            .collect::<Vec<_>>();
        ids.sort();
        return Some(json!(ids));
    }
    if key.field == "__dependents__"
        && let EntityKey::Element(id) = key.entity
    {
        let mut ids = board
            .elements
            .iter()
            .filter(|e| e.parent_frame_id == Some(id) || e.from == Some(id) || e.to == Some(id))
            .map(|e| format!("element:{}", e.id))
            .collect::<Vec<_>>();
        ids.extend(
            board
                .comments
                .iter()
                .filter(|c| c.anchor.element_id() == Some(id))
                .map(|c| format!("comment:{}", c.id)),
        );
        ids.sort();
        return Some(json!(ids));
    }
    let obj = object(board, &key.entity)?;
    if key.field == "__entity__" {
        Some(obj)
    } else {
        obj.get(&key.field).cloned()
    }
}
pub fn required_guards(
    board: &Board,
    operations: &[Operation],
) -> Result<BTreeSet<FieldKey>, AppError> {
    let mut fields = BTreeSet::new();
    for op in operations {
        match op {
            Operation::Create { .. } => {
                fields.insert(key(&EntityKey::Board, "nextId"));
            }
            Operation::Rename { .. } => {
                fields.insert(key(&EntityKey::Board, "title"));
            }
            Operation::Update { id, patch } => {
                if board.element(*id).is_ok() {
                    let entity = EntityKey::Element(*id);
                    macro_rules! required {($($rust:ident=>$json:literal),*)=>{$(if patch.$rust.is_some(){fields.insert(key(&entity,$json));})*};}
                    required!(x=>"x",y=>"y",width=>"width",height=>"height",text=>"text",title=>"title",font_weight=>"fontWeight",fill=>"fill",stroke=>"stroke",font_size=>"fontSize",from=>"from",to=>"to",from_port=>"fromPort",to_port=>"toPort",parent_frame_id=>"parentFrameId");
                    if patch.parent_frame_id.is_some() {
                        frame_guards(board, &mut fields);
                    }
                }
            }
            Operation::Resize { id, .. } => {
                if board.element(*id).is_ok() {
                    for field in ["x", "y", "width", "height", "parentFrameId"] {
                        fields.insert(key(&EntityKey::Element(*id), field));
                    }
                }
            }
            Operation::Move { ids, .. } => {
                let mut moving: BTreeSet<_> = ids.iter().copied().collect();
                for id in ids {
                    moving.extend(crate::geometry::frame_members(board, *id));
                }
                for id in moving {
                    if let Ok(e) = board.element(id) {
                        for field in ["x", "y", "width", "height", "parentFrameId"] {
                            fields.insert(key(&EntityKey::Element(id), field));
                        }
                        if e.kind == crate::model::ElementKind::Frame {
                            fields.insert(key(&EntityKey::Element(id), "__children__"));
                        }
                    }
                }
            }
            Operation::Delete { ids } | Operation::Duplicate { ids, .. } => {
                let mut affected: BTreeSet<_> = ids.iter().copied().collect();
                if matches!(op, Operation::Duplicate { .. }) {
                    fields.insert(key(&EntityKey::Board, "nextId"));
                    for id in ids {
                        affected.extend(crate::geometry::frame_members(board, *id));
                    }
                }
                for id in affected {
                    if let Some(obj) = object(board, &EntityKey::Element(id)) {
                        for field in obj.as_object().expect("Element object").keys() {
                            fields.insert(key(&EntityKey::Element(id), field));
                        }
                        fields.insert(key(&EntityKey::Element(id), "__dependents__"));
                    }
                }
            }
            Operation::CommentCreate { anchor, .. } => {
                fields.insert(key(&EntityKey::Board, "nextCommentId"));
                fields.insert(key(&EntityKey::Board, "nextMessageId"));
                if let Some(id) = anchor.element_id() {
                    fields.insert(key(&EntityKey::Element(id), "__entity__"));
                }
            }
            Operation::CommentReply { thread_id, .. }
            | Operation::CommentStatus { thread_id, .. }
            | Operation::CommentReanchor { thread_id, .. } => {
                if let Some(obj) = object(board, &EntityKey::Comment(*thread_id)) {
                    for field in obj
                        .as_object()
                        .expect("Comment object")
                        .keys()
                        .filter(|s| s.as_str() != "anchorSnapshot")
                    {
                        fields.insert(key(&EntityKey::Comment(*thread_id), field));
                    }
                }
                if matches!(op, Operation::CommentReply { .. }) {
                    fields.insert(key(&EntityKey::Board, "nextMessageId"));
                }
            }
        }
    }
    Ok(fields)
}
fn frame_guards(board: &Board, fields: &mut BTreeSet<FieldKey>) {
    fields.insert(key(&EntityKey::Board, "__frames__"));
    for e in board
        .elements
        .iter()
        .filter(|e| e.kind == crate::model::ElementKind::Frame)
    {
        for field in ["x", "y", "width", "height", "parentFrameId"] {
            fields.insert(key(&EntityKey::Element(e.id), field));
        }
    }
}
pub fn record(
    before: &Board,
    after: &Board,
    meta: &CommandMeta,
    stamps: &FieldStamps,
) -> JournalEntry {
    let mut entities = BTreeSet::from([EntityKey::Board]);
    for board in [before, after] {
        entities.extend(board.elements.iter().map(|e| EntityKey::Element(e.id)));
        entities.extend(board.comments.iter().map(|e| EntityKey::Comment(e.id)));
    }
    let mut deltas = Vec::new();
    for entity in entities {
        let a = object(before, &entity);
        let b = object(after, &entity);
        let mut fields = BTreeSet::new();
        for obj in [&a, &b].into_iter().flatten() {
            fields.extend(
                obj.as_object()
                    .expect("Object")
                    .keys()
                    .filter(|s| s.as_str() != "id" && s.as_str() != "anchorSnapshot")
                    .cloned(),
            );
        }
        let whole = a.is_none() != b.is_none();
        if whole {
            fields.insert("__entity__".into());
            if matches!(entity, EntityKey::Element(_)) {
                fields.insert("__dependents__".into());
            }
        }
        for field in fields {
            let k = key(&entity, &field);
            let a = read_field(before, &k);
            let b = read_field(after, &k);
            if a != b || (whole && field == "__dependents__") {
                deltas.push(FieldDelta {
                    before: a,
                    after: b,
                    before_stamp: stamp(stamps, &k),
                    after_stamp: meta.id.clone(),
                    key: k,
                });
            }
        }
    }
    JournalEntry {
        command: meta.clone(),
        deltas,
    }
}
pub fn commit_stamps(stamps: &mut FieldStamps, entry: &JournalEntry) {
    for d in &entry.deltas {
        if d.key.field != "__dependents__" {
            stamps.insert(d.key.clone(), d.after_stamp.clone());
        }
    }
}
pub fn inverse(
    board: &Board,
    entry: &JournalEntry,
    stamps: &FieldStamps,
    direction: HistoryDirection,
) -> Result<(Board, FieldStamps), CommandConflict> {
    let undo = matches!(direction, HistoryDirection::Undo);
    let bad: Vec<_> = entry
        .deltas
        .iter()
        .filter(|d| {
            let expected = if undo { &d.after } else { &d.before };
            let expected_stamp = if undo {
                &d.after_stamp
            } else {
                &d.before_stamp
            };
            read_field(board, &d.key) != *expected
                || (d.key.field != "__dependents__" && stamp(stamps, &d.key) != *expected_stamp)
        })
        .map(|d| d.key.clone())
        .collect();
    let conflict = |fields: Vec<FieldKey>, reason: String| CommandConflict {
        command_id: entry.command.id.clone(),
        elements: fields
            .iter()
            .filter_map(|k| {
                if let EntityKey::Element(id) = k.entity {
                    Some(id)
                } else {
                    None
                }
            })
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect(),
        fields,
        reason,
    };
    if !bad.is_empty() {
        return Err(conflict(
            bad,
            format!(
                "Не удалось отменить «{}»: свойства или связанные объекты изменились после действия",
                entry.command.label
            ),
        ));
    }
    let mut next = board.clone();
    let mut next_stamps = stamps.clone();
    let whole: BTreeSet<_> = entry
        .deltas
        .iter()
        .filter(|d| d.key.field == "__entity__")
        .map(|d| d.key.entity.clone())
        .collect();
    for d in &entry.deltas {
        let value = if undo { &d.before } else { &d.after };
        let restore_stamp = if undo {
            &d.before_stamp
        } else {
            &d.after_stamp
        };
        if d.key.field == "__dependents__" {
            continue;
        }
        next_stamps.insert(d.key.clone(), restore_stamp.clone());
        if whole.contains(&d.key.entity) && d.key.field != "__entity__" {
            continue;
        }
        let result = apply_field(&mut next, &d.key, value);
        if let Err(error) = result {
            return Err(conflict(vec![d.key.clone()], error.message));
        }
    }
    next.revision = board
        .revision
        .checked_add(1)
        .filter(|v| *v <= MAX_SAFE_ID)
        .ok_or_else(|| conflict(vec![], "Revision исчерпана".into()))?;
    next.refresh_comment_snapshots()
        .and_then(|_| next.validate())
        .map_err(|e| conflict(vec![], e.message))?;
    Ok((next, next_stamps))
}
fn apply_field(board: &mut Board, key: &FieldKey, value: &Option<Value>) -> Result<(), AppError> {
    let invalid = || AppError::validation("Не удалось восстановить свойства объекта");
    match key.entity {
        EntityKey::Board => {
            if key.field != "title" {
                return Err(invalid());
            }
            board.title = value
                .as_ref()
                .and_then(Value::as_str)
                .ok_or_else(invalid)?
                .into();
        }
        EntityKey::Element(id) => {
            if key.field == "__entity__" {
                board.elements.retain(|e| e.id != id);
                if let Some(v) = value {
                    board
                        .elements
                        .push(serde_json::from_value(v.clone()).map_err(|_| invalid())?);
                }
            } else {
                let e = board
                    .elements
                    .iter_mut()
                    .find(|e| e.id == id)
                    .ok_or_else(invalid)?;
                let mut v = serde_json::to_value(&*e).map_err(|_| invalid())?;
                v[&key.field] = value.clone().ok_or_else(invalid)?;
                *e = serde_json::from_value(v).map_err(|_| invalid())?;
            }
        }
        EntityKey::Comment(id) => {
            if key.field == "__entity__" {
                board.comments.retain(|e| e.id != id);
                if let Some(v) = value {
                    board
                        .comments
                        .push(serde_json::from_value(v.clone()).map_err(|_| invalid())?);
                }
            } else {
                let e = board
                    .comments
                    .iter_mut()
                    .find(|e| e.id == id)
                    .ok_or_else(invalid)?;
                let mut v = serde_json::to_value(&*e).map_err(|_| invalid())?;
                v[&key.field] = value.clone().ok_or_else(invalid)?;
                *e = serde_json::from_value(v).map_err(|_| invalid())?;
            }
        }
    }
    board.elements.sort_by_key(|e| e.id);
    board.comments.sort_by_key(|e| e.id);
    Ok(())
}

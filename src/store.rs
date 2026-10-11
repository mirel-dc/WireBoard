use crate::{
    document::{MAX_DOCUMENT_BYTES, StoredDocument},
    error::AppError,
    history::{
        self, Actor, CommandMeta, CommandReceipt, CommandRequest, FieldStamps, HistoryCommand,
        HistorySummary, Source,
    },
    links::{LinkIndex, MAX_LINK_BYTES},
    model::{Board, Operation, valid_id},
    platform,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HistoryDirection {
    Undo,
    Redo,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardSummary {
    pub id: String,
    pub title: String,
    pub slug: String,
    pub revision: u64,
    pub element_count: usize,
}
pub struct CommandOutcome {
    pub board: Board,
    pub committed: bool,
}
pub struct Store {
    root: PathBuf,
    documents: BTreeMap<String, StoredDocument>,
    links: LinkIndex,
    _lock: platform::DataLock,
    persistence: Box<dyn platform::Persistence>,
    poisoned: bool,
    fresh: bool,
}
impl Store {
    pub fn boards_directory(&self) -> PathBuf {
        std::fs::canonicalize(self.root.join("boards")).unwrap_or_else(|_| self.root.join("boards"))
    }
    pub fn open(root: &Path) -> Result<Self, AppError> {
        Self::open_with_persistence(root, Box::new(platform::FilePersistence))
    }
    pub fn open_with_persistence(
        root: &Path,
        persistence: Box<dyn platform::Persistence>,
    ) -> Result<Self, AppError> {
        std::fs::create_dir_all(root).map_err(|_| AppError::persistence())?;
        let fresh = std::fs::read_dir(root)
            .map_err(|_| AppError::persistence())?
            .next()
            .is_none();
        let lock = platform::lock_data_dir(root)?;
        let dir = root.join("boards");
        std::fs::create_dir_all(&dir).map_err(|_| AppError::persistence())?;
        let links_path = root.join("links.json");
        let links = match std::fs::symlink_metadata(&links_path) {
            Ok(meta)
                if meta.is_file()
                    && !meta.file_type().is_symlink()
                    && meta.len() <= MAX_LINK_BYTES as u64 =>
            {
                LinkIndex::decode(
                    &std::fs::read(&links_path).map_err(|_| AppError::persistence())?,
                )?
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => LinkIndex::default(),
            _ => {
                return Err(AppError::validation(
                    "Некорректный файл индекса ссылок. Исходные данные сохранены",
                ));
            }
        };
        let mut store = Self {
            root: root.into(),
            documents: BTreeMap::new(),
            links,
            _lock: lock,
            persistence,
            poisoned: false,
            fresh,
        };
        for entry in std::fs::read_dir(&dir).map_err(|_| AppError::persistence())? {
            let path = entry.map_err(|_| AppError::persistence())?.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let meta = std::fs::symlink_metadata(&path).map_err(|_| AppError::persistence())?;
            if !meta.is_file()
                || meta.file_type().is_symlink()
                || meta.len() > MAX_DOCUMENT_BYTES as u64
            {
                return Err(AppError::validation(
                    "Некорректный файл доски. Исходные данные сохранены",
                ));
            }
            let bytes = std::fs::read(&path).map_err(|_| AppError::persistence())?;
            let (doc, migrating) = StoredDocument::decode(&bytes)?;
            if path.file_stem().and_then(|s| s.to_str()) != Some(&doc.board.id) {
                return Err(AppError::validation("ID доски не совпадает с именем файла"));
            }
            if migrating {
                store.backup_original(&doc.board.id, &bytes)?;
                store.persist(&doc)?;
            }
            store.documents.insert(doc.board.id.clone(), doc);
        }
        let mut links = store.links.clone();
        let mut changed = false;
        for doc in store.documents.values() {
            if links.slug(&doc.board.id).is_none() {
                links.assign(&doc.board.id, &doc.board.title);
                changed = true;
            }
        }
        if changed {
            store.save_links(links)?;
        }
        Ok(store)
    }
    fn backup_original(&mut self, id: &str, bytes: &[u8]) -> Result<(), AppError> {
        let dir = self.root.join("backups").join("ux-v3");
        for part in [self.root.join("backups"), dir.clone()] {
            match std::fs::symlink_metadata(&part) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    std::fs::create_dir(&part).map_err(|_| AppError::persistence())?
                }
                Err(_) => return Err(AppError::persistence()),
                Ok(_) => {}
            }
            let meta = std::fs::symlink_metadata(part).map_err(|_| AppError::persistence())?;
            if !meta.is_dir() || meta.file_type().is_symlink() {
                return Err(AppError::validation("Некорректный каталог резервной копии"));
            }
        }
        let path = dir.join(format!("{id}.json"));
        match std::fs::symlink_metadata(&path) {
            Ok(meta) => {
                if !meta.is_file()
                    || meta.file_type().is_symlink()
                    || std::fs::read(&path).map_err(|_| AppError::persistence())? != bytes
                {
                    return Err(AppError::validation(
                        "Резервная копия уже существует и отличается. Исходная доска сохранена",
                    ));
                }
                Ok(())
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => self.write_bytes(&path, bytes),
            Err(_) => Err(AppError::persistence()),
        }
    }
    fn document(&self, id: &str) -> Result<&StoredDocument, AppError> {
        self.ensure_healthy()?;
        if !valid_id(id) {
            return Err(AppError::validation("Недопустимый ID доски"));
        }
        self.documents.get(id).ok_or_else(AppError::missing)
    }
    pub fn get(&self, id: &str) -> Result<Board, AppError> {
        Ok(self.document(id)?.board.clone())
    }
    pub fn stamps(&self, id: &str) -> Result<FieldStamps, AppError> {
        Ok(self.document(id)?.stamps.clone())
    }
    pub fn list(&self) -> Result<Vec<BoardSummary>, AppError> {
        self.ensure_healthy()?;
        self.documents
            .values()
            .map(|d| {
                Ok(BoardSummary {
                    id: d.board.id.clone(),
                    title: d.board.title.clone(),
                    slug: self
                        .links
                        .slug(&d.board.id)
                        .ok_or_else(AppError::persistence)?
                        .to_string(),
                    revision: d.board.revision,
                    element_count: d.board.elements.len(),
                })
            })
            .collect::<Result<Vec<_>, AppError>>()
    }
    pub fn create(&mut self, title: &str) -> Result<Board, AppError> {
        let board = Board::new(uuid::Uuid::new_v4().to_string(), title.trim().into());
        let doc = StoredDocument::new(board.clone());
        doc.validate()?;
        self.reserve_link(&board)?;
        self.persist(&doc)?;
        self.documents.insert(board.id.clone(), doc);
        Ok(board)
    }
    pub fn apply(
        &mut self,
        id: &str,
        revision: u64,
        operations: &[Operation],
    ) -> Result<Board, AppError> {
        Ok(self
            .execute(
                id,
                &CommandRequest {
                    revision,
                    operations: operations.to_vec(),
                    command: None,
                    guards: None,
                },
            )?
            .board)
    }
    pub fn execute(
        &mut self,
        id: &str,
        request: &CommandRequest,
    ) -> Result<CommandOutcome, AppError> {
        let mut doc = self.document(id)?.clone();
        if let Some(meta) = &request.command {
            meta.validate()?;
            if meta.actor.source == Source::Legacy {
                return Err(AppError::validation("Источник legacy назначается сервером"));
            }
            let expected = match meta.actor.source {
                Source::User => crate::comments::Author::User,
                Source::Codex => crate::comments::Author::Codex,
                Source::Claude => crate::comments::Author::Claude,
                Source::Legacy => unreachable!(),
            };
            for op in &request.operations {
                let author = match op {
                    Operation::CommentCreate { author, .. }
                    | Operation::CommentReply { author, .. }
                    | Operation::CommentStatus { author, .. }
                    | Operation::CommentReanchor { author, .. } => Some(*author),
                    _ => None,
                };
                if author.is_some_and(|a| a != expected) {
                    return Err(AppError::new(
                        crate::error::ErrorCode::Forbidden,
                        "Источник команды не может выдавать себя за другого автора комментария",
                    ));
                }
            }
            if let Some(outcome) = replayed(&doc, &meta.id, request)? {
                return Ok(outcome);
            }
        } else if request.guards.is_some() {
            return Err(AppError::validation(
                "Guarded-команда требует ID и участника",
            ));
        }
        let guards = request.guards.as_ref();
        if doc.board.revision != request.revision && guards.is_none() {
            return Err(AppError::conflict());
        }
        if request.revision > doc.board.revision {
            return Err(AppError::conflict());
        }
        if let Some(guards) = guards {
            if guards.len() > 60000 {
                return Err(AppError::limit("Слишком много условий команды"));
            }
            let required = history::required_guards(&doc.board, &request.operations)?;
            let supplied: std::collections::BTreeSet<_> =
                guards.iter().map(|g| g.key.clone()).collect();
            if supplied.len() != guards.len() || !required.is_subset(&supplied) {
                return Err(AppError::conflict());
            }
            let failed: Vec<_> = guards
                .iter()
                .filter(|g| {
                    !history::guard_value_eq(&history::read_field(&doc.board, &g.key), &g.value)
                        || history::stamp(&doc.stamps, &g.key) != g.stamp
                })
                .map(|g| g.key.clone())
                .collect();
            if !failed.is_empty() {
                return Err(history::CommandConflict{command_id:request.command.as_ref().map(|m|m.id.clone()).unwrap_or_default(),elements:failed.iter().filter_map(|k|if let history::EntityKey::Element(id)=k.entity{Some(id)}else{None}).collect(),fields:failed,reason:"Положение, размер или связанные объекты изменились. Несохранённое действие требует просмотра".into()}.error());
            }
        }
        let now = time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|_| AppError::validation("Ошибка системного времени"))?;
        let next = doc
            .board
            .apply_with_context(doc.board.revision, &request.operations, &now)?;
        let meta = request.command.clone().unwrap_or_else(|| CommandMeta {
            id: uuid::Uuid::new_v4().to_string(),
            actor: Actor {
                id: "legacy".into(),
                source: Source::Legacy,
            },
            label: "Изменение CLI".into(),
        });
        let entry = history::record(&doc.board, &next, &meta, &doc.stamps);
        let committed = !entry.deltas.is_empty()
            || next.next_id != doc.board.next_id
            || next.next_comment_id != doc.board.next_comment_id
            || next.next_message_id != doc.board.next_message_id;
        if committed {
            history::commit_stamps(&mut doc.stamps, &entry);
            doc.history.push(entry);
            doc.board = next;
        }
        if let Some(meta) = &request.command {
            doc.receipts.insert(
                meta.id.clone(),
                CommandReceipt {
                    id: meta.id.clone(),
                    fingerprint: fingerprint(request)?,
                    committed_revision: doc.board.revision,
                },
            );
        }
        if committed || request.command.is_some() {
            self.persist(&doc)?;
        }
        let board = doc.board.clone();
        self.documents.insert(id.into(), doc);
        Ok(CommandOutcome { board, committed })
    }
    pub fn execute_history(
        &mut self,
        id: &str,
        request: &HistoryCommand,
    ) -> Result<CommandOutcome, AppError> {
        let mut doc = self.document(id)?.clone();
        request.command.validate()?;
        if request.command.actor.source != Source::User {
            return Err(AppError::validation(
                "Undo доступен только собственным действиям пользователя",
            ));
        }
        if let Some(outcome) = replayed(&doc, &request.command.id, request)? {
            return Ok(outcome);
        }
        // Journal guards validate touched fields against the latest board.
        if request.revision > doc.board.revision {
            return Err(AppError::conflict());
        }
        let actor_key = request.command.actor.key();
        let h = doc
            .history
            .actors
            .get(&actor_key)
            .ok_or_else(|| AppError::validation("История пуста"))?;
        let top = match request.direction {
            HistoryDirection::Undo => h.undo.last(),
            HistoryDirection::Redo => h.redo.last(),
        };
        if top != Some(&request.target_command_id) {
            return Err(AppError::validation(
                "Это действие больше не является следующим шагом истории",
            ));
        }
        let entry = doc
            .history
            .entries
            .iter()
            .find(|e| {
                e.command.id == request.target_command_id
                    && e.command.actor == request.command.actor
            })
            .ok_or_else(|| AppError::validation("История пуста"))?
            .clone();
        let (board, stamps) = history::inverse(&doc.board, &entry, &doc.stamps, request.direction)
            .map_err(history::CommandConflict::error)?;
        doc.board = board;
        doc.stamps = stamps;
        let h = doc
            .history
            .actors
            .get_mut(&actor_key)
            .expect("History validated");
        match request.direction {
            HistoryDirection::Undo => {
                h.undo.pop();
                h.redo.push(entry.command.id);
            }
            HistoryDirection::Redo => {
                h.redo.pop();
                h.undo.push(entry.command.id);
            }
        }
        doc.receipts.insert(
            request.command.id.clone(),
            CommandReceipt {
                id: request.command.id.clone(),
                fingerprint: fingerprint(request)?,
                committed_revision: doc.board.revision,
            },
        );
        self.persist(&doc)?;
        let board = doc.board.clone();
        self.documents.insert(id.into(), doc);
        Ok(CommandOutcome {
            board,
            committed: true,
        })
    }
    pub fn history_summary(&self, id: &str, actor: &Actor) -> Result<HistorySummary, AppError> {
        Ok(self.document(id)?.history.summary(actor))
    }
    pub fn receipt(&self, id: &str, command_id: &str) -> Result<Option<CommandReceipt>, AppError> {
        Ok(self.document(id)?.receipts.get(command_id).cloned())
    }
    pub fn history(
        &mut self,
        _id: &str,
        _revision: u64,
        _direction: HistoryDirection,
    ) -> Result<Board, AppError> {
        Err(AppError::validation(
            "Для Undo нужен участник и ID собственного действия. Обновите редактор",
        ))
    }
    pub fn delete(&mut self, id: &str, revision: u64) -> Result<(), AppError> {
        let board = self.get(id)?;
        if board.revision != revision {
            return Err(AppError::conflict());
        }
        std::fs::remove_file(self.path(id)).map_err(|_| AppError::persistence())?;
        self.documents.remove(id);
        Ok(())
    }
    pub fn import(&mut self, mut board: Board) -> Result<Board, AppError> {
        board.validate()?;
        board.id = uuid::Uuid::new_v4().to_string();
        board.revision = 0;
        for thread in &mut board.comments {
            if thread.review_revision.is_some() {
                thread.review_revision = Some(0);
            }
        }
        let doc = StoredDocument::new(board.clone());
        self.reserve_link(&board)?;
        self.persist(&doc)?;
        self.documents.insert(board.id.clone(), doc);
        Ok(board)
    }
    fn path(&self, id: &str) -> PathBuf {
        self.root.join("boards").join(format!("{id}.json"))
    }
    fn save_links(&mut self, links: LinkIndex) -> Result<(), AppError> {
        self.write_bytes(&self.root.join("links.json"), &links.encode()?)?;
        self.links = links;
        Ok(())
    }
    fn reserve_link(&mut self, board: &Board) -> Result<(), AppError> {
        let mut links = self.links.clone();
        links.assign(&board.id, &board.title);
        // Persist the reservation first. A failed board write can leave a
        // reserved name, but cannot create a board without a durable address.
        self.save_links(links)
    }
    pub fn is_fresh(&self) -> bool {
        self.fresh
    }
    fn ensure_healthy(&self) -> Result<(), AppError> {
        if !self._lock.is_owned() {
            Err(AppError::new(
                crate::error::ErrorCode::Conflict,
                "Библиотека открыта другим сервером. Изменения не сохранены; перезапустите редактор",
            ))
        } else if self.poisoned {
            Err(platform::CommitError::Uncertain.error())
        } else {
            Ok(())
        }
    }
    fn persist(&mut self, doc: &StoredDocument) -> Result<(), AppError> {
        self.ensure_healthy()?;
        let bytes = doc.encode()?;
        self.write_bytes(&self.path(&doc.board.id), &bytes)
    }
    fn write_bytes(&mut self, path: &Path, bytes: &[u8]) -> Result<(), AppError> {
        self.ensure_healthy()?;
        match self.persistence.write(path, bytes) {
            Ok(()) => Ok(()),
            Err(platform::CommitError::Uncertain) => {
                self.poisoned = true;
                Err(platform::CommitError::Uncertain.error())
            }
            Err(e) => Err(e.error()),
        }
    }
}
fn fingerprint<T: Serialize>(request: &T) -> Result<String, AppError> {
    let value =
        serde_json::to_value(request).map_err(|_| AppError::validation("Некорректная команда"))?;
    let bytes =
        serde_json::to_vec(&value).map_err(|_| AppError::validation("Некорректная команда"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
fn replayed<T: Serialize>(
    doc: &StoredDocument,
    id: &str,
    request: &T,
) -> Result<Option<CommandOutcome>, AppError> {
    if let Some(receipt) = doc.receipts.get(id) {
        if receipt.fingerprint != fingerprint(request)? {
            return Err(AppError::validation(
                "ID команды уже использован с другим содержимым",
            ));
        }
        return Ok(Some(CommandOutcome {
            board: doc.board.clone(),
            committed: false,
        }));
    }
    Ok(None)
}

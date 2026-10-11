use crate::{
    error::AppError,
    history::{self, CommandReceipt, FieldStamps, HistoryState},
    model::{Board, MAX_BOARD_BYTES},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
pub const MAX_DOCUMENT_BYTES: usize = 192 * 1024 * 1024;
pub const MAX_RECEIPT_BYTES: usize = 16 * 1024 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredDocument {
    pub storage_version: u32,
    pub board: Board,
    pub history: HistoryState,
    pub receipts: BTreeMap<String, CommandReceipt>,
    #[serde(with = "history::stamps_serde")]
    pub stamps: FieldStamps,
}
impl StoredDocument {
    pub fn new(board: Board) -> Self {
        Self {
            storage_version: 1,
            board,
            history: HistoryState::default(),
            receipts: BTreeMap::new(),
            stamps: FieldStamps::new(),
        }
    }
    pub fn decode(bytes: &[u8]) -> Result<(Self, bool), AppError> {
        if bytes.len() > MAX_DOCUMENT_BYTES {
            return Err(AppError::limit("Документ доски больше 192 MiB"));
        }
        let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| {
            AppError::validation("Повреждённый документ доски. Исходные данные сохранены")
        })?;
        if value.get("storageVersion").is_some() {
            let doc: Self = serde_json::from_value(value).map_err(|_| {
                AppError::validation("Некорректный документ доски. Исходные данные сохранены")
            })?;
            doc.validate()?;
            Ok((doc, false))
        } else {
            Ok((Self::new(Board::from_json(bytes)?), true))
        }
    }
    pub fn validate(&self) -> Result<(), AppError> {
        if self.storage_version != 1 {
            return Err(AppError::validation("Неподдерживаемый формат хранилища"));
        }
        self.board.validate()?;
        self.history.validate()?;
        if self
            .stamps
            .values()
            .any(|s| s != "baseline" && uuid::Uuid::parse_str(s).is_err())
        {
            return Err(AppError::validation("Повреждённые метки полей"));
        }
        if serde_json::to_vec(&self.board)
            .map_err(|_| AppError::persistence())?
            .len()
            > MAX_BOARD_BYTES
        {
            return Err(AppError::limit("JSON доски больше 32 MiB"));
        }
        if serde_json::to_vec(&self.receipts)
            .map_err(|_| AppError::persistence())?
            .len()
            > MAX_RECEIPT_BYTES
        {
            return Err(AppError::limit(
                "Лимит квитанций сохранения достигнут. Новое действие не сохранено",
            ));
        }
        for (id, r) in &self.receipts {
            if id != &r.id
                || uuid::Uuid::parse_str(id).is_err()
                || r.committed_revision > self.board.revision
                || r.fingerprint.len() != 64
                || !r.fingerprint.bytes().all(|c| c.is_ascii_hexdigit())
            {
                return Err(AppError::validation("Повреждённая квитанция команды"));
            }
        }
        Ok(())
    }
    pub fn encode(&self) -> Result<Vec<u8>, AppError> {
        self.validate()?;
        let mut bytes = serde_json::to_vec_pretty(self).map_err(|_| AppError::persistence())?;
        bytes.push(b'\n');
        if bytes.len() > MAX_DOCUMENT_BYTES {
            return Err(AppError::limit(
                "Документ доски больше 192 MiB. Новое действие не сохранено",
            ));
        }
        Ok(bytes)
    }
}

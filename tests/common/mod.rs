#![allow(dead_code)]
use wireboard::{
    history::{Actor, CommandMeta, CommandRequest, HistoryCommand, Source},
    model::{Board, Operation},
    store::{HistoryDirection, Store},
};
pub fn actor() -> Actor {
    Actor {
        id: "test-user".into(),
        source: Source::User,
    }
}
pub fn meta() -> CommandMeta {
    CommandMeta {
        id: uuid::Uuid::new_v4().to_string(),
        actor: actor(),
        label: "Изменение".into(),
    }
}
pub fn request(revision: u64, operations: Vec<Operation>) -> CommandRequest {
    CommandRequest {
        revision,
        operations,
        command: Some(meta()),
        guards: None,
    }
}
pub fn apply_user(store: &mut Store, id: &str, revision: u64, ops: &[Operation]) -> Board {
    store
        .execute(id, &request(revision, ops.to_vec()))
        .unwrap()
        .board
}
pub fn history_user(
    store: &mut Store,
    id: &str,
    revision: u64,
    direction: HistoryDirection,
) -> Result<Board, wireboard::error::AppError> {
    let summary = store.history_summary(id, &actor())?;
    let action = match direction {
        HistoryDirection::Undo => summary.undo,
        HistoryDirection::Redo => summary.redo,
    }
    .ok_or_else(|| wireboard::error::AppError::validation("Empty history"))?;
    store
        .execute_history(
            id,
            &HistoryCommand {
                revision,
                direction,
                target_command_id: action.command_id,
                command: meta(),
            },
        )
        .map(|o| o.board)
}

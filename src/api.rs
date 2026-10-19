use crate::{
    error::{AppError, ErrorCode},
    history::{Actor, CommandMeta, CommandRequest, FieldStampEntry, HistoryCommand, Source},
    model::{Board, MAX_BOARD_BYTES},
    render,
    store::{HistoryDirection, Store},
};
use axum::{
    Json, Router,
    body::Body,
    extract::{
        DefaultBodyLimit, Path, Query, Request, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;
use std::{convert::Infallible, sync::Arc, time::Duration};
use tokio::sync::{Mutex, Semaphore, broadcast, watch};
use tokio_stream::{StreamExt, wrappers::BroadcastStream};

#[derive(Clone)]
pub struct ApiState {
    pub store: Arc<Mutex<Store>>,
    pub origin: String,
    pub token: String,
    pub events: broadcast::Sender<String>,
    pub shutdown: watch::Sender<bool>,
    pub render_slots: Arc<Semaphore>,
}
impl ApiState {
    pub fn new(store: Store, origin: String, token: String) -> Self {
        let (events, _) = broadcast::channel(256);
        let (shutdown, _) = watch::channel(false);
        Self {
            store: Arc::new(Mutex::new(store)),
            origin,
            token,
            events,
            shutdown,
            render_slots: Arc::new(Semaphore::new(2)),
        }
    }
    pub fn with_browser_origin(mut self, origin: String) -> Self {
        self.origin = origin;
        self
    }
}
impl ApiState {
    pub fn browser_url(&self) -> String {
        format!("{}/", self.origin)
    }
}
#[derive(rust_embed::RustEmbed)]
#[folder = "frontend/dist/"]
struct Assets;
pub fn router(state: ApiState) -> Router {
    Router::new()
        .route("/api/boards", get(list).post(create))
        .route("/api/boards/{id}", get(inspect).delete(delete))
        .route("/api/boards/{id}/apply", post(apply))
        .route("/api/boards/{id}/comments", get(comments))
        .route("/api/boards/{id}/history", post(history))
        .route("/api/boards/{id}/edit-state", get(edit_state))
        .route(
            "/api/boards/{id}/commands/{command_id}",
            get(command_receipt),
        )
        .route("/api/boards/{id}/render", get(render_board))
        .route("/api/import", post(import))
        .route("/api/events", get(events))
        .route("/api/layout-metrics", get(layout_metrics))
        .route("/api/library", get(library))
        .fallback(asset)
        .layer(DefaultBodyLimit::max(MAX_BOARD_BYTES))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            response_policy,
        ))
        .with_state(state)
}
async fn layout_metrics() -> Json<&'static crate::layout::FontMetrics> {
    Json(crate::layout::font_metrics())
}
async fn library(State(state): State<ApiState>) -> Result<Json<serde_json::Value>, AppError> {
    let store = state.store.lock().await;
    let path = std::env::var("WIREBOARD_LIBRARY_PATH")
        .ok()
        .map(|root| std::path::PathBuf::from(root).join("boards"))
        .unwrap_or_else(|| store.boards_directory());
    Ok(Json(
        json!({"url":state.browser_url(),"path":path.to_string_lossy().trim_start_matches("\\\\?\\"),"boardCount":store.list()?.len(),"format":"wireboard-json","mode":"local"}),
    ))
}
async fn response_policy(State(state): State<ApiState>, request: Request, next: Next) -> Response {
    let headers = request.headers();
    let is_api = request.uri().path().starts_with("/api/");
    if is_api {
        let bearer = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v == format!("Bearer {}", state.token));
        if headers.contains_key(header::AUTHORIZATION) && !bearer {
            return AppError::new(
                ErrorCode::Unauthorized,
                "CLI подключён к другой или устаревшей библиотеке",
            )
            .into_response();
        }
        if headers
            .get(header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<usize>().ok())
            .is_some_and(|n| n > MAX_BOARD_BYTES)
        {
            return AppError::limit("Запрос больше 32 MiB").into_response();
        }
    }
    let editor = (request.uri().path() == "/" || request.uri().path().starts_with("/b/"))
        && request.method() == axum::http::Method::GET;
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert("content-security-policy",HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    if is_api || editor {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response
}
fn body<T>(value: Result<Json<T>, JsonRejection>) -> Result<T, AppError> {
    value.map(|Json(v)| v).map_err(|e| {
        if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
            AppError::limit("Запрос больше 32 MiB")
        } else {
            AppError::validation("Некорректный JSON запроса или неизвестное поле")
        }
    })
}
fn changed(state: &ApiState, id: &str, revision: u64, kind: &str, command: Option<&CommandMeta>) {
    let mut event = json!({"id":id,"revision":revision,"kind":kind});
    if let Some(command) = command {
        event["commandId"] = json!(command.id);
        event["actorId"] = json!(command.actor.id);
    }
    let _ = state.events.send(event.to_string());
}
#[derive(Deserialize, Default)]
struct ResponseQuery {
    #[serde(default)]
    state: Option<u8>,
}
impl ResponseQuery {
    fn wants_state(&self) -> bool {
        self.state == Some(1)
    }
}
fn response_query(
    query: Result<Query<ResponseQuery>, QueryRejection>,
) -> Result<ResponseQuery, AppError> {
    query
        .map(|Query(query)| query)
        .map_err(|_| AppError::validation("Некорректные параметры запроса"))
}
fn edit_state_value(
    store: &Store,
    id: &str,
    actor: &Actor,
    command_id: Option<&str>,
) -> Result<serde_json::Value, AppError> {
    let board = store.get(id)?;
    let stamps = store
        .stamps(id)?
        .into_iter()
        .map(|(key, stamp)| FieldStampEntry { key, stamp })
        .collect::<Vec<_>>();
    let history = store.history_summary(id, actor)?;
    let receipt = match command_id {
        Some(command_id) => store.receipt(id, command_id)?,
        None => None,
    };
    Ok(json!({"board":board,"stamps":stamps,"history":history,"receipt":receipt}))
}
async fn list(State(state): State<ApiState>) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(json!(state.store.lock().await.list()?)))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateRequest {
    title: String,
}
async fn create(
    State(state): State<ApiState>,
    payload: Result<Json<CreateRequest>, JsonRejection>,
) -> Result<Json<Board>, AppError> {
    let request = body(payload)?;
    let board = state.store.lock().await.create(&request.title)?;
    changed(&state, &board.id, board.revision, "created", None);
    Ok(Json(board))
}
async fn inspect(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> Result<Json<Board>, AppError> {
    Ok(Json(state.store.lock().await.get(&id)?))
}
pub type ApplyRequest = CommandRequest;
async fn apply(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    query: Result<Query<ResponseQuery>, QueryRejection>,
    payload: Result<Json<ApplyRequest>, JsonRejection>,
) -> Result<Json<serde_json::Value>, AppError> {
    let query = response_query(query)?;
    let request = body(payload)?;
    if query.wants_state() && request.command.is_none() {
        return Err(AppError::validation("Для ответа state=1 нужен command"));
    }
    let mut store = state.store.lock().await;
    let outcome = store.execute(&id, &request)?;
    if outcome.committed {
        changed(
            &state,
            &id,
            outcome.board.revision,
            "changed",
            request.command.as_ref(),
        );
    }
    match request.command.as_ref().filter(|_| query.wants_state()) {
        Some(command) => Ok(Json(edit_state_value(
            &store,
            &id,
            &command.actor,
            Some(&command.id),
        )?)),
        None => Ok(Json(json!(outcome.board))),
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoryRequest {
    revision: u64,
    direction: HistoryDirection,
    #[serde(default)]
    target_command_id: Option<String>,
    #[serde(default)]
    command: Option<crate::history::CommandMeta>,
}
async fn history(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    query: Result<Query<ResponseQuery>, QueryRejection>,
    payload: Result<Json<HistoryRequest>, JsonRejection>,
) -> Result<Json<serde_json::Value>, AppError> {
    let query = response_query(query)?;
    let request = body(payload)?;
    let command = request.command.ok_or_else(|| {
        AppError::validation(
            "Для Undo нужен участник и ID собственного действия. Обновите редактор",
        )
    })?;
    let target_command_id = request
        .target_command_id
        .ok_or_else(|| AppError::validation("Не указан ID действия для Undo"))?;
    let request = HistoryCommand {
        revision: request.revision,
        direction: request.direction,
        target_command_id,
        command,
    };
    let mut store = state.store.lock().await;
    let outcome = store.execute_history(&id, &request)?;
    if outcome.committed {
        changed(
            &state,
            &id,
            outcome.board.revision,
            "changed",
            Some(&request.command),
        );
    }
    if query.wants_state() {
        return Ok(Json(edit_state_value(
            &store,
            &id,
            &request.command.actor,
            Some(&request.command.id),
        )?));
    }
    Ok(Json(json!(outcome.board)))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditQuery {
    actor_id: String,
    command_id: Option<String>,
}
async fn edit_state(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    Query(query): Query<EditQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    if query.actor_id.trim().is_empty() || query.actor_id.len() > 128 {
        return Err(AppError::validation("Некорректный участник"));
    }
    let store = state.store.lock().await;
    let actor = Actor {
        id: query.actor_id,
        source: Source::User,
    };
    Ok(Json(edit_state_value(
        &store,
        &id,
        &actor,
        query.command_id.as_deref(),
    )?))
}
async fn command_receipt(
    State(state): State<ApiState>,
    Path((id, command_id)): Path<(String, String)>,
) -> Result<Json<crate::history::CommandReceipt>, AppError> {
    Ok(Json(
        state
            .store
            .lock()
            .await
            .receipt(&id, &command_id)?
            .ok_or_else(AppError::missing)?,
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RevisionQuery {
    revision: u64,
}
async fn delete(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    Query(query): Query<RevisionQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    state.store.lock().await.delete(&id, query.revision)?;
    changed(&state, &id, query.revision + 1, "deleted", None);
    Ok(Json(json!({"deleted":id})))
}
async fn import(
    State(state): State<ApiState>,
    payload: Result<Json<serde_json::Value>, JsonRejection>,
) -> Result<Json<Board>, AppError> {
    let value = body(payload)?;
    let bytes =
        serde_json::to_vec(&value).map_err(|_| AppError::validation("Некорректный JSON"))?;
    let board = state.store.lock().await.import(Board::from_json(&bytes)?)?;
    changed(&state, &board.id, board.revision, "created", None);
    Ok(Json(board))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CommentsQuery {
    status: Option<String>,
    thread: Option<u64>,
}
async fn comments(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    Query(query): Query<CommentsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let store = state.store.lock().await;
    Ok(Json(store.get(&id)?.comments_context(
        query.status.as_deref().unwrap_or("open"),
        query.thread,
    )?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RenderQuery {
    format: Option<String>,
    frame: Option<u64>,
}
async fn render_board(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    Query(query): Query<RenderQuery>,
) -> Result<Response, AppError> {
    let permit = state
        .render_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| AppError::limit("Рендер занят. Повторите запрос позже"))?;
    let board = state.store.lock().await.get(&id)?;
    let revision = board.revision;
    let mut response = match query.format.as_deref().unwrap_or("svg") {
        "svg" => Ok((
            [(header::CONTENT_TYPE, "image/svg+xml; charset=utf-8")],
            render::render_svg(&board, query.frame)?,
        )
            .into_response()),
        "png" => {
            let frame = query.frame;
            let png = tokio::task::spawn_blocking(move || {
                let _permit = permit;
                render::render_png(&board, frame)
            })
            .await
            .map_err(|_| AppError::validation("Ошибка рендеринга"))??;
            Ok(([(header::CONTENT_TYPE, "image/png")], png).into_response())
        }
        _ => Err(AppError::validation("Формат должен быть svg или png")),
    }?;
    response.headers_mut().insert(
        "x-board-revision",
        HeaderValue::from_str(&revision.to_string())
            .map_err(|_| AppError::validation("Ошибка revision"))?,
    );
    Ok(response)
}
async fn events(
    State(state): State<ApiState>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let stream = BroadcastStream::new(state.events.subscribe()).map(|event| {
        Ok(match event {
            Ok(data) => Event::default().event("board").data(data),
            Err(_) => Event::default().event("reload").data("{}"),
        })
    });
    let initial = tokio_stream::once(Ok(Event::default().event("reload").data("{}")));
    let mut shutdown = state.shutdown.subscribe();
    let stream = futures_util::StreamExt::take_until(initial.chain(stream), async move {
        loop {
            if *shutdown.borrow() {
                break;
            }
            if shutdown.changed().await.is_err() {
                break;
            }
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}
async fn asset(request: Request) -> Response {
    if request.method() != axum::http::Method::GET {
        return AppError::missing().into_response();
    }
    let path = request.uri().path().trim_start_matches('/');
    let board_path = path
        .strip_prefix("b/")
        .is_some_and(crate::links::valid_slug);
    let path = if path.is_empty() || board_path {
        "index.html"
    } else {
        path
    };
    match Assets::get(path) {
        Some(asset) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            let mut response = Response::new(Body::from(asset.data.into_owned()));
            if let Ok(value) = HeaderValue::from_str(mime.as_ref()) {
                response.headers_mut().insert(header::CONTENT_TYPE, value);
            }
            response
        }
        None => AppError::missing().into_response(),
    }
}

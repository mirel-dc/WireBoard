use crate::{
    api::{ApiState, router},
    error::AppError,
    history::{Actor, CommandMeta, CommandRequest, HistoryCommand, Source},
    model::{Board, MAX_BOARD_BYTES, Operation},
    platform,
    store::Store,
};
use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Parser)]
#[command(
    version,
    about = "Local browser whiteboard and revision-checked agent CLI"
)]
struct Args {
    #[arg(long, global = true)]
    data_dir: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Open {
        /// Return the ordinary local editor URL for a host browser helper.
        #[arg(long)]
        print_url: bool,
    },
    Serve {
        #[arg(long)]
        open: bool,
        #[arg(long, default_value_t = 9843)]
        port: u16,
        #[arg(long, default_value = "127.0.0.1")]
        listen: std::net::Ipv4Addr,
        #[arg(long)]
        public_origin: Option<String>,
    },
    Boards,
    Create {
        #[arg(long)]
        title: String,
    },
    Inspect {
        board: String,
    },
    Comments {
        board: String,
        #[arg(long,default_value="open",value_parser=["open","awaiting_review","resolved","all"])]
        status: String,
        #[arg(long)]
        thread: Option<u64>,
    },
    Apply {
        board: String,
        #[arg(long)]
        revision: u64,
        #[arg(long)]
        file: String,
        #[arg(long,requires_all=["actor_id","author"])]
        command_id: Option<String>,
        #[arg(long,requires_all=["command_id","author"])]
        actor_id: Option<String>,
        #[arg(long,value_parser=["user","codex","claude"],requires_all=["command_id","actor_id"])]
        author: Option<String>,
    },
    History {
        board: String,
        #[arg(long)]
        revision: u64,
        #[arg(long,value_parser=["undo","redo"])]
        direction: String,
        #[arg(long)]
        target_command_id: String,
        #[arg(long)]
        command_id: String,
        #[arg(long)]
        actor_id: String,
        #[arg(long,default_value="user",value_parser=["user"])]
        author: String,
    },
    #[command(name = "command")]
    Receipt {
        board: String,
        command_id: String,
    },
    Render {
        board: String,
        #[arg(long)]
        frame: Option<u64>,
        #[arg(long)]
        output: PathBuf,
    },
    Export {
        board: String,
        #[arg(long)]
        output: PathBuf,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Runtime {
    pub endpoint: String,
    #[serde(default)]
    pub browser_endpoint: Option<String>,
    pub token: String,
    pub pid: u32,
}
fn print_json(value: &Value) -> Result<(), AppError> {
    println!(
        "{}",
        serde_json::to_string_pretty(value).map_err(|_| AppError::validation("Ошибка JSON"))?
    );
    Ok(())
}
fn read_input(path: &str) -> Result<Vec<u8>, AppError> {
    let mut bytes = Vec::new();
    if path == "-" {
        std::io::stdin()
            .take((MAX_BOARD_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| AppError::validation("Не удалось прочитать stdin"))?;
    } else {
        let file = std::fs::File::open(path)
            .map_err(|_| AppError::validation("Не удалось открыть входной файл"))?;
        file.take((MAX_BOARD_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| AppError::validation("Не удалось прочитать файл"))?;
    }
    if bytes.len() > MAX_BOARD_BYTES {
        return Err(AppError::limit("Файл больше 32 MiB"));
    }
    Ok(bytes)
}
async fn check(response: reqwest::Response) -> Result<reqwest::Response, AppError> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let value: Value = response.json().await.unwrap_or(json!({}));
    let code = match status.as_u16() {
        400 => crate::error::ErrorCode::Validation,
        401 => crate::error::ErrorCode::Unauthorized,
        403 => crate::error::ErrorCode::Forbidden,
        404 => crate::error::ErrorCode::Missing,
        409 => crate::error::ErrorCode::Conflict,
        413 => crate::error::ErrorCode::Limit,
        _ => crate::error::ErrorCode::Persistence,
    };
    Err(AppError::new(
        code,
        value["message"]
            .as_str()
            .unwrap_or("Сервер отклонил запрос"),
    ))
}
pub async fn run() -> Result<(), AppError> {
    let args = Args::parse();
    let root = match args.data_dir {
        Some(path) => path,
        None => platform::default_data_dir()?,
    };
    if let Command::Serve {
        open,
        port,
        listen,
        public_origin,
    } = args.command
    {
        return serve_network(&root, open, port, listen, public_origin.as_deref()).await;
    }
    let runtime: Runtime = serde_json::from_slice(&read_runtime(&root)?).map_err(|_| {
        AppError::validation("Нет корректного runtime-файла. Запустите wireboard serve")
    })?;
    let endpoint = reachable_runtime(&runtime).await?.ok_or_else(|| AppError::validation("Сервер библиотеки недоступен или runtime устарел. Запустите сервер с тем же --data-dir"))?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| AppError::validation("Не удалось создать HTTP клиент"))?;
    let endpoint = endpoint.trim_end_matches('/');
    let request = |method, path: &str| {
        client
            .request(method, format!("{endpoint}{path}"))
            .bearer_auth(&runtime.token)
    };
    let network_error = |_| {
        AppError::validation("Сервер недоступен. Запустите wireboard serve с тем же --data-dir")
    };
    use reqwest::Method;
    let response = match args.command {
        Command::Open { print_url } => {
            let library: Value = check(
                request(Method::GET, "/api/library")
                    .send()
                    .await
                    .map_err(network_error)?,
            )
            .await?
            .json()
            .await
            .map_err(|_| AppError::validation("Ошибка локальной библиотеки"))?;
            let url = library["url"].as_str().unwrap_or(runtime.endpoint.as_str());
            if print_url {
                println!("{url}");
                return Ok(());
            }
            platform::open_browser(url)?;
            return print_json(&json!({"opened":endpoint}));
        }
        Command::Boards => request(Method::GET, "/api/boards").send().await,
        Command::Create { title } => {
            request(Method::POST, "/api/boards")
                .json(&json!({"title":title}))
                .send()
                .await
        }
        Command::Inspect { board } => {
            validate_id(&board)?;
            request(Method::GET, &format!("/api/boards/{board}"))
                .send()
                .await
        }
        Command::Apply {
            board,
            revision,
            file,
            command_id,
            actor_id,
            author,
        } => {
            validate_id(&board)?;
            let bytes = read_input(&file)?;
            let operations: Vec<Operation> = serde_json::from_slice(&bytes)
                .map_err(|_| AppError::validation("Файл должен содержать JSON-массив операций"))?;
            let command = match (command_id, actor_id, author) {
                (Some(id), Some(actor_id), Some(author)) => {
                    Some(command_meta(id, actor_id, &author, "Изменение CLI")?)
                }
                (None, None, None) => None,
                _ => {
                    return Err(AppError::validation(
                        "Для команды с ID нужны --command-id, --actor-id и --author",
                    ));
                }
            };
            let payload = CommandRequest {
                revision,
                operations,
                command,
                guards: None,
            };
            if let Some(meta) = &payload.command {
                save_request(&root, &board, &meta.id, &payload)?;
            }
            request(Method::POST, &format!("/api/boards/{board}/apply"))
                .json(&payload)
                .send()
                .await
        }
        Command::History {
            board,
            revision,
            direction,
            target_command_id,
            command_id,
            actor_id,
            author,
        } => {
            validate_id(&board)?;
            let direction = if direction == "undo" {
                crate::store::HistoryDirection::Undo
            } else {
                crate::store::HistoryDirection::Redo
            };
            let command = command_meta(command_id, actor_id, &author, "История CLI")?;
            let payload = HistoryCommand {
                revision,
                direction,
                target_command_id,
                command,
            };
            save_request(&root, &board, &payload.command.id, &payload)?;
            request(Method::POST, &format!("/api/boards/{board}/history"))
                .json(&payload)
                .send()
                .await
        }
        Command::Receipt { board, command_id } => {
            validate_id(&board)?;
            if uuid::Uuid::parse_str(&command_id).is_err() {
                return Err(AppError::validation("Некорректный ID команды"));
            }
            request(
                Method::GET,
                &format!("/api/boards/{board}/commands/{command_id}"),
            )
            .send()
            .await
        }
        Command::Comments {
            board,
            status,
            thread,
        } => {
            validate_id(&board)?;
            let mut path = format!("/api/boards/{board}/comments?status={status}");
            if let Some(id) = thread {
                path.push_str(&format!("&thread={id}"));
            }
            request(Method::GET, &path).send().await
        }
        Command::Render {
            board,
            frame,
            output,
        } => {
            validate_id(&board)?;
            let format = match output.extension().and_then(|e| e.to_str()) {
                Some("png") => "png",
                Some("svg") => "svg",
                _ => {
                    return Err(AppError::validation(
                        "Выходной файл должен иметь расширение .svg или .png",
                    ));
                }
            };
            let mut path = format!("/api/boards/{board}/render?format={format}");
            if let Some(frame) = frame {
                path.push_str(&format!("&frame={frame}"));
            }
            let response = check(
                request(Method::GET, &path)
                    .send()
                    .await
                    .map_err(network_error)?,
            )
            .await?;
            let bytes = response
                .bytes()
                .await
                .map_err(|_| AppError::validation("Не удалось получить изображение"))?;
            platform::atomic_write(&output, &bytes)?;
            return print_json(&json!({"output":output,"format":format,"bytes":bytes.len()}));
        }
        Command::Export { board, output } => {
            validate_id(&board)?;
            let response = check(
                request(Method::GET, &format!("/api/boards/{board}"))
                    .send()
                    .await
                    .map_err(network_error)?,
            )
            .await?;
            let board: Board = response
                .json()
                .await
                .map_err(|_| AppError::validation("Некорректный ответ сервера"))?;
            let mut bytes = serde_json::to_vec_pretty(&board)
                .map_err(|_| AppError::validation("Ошибка JSON"))?;
            bytes.push(b'\n');
            platform::atomic_write(&output, &bytes)?;
            return print_json(&json!({"output":output,"bytes":bytes.len()}));
        }
        Command::Serve { .. } => unreachable!(),
    }
    .map_err(network_error)?;
    let value: Value = check(response)
        .await?
        .json()
        .await
        .map_err(|_| AppError::validation("Некорректный ответ сервера"))?;
    print_json(&value)
}
fn command_meta(
    id: String,
    actor_id: String,
    author: &str,
    label: &str,
) -> Result<CommandMeta, AppError> {
    let source = match author {
        "user" => Source::User,
        "codex" => Source::Codex,
        "claude" => Source::Claude,
        _ => return Err(AppError::validation("Некорректный источник команды")),
    };
    let meta = CommandMeta {
        id,
        actor: Actor {
            id: actor_id,
            source,
        },
        label: label.into(),
    };
    meta.validate()?;
    Ok(meta)
}
fn save_request<T: Serialize>(
    root: &Path,
    board: &str,
    id: &str,
    payload: &T,
) -> Result<(), AppError> {
    let dir = root.join("requests");
    match std::fs::symlink_metadata(&dir) {
        Ok(meta) if !meta.is_dir() || meta.file_type().is_symlink() => {
            return Err(AppError::validation("Некорректный каталог запросов"));
        }
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&dir).map_err(|_| AppError::persistence())?
        }
        Err(_) => return Err(AppError::persistence()),
    }
    let uuid =
        uuid::Uuid::parse_str(id).map_err(|_| AppError::validation("Некорректный ID команды"))?;
    let path = dir.join(format!("{board}-{}.json", uuid.simple()));
    let bytes = serde_json::to_vec_pretty(payload)
        .map_err(|_| AppError::validation("Некорректный запрос"))?;
    match std::fs::symlink_metadata(&path) {
        Ok(meta) => {
            if !meta.is_file()
                || meta.file_type().is_symlink()
                || std::fs::read(&path).map_err(|_| AppError::persistence())? != bytes
            {
                return Err(AppError::validation(
                    "Сохранённый ID запроса уже имеет другое содержимое",
                ));
            }
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            platform::write_private_runtime(&path, &bytes)
        }
        Err(_) => Err(AppError::persistence()),
    }
}
fn validate_id(id: &str) -> Result<(), AppError> {
    if crate::model::valid_id(id) {
        Ok(())
    } else {
        Err(AppError::validation("Некорректный ID доски"))
    }
}
fn read_runtime(root: &Path) -> Result<Vec<u8>, AppError> {
    std::fs::read(root.join("runtime.json"))
        .map_err(|_| AppError::validation("Сервер не запущен. Выполните wireboard serve"))
}
struct RuntimeGuard {
    path: PathBuf,
    token: String,
}
impl Drop for RuntimeGuard {
    fn drop(&mut self) {
        if let Ok(bytes) = std::fs::read(&self.path)
            && serde_json::from_slice::<Runtime>(&bytes)
                .is_ok_and(|r| r.pid == std::process::id() && r.token == self.token)
        {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}
pub async fn serve(root: &Path, open: bool, port: u16) -> Result<(), AppError> {
    serve_network(root, open, port, std::net::Ipv4Addr::LOCALHOST, None).await
}
async fn reachable_runtime(runtime: &Runtime) -> Result<Option<String>, AppError> {
    let endpoints: Vec<_> = std::iter::once(runtime.endpoint.as_str())
        .chain(runtime.browser_endpoint.as_deref())
        .collect();
    for endpoint in &endpoints {
        let url = reqwest::Url::parse(endpoint)
            .map_err(|_| AppError::validation("Некорректный endpoint библиотеки"))?;
        if url.scheme() != "http"
            || url.host_str() != Some("127.0.0.1")
            || url.port().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(AppError::validation(
                "CLI разрешён только для локального endpoint 127.0.0.1",
            ));
        }
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|_| AppError::validation("Не удалось проверить библиотеку"))?;
    for endpoint in endpoints {
        if let Ok(response) = client
            .get(format!("{}/api/boards", endpoint.trim_end_matches('/')))
            .bearer_auth(&runtime.token)
            .send()
            .await
            && (response.status().is_success() || response.status().is_server_error())
        {
            return Ok(Some(endpoint.to_string()));
        }
    }
    Ok(None)
}
async fn serve_network(
    root: &Path,
    open: bool,
    port: u16,
    listen: std::net::Ipv4Addr,
    public_origin: Option<&str>,
) -> Result<(), AppError> {
    if listen != std::net::Ipv4Addr::LOCALHOST && !listen.is_unspecified() {
        return Err(AppError::validation(
            "Разрешён listen 127.0.0.1 или явный контейнерный 0.0.0.0",
        ));
    }
    let browser_origin = public_origin.map(validate_public_origin).transpose()?;
    if let Ok(bytes) = read_runtime(root)
        && let Ok(runtime) = serde_json::from_slice::<Runtime>(&bytes)
        && let Some(endpoint) = reachable_runtime(&runtime).await?
    {
        return Err(AppError::validation(format!(
            "Библиотека уже открыта на {endpoint}. Используйте этот сервер или сначала остановите его"
        )));
    }
    let store = Store::open(root)?;
    let listener = tokio::net::TcpListener::bind((listen, port))
        .await
        .map_err(|_| AppError::validation("Порт занят или недоступен. Используйте --port"))?;
    let addr = listener
        .local_addr()
        .map_err(|_| AppError::validation("Не удалось получить адрес сервера"))?;
    let endpoint = format!("http://127.0.0.1:{}", addr.port());
    let browser_origin = browser_origin.unwrap_or_else(|| endpoint.clone());
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let runtime = Runtime {
        endpoint: endpoint.clone(),
        browser_endpoint: Some(browser_origin.clone()),
        token: token.clone(),
        pid: std::process::id(),
    };
    let path = root.join("runtime.json");
    platform::write_private_runtime(
        &path,
        &serde_json::to_vec(&runtime).map_err(|_| AppError::persistence())?,
    )?;
    let _guard = RuntimeGuard {
        path,
        token: token.clone(),
    };
    let state =
        ApiState::new(store, endpoint.clone(), token).with_browser_origin(browser_origin.clone());
    println!(
        "{}",
        json!({"url":browser_origin,"message":"Wireboard готов. Ctrl+C останавливает сервер"})
    );
    if open && let Err(error) = platform::open_browser(&state.browser_url()) {
        eprintln!("{}", error);
    }
    let shutdown = state.shutdown.clone();
    let mut receiver = shutdown.subscribe();
    let mut task = tokio::spawn(async move {
        axum::serve(listener, router(state))
            .with_graceful_shutdown(async move {
                while !*receiver.borrow() {
                    if receiver.changed().await.is_err() {
                        break;
                    }
                }
            })
            .await
    });
    tokio::select! {
        result=&mut task=>result.map_err(|_|AppError::validation("Сервер завершился с ошибкой"))?.map_err(|_|AppError::validation("Сервер завершился с ошибкой")),
        signal=shutdown_signal()=>{signal?;shutdown.send_replace(true);match tokio::time::timeout(Duration::from_secs(10),&mut task).await{Ok(result)=>result.map_err(|_|AppError::validation("Ошибка остановки сервера"))?.map_err(|_|AppError::validation("Ошибка остановки сервера")),Err(_)=>{task.abort();let _=task.await;Ok(())}}}
    }
}
fn validate_public_origin(value: &str) -> Result<String, AppError> {
    let url = reqwest::Url::parse(value)
        .map_err(|_| AppError::validation("Некорректный public-origin"))?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::validation(
            "public-origin должен быть HTTP origin на 127.0.0.1 без пути и credentials",
        ));
    }
    Ok(url.origin().ascii_serialization())
}
async fn shutdown_signal() -> Result<(), AppError> {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .map_err(|_| AppError::validation("Не удалось установить SIGTERM handler"))?;
        tokio::select! {
            result = tokio::signal::ctrl_c() => result.map_err(|_|AppError::validation("Не удалось получить сигнал остановки")),
            _ = terminate.recv() => Ok(()),
        }
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c()
        .await
        .map_err(|_| AppError::validation("Не удалось получить сигнал остановки"))
}

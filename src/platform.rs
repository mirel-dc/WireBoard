use crate::error::{AppError, ErrorCode};
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Copy)]
pub enum Platform {
    Windows,
    Mac,
    Linux,
}
pub fn resolve_data_dir(
    platform: Platform,
    home: Option<&Path>,
    local: Option<&Path>,
    xdg: Option<&Path>,
) -> Result<PathBuf, AppError> {
    match platform {
        Platform::Windows => Ok(local
            .ok_or_else(|| AppError::validation("LOCALAPPDATA недоступен; укажите --data-dir"))?
            .join("Wireboard")),
        Platform::Mac => Ok(home
            .ok_or_else(|| AppError::validation("HOME недоступен; укажите --data-dir"))?
            .join("Library/Application Support/Wireboard")),
        Platform::Linux => {
            if let Some(xdg) = xdg.filter(|p| p.is_absolute()) {
                return Ok(xdg.join("wireboard"));
            }
            Ok(home
                .ok_or_else(|| AppError::validation("HOME недоступен; укажите --data-dir"))?
                .join(".local/share/wireboard"))
        }
    }
}
pub fn default_data_dir() -> Result<PathBuf, AppError> {
    if let Some(root) = std::env::var_os("WIREBOARD_DATA_DIR") {
        let root = PathBuf::from(root);
        if !root.is_absolute() {
            return Err(AppError::validation(
                "WIREBOARD_DATA_DIR должен быть абсолютным путём",
            ));
        }
        return Ok(root);
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let xdg = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from);
    let platform = if cfg!(windows) {
        Platform::Windows
    } else if cfg!(target_os = "macos") {
        Platform::Mac
    } else {
        Platform::Linux
    };
    resolve_data_dir(platform, home.as_deref(), local.as_deref(), xdg.as_deref())
}
pub struct DataLock {
    _file: File,
    directory: PathBuf,
    owner: String,
}
impl DataLock {
    pub fn is_owned(&self) -> bool {
        std::fs::read_to_string(self.directory.join("owner")).is_ok_and(|owner| owner == self.owner)
    }
}
impl Drop for DataLock {
    fn drop(&mut self) {
        if self.is_owned() {
            let _ = std::fs::remove_file(self.directory.join("owner"));
            let _ = std::fs::remove_dir(&self.directory);
        }
    }
}
pub fn lock_data_dir(root: &Path) -> Result<DataLock, AppError> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join(".lock"))
        .map_err(|_| AppError::persistence())?;
    fs2::FileExt::try_lock_exclusive(&file).map_err(|_| {
        AppError::new(
            ErrorCode::Conflict,
            "Каталог уже используется другим сервером",
        )
    })?;
    // Directory creation also excludes Windows/container runtimes whose
    // advisory file locks are not shared by Docker Desktop. Never expire an
    // owner automatically: a paused writer can still have a commit in flight.
    let directory = root.join(".library-lock");
    std::fs::create_dir(&directory).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            AppError::new(ErrorCode::Conflict,
                "Библиотека заблокирована другим сервером. После аварии остановите все её серверы и удалите только каталог .library-lock")
        } else {
            AppError::persistence()
        }
    })?;
    let owner = uuid::Uuid::new_v4().to_string();
    if std::fs::write(directory.join("owner"), &owner).is_err() {
        let _ = std::fs::remove_dir(&directory);
        return Err(AppError::persistence());
    }
    Ok(DataLock {
        _file: file,
        directory,
        owner,
    })
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    FilePersistence
        .write(path, bytes)
        .map_err(CommitError::error)
}
#[derive(Debug)]
pub enum CommitError {
    Unchanged,
    Uncertain,
}
impl CommitError {
    pub fn error(self) -> AppError {
        match self {
            Self::Unchanged => AppError::persistence(),
            Self::Uncertain => AppError::new(
                ErrorCode::Persistence,
                "Не удалось подтвердить долговечность записи. Содержимое файла могло измениться; перезапустите сервер и проверьте доску",
            ),
        }
    }
}
pub trait Persistence: Send + Sync {
    fn write(&self, path: &Path, bytes: &[u8]) -> Result<(), CommitError>;
}
pub struct FilePersistence;
impl Persistence for FilePersistence {
    fn write(&self, path: &Path, bytes: &[u8]) -> Result<(), CommitError> {
        let mut file =
            atomic_write_file::AtomicWriteFile::open(path).map_err(|_| CommitError::Unchanged)?;
        file.write_all(bytes).map_err(|_| CommitError::Unchanged)?;
        file.commit().map_err(|_| match std::fs::read(path) {
            Ok(current) if current != bytes => CommitError::Unchanged,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound || path.is_dir() => {
                CommitError::Unchanged
            }
            _ => CommitError::Uncertain,
        })
    }
}
pub fn write_private_runtime(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let parent = path.parent().ok_or_else(AppError::persistence)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|_| AppError::persistence())?;
    restrict_file(file.path())?;
    file.write_all(bytes).map_err(|_| AppError::persistence())?;
    file.as_file()
        .sync_all()
        .map_err(|_| AppError::persistence())?;
    file.persist(path).map_err(|_| AppError::persistence())?;
    Ok(())
}
#[cfg(unix)]
fn restrict_file(path: &Path) -> Result<(), AppError> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|_| AppError::persistence())
}
#[cfg(windows)]
fn restrict_file(path: &Path) -> Result<(), AppError> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("whoami.exe")
        .args(["/user", "/fo", "csv", "/nh"])
        .creation_flags(0x08000000)
        .output()
        .map_err(|_| AppError::persistence())?;
    if !output.status.success() {
        return Err(AppError::persistence());
    }
    let csv = String::from_utf8_lossy(&output.stdout);
    let sid = csv
        .trim()
        .split(',')
        .next_back()
        .unwrap_or("")
        .trim_matches('"');
    if !sid.starts_with("S-1-")
        || !sid
            .bytes()
            .all(|c| c.is_ascii_digit() || c == b'S' || c == b'-')
    {
        return Err(AppError::persistence());
    }
    let result = std::process::Command::new("icacls.exe")
        .arg(path)
        .args(["/inheritance:r", "/grant:r", &format!("*{sid}:F")])
        .creation_flags(0x08000000)
        .output()
        .map_err(|_| AppError::persistence())?;
    if !result.status.success() {
        return Err(AppError::persistence());
    }
    Ok(())
}
pub fn open_browser(url: &str) -> Result<(), AppError> {
    webbrowser::open(url).map_err(|_| {
        AppError::validation(
            "Не удалось открыть браузер. Проверьте браузер по умолчанию и повторите wireboard open",
        )
    })
}

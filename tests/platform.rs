use std::path::Path;
use wireboard::platform::{Platform, resolve_data_dir, write_private_runtime};
#[test]
fn data_directories_follow_platform_and_xdg_rules() {
    let home = Path::new("/users/me");
    assert_eq!(
        resolve_data_dir(Platform::Mac, Some(home), None, None).unwrap(),
        home.join("Library/Application Support/Wireboard")
    );
    assert_eq!(
        resolve_data_dir(Platform::Linux, Some(home), None, None).unwrap(),
        home.join(".local/share/wireboard")
    );
    assert_eq!(
        resolve_data_dir(
            Platform::Linux,
            Some(home),
            None,
            Some(Path::new("relative"))
        )
        .unwrap(),
        home.join(".local/share/wireboard")
    );
    assert_eq!(
        resolve_data_dir(Platform::Windows, None, Some(Path::new("local")), None).unwrap(),
        Path::new("local/Wireboard")
    );
}
#[test]
fn runtime_is_written_and_replaced_privately() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("runtime.json");
    write_private_runtime(&path, b"first").unwrap();
    write_private_runtime(&path, b"second").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"second");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

#[test]
fn cross_runtime_lease_never_expires_a_potentially_live_writer() {
    let dir = tempfile::tempdir().unwrap();
    let lease = dir.path().join(".library-lock");
    std::fs::create_dir(&lease).unwrap();
    let heartbeat = lease.join("owner");
    std::fs::write(&heartbeat, "other-runtime").unwrap();
    assert!(
        wireboard::store::Store::open(dir.path()).is_err(),
        "A live lease blocks even when OS advisory file locks are free"
    );
    std::fs::OpenOptions::new()
        .write(true)
        .open(&heartbeat)
        .unwrap()
        .set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(120))
        .unwrap();
    assert!(
        wireboard::store::Store::open(dir.path()).is_err(),
        "Age cannot prove a runtime has stopped"
    );
    std::fs::remove_file(&heartbeat).unwrap();
    std::fs::remove_dir(&lease).unwrap();
    let mut store = wireboard::store::Store::open(dir.path()).unwrap();
    store.create("Recovered").unwrap();
    drop(store);
    assert!(!lease.exists(), "Normal shutdown releases the lease");
}

#[test]
fn lost_lease_freezes_writes_instead_of_overwriting_another_runtime() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = wireboard::store::Store::open(dir.path()).unwrap();
    std::fs::write(dir.path().join(".library-lock/owner"), "replacement-owner").unwrap();
    assert!(store.create("Must not save").is_err());
    assert_eq!(
        std::fs::read_dir(dir.path().join("boards"))
            .unwrap()
            .count(),
        0
    );
}

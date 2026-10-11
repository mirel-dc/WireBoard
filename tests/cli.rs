use serde_json::{Value, json};
use wireboard::{
    api::{ApiState, router},
    platform,
    store::Store,
};
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_changes_server_and_exports_real_files() {
    let dir = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let state = ApiState::new(
        Store::open(dir.path()).unwrap(),
        format!("http://{addr}"),
        "secret".into(),
    );
    let task = tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
    platform::write_private_runtime(
        &dir.path().join("runtime.json"),
        &serde_json::to_vec(
            &json!({"endpoint":format!("http://{addr}"),"token":"secret","pid":std::process::id()}),
        )
        .unwrap(),
    )
    .unwrap();
    let exe = env!("CARGO_BIN_EXE_wireboard");
    let output = tokio::process::Command::new(exe)
        .arg("--data-dir")
        .arg(dir.path())
        .args(["create", "--title", "Из CLI"])
        .output()
        .await
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let board: Value = serde_json::from_slice(&output.stdout).unwrap();
    let id = board["id"].as_str().expect("CLI must return real board ID");
    let ops = dir.path().join("ops.json");
    std::fs::write(
        &ops,
        serde_json::to_vec(
            &json!([{"op":"create","element":{"kind":"rectangle","text":"Привет CLI"}}]),
        )
        .unwrap(),
    )
    .unwrap();
    let output = tokio::process::Command::new(exe)
        .arg("--data-dir")
        .arg(dir.path())
        .args(["apply", id, "--revision", "0", "--file"])
        .arg(&ops)
        .output()
        .await
        .unwrap();
    assert!(output.status.success());
    let stale = tokio::process::Command::new(exe)
        .arg("--data-dir")
        .arg(dir.path())
        .args(["apply", id, "--revision", "0", "--file"])
        .arg(&ops)
        .output()
        .await
        .unwrap();
    assert!(!stale.status.success());
    assert!(String::from_utf8_lossy(&stale.stderr).contains("conflict"));
    let path = dir.path().join("result.svg");
    let output = tokio::process::Command::new(exe)
        .arg("--data-dir")
        .arg(dir.path())
        .args(["render", id, "--output"])
        .arg(&path)
        .output()
        .await
        .unwrap();
    assert!(output.status.success());
    assert!(
        std::fs::read_to_string(path)
            .unwrap()
            .contains("Привет CLI")
    );
    let command_id = uuid::Uuid::new_v4().to_string();
    for _ in 0..2 {
        let result = tokio::process::Command::new(exe)
            .arg("--data-dir")
            .arg(dir.path())
            .args(["apply", id, "--revision", "1", "--file"])
            .arg(&ops)
            .args([
                "--command-id",
                &command_id,
                "--actor-id",
                "cli-user",
                "--author",
                "user",
            ])
            .output()
            .await
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let b: Value = serde_json::from_slice(&result.stdout).unwrap();
        assert_eq!(b["revision"], 2);
        assert_eq!(b["elements"].as_array().unwrap().len(), 2);
    }
    let receipt = tokio::process::Command::new(exe)
        .arg("--data-dir")
        .arg(dir.path())
        .args(["command", id, &command_id])
        .output()
        .await
        .unwrap();
    assert!(receipt.status.success());
    let r: Value = serde_json::from_slice(&receipt.stdout).unwrap();
    assert_eq!(r["committedRevision"], 2);
    assert_eq!(
        std::fs::read_dir(dir.path().join("requests"))
            .unwrap()
            .count(),
        1
    );
    let undo_id = uuid::Uuid::new_v4().to_string();
    let undo = tokio::process::Command::new(exe)
        .arg("--data-dir")
        .arg(dir.path())
        .args([
            "history",
            id,
            "--revision",
            "2",
            "--direction",
            "undo",
            "--target-command-id",
            &command_id,
            "--command-id",
            &undo_id,
            "--actor-id",
            "cli-user",
        ])
        .output()
        .await
        .unwrap();
    assert!(
        undo.status.success(),
        "{}",
        String::from_utf8_lossy(&undo.stderr)
    );
    let b: Value = serde_json::from_slice(&undo.stdout).unwrap();
    assert_eq!(b["elements"].as_array().unwrap().len(), 1);
    assert_eq!(b["elements"][0]["id"], 1);
    task.abort();
}

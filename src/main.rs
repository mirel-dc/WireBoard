#[tokio::main]
async fn main() {
    if let Err(error) = wireboard::cli::run().await {
        eprintln!(
            "{}",
            serde_json::to_string(&error).unwrap_or_else(|_| "CLI error".into())
        );
        std::process::exit(1);
    }
}

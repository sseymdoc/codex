use std::time::Duration;

use anyhow::Result;
use app_test_support::TestAppServer;
use app_test_support::to_response;
use codex_app_server_protocol::ClientInfo;
use codex_app_server_protocol::EnvironmentAddStdioResponse;
use codex_app_server_protocol::EnvironmentReadDirectoryResponse;
use codex_app_server_protocol::EnvironmentStatusKind;
use codex_app_server_protocol::EnvironmentStatusResponse;
use codex_app_server_protocol::FsReadDirectoryEntry;
use codex_app_server_protocol::InitializeResponse;
use codex_app_server_protocol::JSONRPCError;
use codex_app_server_protocol::JSONRPCMessage;
use codex_app_server_protocol::RequestId;
use pretty_assertions::assert_eq;
use serde::de::DeserializeOwned;
use serde_json::Value;
use serde_json::json;
use tempfile::TempDir;
use tokio::time::timeout;

const RPC_TIMEOUT: Duration = Duration::from_secs(10);
/// Never started: registering a stdio environment does not connect it.
const PROGRAM: &str = "codex-ui-test-missing-ssh";

async fn server(gate: Option<&str>) -> Result<(TestAppServer, InitializeResponse, TempDir)> {
    let home = TempDir::new()?;
    let mut app_server = TestAppServer::builder()
        .with_codex_home(home.path())
        .without_auto_env()
        .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", gate)])
        .build()
        .await?;
    let message = timeout(
        RPC_TIMEOUT,
        app_server.initialize_with_client_info(ClientInfo {
            name: "codex_ui".to_string(),
            title: None,
            version: "0.1.0".to_string(),
        }),
    )
    .await??;
    let JSONRPCMessage::Response(response) = message else {
        anyhow::bail!("expected initialize response, got {message:?}");
    };
    Ok((app_server, to_response(response)?, home))
}

async fn ok<T: DeserializeOwned>(
    app_server: &mut TestAppServer,
    method: &str,
    params: Value,
) -> Result<T> {
    let id = RequestId::Integer(app_server.send_raw_request(method, Some(params)).await?);
    to_response(
        timeout(
            RPC_TIMEOUT,
            app_server.read_stream_until_response_message(id),
        )
        .await??,
    )
}

async fn err(app_server: &mut TestAppServer, method: &str, params: Value) -> Result<JSONRPCError> {
    let id = RequestId::Integer(app_server.send_raw_request(method, Some(params)).await?);
    Ok(timeout(RPC_TIMEOUT, app_server.read_stream_until_error_message(id)).await??)
}

#[tokio::test]
async fn stdio_environments_need_the_codex_ui_experimental_backend() -> Result<()> {
    for gate in [None, Some("0")] {
        let (mut app_server, initialize, _home) = server(gate).await?;
        assert_eq!(initialize.codex_ui_stdio_environments, None);
        for (method, params) in [
            (
                "environment/addStdio",
                json!({"environmentId": "ssh-a", "program": PROGRAM, "args": ["host"]}),
            ),
            (
                "environment/readDirectory",
                json!({"environmentId": "local", "path": "/"}),
            ),
        ] {
            let error = err(&mut app_server, method, params).await?;
            assert_eq!(
                error.error.message,
                format!("{method} requires the Codex UI experimental backend")
            );
        }
        let status: EnvironmentStatusResponse = ok(
            &mut app_server,
            "environment/status",
            json!({"environmentId": "ssh-a"}),
        )
        .await?;
        assert_eq!(status.status, EnvironmentStatusKind::Unknown);
    }
    Ok(())
}

#[tokio::test]
async fn enabled_backend_registers_stdio_environments_and_lists_directories() -> Result<()> {
    let (mut app_server, initialize, _home) = server(Some("1")).await?;
    assert_eq!(initialize.codex_ui_stdio_environments, Some(true));

    let _: EnvironmentAddStdioResponse = ok(
        &mut app_server,
        "environment/addStdio",
        json!({
            "environmentId": "ssh-a",
            "program": PROGRAM,
            "args": ["-o", "BatchMode=yes", "host", "codex exec-server --listen stdio"],
        }),
    )
    .await?;
    let status: EnvironmentStatusResponse = ok(
        &mut app_server,
        "environment/status",
        json!({"environmentId": "ssh-a"}),
    )
    .await?;
    assert_ne!(status.status, EnvironmentStatusKind::Unknown);

    let error = err(
        &mut app_server,
        "environment/addStdio",
        json!({"environmentId": "ssh-b", "program": " ", "args": []}),
    )
    .await?;
    assert_eq!(
        error.error.message,
        "exec-server protocol error: stdio environment program cannot be empty"
    );

    let folder = TempDir::new()?;
    std::fs::create_dir(folder.path().join("src"))?;
    std::fs::write(folder.path().join("README.md"), "readme")?;
    let listing: EnvironmentReadDirectoryResponse = ok(
        &mut app_server,
        "environment/readDirectory",
        json!({"environmentId": "local", "path": folder.path()}),
    )
    .await?;
    let mut entries = listing.entries;
    entries.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    assert_eq!(
        entries,
        vec![
            FsReadDirectoryEntry {
                file_name: "README.md".to_string(),
                is_directory: false,
                is_file: true,
            },
            FsReadDirectoryEntry {
                file_name: "src".to_string(),
                is_directory: true,
                is_file: false,
            },
        ]
    );

    let error = err(
        &mut app_server,
        "environment/readDirectory",
        json!({"environmentId": "missing", "path": folder.path()}),
    )
    .await?;
    assert_eq!(error.error.message, "unknown environment id `missing`");
    Ok(())
}

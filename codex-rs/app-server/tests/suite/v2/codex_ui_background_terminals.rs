use std::time::Duration;

use anyhow::Result;
use app_test_support::MockResponsesConfig;
use app_test_support::TestAppServer;
use app_test_support::create_final_assistant_message_sse_response;
use app_test_support::create_mock_responses_server_sequence;
use app_test_support::to_response;
use codex_app_server_protocol::ClientInfo;
use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::InitializeResponse;
use codex_app_server_protocol::ItemCompletedNotification;
use codex_app_server_protocol::ItemStartedNotification;
use codex_app_server_protocol::JSONRPCMessage;
use codex_app_server_protocol::JSONRPCNotification;
use codex_app_server_protocol::RequestId;
use codex_app_server_protocol::ThreadBackgroundTerminalsBackgroundResponse;
use codex_app_server_protocol::ThreadItem;
use codex_app_server_protocol::ThreadStartParams;
use codex_app_server_protocol::ThreadStartResponse;
use codex_app_server_protocol::TurnStartParams;
use codex_app_server_protocol::TurnStartResponse;
use codex_app_server_protocol::UserInput as V2UserInput;
use codex_features::Feature;
use core_test_support::responses;
use pretty_assertions::assert_eq;
use serde_json::json;
use tempfile::TempDir;
use tokio::time::timeout;

const METHOD: &str = "thread/backgroundTerminals/background";
const RPC_TIMEOUT: Duration = Duration::from_secs(10);
/// Well under the command's 30s yield: only an early yield completes the turn in time.
const TURN_TIMEOUT: Duration = Duration::from_secs(20);

async fn initialize(app_server: &mut TestAppServer) -> Result<InitializeResponse> {
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
    to_response(response)
}

async fn background(
    app_server: &mut TestAppServer,
    thread_id: &str,
    process_id: &str,
) -> Result<bool> {
    let id = app_server
        .send_raw_request(
            METHOD,
            Some(json!({"threadId": thread_id, "processId": process_id})),
        )
        .await?;
    let response: ThreadBackgroundTerminalsBackgroundResponse =
        timeout(RPC_TIMEOUT, app_server.read_response(id)).await??;
    Ok(response.backgrounded)
}

fn command_item(notification: &JSONRPCNotification) -> Option<ThreadItem> {
    let item = notification.params.as_ref()?.get("item")?.clone();
    serde_json::from_value(item)
        .ok()
        .filter(|item| matches!(item, ThreadItem::CommandExecution { .. }))
}

#[tokio::test]
async fn background_terminals_rpc_needs_the_codex_ui_experimental_backend() -> Result<()> {
    for gate in [None, Some("0")] {
        let home = TempDir::new()?;
        let mut app_server = TestAppServer::builder()
            .with_codex_home(home.path())
            .without_auto_env()
            .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", gate)])
            .build()
            .await?;
        let initialize = initialize(&mut app_server).await?;
        assert_eq!(initialize.codex_ui_background_terminals, None);

        let id = app_server
            .send_raw_request(
                METHOD,
                Some(json!({"threadId": "thr_missing", "processId": "1"})),
            )
            .await?;
        let error = timeout(
            RPC_TIMEOUT,
            app_server.read_stream_until_error_message(RequestId::Integer(id)),
        )
        .await??;
        assert_eq!(
            error.error.message,
            format!("{METHOD} requires the Codex UI experimental backend")
        );
    }
    Ok(())
}

#[tokio::test]
async fn background_terminals_rpc_backgrounds_a_waiting_command() -> Result<()> {
    let work = TempDir::new()?;
    let gate = work.path().join("release-gated-command");
    let script = work.path().join("gated-command.py");
    std::fs::write(
        &script,
        format!(
            "from pathlib import Path\nimport time\nwhile not Path(r'{}').exists(): time.sleep(0.01)\nprint('GATED-COMMAND-DONE')\n",
            gate.display()
        ),
    )?;
    let python = if cfg!(windows) { "python" } else { "python3" };
    let args = json!({
        "cmd": format!("{python} \"{}\"", script.display()),
        "yield_time_ms": 30_000,
    });
    let server = create_mock_responses_server_sequence(vec![
        responses::sse(vec![
            responses::ev_response_created("command"),
            responses::ev_function_call("gated-command", "exec_command", &args.to_string()),
            responses::ev_completed("command"),
        ]),
        create_final_assistant_message_sse_response("done")?,
    ])
    .await;
    let home = TempDir::new()?;
    MockResponsesConfig::new(&server.uri())
        .with_sandbox_mode("danger-full-access")
        .enable_feature(Feature::UnifiedExec)
        .disable_feature(Feature::ShellSnapshot)
        .write(home.path())?;
    let mut mcp = TestAppServer::builder()
        .with_codex_home(home.path())
        .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", Some("1"))])
        .build()
        .await?;
    let initialize = initialize(&mut mcp).await?;
    assert_eq!(initialize.codex_ui_background_terminals, Some(true));

    let ThreadStartResponse { thread, .. } = mcp
        .start_thread(ThreadStartParams {
            model: Some("mock-model".to_string()),
            ..Default::default()
        })
        .await?;
    let _: TurnStartResponse = mcp
        .request(|request_id| ClientRequest::TurnStart {
            request_id,
            params: TurnStartParams {
                thread_id: thread.id.clone(),
                input: vec![V2UserInput::Text {
                    text: "run a long command".to_string(),
                    text_elements: Vec::new(),
                }],
                sandbox_policy: Some(codex_app_server_protocol::SandboxPolicy::DangerFullAccess),
                ..Default::default()
            },
        })
        .await?;

    let started = timeout(RPC_TIMEOUT, async {
        loop {
            let started: ItemStartedNotification = mcp.read_notification("item/started").await?;
            if let ThreadItem::CommandExecution { .. } = started.item {
                return Ok::<ThreadItem, anyhow::Error>(started.item);
            }
        }
    })
    .await??;
    let ThreadItem::CommandExecution {
        process_id: Some(process_id),
        backgrounded: Some(false),
        ..
    } = started
    else {
        anyhow::bail!("expected a waiting experimental command, got {started:?}");
    };

    // The tool call starts waiting on the process shortly after the item starts.
    timeout(RPC_TIMEOUT, async {
        while !background(&mut mcp, &thread.id, &process_id).await? {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        Ok::<(), anyhow::Error>(())
    })
    .await??;

    timeout(
        TURN_TIMEOUT,
        mcp.read_stream_until_matching_notification("backgrounded command", |notification| {
            notification.method == "item/started"
                && matches!(
                    command_item(notification),
                    Some(ThreadItem::CommandExecution {
                        backgrounded: Some(true),
                        ..
                    })
                )
        }),
    )
    .await??;
    timeout(
        TURN_TIMEOUT,
        mcp.read_stream_until_notification_message("turn/completed"),
    )
    .await??;
    assert!(
        !background(&mut mcp, &thread.id, &process_id).await?,
        "nothing waits on a backgrounded command"
    );

    std::fs::write(&gate, "release")?;
    let completed = timeout(TURN_TIMEOUT, async {
        loop {
            let completed: ItemCompletedNotification =
                mcp.read_notification("item/completed").await?;
            if let ThreadItem::CommandExecution { .. } = completed.item {
                return Ok::<ThreadItem, anyhow::Error>(completed.item);
            }
        }
    })
    .await??;
    let ThreadItem::CommandExecution {
        backgrounded,
        aggregated_output,
        ..
    } = completed
    else {
        unreachable!("loop returns command items");
    };
    assert_eq!(backgrounded, Some(true));
    assert!(
        aggregated_output
            .unwrap_or_default()
            .contains("GATED-COMMAND-DONE")
    );
    Ok(())
}

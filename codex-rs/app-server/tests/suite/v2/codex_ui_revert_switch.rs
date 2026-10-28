use std::time::Duration;

use anyhow::Result;
use app_test_support::MockResponsesConfig;
use app_test_support::TestAppServer;
use app_test_support::to_response;
use codex_app_server_protocol::ClientInfo;
use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::InitializeCapabilities;
use codex_app_server_protocol::InitializeResponse;
use codex_app_server_protocol::JSONRPCMessage;
use codex_app_server_protocol::RequestId;
use codex_app_server_protocol::SortDirection;
use codex_app_server_protocol::ThreadHistoryMode;
use codex_app_server_protocol::ThreadRevertParams;
use codex_app_server_protocol::ThreadRevertResponse;
use codex_app_server_protocol::ThreadRevertSwitchResponse;
use codex_app_server_protocol::ThreadRevertedNotification;
use codex_app_server_protocol::ThreadStartParams;
use codex_app_server_protocol::ThreadStartResponse;
use codex_app_server_protocol::ThreadTurnsListParams;
use codex_app_server_protocol::ThreadTurnsListResponse;
use codex_app_server_protocol::TurnStartParams;
use codex_app_server_protocol::UserInput;
use core_test_support::responses;
use pretty_assertions::assert_eq;
use serde_json::json;
use tempfile::TempDir;
use tokio::time::timeout;

const METHOD: &str = "thread/revert/switch";
const RPC_TIMEOUT: Duration = Duration::from_secs(10);

async fn initialize(app_server: &mut TestAppServer) -> Result<InitializeResponse> {
    let message = timeout(
        RPC_TIMEOUT,
        app_server.initialize_with_capabilities(
            ClientInfo {
                name: "codex_ui".to_string(),
                title: None,
                version: "0.1.0".to_string(),
            },
            Some(InitializeCapabilities {
                explicit_gateway_oauth: false,
                experimental_api: true,
                request_attestation: false,
                opt_out_notification_methods: None,
                mcp_server_openai_form_elicitation: false,
                extensions: None,
            }),
        ),
    )
    .await??;
    let JSONRPCMessage::Response(response) = message else {
        anyhow::bail!("expected initialize response, got {message:?}");
    };
    to_response(response)
}

async fn switch(app_server: &mut TestAppServer, thread_id: &str, direction: &str) -> Result<bool> {
    let id = app_server
        .send_raw_request(
            METHOD,
            Some(json!({"threadId": thread_id, "direction": direction})),
        )
        .await?;
    let response: ThreadRevertSwitchResponse =
        timeout(RPC_TIMEOUT, app_server.read_response(id)).await??;
    if response.switched {
        let reverted: ThreadRevertedNotification =
            timeout(RPC_TIMEOUT, app_server.read_notification("thread/reverted")).await??;
        assert_eq!(reverted.thread_id, thread_id);
    }
    Ok(response.switched)
}

async fn turn_ids(app_server: &mut TestAppServer, thread_id: &str) -> Result<Vec<String>> {
    let ThreadTurnsListResponse { data, .. } = app_server
        .request(|request_id| ClientRequest::ThreadTurnsList {
            request_id,
            params: ThreadTurnsListParams {
                thread_id: thread_id.to_string(),
                cursor: None,
                limit: None,
                sort_direction: Some(SortDirection::Asc),
                items_view: None,
            },
        })
        .await?;
    Ok(data.into_iter().map(|turn| turn.id).collect())
}

async fn run_turn(app_server: &mut TestAppServer, thread_id: &str, text: &str) -> Result<String> {
    let completed = app_server
        .start_turn_and_wait_for_completion(TurnStartParams {
            thread_id: thread_id.to_string(),
            input: vec![UserInput::Text {
                text: text.to_string(),
                text_elements: Vec::new(),
            }],
            ..Default::default()
        })
        .await?;
    Ok(completed.turn.id)
}

#[tokio::test]
async fn revert_switch_needs_the_codex_ui_experimental_backend() -> Result<()> {
    for gate in [None, Some("0")] {
        let home = TempDir::new()?;
        let mut app_server = TestAppServer::builder()
            .with_codex_home(home.path())
            .without_auto_env()
            .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", gate)])
            .build()
            .await?;
        let initialize = initialize(&mut app_server).await?;
        assert_eq!(initialize.codex_ui_revert_switch, None);

        let id = app_server
            .send_raw_request(
                METHOD,
                Some(json!({"threadId": "thr_missing", "direction": "undo"})),
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
async fn revert_switch_undoes_and_redoes_until_a_turn_runs() -> Result<()> {
    let server = responses::start_mock_server().await;
    responses::mount_sse_sequence(&server, vec![responses::sse_completed("done"); 3]).await;
    let home = TempDir::new()?;
    MockResponsesConfig::new(&server.uri()).write(home.path())?;
    let mut app_server = TestAppServer::builder()
        .with_codex_home(home.path())
        .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", Some("1"))])
        .build()
        .await?;
    let initialize = initialize(&mut app_server).await?;
    assert_eq!(initialize.codex_ui_revert_switch, Some(true));

    let ThreadStartResponse { thread, .. } = app_server
        .start_thread(ThreadStartParams {
            history_mode: Some(ThreadHistoryMode::Paginated),
            ..Default::default()
        })
        .await?;
    // Nothing to undo before a revert.
    assert!(!switch(&mut app_server, &thread.id, "undo").await?);
    let first = run_turn(&mut app_server, &thread.id, "first").await?;
    let second = run_turn(&mut app_server, &thread.id, "second").await?;

    let _: ThreadRevertResponse = app_server
        .request(|request_id| ClientRequest::ThreadRevert {
            request_id,
            params: ThreadRevertParams {
                thread_id: thread.id.clone(),
                before_turn_id: second.clone(),
            },
        })
        .await?;
    let _: ThreadRevertedNotification =
        timeout(RPC_TIMEOUT, app_server.read_notification("thread/reverted")).await??;
    assert_eq!(
        turn_ids(&mut app_server, &thread.id).await?,
        vec![first.clone()]
    );

    // Redo needs an undo first; undo brings the removed turn back, redo removes it again.
    assert!(!switch(&mut app_server, &thread.id, "redo").await?);
    assert!(switch(&mut app_server, &thread.id, "undo").await?);
    assert_eq!(
        turn_ids(&mut app_server, &thread.id).await?,
        vec![first.clone(), second.clone()]
    );
    assert!(!switch(&mut app_server, &thread.id, "undo").await?);
    assert!(switch(&mut app_server, &thread.id, "redo").await?);
    assert_eq!(
        turn_ids(&mut app_server, &thread.id).await?,
        vec![first.clone()]
    );
    assert!(switch(&mut app_server, &thread.id, "undo").await?);

    // A turn run since retires the mark: redo would drop it.
    let third = run_turn(&mut app_server, &thread.id, "third").await?;
    assert!(!switch(&mut app_server, &thread.id, "redo").await?);
    assert_eq!(
        turn_ids(&mut app_server, &thread.id).await?,
        vec![first, second, third]
    );
    Ok(())
}

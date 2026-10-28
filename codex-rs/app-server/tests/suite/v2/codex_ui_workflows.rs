use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

use anyhow::Result;
use app_test_support::MockResponsesConfig;
use app_test_support::TestAppServer;
use app_test_support::to_response;
use codex_app_server_protocol::ClientInfo;
use codex_app_server_protocol::InitializeResponse;
use codex_app_server_protocol::JSONRPCMessage;
use codex_app_server_protocol::RequestId;
use codex_app_server_protocol::ServerRequest;
use codex_app_server_protocol::ThreadItem;
use codex_app_server_protocol::ThreadStartParams;
use codex_app_server_protocol::ThreadStartResponse;
use codex_app_server_protocol::ThreadWorkflowsListResponse;
use codex_app_server_protocol::ThreadWorkflowsStopResponse;
use codex_app_server_protocol::TurnStartParams;
use codex_app_server_protocol::TurnStartResponse;
use codex_app_server_protocol::UserInput as V2UserInput;
use codex_app_server_protocol::WorkflowAgentState;
use codex_app_server_protocol::WorkflowItem;
use codex_app_server_protocol::WorkflowStatus;
use core_test_support::responses;
use pretty_assertions::assert_eq;
use serde_json::Value;
use serde_json::json;
use tempfile::TempDir;
use tokio::time::timeout;
use wiremock::Mock;
use wiremock::Request;
use wiremock::Respond;
use wiremock::ResponseTemplate;
use wiremock::matchers::method;
use wiremock::matchers::path_regex;

const RPC_TIMEOUT: Duration = Duration::from_secs(10);
const RUN_TIMEOUT: Duration = Duration::from_secs(60);
const SUBAGENT_MARKER: &str = "You are a sub-agent started by a dynamic workflow script";
/// Opening of the <workflow_result> fragment (the tag itself also appears in the tool description).
const RESULT_MARKER: &str = "A dynamic workflow you started has ended";

const SCRIPT: &str = "export const meta = {\n  name: 'probe',\n  description: 'Probe two agents',\n  phases: [{ title: 'Ask' }],\n};\nphase('Ask');\nconst answers = await parallel([\n  () => agent('AGENT-TASK-ALPHA', { label: 'alpha' }),\n  () => agent('AGENT-TASK-BETA', { label: 'beta' }),\n]);\nlog('asked');\nreturn { answers };\n";

const SLOW_SCRIPT: &str = "export const meta = { name: 'slow', description: 'One slow agent' };\nreturn await agent('AGENT-TASK-SLOW', { label: 'slow' });\n";

/// Routes model requests by content: the parent's first request, its follow-up after the tool
/// call, the wake-up turn carrying the result, and each sub-agent.
struct Router {
    script: &'static str,
    bodies: Arc<Mutex<Vec<String>>>,
}

impl Respond for Router {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let body = String::from_utf8_lossy(&request.body).into_owned();
        self.bodies.lock().expect("bodies").push(body.clone());
        let message = |text: &str| {
            responses::sse(vec![
                responses::ev_response_created("r"),
                responses::ev_assistant_message("m", text),
                responses::ev_completed("r"),
            ])
        };
        let sse = if body.contains(SUBAGENT_MARKER) {
            if body.contains("AGENT-TASK-SLOW") {
                return ResponseTemplate::new(200)
                    .insert_header("content-type", "text/event-stream")
                    .set_body_string(message("slow-result"))
                    .set_delay(Duration::from_secs(30));
            }
            message(if body.contains("AGENT-TASK-ALPHA") {
                "alpha-result"
            } else {
                "beta-result"
            })
        } else if body.contains(RESULT_MARKER) {
            message("parent-done")
        } else if body.contains("function_call_output") {
            message("launched")
        } else {
            let args = json!({ "script": self.script }).to_string();
            responses::sse(vec![
                responses::ev_response_created("r"),
                responses::ev_function_call("wf-call", "workflow", &args),
                responses::ev_completed("r"),
            ])
        };
        ResponseTemplate::new(200)
            .insert_header("content-type", "text/event-stream")
            .set_body_string(sse)
    }
}

async fn mock_server(script: &'static str) -> (wiremock::MockServer, Arc<Mutex<Vec<String>>>) {
    let server = responses::start_mock_server().await;
    let bodies = Arc::new(Mutex::new(Vec::new()));
    Mock::given(method("POST"))
        .and(path_regex(".*/responses$"))
        .respond_with(Router {
            script,
            bodies: Arc::clone(&bodies),
        })
        .mount(&server)
        .await;
    (server, bodies)
}

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

fn host_context(cwd: &Value, workflows: bool) -> Value {
    json!({
        "cwd": cwd,
        "planning": { "enabled": false, "text": "HOST_PLAN_ENABLED", "disabledText": "HOST_PLAN_REVOKED" },
        "browserVerification": { "toolsEnabled": false, "autoVerify": false,
            "text": "HOST_BROWSER_ENABLED", "disabledText": "HOST_BROWSER_REVOKED", "editReminder": "HOST_VERIFY_EDIT" },
        "workflows": { "enabled": workflows, "ultracode": true,
            "ultracodeText": "HOST_ULTRACODE_ON", "ultracodeDisabledText": "HOST_ULTRACODE_OFF" }
    })
}

/// Starts a thread on the experimental backend with the workflow setting as given.
async fn start(
    script: &'static str,
    approval: &str,
    workflows: bool,
) -> Result<(
    TestAppServer,
    String,
    Arc<Mutex<Vec<String>>>,
    TempDir,
    wiremock::MockServer,
)> {
    let (server, bodies) = mock_server(script).await;
    let home = TempDir::new()?;
    MockResponsesConfig::new(&server.uri())
        .with_approval_policy(approval)
        .with_sandbox_mode("danger-full-access")
        .write(home.path())?;
    let mut mcp = TestAppServer::builder()
        .with_codex_home(home.path())
        .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", Some("1"))])
        .build()
        .await?;
    let initialize = initialize(&mut mcp).await?;
    assert_eq!(initialize.codex_ui_workflows, Some(true));
    let ThreadStartResponse { thread, cwd, .. } = mcp
        .start_thread(ThreadStartParams {
            model: Some("mock-model".to_string()),
            ..Default::default()
        })
        .await?;
    let request = mcp
        .send_raw_request(
            "thread/settings/update",
            Some(json!({"threadId": thread.id, "codexUiContext": host_context(&json!(cwd), workflows)})),
        )
        .await?;
    let _: Value = timeout(RPC_TIMEOUT, mcp.read_response(request)).await??;
    Ok((mcp, thread.id, bodies, home, server))
}

async fn start_turn(mcp: &mut TestAppServer, thread_id: &str) -> Result<()> {
    let _: TurnStartResponse = mcp
        .request(
            |request_id| codex_app_server_protocol::ClientRequest::TurnStart {
                request_id,
                params: TurnStartParams {
                    thread_id: thread_id.to_string(),
                    input: vec![V2UserInput::Text {
                        text: "please run the workflow".to_string(),
                        text_elements: Vec::new(),
                    }],
                    ..Default::default()
                },
            },
        )
        .await?;
    Ok(())
}

fn workflow_item(message: &JSONRPCMessage, method: &str) -> Option<WorkflowItem> {
    let JSONRPCMessage::Notification(notification) = message else {
        return None;
    };
    if notification.method != method {
        return None;
    }
    let item = notification.params.as_ref()?.get("item")?.clone();
    match serde_json::from_value(item).ok()? {
        ThreadItem::Workflow(item) => Some(item),
        _ => None,
    }
}

fn tool_names(body: &str) -> Vec<String> {
    let body: Value = serde_json::from_str(body).unwrap_or_default();
    body["tools"]
        .as_array()
        .map(|tools| {
            tools
                .iter()
                .filter_map(|tool| tool["name"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

#[tokio::test]
async fn workflows_need_the_codex_ui_experimental_backend() -> Result<()> {
    for gate in [None, Some("0")] {
        let home = TempDir::new()?;
        let mut app_server = TestAppServer::builder()
            .with_codex_home(home.path())
            .without_auto_env()
            .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", gate)])
            .build()
            .await?;
        let initialize = initialize(&mut app_server).await?;
        assert_eq!(initialize.codex_ui_workflows, None);
        for (method, params) in [
            (
                "thread/workflows/stop",
                json!({"threadId": "thr_missing", "runId": "wf_abc123def456"}),
            ),
            ("thread/workflows/list", json!({"threadId": "thr_missing"})),
        ] {
            let id = app_server.send_raw_request(method, Some(params)).await?;
            let error = timeout(
                RPC_TIMEOUT,
                app_server.read_stream_until_error_message(RequestId::Integer(id)),
            )
            .await??;
            assert_eq!(
                error.error.message,
                format!("{method} requires the Codex UI experimental backend")
            );
        }
    }
    Ok(())
}

#[tokio::test]
async fn workflow_tool_follows_the_host_setting() -> Result<()> {
    let (mut mcp, thread_id, bodies, _home, _server) = start(SCRIPT, "never", false).await?;
    start_turn(&mut mcp, &thread_id).await?;
    timeout(
        RUN_TIMEOUT,
        mcp.read_stream_until_notification_message("turn/completed"),
    )
    .await??;
    let first = bodies.lock().expect("bodies")[0].clone();
    assert!(!tool_names(&first).contains(&"workflow".to_string()));
    assert!(
        !first.contains("HOST_ULTRACODE_ON"),
        "no Ultracode reminder while workflows are off"
    );
    Ok(())
}

#[tokio::test]
async fn workflow_runs_agents_and_reports_back() -> Result<()> {
    let (mut mcp, thread_id, bodies, _home, _server) = start(SCRIPT, "on-request", true).await?;
    start_turn(&mut mcp, &thread_id).await?;

    // The run asks first, carrying the script for the approval card.
    let request = timeout(RUN_TIMEOUT, mcp.read_stream_until_request_message()).await??;
    let ServerRequest::ToolRequestUserInput { request_id, params } = request else {
        anyhow::bail!("expected the workflow approval question, got {request:?}");
    };
    let question = &params.questions[0];
    assert_eq!(question.id, "codex_ui_workflow_approval:wf-call");
    mcp.send_response(
        request_id,
        json!({"answers": {question.id.clone(): {"answers": ["Run workflow"]}}}),
    )
    .await?;

    let mut pending_seen = false;
    let completed = timeout(RUN_TIMEOUT, async {
        loop {
            let message = mcp.read_next_message().await?;
            if let Some(item) = workflow_item(&message, "item/started")
                && item.status == WorkflowStatus::Pending
            {
                assert_eq!(item.script.as_deref(), Some(SCRIPT));
                pending_seen = true;
            }
            if let Some(item) = workflow_item(&message, "item/completed") {
                return Ok::<WorkflowItem, anyhow::Error>(item);
            }
        }
    })
    .await??;
    assert!(pending_seen, "the pending snapshot reached the client");
    assert_eq!(completed.status, WorkflowStatus::Completed);
    assert_eq!(completed.name, "probe");
    assert_eq!(completed.phases[0].title, "Ask");
    assert_eq!(completed.script, None);
    let mut labels: Vec<(String, WorkflowAgentState, Option<u32>)> = completed
        .agents
        .iter()
        .map(|agent| (agent.label.clone(), agent.state, agent.phase_index))
        .collect();
    labels.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(
        labels,
        vec![
            ("alpha".to_string(), WorkflowAgentState::Done, Some(0)),
            ("beta".to_string(), WorkflowAgentState::Done, Some(0)),
        ]
    );

    // The result wakes the parent with a <workflow_result>.
    timeout(RUN_TIMEOUT, async {
        loop {
            let woke = bodies.lock().expect("bodies").iter().any(|body| {
                body.contains(RESULT_MARKER)
                    && body.contains(r#"{\"answers\":[\"alpha-result\",\"beta-result\"]}"#)
            });
            if woke {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await?;
    let first = bodies.lock().expect("bodies")[0].clone();
    assert!(tool_names(&first).contains(&"workflow".to_string()));
    assert!(first.contains("HOST_ULTRACODE_ON"));
    Ok(())
}

#[tokio::test]
async fn stopped_workflow_ends_without_reporting_back() -> Result<()> {
    let (mut mcp, thread_id, bodies, _home, _server) = start(SLOW_SCRIPT, "never", true).await?;
    start_turn(&mut mcp, &thread_id).await?;
    let running = timeout(RUN_TIMEOUT, async {
        loop {
            let message = mcp.read_next_message().await?;
            if let Some(item) = workflow_item(&message, "item/started")
                && item
                    .agents
                    .iter()
                    .any(|agent| agent.started_at_ms.is_some())
            {
                return Ok::<WorkflowItem, anyhow::Error>(item);
            }
        }
    })
    .await??;

    let id = mcp
        .send_raw_request(
            "thread/workflows/list",
            Some(json!({"threadId": thread_id})),
        )
        .await?;
    let list: ThreadWorkflowsListResponse = timeout(RPC_TIMEOUT, mcp.read_response(id)).await??;
    assert_eq!(list.running, vec![running.run_id.clone()]);

    let id = mcp
        .send_raw_request(
            "thread/workflows/stop",
            Some(json!({"threadId": thread_id, "runId": running.run_id})),
        )
        .await?;
    let stop: ThreadWorkflowsStopResponse = timeout(RPC_TIMEOUT, mcp.read_response(id)).await??;
    assert!(stop.stopped);

    let completed = timeout(RUN_TIMEOUT, async {
        loop {
            let message = mcp.read_next_message().await?;
            if let Some(item) = workflow_item(&message, "item/completed") {
                return Ok::<WorkflowItem, anyhow::Error>(item);
            }
        }
    })
    .await??;
    assert_eq!(completed.status, WorkflowStatus::Stopped);

    let id = mcp
        .send_raw_request(
            "thread/workflows/list",
            Some(json!({"threadId": thread_id})),
        )
        .await?;
    let list: ThreadWorkflowsListResponse = timeout(RPC_TIMEOUT, mcp.read_response(id)).await??;
    assert!(list.running.is_empty());
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        !bodies
            .lock()
            .expect("bodies")
            .iter()
            .any(|body| body.contains(RESULT_MARKER)),
        "a stopped run does not report back"
    );
    Ok(())
}

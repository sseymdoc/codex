//! One live workflow run: the code-mode cell, its host calls and its progress item.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::AtomicU32;
use std::sync::atomic::Ordering;
use std::time::Duration;

use codex_code_mode::CellId;
use codex_code_mode::CodeModeNestedToolCall;
use codex_code_mode::CodeModeSession;
use codex_code_mode::CodeModeSessionDelegate;
use codex_code_mode::CodeModeToolKind;
use codex_code_mode::ExecuteRequest;
use codex_code_mode::NotificationFuture;
use codex_code_mode::RuntimeResponse;
use codex_code_mode::ToolDefinition;
use codex_code_mode::ToolInvocationFuture;
use codex_code_mode::WaitOutcome;
use codex_code_mode::WaitRequest;
use codex_extension_items::ExtensionItem;
use codex_extension_items::workflow::WorkflowAgent;
use codex_extension_items::workflow::WorkflowAgentState;
use codex_extension_items::workflow::WorkflowItem;
use codex_extension_items::workflow::WorkflowPhase;
use codex_extension_items::workflow::WorkflowStatus;
use codex_protocol::ToolName;
use codex_protocol::items::TurnItem;
use serde_json::Value as JsonValue;
use serde_json::json;
use tokio::sync::Notify;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

use super::WorkflowRuns;
use super::agent;
use super::handler;
use super::journal::Journal;
use super::result::WorkflowResult;
use crate::context::ContextualUserFragment;
use crate::session::session::Session;
use crate::session::step_context::StepContext;
use crate::session::turn_context::TurnContext;

const YIELD_MS: u64 = 30_000;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(500);
const RESULT_MAX_CHARS: usize = 8_000;
const FAILURES_MAX_CHARS: usize = 40_000;
const MAX_LOGS: usize = 1_000;
const AGENT_TOOL: &str = "__wf_agent";
const RESULT_TOOL: &str = "__wf_result";
const CHILD_TOOL: &str = "__wf_child";

pub(super) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

pub(super) struct RunState {
    pub(super) session: Arc<Session>,
    pub(super) turn: Arc<TurnContext>,
    pub(super) step: Arc<StepContext>,
    pub(super) item: Mutex<WorkflowItem>,
    dirty: Notify,
    finished: CancellationToken,
    failures: Mutex<Vec<String>>,
    logs: Mutex<Vec<String>>,
    pub(super) semaphore: Arc<Semaphore>,
    pub(super) agents_started: AtomicU32,
    child_runs: Mutex<HashMap<String, u32>>,
    pub(super) journal: Journal,
    pub(super) cancel: CancellationToken,
    pub(super) stopped: Arc<AtomicBool>,
    result: Mutex<Option<Result<JsonValue, String>>>,
    pub(super) run_dir: PathBuf,
}

impl RunState {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn new(
        session: Arc<Session>,
        turn: Arc<TurnContext>,
        step: Arc<StepContext>,
        item: WorkflowItem,
        journal: Journal,
        concurrency: usize,
        cancel: CancellationToken,
        stopped: Arc<AtomicBool>,
        run_dir: PathBuf,
    ) -> Self {
        Self {
            session,
            turn,
            step,
            item: Mutex::new(item),
            dirty: Notify::new(),
            finished: CancellationToken::new(),
            failures: Mutex::new(Vec::new()),
            logs: Mutex::new(Vec::new()),
            semaphore: Arc::new(Semaphore::new(concurrency)),
            agents_started: AtomicU32::new(0),
            child_runs: Mutex::new(HashMap::new()),
            journal,
            cancel,
            stopped,
            result: Mutex::new(None),
            run_dir,
        }
    }

    fn lock_item(&self) -> std::sync::MutexGuard<'_, WorkflowItem> {
        self.item
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub(super) fn snapshot(&self) -> WorkflowItem {
        self.lock_item().clone()
    }

    pub(super) fn update(&self, change: impl FnOnce(&mut WorkflowItem)) {
        {
            let mut item = self.lock_item();
            change(&mut item);
            item.total_tokens = item.agents.iter().filter_map(|agent| agent.tokens).sum();
            item.total_tool_calls = item
                .agents
                .iter()
                .filter_map(|agent| agent.tool_calls)
                .sum();
        }
        self.dirty.notify_one();
    }

    pub(super) fn push_agent(&self, agent: WorkflowAgent) {
        self.update(|item| item.agents.push(agent));
    }

    pub(super) fn update_agent(&self, index: u32, change: impl FnOnce(&mut WorkflowAgent)) {
        self.update(|item| {
            if let Some(agent) = item.agents.iter_mut().find(|agent| agent.index == index) {
                change(agent);
            }
        });
    }

    /// Index of the progress group titled `title`, adding it on first use.
    pub(super) fn phase_index(&self, title: &str, child: bool) -> u32 {
        let mut created = false;
        let index = {
            let mut item = self.lock_item();
            match item.phases.iter().find(|phase| phase.title == title) {
                Some(phase) => phase.index,
                None => {
                    let index = item.phases.len() as u32;
                    item.phases.push(WorkflowPhase {
                        index,
                        title: title.to_string(),
                        detail: None,
                        child: child.then_some(true),
                    });
                    created = true;
                    index
                }
            }
        };
        if created {
            self.dirty.notify_one();
        }
        index
    }

    pub(super) fn fail(&self, message: String) {
        self.failures
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(message);
    }

    fn log(&self, message: String) {
        let mut logs = self
            .logs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if logs.len() >= MAX_LOGS {
            logs.drain(..MAX_LOGS / 2);
        }
        logs.push(message);
    }

    /// Group title for the next nested run of `name` ("▸ name", then "▸ name #2", ...).
    fn child_phase(&self, name: &str) -> String {
        let mut runs = self
            .child_runs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let count = runs.entry(name.to_string()).or_insert(0);
        *count += 1;
        if *count == 1 {
            format!("\u{25B8} {name}")
        } else {
            format!("\u{25B8} {name} #{count}")
        }
    }
}

struct Delegate {
    state: Arc<RunState>,
}

impl CodeModeSessionDelegate for Delegate {
    fn invoke_tool<'a>(
        &'a self,
        invocation: CodeModeNestedToolCall,
        _cancellation_token: CancellationToken,
    ) -> ToolInvocationFuture<'a> {
        Box::pin(async move {
            let input = invocation.input.unwrap_or(JsonValue::Null);
            match invocation.tool_name.name.as_str() {
                AGENT_TOOL => agent::call(&self.state, input).await,
                RESULT_TOOL => {
                    let outcome = match input.get("error").and_then(JsonValue::as_str) {
                        Some(error) => Err(error.to_string()),
                        None => Ok(input.get("value").cloned().unwrap_or(JsonValue::Null)),
                    };
                    *self
                        .state
                        .result
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(outcome);
                    Ok(JsonValue::Null)
                }
                CHILD_TOOL => {
                    let child = handler::resolve_child(&self.state, &input).await?;
                    let phase = self.state.child_phase(&child.name);
                    self.state.phase_index(&phase, true);
                    Ok(json!({ "name": child.name, "body": child.body, "phase": phase }))
                }
                other => Err(format!("unknown workflow host call `{other}`")),
            }
        })
    }

    fn notify<'a>(
        &'a self,
        _call_id: String,
        _cell_id: CellId,
        text: String,
        _cancellation_token: CancellationToken,
    ) -> NotificationFuture<'a> {
        Box::pin(async move {
            let Ok(event) = serde_json::from_str::<JsonValue>(&text) else {
                return Ok(());
            };
            let field = |name: &str| {
                event
                    .get(name)
                    .and_then(JsonValue::as_str)
                    .map(str::to_string)
            };
            match event.get("wf").and_then(JsonValue::as_str) {
                Some("phase") => {
                    if let Some(title) = field("title") {
                        self.state.phase_index(&title, false);
                    }
                }
                Some("log") => self.state.log(field("message").unwrap_or_default()),
                Some("failure") => self.state.fail(field("message").unwrap_or_default()),
                _ => {}
            }
            Ok(())
        })
    }

    fn cell_closed(&self, _cell_id: &CellId) {}
}

fn host_tools() -> Vec<ToolDefinition> {
    [AGENT_TOOL, RESULT_TOOL, CHILD_TOOL]
        .into_iter()
        .map(|name| ToolDefinition {
            name: name.to_string(),
            tool_name: ToolName::plain(name),
            description: String::new(),
            kind: CodeModeToolKind::Function,
            input_schema: None,
            input_schema_max_bytes: None,
            output_schema: None,
        })
        .collect()
}

enum Outcome {
    Completed(JsonValue),
    Failed(String),
    Stopped,
}

/// Runs the script to its end, then reports the run.
pub(super) async fn drive(state: Arc<RunState>, code: Arc<dyn CodeModeSession>, source: String) {
    let progress = tokio::spawn(emit_progress(Arc::clone(&state)));
    let outcome = execute(&state, &code, source).await;
    let outcome = if state.stopped.load(Ordering::Acquire) {
        Outcome::Stopped
    } else {
        outcome
    };
    // Ends agents still running after the script returned or failed.
    state.cancel.cancel();
    state.finished.cancel();
    let _ = progress.await;
    if let Err(error) = code.shutdown().await {
        tracing::debug!(%error, "failed to shut down workflow code-mode session");
    }
    finish(&state, outcome).await;
}

async fn execute(
    state: &Arc<RunState>,
    code: &Arc<dyn CodeModeSession>,
    source: String,
) -> Outcome {
    let tool_call_id = state.lock_item().id.clone();
    let delegate: Arc<dyn CodeModeSessionDelegate> = Arc::new(Delegate {
        state: Arc::clone(state),
    });
    let request = ExecuteRequest {
        tool_call_id,
        enabled_tools: host_tools(),
        source,
        yield_time_ms: Some(YIELD_MS),
        max_output_tokens: None,
    };
    let started = match code.execute(request, delegate, None).await {
        Ok(started) => started,
        Err(error) => return Outcome::Failed(error),
    };
    let cell_id = started.cell_id.clone();
    let mut response = tokio::select! {
        response = started.initial_response() => response,
        () = state.cancel.cancelled() => {
            let _ = code.terminate(cell_id).await;
            return Outcome::Stopped;
        }
    };
    loop {
        match response {
            Ok(RuntimeResponse::Yielded { .. }) => {
                let wait = code.wait(
                    WaitRequest {
                        cell_id: cell_id.clone(),
                        yield_time_ms: YIELD_MS,
                    },
                    None,
                );
                response = tokio::select! {
                    outcome = wait => outcome.map(|outcome| match outcome {
                        WaitOutcome::LiveCell(response) | WaitOutcome::MissingCell(response) => response,
                    }),
                    () = state.cancel.cancelled() => {
                        let _ = code.terminate(cell_id).await;
                        return Outcome::Stopped;
                    }
                };
            }
            Ok(RuntimeResponse::Result { error_text, .. }) => {
                if let Some(error) = error_text {
                    return Outcome::Failed(error);
                }
                return match state
                    .result
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .take()
                {
                    Some(Ok(value)) => Outcome::Completed(value),
                    Some(Err(error)) => Outcome::Failed(error),
                    None => Outcome::Failed("the workflow script ended without a result".into()),
                };
            }
            Ok(RuntimeResponse::Terminated { .. }) => {
                return Outcome::Failed("the workflow script was terminated".into());
            }
            Err(error) => return Outcome::Failed(error),
        }
    }
}

async fn emit_progress(state: Arc<RunState>) {
    loop {
        tokio::select! {
            () = state.dirty.notified() => {}
            () = state.finished.cancelled() => return,
        }
        let item = TurnItem::Extension(ExtensionItem::Workflow(state.snapshot()));
        state
            .session
            .emit_turn_item_started(state.turn.as_ref(), &item)
            .await;
        tokio::select! {
            () = tokio::time::sleep(PROGRESS_INTERVAL) => {}
            () = state.finished.cancelled() => return,
        }
    }
}

async fn finish(state: &Arc<RunState>, outcome: Outcome) {
    let completed_at = now_ms();
    let (status, error, value) = match &outcome {
        Outcome::Completed(value) => (WorkflowStatus::Completed, None, Some(value.clone())),
        Outcome::Failed(error) => (WorkflowStatus::Failed, Some(error.clone()), None),
        Outcome::Stopped => (WorkflowStatus::Stopped, None, None),
    };
    let description = state.lock_item().description.clone();
    let summary = match &outcome {
        Outcome::Completed(_) => format!("Dynamic workflow \"{description}\" completed"),
        Outcome::Failed(error) => format!("Dynamic workflow \"{description}\" failed: {error}"),
        Outcome::Stopped => description.clone(),
    };
    state.update(|item| {
        item.status = status;
        item.completed_at_ms = Some(completed_at);
        item.summary = Some(summary.clone());
        item.error = error.clone();
        if status != WorkflowStatus::Stopped {
            for agent in &mut item.agents {
                if matches!(
                    agent.state,
                    WorkflowAgentState::Start | WorkflowAgentState::Progress
                ) && (agent.started_at_ms.is_some() || agent.tokens.is_some())
                {
                    agent.state = WorkflowAgentState::Error;
                    agent
                        .error
                        .get_or_insert_with(|| "Workflow ended before completion".to_string());
                }
            }
        }
    });
    let item = state.snapshot();
    state
        .session
        .emit_turn_item_completed(
            state.turn.as_ref(),
            TurnItem::Extension(ExtensionItem::Workflow(item.clone())),
        )
        .await;
    let failures = state
        .failures
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    let logs = state
        .logs
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    let output_file = state.run_dir.join("output.json");
    let output = json!({
        "summary": summary,
        "status": status,
        "agentCount": item.agents.len(),
        "logs": logs,
        "failures": failures,
        "result": value,
        "workflow": item,
        "totalTokens": item.total_tokens,
        "totalToolCalls": item.total_tool_calls,
    });
    if let Err(error) = tokio::fs::write(
        &output_file,
        serde_json::to_string_pretty(&output).unwrap_or_default(),
    )
    .await
    {
        tracing::warn!(%error, "failed to write workflow output");
    }
    WorkflowRuns::of(&state.session).remove(&item.run_id);
    if matches!(outcome, Outcome::Stopped) {
        return;
    }
    let report = report(
        &item,
        value.as_ref(),
        &failures,
        &output_file,
        &state.run_dir,
    );
    wake(&state.session, report).await;
}

/// The model-facing summary of a finished run.
fn report(
    item: &WorkflowItem,
    value: Option<&JsonValue>,
    failures: &[String],
    output_file: &std::path::Path,
    run_dir: &std::path::Path,
) -> String {
    let mut out = String::new();
    let status = match item.status {
        WorkflowStatus::Completed => "completed",
        _ => "failed",
    };
    out.push_str(&format!("<run-id>{}</run-id>\n", item.run_id));
    out.push_str(&format!("<status>{status}</status>\n"));
    out.push_str(&format!(
        "<summary>{}</summary>\n",
        item.summary.as_deref().unwrap_or_default()
    ));
    out.push_str(&format!(
        "<output-file>{}</output-file>\n",
        output_file.display()
    ));
    if let Some(value) = value {
        let text = value.to_string();
        let total = text.chars().count();
        let shown: String = text.chars().take(RESULT_MAX_CHARS).collect();
        out.push_str("<result>");
        out.push_str(&shown);
        if total > RESULT_MAX_CHARS {
            out.push_str(&format!(
                "... (truncated {} chars, full result in {})",
                total - RESULT_MAX_CHARS,
                output_file.display()
            ));
        }
        out.push_str("</result>\n");
    }
    if !failures.is_empty() {
        let joined: String = failures
            .join("\n")
            .chars()
            .take(FAILURES_MAX_CHARS)
            .collect();
        out.push_str(&format!("<failures>\n{joined}\n</failures>\n"));
    }
    let script = item.script_path.as_deref().unwrap_or("<script path>");
    out.push_str(&format!(
        "<resume>Journal: {}. If the result is empty or unexpected, read the journal first. To rerun with finished agents answered from it, call the workflow tool with {{\"scriptPath\": \"{script}\", \"resumeFromRunId\": \"{}\"}}.</resume>\n",
        run_dir.join(super::journal::JOURNAL_FILE).display(),
        item.run_id
    ));
    let done = item
        .agents
        .iter()
        .filter(|agent| agent.state == WorkflowAgentState::Done)
        .count();
    let errors = item
        .agents
        .iter()
        .filter(|agent| agent.state == WorkflowAgentState::Error)
        .count();
    let duration = item
        .completed_at_ms
        .map(|end| (end - item.started_at_ms).max(0))
        .unwrap_or_default();
    out.push_str(&format!(
        "<usage><agent_count>{}</agent_count><agents_done>{done}</agents_done><agents_error>{errors}</agents_error><subagent_tokens>{}</subagent_tokens><tool_uses>{}</tool_uses><duration_ms>{duration}</duration_ms></usage>",
        item.agents.len(),
        item.total_tokens,
        item.total_tool_calls
    ));
    out
}

/// Hands the report to the model, starting a turn when the thread is idle.
#[expect(
    clippy::await_holding_invalid_type,
    reason = "holding the active-turn lock keeps the enqueue atomic with turn starts, as for background commands"
)]
async fn wake(session: &Arc<Session>, report: String) {
    if !session.background_wake_allowed().await {
        return;
    }
    // Taken now, not at launch: an interrupted turn must not swallow a long run's result.
    let token = session.input_queue.background_wake_token().await;
    let queued = {
        let _active = session.active_turn.lock().await;
        session
            .input_queue
            .enqueue_background_input(
                &token,
                ContextualUserFragment::into(WorkflowResult(report)).into(),
                || true,
            )
            .await
    };
    if queued {
        session.maybe_start_turn_for_pending_work().await;
    }
}

pub(super) fn live_runs_contains(session: &Session, run_id: &str) -> bool {
    WorkflowRuns::of(session).is_running(run_id)
}

#[cfg(test)]
pub(super) fn report_for_test(item: &WorkflowItem, value: Option<&JsonValue>) -> String {
    report(
        item,
        value,
        &["[a] failed: boom".to_string()],
        std::path::Path::new("out.json"),
        std::path::Path::new("run"),
    )
}

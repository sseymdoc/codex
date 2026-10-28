//! The `workflow` tool: validates and approves a script, then starts its run.

use std::collections::BTreeMap;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use codex_code_mode::CodeModeSession;
use codex_code_mode::CodeModeSessionDelegate;
use codex_code_mode::ExecuteRequest;
use codex_code_mode::FunctionCallOutputContentItem;
use codex_code_mode::NoopCodeModeSessionDelegate;
use codex_code_mode::RuntimeResponse;
use codex_extension_items::ExtensionItem;
use codex_extension_items::workflow::WorkflowItem;
use codex_extension_items::workflow::WorkflowPhase;
use codex_extension_items::workflow::WorkflowStatus;
use codex_protocol::items::TurnItem;
use codex_protocol::protocol::AskForApproval;
use codex_protocol::request_user_input::RequestUserInputArgs;
use codex_protocol::request_user_input::RequestUserInputQuestion;
use codex_protocol::request_user_input::RequestUserInputQuestionOption;
use codex_tools::JsonSchema;
use codex_tools::ResponsesApiTool;
use codex_tools::ToolName;
use codex_tools::ToolSpec;
use serde::Deserialize;
use serde_json::Value as JsonValue;
use tokio_util::sync::CancellationToken;

use super::RunControl;
use super::WorkflowRuns;
use super::journal::Journal;
use super::run;
use super::run::RunState;
use super::run::now_ms;
use super::script;
use crate::function_tool::FunctionCallError;
use crate::session::host_context::workflows_enabled;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolPayload;
use crate::tools::context::boxed_tool_output;
use crate::tools::handlers::parse_arguments;
use crate::tools::registry::CoreToolRuntime;
use crate::tools::registry::ToolExecutor;

pub(crate) const TOOL_NAME: &str = "workflow";
const DESCRIPTION: &str = include_str!("tool_description.md");
const SIZE_GUIDELINE: &str = "\n\nSize guideline for this session: keep workflows under 10 agents. This is a guideline, not a hard limit; follow the user when they ask for more or fewer.";
/// Ceiling on scripts' concurrent `agent()` host calls, below the host's pending-call limit.
const MAX_IN_FLIGHT_CALLS: usize = 512;
const APPROVAL_PREFIX: &str = "codex_ui_workflow_approval:";
const RUN_ONCE: &str = "Run workflow";
const RUN_SESSION: &str = "Allow for this session";
const DECLINE: &str = "Decline";

pub(crate) struct WorkflowHandler;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowArgs {
    #[serde(default)]
    script: Option<String>,
    #[serde(default)]
    script_path: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    args: Option<JsonValue>,
    #[serde(default)]
    resume_from_run_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Meta {
    name: String,
    description: String,
    #[serde(default)]
    phases: Vec<MetaPhase>,
}

#[derive(Debug, Deserialize)]
struct MetaPhase {
    title: String,
    #[serde(default)]
    detail: Option<String>,
}

/// A nested `workflow()` script.
pub(super) struct ChildScript {
    pub(super) name: String,
    pub(super) body: String,
}

fn create_tool() -> ToolSpec {
    let properties = BTreeMap::from([
        (
            "script".to_string(),
            JsonSchema::string(Some(
                "The workflow script, starting with `export const meta = {...}`.".to_string(),
            )),
        ),
        (
            "scriptPath".to_string(),
            JsonSchema::string(Some(
                "Path of a script file to run instead of `script`.".to_string(),
            )),
        ),
        (
            "name".to_string(),
            JsonSchema::string(Some("Run a saved workflow by its meta.name.".to_string())),
        ),
        (
            "args".to_string(),
            JsonSchema {
                description: Some(
                    "Any JSON value, passed verbatim to the script as `args`.".into(),
                ),
                ..Default::default()
            },
        ),
        (
            "resumeFromRunId".to_string(),
            JsonSchema::string(Some(
                "Reuse finished agents of an earlier run of this thread (wf_...).".to_string(),
            )),
        ),
    ]);
    ToolSpec::Function(ResponsesApiTool {
        name: TOOL_NAME.to_string(),
        description: format!("{DESCRIPTION}{SIZE_GUIDELINE}"),
        strict: false,
        defer_loading: None,
        parameters: JsonSchema::object(
            properties,
            Some(Vec::new()),
            /*additional_properties*/ None,
        ),
        output_schema: None,
    })
}

fn respond(message: impl Into<String>) -> FunctionCallError {
    FunctionCallError::RespondToModel(message.into())
}

impl ToolExecutor<ToolInvocation> for WorkflowHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain(TOOL_NAME)
    }

    fn spec(&self) -> ToolSpec {
        create_tool()
    }

    fn handle<'a>(&'a self, invocation: ToolInvocation) -> codex_tools::ToolExecutorFuture<'a>
    where
        ToolInvocation: 'a,
    {
        Box::pin(async move {
            let ToolInvocation {
                session,
                turn,
                step_context,
                call_id,
                payload,
                ..
            } = invocation;
            if !workflows_enabled(&turn, &step_context.extension_data)
                || !session.services.code_mode_service.is_available()
            {
                return Err(respond(
                    "the workflow tool is not available in this session",
                ));
            }
            let ToolPayload::Function { arguments } = payload else {
                return Err(respond("workflow received an unsupported payload"));
            };
            let args: WorkflowArgs = parse_arguments(&arguments)?;
            let codex_home = turn.config.codex_home.as_path().to_path_buf();
            let cwd = step_cwd(&step_context, &codex_home);
            let thread_dir = codex_home
                .join("workflows")
                .join(session.thread_id().to_string());

            // scriptPath, then name, then script.
            let (source, saved_path) = if let Some(path) = &args.script_path {
                let path = resolve_path(&cwd, path);
                (read_script(&path).await?, Some(path))
            } else if let Some(name) = &args.name {
                let path = find_saved(name, &cwd, &codex_home).await.ok_or_else(|| {
                    respond(format!(
                        "Workflow \"{name}\" not found in .codex/workflows or $CODEX_HOME/workflows"
                    ))
                })?;
                (read_script(&path).await?, Some(path))
            } else if let Some(source) = &args.script {
                (source.clone(), None)
            } else {
                return Err(respond(
                    "pass one of `script`, `scriptPath` or `name` to the workflow tool",
                ));
            };
            script::check_text(&source).map_err(respond)?;
            let split = script::split(&source).map_err(|error| {
                respond(format!(
                    "Workflow script has a syntax error and was not launched:\n{error}"
                ))
            })?;
            if saved_path.is_none() {
                script::check_determinism(split.body).map_err(respond)?;
            }

            let run_id = match &args.resume_from_run_id {
                Some(run_id) => {
                    if !valid_run_id(run_id) {
                        return Err(respond(format!("invalid resumeFromRunId `{run_id}`")));
                    }
                    if run::live_runs_contains(&session, run_id) {
                        return Err(respond(format!(
                            "workflow run {run_id} is still running; stop it before resuming"
                        )));
                    }
                    run_id.clone()
                }
                None => format!("wf_{}", &uuid::Uuid::new_v4().simple().to_string()[..12]),
            };
            let run_dir = thread_dir.join(&run_id);
            let resume = args.resume_from_run_id.is_some();
            if resume && !run_dir.join(super::journal::JOURNAL_FILE).exists() {
                return Err(respond(format!(
                    "cannot resume {run_id}: its journal is missing; run the script from the start instead"
                )));
            }

            let code = session
                .services
                .code_mode_service
                .session_provider()
                .create_session()
                .await
                .map_err(|error| {
                    respond(format!("the workflow runtime is unavailable: {error}"))
                })?;
            let meta = match evaluate_meta(&code, &call_id, split.meta, split.body).await {
                Ok(meta) => meta,
                Err(error) => {
                    let _ = code.shutdown().await;
                    return Err(respond(format!(
                        "Workflow script has a syntax error and was not launched:\n{error}"
                    )));
                }
            };

            let script_path = match &saved_path {
                Some(path) => path.clone(),
                None => {
                    let path = thread_dir
                        .join("scripts")
                        .join(format!("{}-{run_id}.js", script::slug(&meta.name)));
                    if let Some(parent) = path.parent() {
                        let _ = tokio::fs::create_dir_all(parent).await;
                    }
                    if let Err(error) = tokio::fs::write(&path, &source).await {
                        tracing::warn!(%error, "failed to save workflow script");
                    }
                    path
                }
            };
            let script_args = args.args.clone().unwrap_or(JsonValue::Null);
            let mut item = WorkflowItem {
                id: call_id.clone(),
                run_id: run_id.clone(),
                name: meta.name.clone(),
                description: meta.description.clone(),
                status: WorkflowStatus::Pending,
                phases: meta
                    .phases
                    .iter()
                    .enumerate()
                    .map(|(index, phase)| WorkflowPhase {
                        index: index as u32,
                        title: phase.title.clone(),
                        detail: phase.detail.clone(),
                        child: None,
                    })
                    .collect(),
                agents: Vec::new(),
                started_at_ms: now_ms(),
                completed_at_ms: None,
                summary: None,
                error: None,
                script_path: Some(script_path.display().to_string()),
                script: Some(source.clone()),
                args: args.args.clone(),
                total_tokens: 0,
                total_tool_calls: 0,
            };

            let runs = WorkflowRuns::of(&session);
            let named = args.name.is_some() && args.script_path.is_none();
            if turn.approval_policy() != AskForApproval::Never
                && !(named && runs.approved(&meta.name))
            {
                session
                    .emit_turn_item_started(
                        turn.as_ref(),
                        &TurnItem::Extension(ExtensionItem::Workflow(item.clone())),
                    )
                    .await;
                let decision = ask_approval(&session, &turn, &call_id, &meta, named).await;
                if decision == Decision::Session {
                    runs.approve(&meta.name);
                }
                if decision == Decision::Decline {
                    item.status = WorkflowStatus::Declined;
                    item.script = None;
                    item.args = None;
                    item.completed_at_ms = Some(now_ms());
                    session
                        .emit_turn_item_completed(
                            turn.as_ref(),
                            TurnItem::Extension(ExtensionItem::Workflow(item)),
                        )
                        .await;
                    let _ = code.shutdown().await;
                    return Err(respond("The user declined to run this workflow."));
                }
            }

            let journal = match Journal::open(&run_dir, resume).await {
                Ok(journal) => journal,
                Err(error) => {
                    let _ = code.shutdown().await;
                    return Err(respond(format!(
                        "failed to open the workflow journal: {error}"
                    )));
                }
            };
            item.status = WorkflowStatus::Running;
            item.script = None;
            item.args = None;
            item.started_at_ms = now_ms();
            let cancel = CancellationToken::new();
            let stopped = Arc::new(AtomicBool::new(false));
            if !runs.insert(
                &run_id,
                RunControl {
                    cancel: cancel.clone(),
                    stopped: Arc::clone(&stopped),
                },
            ) {
                let _ = code.shutdown().await;
                return Err(respond(format!("workflow run {run_id} is already running")));
            }
            session
                .emit_turn_item_started(
                    turn.as_ref(),
                    &TurnItem::Extension(ExtensionItem::Workflow(item.clone())),
                )
                .await;
            let state = Arc::new(RunState::new(
                Arc::clone(&session),
                Arc::clone(&turn),
                Arc::clone(&step_context),
                item,
                journal,
                concurrency(),
                cancel,
                stopped,
                run_dir.clone(),
            ));
            let source = script::run_source(split.body, &script_args, MAX_IN_FLIGHT_CALLS);
            tokio::spawn(run::drive(state, code, source));

            let script_path = script_path.display();
            let message = format!(
                "Workflow launched in background. Run ID: {run_id}\nSummary: {}\nScript file: {script_path} (edit it and rerun with {{\"scriptPath\": \"{script_path}\"}})\nTranscript dir: {}\nTo resume after a stop or failure: {{\"scriptPath\": \"{script_path}\", \"resumeFromRunId\": \"{run_id}\"}}; cached results can be empty, so read {}/journal.jsonl before relying on them.\n\nYou will receive a <workflow_result> when it finishes. If nothing else is left to do, end your turn instead of waiting.",
                meta.description,
                run_dir.display(),
                run_dir.display(),
            );
            Ok(boxed_tool_output(FunctionToolOutput::from_text(
                message,
                /*success*/ Some(true),
            )))
        })
    }
}

impl CoreToolRuntime for WorkflowHandler {}

#[derive(Debug, PartialEq, Eq)]
enum Decision {
    Once,
    Session,
    Decline,
}

async fn ask_approval(
    session: &Arc<crate::session::session::Session>,
    turn: &Arc<crate::session::turn_context::TurnContext>,
    call_id: &str,
    meta: &Meta,
    named: bool,
) -> Decision {
    let option = |label: &str, description: &str| RequestUserInputQuestionOption {
        label: label.to_string(),
        description: description.to_string(),
    };
    let mut options = vec![option(RUN_ONCE, "Start this workflow now.")];
    if named {
        options.push(option(
            RUN_SESSION,
            "Run it, and run this saved workflow again in this session without asking.",
        ));
    }
    options.push(option(DECLINE, "Do not run it."));
    let question_id = format!("{APPROVAL_PREFIX}{call_id}");
    let response = session
        .request_user_input(
            turn.as_ref(),
            call_id.to_string(),
            RequestUserInputArgs {
                questions: vec![RequestUserInputQuestion {
                    id: question_id.clone(),
                    header: "Run workflow".to_string(),
                    question: format!(
                        "Run the dynamic workflow \"{}\"? {} It starts several sub-agents in parallel and can use a lot of your usage limits.",
                        meta.name, meta.description
                    ),
                    is_other: false,
                    is_secret: false,
                    multi_select: false,
                    options: Some(options),
                }],
                is_blocking: true,
                auto_resolution_ms: None,
            },
        )
        .await;
    let answer = response.and_then(|accepted| {
        accepted
            .response
            .answers
            .get(&question_id)
            .and_then(|answer| answer.answers.first().cloned())
    });
    match answer.as_deref() {
        Some(RUN_ONCE) => Decision::Once,
        Some(RUN_SESSION) if named => Decision::Session,
        _ => Decision::Decline,
    }
}

/// Evaluates the `meta` literal and syntax-checks the body without running it.
async fn evaluate_meta(
    code: &Arc<dyn CodeModeSession>,
    call_id: &str,
    meta: &str,
    body: &str,
) -> Result<Meta, String> {
    let source = format!(
        "{}\nconst __wfCheck = async () => {{\n{body}\n}};\n",
        script::meta_source(meta)
    );
    let delegate: Arc<dyn CodeModeSessionDelegate> = Arc::new(NoopCodeModeSessionDelegate);
    let started = code
        .execute(
            ExecuteRequest {
                tool_call_id: format!("{call_id}-meta"),
                enabled_tools: Vec::new(),
                source,
                yield_time_ms: Some(10_000),
                max_output_tokens: None,
            },
            delegate,
            None,
        )
        .await?;
    let RuntimeResponse::Result {
        content_items,
        error_text,
        ..
    } = started.initial_response().await?
    else {
        return Err("evaluating `meta` did not finish".to_string());
    };
    if let Some(error) = error_text {
        return Err(error);
    }
    let text = content_items
        .into_iter()
        .find_map(|item| match item {
            FunctionCallOutputContentItem::InputText { text } => Some(text),
            _ => None,
        })
        .ok_or("`meta` produced no value")?;
    let meta: Meta = serde_json::from_str(&text)
        .map_err(|error| format!("`meta` must have string `name` and `description`: {error}"))?;
    if meta.name.trim().is_empty() || meta.description.trim().is_empty() {
        return Err("`meta.name` and `meta.description` must be non-empty".to_string());
    }
    Ok(meta)
}

fn valid_run_id(run_id: &str) -> bool {
    run_id.strip_prefix("wf_").is_some_and(|rest| {
        rest.len() >= 6
            && rest
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    })
}

fn concurrency() -> usize {
    let cpus = std::thread::available_parallelism().map_or(4, std::num::NonZeroUsize::get);
    cpus.saturating_sub(2).clamp(2, 16)
}

fn step_cwd(step: &crate::session::step_context::StepContext, fallback: &Path) -> PathBuf {
    step.environments
        .primary()
        .and_then(|environment| environment.selection.cwd.to_abs_path().ok())
        .map(|path| path.as_path().to_path_buf())
        .unwrap_or_else(|| fallback.to_path_buf())
}

fn resolve_path(cwd: &Path, path: &str) -> PathBuf {
    let path = Path::new(path);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    }
}

async fn read_script(path: &Path) -> Result<String, FunctionCallError> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|error| respond(format!("cannot read {}: {error}", path.display())))?;
    if metadata.len() > script::MAX_SCRIPT_BYTES as u64 {
        return Err(respond(format!(
            "{} is larger than {} bytes",
            path.display(),
            script::MAX_SCRIPT_BYTES
        )));
    }
    tokio::fs::read_to_string(path)
        .await
        .map_err(|error| respond(format!("cannot read {}: {error}", path.display())))
}

/// `meta.name` without running the script: the first `name:` string in the literal.
fn meta_name(meta: &str) -> Option<String> {
    let at = meta.find("name")?;
    let rest = meta[at + 4..].trim_start().strip_prefix(':')?.trim_start();
    let quote = rest
        .chars()
        .next()
        .filter(|c| matches!(c, '\'' | '"' | '`'))?;
    let end = rest[1..].find(quote)?;
    Some(rest[1..=end].to_string())
}

/// Finds a saved workflow: project `.codex/workflows` (nearest first), then `$CODEX_HOME/workflows`.
async fn find_saved(name: &str, cwd: &Path, codex_home: &Path) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = cwd
        .ancestors()
        .map(|dir| dir.join(".codex").join("workflows"))
        .collect();
    dirs.push(codex_home.join("workflows"));
    for dir in dirs {
        let Ok(mut entries) = tokio::fs::read_dir(&dir).await else {
            continue;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("js") {
                continue;
            }
            let Ok(text) = tokio::fs::read_to_string(&path).await else {
                continue;
            };
            if text.len() <= script::MAX_SCRIPT_BYTES
                && script::split(&text)
                    .ok()
                    .and_then(|split| meta_name(split.meta))
                    .as_deref()
                    == Some(name)
            {
                return Some(path);
            }
        }
    }
    None
}

/// Loads the script of a nested `workflow()` call.
pub(super) async fn resolve_child(
    state: &RunState,
    input: &JsonValue,
) -> Result<ChildScript, String> {
    let codex_home = state.turn.config.codex_home.as_path().to_path_buf();
    let cwd = step_cwd(&state.step, &codex_home);
    let path = if let Some(path) = input.get("scriptPath").and_then(JsonValue::as_str) {
        resolve_path(&cwd, path)
    } else if let Some(name) = input.get("name").and_then(JsonValue::as_str) {
        find_saved(name, &cwd, &codex_home)
            .await
            .ok_or_else(|| format!("Workflow \"{name}\" not found"))?
    } else {
        return Err("workflow() expects a saved workflow name or { scriptPath }".to_string());
    };
    let text = read_script(&path)
        .await
        .map_err(|error| error.to_string())?;
    script::check_text(&text)?;
    let split = script::split(&text)?;
    let name = meta_name(split.meta).unwrap_or_else(|| {
        path.file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("workflow")
            .to_string()
    });
    Ok(ChildScript {
        name,
        body: split.body.to_string(),
    })
}

#[cfg(test)]
pub(super) fn meta_name_for_test(meta: &str) -> Option<String> {
    meta_name(meta)
}

#[cfg(test)]
pub(super) fn valid_run_id_for_test(run_id: &str) -> bool {
    valid_run_id(run_id)
}

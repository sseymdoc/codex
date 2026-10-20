use std::collections::HashMap;
use std::ffi::OsStr;
use std::ffi::OsString;
use std::future::Future;
use std::io::ErrorKind;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::Path;
#[cfg(not(unix))]
use std::process::Stdio;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::MutexGuard;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;
use std::time::Duration;
use std::time::Instant;

use async_channel::Sender;
use codex_protocol::shell_environment::is_non_inheritable_env_var;
#[cfg(unix)]
use codex_utils_pty::Command;
#[cfg(windows)]
use codex_utils_pty::JobObject;
use futures::future::try_join;
use tokio::io::AsyncWriteExt;
#[cfg(not(unix))]
use tokio::process::Command;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tokio::time::timeout;
use tracing::Span;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use super::CommandShell;
use super::ConfiguredHandler;
use super::ConfiguredHandlerKind;
use super::HandlerRunResult;
use super::dispatcher::ParsedHandler;
use super::dispatcher::hook_event_name_label;
use super::dispatcher::hook_execution_mode_label;
use super::dispatcher::hook_handler_type_label;
use super::dispatcher::hook_scope_label;
use super::dispatcher::hook_source_label;
use super::dispatcher::scope_for_event;
use crate::output_spill::HookOutputSpiller;
use codex_protocol::ThreadId;
use codex_protocol::protocol::HookCompletedEvent;
use codex_protocol::protocol::HookHandlerType;
use codex_protocol::protocol::HookOutputEntry;
use codex_protocol::protocol::HookOutputEntryKind;

const MAX_CONCURRENT_ASYNC_HOOKS: usize = 8;

/// A completion request, invalidated when the owning session is interrupted.
pub struct AsyncHookWake {
    pub context: crate::HookContext,
    generation: u64,
    current_generation: Arc<AtomicU64>,
}

impl AsyncHookWake {
    pub fn is_cancelled(&self) -> bool {
        self.current_generation.load(Ordering::Acquire) != self.generation
    }
}

/// Owns command execution and bounded asynchronous work for one session.
#[derive(Clone)]
pub(crate) struct CommandHookRuntime {
    pub(crate) async_rewake_enabled: bool,
    shell: CommandShell,
    environment: Arc<Vec<(OsString, OsString)>>,
    result_sender: Sender<HookCompletedEvent>,
    wake_sender: Sender<AsyncHookWake>,
    wake_receiver: async_channel::Receiver<AsyncHookWake>,
    wake_generation: Arc<AtomicU64>,
    state: Arc<Mutex<CommandHookRuntimeState>>,
    output_spiller: HookOutputSpiller,
}

struct CommandHookRuntimeState {
    concurrency_limit: Arc<Semaphore>,
    tasks: JoinSet<()>,
    pending_wakes: Arc<()>,
}

impl Default for CommandHookRuntimeState {
    fn default() -> Self {
        Self {
            concurrency_limit: Arc::new(Semaphore::new(MAX_CONCURRENT_ASYNC_HOOKS)),
            tasks: JoinSet::new(),
            pending_wakes: Arc::new(()),
        }
    }
}

impl CommandHookRuntime {
    pub(crate) fn new(
        shell: CommandShell,
        environment: Arc<Vec<(OsString, OsString)>>,
        thread_id: ThreadId,
        result_sender: Sender<HookCompletedEvent>,
    ) -> Self {
        let (wake_sender, wake_receiver) = async_channel::unbounded();
        Self {
            async_rewake_enabled: false,
            shell,
            environment,
            result_sender,
            wake_sender,
            wake_receiver,
            wake_generation: Arc::new(AtomicU64::new(0)),
            state: Arc::new(Mutex::new(CommandHookRuntimeState::default())),
            output_spiller: HookOutputSpiller::new(thread_id),
        }
    }

    fn lock_state(&self) -> MutexGuard<'_, CommandHookRuntimeState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub(crate) fn reconfigured(&self, shell: CommandShell) -> Self {
        Self {
            async_rewake_enabled: self.async_rewake_enabled,
            shell,
            environment: Arc::clone(&self.environment),
            result_sender: self.result_sender.clone(),
            wake_sender: self.wake_sender.clone(),
            wake_receiver: self.wake_receiver.clone(),
            wake_generation: Arc::clone(&self.wake_generation),
            state: Arc::clone(&self.state),
            output_spiller: self.output_spiller.clone(),
        }
    }

    pub(crate) fn output_spiller(&self) -> &HookOutputSpiller {
        &self.output_spiller
    }

    pub(crate) fn wake_receiver(&self) -> async_channel::Receiver<AsyncHookWake> {
        self.wake_receiver.clone()
    }

    pub(crate) fn cancel_wakes(&self) {
        let mut state = self.lock_state();
        self.wake_generation.fetch_add(1, Ordering::AcqRel);
        state.pending_wakes = Arc::new(());
        while self.wake_receiver.try_recv().is_ok() {}
    }

    pub(crate) fn has_pending_wakes(&self) -> bool {
        Arc::strong_count(&self.lock_state().pending_wakes) > 1
    }

    fn track_pending_wake(&self, generation: u64) -> Option<Arc<()>> {
        let state = self.lock_state();
        (generation == self.wake_generation.load(Ordering::Acquire))
            .then(|| Arc::clone(&state.pending_wakes))
    }

    pub(crate) fn schedule_async_hook<T: 'static>(
        &self,
        handler: ConfiguredHandler,
        input_json: String,
        cwd: std::path::PathBuf,
        turn_id: Option<String>,
        parse: fn(&ConfiguredHandler, HandlerRunResult, Option<String>) -> ParsedHandler<T>,
    ) {
        if self.result_sender.is_closed() {
            return;
        }

        let result_sender = self.result_sender.clone();
        let runtime = self.clone();
        let generation = self.wake_generation.load(Ordering::Acquire);
        // A Stop hook must not recursively wake the continuation it created.
        let rewake = self.async_rewake_enabled
            && matches!(
                handler.kind,
                ConfiguredHandlerKind::Command {
                    async_rewake: true,
                    ..
                }
            )
            && !serde_json::from_str::<serde_json::Value>(&input_json)
                .ok()
                .is_some_and(|input| input["stop_hook_active"] == true);
        let pending_wake = rewake
            .then(|| self.track_pending_wake(generation))
            .flatten();
        self.schedule_async_task(async move {
            // The handle drops on completion, cancellation, or a closed concurrency queue.
            let _pending_wake = pending_wake;
            let result = match &handler.kind {
                ConfiguredHandlerKind::Command { command, env, .. } => {
                    run_command(&runtime, &handler, command, env, &input_json, &cwd).await
                }
                ConfiguredHandlerKind::McpTool { .. } => return,
            };
            let wake_context = if rewake && result.exit_code == Some(2) && result.error.is_none() {
                let output = if result.stderr.trim().is_empty() {
                    &result.stdout
                } else {
                    &result.stderr
                };
                Some(crate::HookContext {
                    text: runtime
                        .output_spiller
                        .maybe_spill_text_with_limit(
                            format!(
                                "Background {} hook completed with exit code 2:\n{}",
                                hook_event_name_label(handler.event_name),
                                output
                            ),
                            handler.additional_context_limit,
                        )
                        .await,
                    metadata: result.context_metadata.clone(),
                })
            } else {
                None
            };
            let mut hook_result = parse(&handler, result, turn_id).completed;
            let mut entries = Vec::new();
            let mut warnings = Vec::new();

            for entry in std::mem::take(&mut hook_result.run.entries) {
                match entry.kind {
                    HookOutputEntryKind::Context => {
                        let text = runtime
                            .output_spiller
                            .maybe_spill_text_with_limit(
                                entry.text,
                                handler.additional_context_limit,
                            )
                            .await;
                        entries.push(HookOutputEntry {
                            kind: HookOutputEntryKind::Context,
                            text,
                        });
                    }
                    HookOutputEntryKind::Warning => warnings.push(entry),
                    HookOutputEntryKind::Error => entries.push(entry),
                    HookOutputEntryKind::Stop | HookOutputEntryKind::Feedback => {}
                }
            }

            entries.extend(warnings);
            hook_result.run.entries = entries;
            let _ = result_sender.try_send(hook_result);
            if let Some(context) = wake_context {
                let _ = runtime.wake_sender.try_send(AsyncHookWake {
                    context,
                    generation,
                    current_generation: Arc::clone(&runtime.wake_generation),
                });
            }
        });
    }

    pub(crate) fn schedule_async_task(&self, task: impl Future<Output = ()> + Send + 'static) {
        let mut state = self.lock_state();
        if state.concurrency_limit.is_closed() {
            return;
        }

        while state.tasks.try_join_next().is_some() {}
        let concurrency_limit = Arc::clone(&state.concurrency_limit);
        state.tasks.spawn(async move {
            let Ok(_permit) = concurrency_limit.acquire_owned().await else {
                return;
            };
            task.await;
        });
    }

    pub(crate) async fn shutdown(&self) {
        self.cancel_wakes();
        let mut tasks = {
            let mut state = self.lock_state();
            state.concurrency_limit.close();
            std::mem::take(&mut state.tasks)
        };
        tasks.abort_all();
        while tasks.join_next().await.is_some() {}
    }
}

#[tracing::instrument(
    name = "codex.hooks.command",
    level = "trace",
    skip_all,
    fields(
        hook.event_name = hook_event_name_label(handler.event_name),
        hook.handler_type = hook_handler_type_label(HookHandlerType::Command),
        hook.execution_mode = hook_execution_mode_label(handler.execution_mode()),
        hook.scope = hook_scope_label(scope_for_event(handler.event_name)),
        hook.source = hook_source_label(handler.source),
        hook.display_order = handler.display_order,
        hook.timeout_sec = handler.timeout_sec,
        hook.command_outcome = tracing::field::Empty,
    )
)]
pub(crate) async fn run_command(
    runtime: &CommandHookRuntime,
    handler: &ConfiguredHandler,
    command_line: &str,
    env: &HashMap<String, String>,
    input_json: &str,
    cwd: &Path,
) -> HandlerRunResult {
    let started_at = chrono::Utc::now().timestamp();
    let started = Instant::now();
    let timeout_started = tokio::time::Instant::now();
    let duration = Duration::from_secs(handler.timeout_sec);
    if let Some(trust) = &handler.plugin_trust {
        let error = match timeout(duration, trust.verify()).await {
            Ok(Ok(())) => None,
            Ok(Err(err)) => Some(err.to_string()),
            Err(_) => Some(format!("hook timed out after {}s", handler.timeout_sec)),
        };
        if let Some(error) = error {
            return finish_command_run(
                started_at,
                started,
                CommandRunCompletion {
                    exit_code: None,
                    stdout: String::new(),
                    stderr: String::new(),
                    error: Some(error),
                    outcome: "trust_error",
                },
            );
        }
    }

    let mut command = build_command(&runtime.shell, command_line, &runtime.environment, env);
    command.current_dir(cwd);

    #[cfg(windows)]
    let (child, process_tree_job) = match JobObject::spawn_background(&mut command) {
        Ok((child, job)) => (Ok(child), job),
        Err(error) => (Err(error), None),
    };
    #[cfg(not(windows))]
    let child = command.spawn();

    let mut child = match child {
        Ok(child) => child,
        Err(err) => {
            return finish_command_run(
                started_at,
                started,
                CommandRunCompletion {
                    exit_code: None,
                    stdout: String::new(),
                    stderr: String::new(),
                    error: Some(err.to_string()),
                    outcome: "spawn_error",
                },
            );
        }
    };

    let mut process_tree_guard = ProcessTreeGuard {
        process_id: child.id(),
        #[cfg(windows)]
        job: process_tree_job,
    };

    let stdin = child.stdin.take();
    let write_stdin = async {
        if let Some(mut stdin) = stdin
            && let Err(err) = stdin.write_all(input_json.as_bytes()).await
            && err.kind() != ErrorKind::BrokenPipe
        {
            return Err(("stdin_error", format!("failed to write hook stdin: {err}")));
        }
        Ok(())
    };
    let wait_with_output = async {
        child
            .wait_with_output()
            .await
            .map_err(|err| ("wait_error", err.to_string()))
    };

    // Drain output while sending input so neither pipe can block the other, and
    // include stdin writes in the deadline even when the hook never reads them.
    match timeout(
        duration.saturating_sub(timeout_started.elapsed()),
        try_join(write_stdin, wait_with_output),
    )
    .await
    {
        Ok(Ok(((), output))) => {
            // Successfully completed hooks may intentionally leave detached helpers running.
            #[cfg(windows)]
            if let Some(job) = process_tree_guard.job.as_ref() {
                let _ = job.preserve_descendants();
            }
            process_tree_guard.process_id = None;
            finish_command_run(
                started_at,
                started,
                CommandRunCompletion {
                    exit_code: output.status.code(),
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    error: None,
                    outcome: "completed",
                },
            )
        }
        Ok(Err((outcome, error))) => finish_command_run(
            started_at,
            started,
            CommandRunCompletion {
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                error: Some(error),
                outcome,
            },
        ),
        Err(_) => finish_command_run(
            started_at,
            started,
            CommandRunCompletion {
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                error: Some(format!("hook timed out after {}s", handler.timeout_sec)),
                outcome: "timeout",
            },
        ),
    }
}

// Needed only until command hooks move to the exec server, which owns process-tree cleanup.
struct ProcessTreeGuard {
    process_id: Option<u32>,
    #[cfg(windows)]
    job: Option<JobObject>,
}

impl Drop for ProcessTreeGuard {
    fn drop(&mut self) {
        let Some(process_id) = self.process_id else {
            return;
        };

        #[cfg(unix)]
        {
            let _ = codex_utils_pty::process_group::kill_process_group(process_id);
        }

        #[cfg(windows)]
        {
            if let Some(job) = self.job.as_ref() {
                let _ = job.terminate();
            } else {
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &process_id.to_string(), "/T", "/F"])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn();
            }
        }
    }
}

struct CommandRunCompletion {
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    error: Option<String>,
    outcome: &'static str,
}

fn finish_command_run(
    started_at: i64,
    started: Instant,
    completion: CommandRunCompletion,
) -> HandlerRunResult {
    Span::current().record("hook.command_outcome", completion.outcome);
    HandlerRunResult {
        context_metadata: codex_protocol::models::ContentItemMetadata::command_hook(),
        started_at,
        completed_at: chrono::Utc::now().timestamp(),
        duration_ms: started.elapsed().as_millis().try_into().unwrap_or(i64::MAX),
        exit_code: completion.exit_code,
        stdout: completion.stdout,
        stderr: completion.stderr,
        error: completion.error,
    }
}

fn build_command(
    shell: &CommandShell,
    command_line: &str,
    environment: &[(OsString, OsString)],
    env: &HashMap<String, String>,
) -> Command {
    let mut command = if shell.program.is_empty() {
        Command::new(default_shell_program(environment))
    } else {
        Command::new(&shell.program)
    };
    if shell.program.is_empty() {
        #[cfg(windows)]
        command.arg("/C");
        #[cfg(not(windows))]
        command.arg("-lc");
    } else {
        command.args(&shell.args);
    }
    #[cfg(windows)]
    if shell.program.is_empty() || shell.args.iter().any(|arg| arg.eq_ignore_ascii_case("/c")) {
        command.raw_arg(format!(r#""{command_line}""#));
    } else {
        command.arg(command_line);
    }
    #[cfg(not(windows))]
    command.arg(command_line);

    #[cfg(unix)]
    command.process_mode(codex_utils_pty::ProcessMode::NewSession);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    #[cfg(not(unix))]
    command
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    // Both launchers start with an empty environment. Replay the session snapshot
    // before hook overrides, filtering restricted names from both sources.
    command.envs(
        environment
            .iter()
            .map(|(key, value)| (key.as_os_str(), value.as_os_str()))
            .chain(
                env.iter()
                    .map(|(key, value)| (OsStr::new(key), OsStr::new(value))),
            )
            .filter(|(key, _)| !key.to_str().is_some_and(is_non_inheritable_env_var)),
    );
    command
}

fn default_shell_program(environment: &[(OsString, OsString)]) -> OsString {
    #[cfg(windows)]
    let (environment_variable, fallback_program) = ("COMSPEC", "cmd.exe");

    #[cfg(not(windows))]
    let (environment_variable, fallback_program) = ("SHELL", "/bin/sh");

    environment
        .iter()
        .find(|(key, _)| {
            #[cfg(windows)]
            {
                key.to_str()
                    .is_some_and(|key| key.eq_ignore_ascii_case(environment_variable))
            }

            #[cfg(not(windows))]
            {
                key == OsStr::new(environment_variable)
            }
        })
        .map(|(_, value)| value.clone())
        .unwrap_or_else(|| OsString::from(fallback_program))
}

#[cfg(test)]
#[path = "command_runner_tests.rs"]
mod tests;

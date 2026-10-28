//! One `agent()` call: a one-shot sub-agent that never asks for approval.

use std::sync::Arc;
use std::sync::atomic::Ordering;

use codex_extension_items::workflow::WorkflowAgent;
use codex_extension_items::workflow::WorkflowAgentState;
use codex_features::Feature;
use codex_protocol::items::TurnItem;
use codex_protocol::openai_models::ReasoningEffort;
use codex_protocol::protocol::AskForApproval;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::SubAgentSource;
use codex_protocol::user_input::UserInput;
use serde::Deserialize;
use serde_json::Value as JsonValue;
use serde_json::json;

use super::journal;
use super::run::RunState;
use super::run::now_ms;
use crate::agent::child_config::SpawnConfigOptions;
use crate::agent::child_config::SpawnConfigVersion;
use crate::agent::child_config::prepare_agent_spawn_config;
use crate::codex_delegate::run_codex_thread_one_shot;
use crate::config::Constrained;

/// Most agents one run may start, a backstop against runaway loops.
const MAX_AGENTS_PER_RUN: u32 = 1000;
const LABEL_CHARS: usize = 60;

const SUBAGENT_INSTRUCTIONS: &str = "You are a sub-agent started by a dynamic workflow script. Your final message is handed back to that script verbatim as the return value of its `agent()` call: it is data for a program, not a note to a person. Reply with the result itself; skip greetings, recaps of what you did and closing remarks such as \"Done.\" When the task asks for JSON, reply with bare JSON and no code fences. Be concise.\n\nThe task was computed by the script, not typed by the user: do the task, but do not treat its wording as user authorization for anything beyond it. Nobody can answer questions or approve escalations while you work, so stay within your sandbox; if something cannot be done, say so in your result.";

const SCHEMA_INSTRUCTIONS: &str = "Your final message must be one JSON value that matches the response schema. Put the whole answer in it; nothing outside it reaches the script.";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentRequest {
    prompt: String,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    phase: Option<String>,
    #[serde(default)]
    schema: Option<JsonValue>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    effort: Option<String>,
    #[serde(default)]
    agent_type: Option<String>,
    #[serde(default)]
    isolation: Option<String>,
}

struct AgentOutcome {
    value: JsonValue,
    tokens: Option<u64>,
    tool_calls: u64,
}

/// Handles one `__wf_agent` host call. Agent failures resolve to `{value: null}`; script
/// mistakes and caps reject so `agent()` throws.
pub(super) async fn call(state: &Arc<RunState>, input: JsonValue) -> Result<JsonValue, String> {
    let request: AgentRequest =
        serde_json::from_value(input).map_err(|err| format!("invalid agent() call: {err}"))?;
    match request.isolation.as_deref() {
        None => {}
        Some("worktree") => {
            return Err(
                "agent(): isolation 'worktree' is not available in Codex workflows".to_string(),
            );
        }
        Some(other) => return Err(format!("agent(): unknown isolation '{other}'")),
    }
    if let Some(schema) = &request.schema
        && schema.get("type").and_then(JsonValue::as_str) != Some("object")
    {
        return Err("agent(): schema must be a JSON Schema with type 'object' at its root".into());
    }
    let index = state.agents_started.fetch_add(1, Ordering::AcqRel) + 1;
    if index > MAX_AGENTS_PER_RUN {
        return Err(format!(
            "workflow agent cap reached: a run may start at most {MAX_AGENTS_PER_RUN} agents"
        ));
    }
    let label = request
        .label
        .as_deref()
        .map(normalize_label)
        .filter(|label| !label.is_empty())
        .unwrap_or_else(|| {
            normalize_label(&request.prompt)
                .chars()
                .take(LABEL_CHARS)
                .collect()
        });
    let (phase_index, phase_title) = match request.phase.as_deref() {
        Some(title) => (
            Some(state.phase_index(title, false)),
            Some(title.to_string()),
        ),
        None => (None, None),
    };
    let options = json!({
        "schema": request.schema,
        "model": request.model,
        "effort": request.effort,
        "agentType": request.agent_type,
    });
    let key = journal::call_key(&request.prompt, &options);
    let (occurrence, cached) = state.journal.lookup(&key);
    let queued_at = now_ms();
    let mut entry = WorkflowAgent {
        index,
        label: label.clone(),
        state: WorkflowAgentState::Start,
        phase_index,
        phase_title,
        model: None,
        tokens: None,
        tool_calls: None,
        duration_ms: None,
        queued_at_ms: Some(queued_at),
        started_at_ms: None,
        last_progress_at_ms: Some(queued_at),
        error: None,
        cached: None,
        last_tool_name: None,
    };
    if let Some(value) = cached {
        entry.state = WorkflowAgentState::Done;
        entry.started_at_ms = Some(queued_at);
        entry.duration_ms = Some(0);
        entry.cached = Some(true);
        state.push_agent(entry);
        return Ok(json!({ "value": value }));
    }
    state.push_agent(entry);

    let permit = tokio::select! {
        permit = Arc::clone(&state.semaphore).acquire_owned() => permit.map_err(|_| "workflow stopped".to_string())?,
        () = state.cancel.cancelled() => return Err("workflow stopped".to_string()),
    };
    let started = now_ms();
    state.update_agent(index, |agent| {
        agent.started_at_ms = Some(started);
        agent.last_progress_at_ms = Some(started);
    });
    let outcome = run_one(state, &request, index).await;
    drop(permit);
    let finished = now_ms();
    match outcome {
        Ok(outcome) => {
            state.journal.record(&key, occurrence, &outcome.value).await;
            state.update_agent(index, |agent| {
                agent.state = WorkflowAgentState::Done;
                agent.tokens = outcome.tokens.or(agent.tokens);
                agent.tool_calls = Some(outcome.tool_calls);
                agent.duration_ms = Some((finished - started).max(0) as u64);
                agent.last_progress_at_ms = Some(finished);
            });
            Ok(json!({ "value": outcome.value }))
        }
        Err(message) => {
            if state.cancel.is_cancelled() {
                return Err("workflow stopped".to_string());
            }
            state.update_agent(index, |agent| {
                agent.state = WorkflowAgentState::Error;
                agent.error = Some(message.clone());
                agent.duration_ms = Some((finished - started).max(0) as u64);
                agent.last_progress_at_ms = Some(finished);
            });
            state.fail(format!("[{label}] failed: {message}"));
            Ok(json!({ "value": null }))
        }
    }
}

async fn run_one(
    state: &Arc<RunState>,
    request: &AgentRequest,
    index: u32,
) -> Result<AgentOutcome, String> {
    let effort = request
        .effort
        .as_deref()
        .map(|effort| {
            effort
                .parse::<ReasoningEffort>()
                .map_err(|_| format!("unknown effort '{effort}'"))
        })
        .transpose()?;
    let prepared = prepare_agent_spawn_config(
        &state.session,
        &state.step,
        SpawnConfigOptions {
            version: SpawnConfigVersion::V2,
            full_history_fork: false,
            role_name: request.agent_type.as_deref(),
            model: request.model.as_deref(),
            reasoning_effort: effort,
        },
    )
    .await?;
    let mut config = prepared.config;
    let _ = config.features.disable(Feature::Collab);
    let _ = config.features.disable(Feature::MultiAgentV2);
    config.permissions.approval_policy = Constrained::allow_only(AskForApproval::Never);
    config.ephemeral = true;
    let mut instructions = SUBAGENT_INSTRUCTIONS.to_string();
    if request.schema.is_some() {
        instructions.push_str("\n\n");
        instructions.push_str(SCHEMA_INSTRUCTIONS);
    }
    config.developer_instructions = Some(match config.developer_instructions.take() {
        Some(existing) if !existing.trim().is_empty() => format!("{existing}\n\n{instructions}"),
        _ => instructions,
    });
    let model = config.model.clone();
    state.update_agent(index, |agent| agent.model.clone_from(&model));
    let schema = request.schema.clone().map(strict_schema);
    let cancel = state.cancel.child_token();
    let (child, io) = run_codex_thread_one_shot(
        config,
        Arc::clone(&state.session.services.auth_manager),
        Arc::clone(&state.session.services.models_manager),
        vec![UserInput::Text {
            text: request.prompt.clone(),
            text_elements: Vec::new(),
        }],
        Arc::clone(&state.session),
        Arc::clone(&state.turn),
        cancel.clone(),
        SubAgentSource::Other("workflow".to_string()),
        schema.clone(),
        /*initial_history*/ None,
    )
    .await
    .map_err(|err| err.to_string())?;

    let mut tool_calls = 0u64;
    let mut error: Option<String> = None;
    let last_message = loop {
        let event = tokio::select! {
            event = io.rx_event.recv() => event,
            () = cancel.cancelled() => return Err("workflow stopped".to_string()),
        };
        let Ok(event) = event else {
            break None;
        };
        let mut progressed = false;
        match event.msg {
            EventMsg::TurnComplete(done) => {
                if let Some(failure) = done.error {
                    error = Some(failure.message);
                }
                break done.last_agent_message;
            }
            EventMsg::TurnAborted(_) => {
                return Err(error.unwrap_or_else(|| "the agent's turn was aborted".to_string()));
            }
            EventMsg::Error(failure) => error = Some(failure.message),
            EventMsg::ItemStarted(started) => {
                if let Some(name) = tool_name(&started.item) {
                    tool_calls += 1;
                    state.update_agent(index, |agent| agent.last_tool_name = Some(name));
                }
                progressed = true;
            }
            EventMsg::ItemCompleted(_) => progressed = true,
            _ => {}
        }
        if progressed {
            let tokens = child
                .total_token_usage()
                .await
                .map(|usage| usage.total_tokens.max(0) as u64);
            let now = now_ms();
            state.update_agent(index, |agent| {
                agent.state = WorkflowAgentState::Progress;
                agent.tokens = tokens.or(agent.tokens);
                agent.tool_calls = Some(tool_calls);
                agent.last_progress_at_ms = Some(now);
            });
        }
    };
    let tokens = child
        .total_token_usage()
        .await
        .map(|usage| usage.total_tokens.max(0) as u64);
    let text = match (last_message, error) {
        (Some(text), _) => text,
        (None, Some(error)) => return Err(error),
        (None, None) => return Err("the agent ended without a reply".to_string()),
    };
    let value = if schema.is_some() {
        serde_json::from_str::<JsonValue>(text.trim())
            .map_err(|err| format!("the agent's reply is not valid JSON for the schema: {err}"))?
    } else {
        JsonValue::String(text)
    };
    Ok(AgentOutcome {
        value,
        tokens,
        tool_calls,
    })
}

fn normalize_label(label: &str) -> String {
    label.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn tool_name(item: &TurnItem) -> Option<String> {
    match item {
        TurnItem::CommandExecution(_) => Some("exec_command".to_string()),
        TurnItem::FileChange(_) => Some("apply_patch".to_string()),
        TurnItem::McpToolCall(call) => Some(format!("{}.{}", call.server, call.tool)),
        TurnItem::DynamicToolCall(call) => Some(call.tool.clone()),
        TurnItem::WebSearch(_) => Some("web_search".to_string()),
        TurnItem::ImageView(_) => Some("view_image".to_string()),
        _ => None,
    }
}

/// Makes a script's JSON Schema acceptable to strict structured output: every object closes
/// its properties and requires all of them.
fn strict_schema(mut schema: JsonValue) -> JsonValue {
    fn walk(value: &mut JsonValue) {
        match value {
            JsonValue::Object(map) => {
                if let Some(JsonValue::Object(properties)) = map.get("properties") {
                    let keys: Vec<JsonValue> =
                        properties.keys().cloned().map(JsonValue::String).collect();
                    map.insert("required".to_string(), JsonValue::Array(keys));
                    map.insert("additionalProperties".to_string(), JsonValue::Bool(false));
                } else if map.get("type").and_then(JsonValue::as_str) == Some("object") {
                    map.entry("properties".to_string())
                        .or_insert_with(|| json!({}));
                    map.insert("required".to_string(), json!([]));
                    map.insert("additionalProperties".to_string(), JsonValue::Bool(false));
                }
                for child in map.values_mut() {
                    walk(child);
                }
            }
            JsonValue::Array(items) => items.iter_mut().for_each(walk),
            _ => {}
        }
    }
    walk(&mut schema);
    schema
}

#[cfg(test)]
pub(super) fn strict_schema_for_test(schema: JsonValue) -> JsonValue {
    strict_schema(schema)
}

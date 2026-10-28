use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use ts_rs::TS;

/// Display item for one dynamic workflow run (codex-ui experimental backend).
///
/// While the run is live the same item id is re-sent as a full snapshot; the
/// completed item carries the final state.
#[derive(Debug, Clone, Deserialize, Serialize, TS, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct WorkflowItem {
    pub id: String,
    pub run_id: String,
    /// `meta.name` of the script.
    pub name: String,
    /// `meta.description` of the script.
    pub description: String,
    pub status: WorkflowStatus,
    #[serde(default)]
    pub phases: Vec<WorkflowPhase>,
    #[serde(default)]
    pub agents: Vec<WorkflowAgent>,
    #[ts(type = "number")]
    pub started_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub completed_at_ms: Option<i64>,
    /// One-line outcome once the run ends.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub summary: Option<String>,
    /// Why the run failed, when it did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
    /// Where the script was saved, for `scriptPath` reruns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script_path: Option<String>,
    /// Script text, sent only while the run waits for approval.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script: Option<String>,
    /// Script `args`, sent only while the run waits for approval.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "unknown")]
    pub args: Option<serde_json::Value>,
    #[serde(default)]
    #[ts(type = "number")]
    pub total_tokens: u64,
    #[serde(default)]
    #[ts(type = "number")]
    pub total_tool_calls: u64,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, TS, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum WorkflowStatus {
    /// Waiting for the user to approve the run.
    Pending,
    Running,
    Completed,
    Failed,
    Stopped,
    /// The user declined the run; nothing ran.
    Declined,
}

impl WorkflowStatus {
    pub fn is_live(self) -> bool {
        matches!(self, Self::Pending | Self::Running)
    }
}

/// A progress group: a `meta.phases` entry or a `phase()` call.
#[derive(Debug, Clone, Deserialize, Serialize, TS, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct WorkflowPhase {
    pub index: u32,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<String>,
    /// The group holds a nested `workflow()` run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub child: Option<bool>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, TS, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum WorkflowAgentState {
    /// Queued (no `startedAtMs`) or started.
    Start,
    Progress,
    Done,
    Error,
}

/// One `agent()` call of the run.
#[derive(Debug, Clone, Deserialize, Serialize, TS, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct WorkflowAgent {
    pub index: u32,
    pub label: String,
    pub state: WorkflowAgentState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub phase_index: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub phase_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
    /// The reasoning effort the agent's requests carry (an Ultra selection resolved).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub tool_calls: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub queued_at_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub started_at_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub last_progress_at_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
    /// Answered from the resume journal without running.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cached: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_tool_name: Option<String>,
}

use codex_extension_items::workflow::WorkflowAgent;
use codex_extension_items::workflow::WorkflowAgentState;
use codex_extension_items::workflow::WorkflowItem;
use codex_extension_items::workflow::WorkflowStatus;
use pretty_assertions::assert_eq;
use serde_json::json;

use super::agent::strict_schema_for_test;
use super::handler::meta_name_for_test;
use super::handler::valid_run_id_for_test;
use super::journal::Journal;
use super::journal::call_key;
use super::run::report_for_test;

#[test]
fn call_keys_ignore_object_key_order() {
    assert_eq!(
        call_key("p", &json!({"model": "m", "schema": {"b": 1, "a": 2}})),
        call_key("p", &json!({"schema": {"a": 2, "b": 1}, "model": "m"}))
    );
    assert_ne!(call_key("p", &json!({})), call_key("q", &json!({})));
}

#[tokio::test]
async fn journal_reuses_the_unchanged_prefix_then_runs_live() {
    let dir = tempfile::tempdir().expect("tempdir");
    let first = Journal::open(dir.path(), false).await.expect("open");
    assert_eq!(first.lookup("a"), (1, None));
    first.record("a", 1, &json!("A1")).await;
    first.record("a", 2, &json!("A2")).await;
    first.record("b", 1, &json!("B1")).await;

    let resumed = Journal::open(dir.path(), true).await.expect("resume");
    assert_eq!(resumed.lookup("a"), (1, Some(json!("A1"))));
    assert_eq!(resumed.lookup("a"), (2, Some(json!("A2"))));
    assert_eq!(resumed.lookup("changed"), (1, None));
    // Everything after the first miss runs live.
    assert_eq!(resumed.lookup("b"), (1, None));
}

#[tokio::test]
async fn journal_resume_needs_an_existing_journal() {
    let dir = tempfile::tempdir().expect("tempdir");
    assert!(
        Journal::open(&dir.path().join("missing"), true)
            .await
            .is_err()
    );
}

#[test]
fn strict_schema_closes_objects_and_requires_every_property() {
    assert_eq!(
        strict_schema_for_test(json!({
            "type": "object",
            "properties": {
                "items": {"type": "array", "items": {"type": "object", "properties": {"x": {"type": "string"}}}},
                "note": {"type": "string"}
            },
            "required": ["items"]
        })),
        json!({
            "type": "object",
            "properties": {
                "items": {"type": "array", "items": {"type": "object", "properties": {"x": {"type": "string"}}, "required": ["x"], "additionalProperties": false}},
                "note": {"type": "string"}
            },
            "required": ["items", "note"],
            "additionalProperties": false
        })
    );
}

#[test]
fn meta_name_reads_the_literal_without_running_it() {
    assert_eq!(
        meta_name_for_test("{ name: 'find-bugs', description: 'x' }"),
        Some("find-bugs".to_string())
    );
    assert_eq!(meta_name_for_test("{ description: 'x' }"), None);
}

#[test]
fn run_ids_follow_the_wf_shape() {
    assert!(valid_run_id_for_test("wf_abc123def456"));
    assert!(!valid_run_id_for_test("wf_ab"));
    assert!(!valid_run_id_for_test("run_abc123def"));
    assert!(!valid_run_id_for_test("wf_ABC123DEF"));
}

#[test]
fn report_carries_result_failures_and_usage() {
    let item = WorkflowItem {
        id: "call-1".into(),
        run_id: "wf_abc123def456".into(),
        name: "review".into(),
        description: "Review".into(),
        status: WorkflowStatus::Completed,
        phases: Vec::new(),
        agents: vec![WorkflowAgent {
            index: 1,
            label: "a".into(),
            state: WorkflowAgentState::Done,
            phase_index: None,
            phase_title: None,
            model: None,
            tokens: Some(10),
            tool_calls: Some(2),
            duration_ms: Some(5),
            queued_at_ms: None,
            started_at_ms: None,
            last_progress_at_ms: None,
            error: None,
            cached: None,
            last_tool_name: None,
        }],
        started_at_ms: 1_000,
        completed_at_ms: Some(4_000),
        summary: Some("Dynamic workflow \"Review\" completed".into()),
        error: None,
        script_path: Some("s.js".into()),
        script: None,
        args: None,
        total_tokens: 10,
        total_tool_calls: 2,
    };
    let long = "x".repeat(9_000);
    let report = report_for_test(&item, Some(&json!(long)));
    assert!(report.contains("<status>completed</status>"));
    assert!(report.contains("(truncated 1002 chars, full result in out.json)"));
    assert!(report.contains("<failures>\n[a] failed: boom\n</failures>"));
    assert!(report.contains("\"resumeFromRunId\": \"wf_abc123def456\""));
    assert!(report.contains("<agent_count>1</agent_count><agents_done>1</agents_done>"));
    assert!(report.contains("<duration_ms>3000</duration_ms>"));
}

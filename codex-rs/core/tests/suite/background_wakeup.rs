use anyhow::Result;
use codex_protocol::protocol::{EventMsg, Op};
use core_test_support::fs_wait;
use core_test_support::hooks::trust_discovered_hooks;
use core_test_support::responses::{
    ev_assistant_message, ev_completed, mount_sse_sequence, sse, start_mock_server,
};
use core_test_support::test_codex::test_codex;
use core_test_support::wait_for_event;
use serde_json::json;
use std::fs;
use std::time::Duration;
use tokio::time::{sleep, timeout};

#[test_case::test_case(2, false, false; "exit_two_wakes_once")]
#[test_case::test_case(0, false, false; "success_does_not_wake")]
#[test_case::test_case(2, true, false; "interrupt_cancels_wake")]
#[test_case::test_case(2, false, true; "budget_limit_prevents_wake")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn async_rewake_stop_hook(
    exit_code: i32,
    interrupt: bool,
    budget_limited: bool,
) -> Result<()> {
    let should_wake = exit_code == 2 && !interrupt && !budget_limited;
    let server = start_mock_server().await;
    let requests = mount_sse_sequence(
        &server,
        vec![
            sse(vec![
                ev_assistant_message("idle", "initial turn finished"),
                ev_completed("idle"),
            ]),
            sse(vec![
                ev_assistant_message("awake", "hook feedback processed"),
                ev_completed("awake"),
            ]),
        ]
        .into_iter()
        .take(if should_wake { 2 } else { 1 })
        .collect(),
    )
    .await;
    let test = test_codex()
        .with_pre_build_hook(move |home| {
            let script = home.join("rewake.py");
            let gate = home.join("release-rewake");
            let finished = home.join("rewake-finished");
            fs::write(&script, format!(
                "import json, sys, time\nfrom pathlib import Path\ni=json.load(sys.stdin)\nwhile not Path(r'{}').exists(): time.sleep(0.01)\nprint('HOOK-REWAKE-MARKER', file=sys.stderr)\nPath(r'{}').write_text(str(i['stop_hook_active']))\nsys.exit({exit_code})\n", gate.display(), finished.display()
            )).unwrap();
            let python = if cfg!(windows) { "python" } else { "python3" };
            let command = format!("{python} \"{}\"{}", script.display(), if cfg!(windows) { "; exit $LASTEXITCODE" } else { "" });
            fs::write(home.join("hooks.json"), json!({"hooks": {"Stop": [{"hooks": [{
                "type": "command", "command": command, "asyncRewake": true,
            }]}]}}).to_string()).unwrap();
        })
        .with_config(trust_discovered_hooks)
        .build(&server).await?;
    test.submit_turn("finish before the hook").await?;
    if budget_limited {
        let db = codex_state::StateRuntime::init(
            test.config.sqlite.clone(),
            test.config.model_provider_id.clone(),
        )
        .await?;
        db.thread_goals()
            .replace_thread_goal(
                test.session_configured.session_id.into(),
                "limited test goal",
                codex_state::ThreadGoalStatus::BudgetLimited,
                Some(1),
            )
            .await?;
    }
    if interrupt {
        test.codex.submit(Op::Interrupt).await?;
        test.codex
            .submit(Op::RealtimeConversationListVoices)
            .await?;
        wait_for_event(&test.codex, |event| {
            matches!(event, EventMsg::RealtimeConversationListVoicesResponse(_))
        })
        .await;
    }
    fs::write(test.codex_home_path().join("release-rewake"), "release")?;
    fs_wait::wait_for_path_exists(
        test.codex_home_path().join("rewake-finished"),
        Duration::from_secs(10),
    )
    .await?;
    if should_wake {
        wait_for_event(&test.codex, |event| {
            matches!(event, EventMsg::TurnComplete(_))
        })
        .await;
        assert!(
            requests.requests()[1].body_json()["input"]
                .to_string()
                .contains("HOOK-REWAKE-MARKER")
        );
        timeout(Duration::from_secs(10), async {
            while fs::read_to_string(test.codex_home_path().join("rewake-finished"))
                .unwrap_or_default()
                != "True"
            {
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await?;
        sleep(Duration::from_millis(200)).await;
        assert_eq!(
            requests.requests().len(),
            2,
            "Stop hook must not recursively wake itself"
        );
    } else {
        sleep(Duration::from_millis(200)).await;
        assert_eq!(requests.requests().len(), 1);
    }
    test.codex.shutdown_and_wait().await?;
    Ok(())
}

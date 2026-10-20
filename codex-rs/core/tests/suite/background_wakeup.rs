use anyhow::Result;
use codex_protocol::protocol::{EventMsg, Op};
use core_test_support::fs_wait;
use core_test_support::hooks::trust_discovered_hooks;
use core_test_support::responses::{
    ev_assistant_message, ev_completed, ev_function_call, mount_sse_sequence, sse,
    start_mock_server,
};
use core_test_support::test_codex::test_codex;
use core_test_support::wait_for_event;
use serde_json::json;
use std::fs;
use std::time::Duration;
use tokio::time::{sleep, timeout};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn disabled_backend_preserves_synchronous_stop_hook_feedback() -> Result<()> {
    let server = start_mock_server().await;
    let calls = mount_sse_sequence(
        &server,
        vec![
            sse(vec![
                ev_assistant_message("first", "done"),
                ev_completed("first"),
            ]),
            sse(vec![
                ev_assistant_message("second", "feedback handled"),
                ev_completed("second"),
            ]),
        ],
    )
    .await;
    let test = test_codex().with_pre_build_hook(|home| {
        let script = home.join("sync-stop.py");
        fs::write(&script, "import json,sys\ni=json.load(sys.stdin)\nprint('NATIVE-STOP-FEEDBACK', file=sys.stderr)\nsys.exit(0 if i['stop_hook_active'] else 2)\n").unwrap();
        let python = if cfg!(windows) { "python" } else { "python3" };
        let command = format!("{python} \"{}\"{}", script.display(), if cfg!(windows) { "; exit $LASTEXITCODE" } else { "" });
        fs::write(home.join("hooks.json"), json!({"hooks": {"Stop": [{"hooks": [{
            "type": "command", "command": command, "asyncRewake": true,
        }]}]}}).to_string()).unwrap();
    }).with_config(|config| { trust_discovered_hooks(config); config.experimental_backend = false; })
      .build(&server).await?;
    test.submit_turn("finish with synchronous Stop validation")
        .await?;
    assert_eq!(calls.requests().len(), 2);
    let input = calls.requests()[1].body_json()["input"].to_string();
    assert!(input.contains("NATIVE-STOP-FEEDBACK"));
    assert!(!input.contains("Background waiting guidance"));
    test.codex.shutdown_and_wait().await?;
    Ok(())
}

#[test_case::test_case(true, false; "disabled_backend_has_no_hook_waiting_guidance")]
#[test_case::test_case(true, true; "rewake_hook_gets_waiting_guidance")]
#[test_case::test_case(false, true; "ordinary_async_hook_has_no_wake_promise")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pending_hook_waiting_guidance(
    async_rewake: bool,
    experimental_backend: bool,
) -> Result<()> {
    let server = start_mock_server().await;
    let calls = mount_sse_sequence(
        &server,
        vec![
            sse(vec![
                ev_function_call(
                    "trigger-hook",
                    "exec_command",
                    &json!({
                        "cmd": "echo hook-trigger", "description": "触发异步 Hook 测试",
                    })
                    .to_string(),
                ),
                ev_completed("command"),
            ]),
            sse(vec![
                ev_assistant_message("idle", "independent work finished"),
                ev_completed("idle"),
            ]),
            sse(vec![
                ev_assistant_message("after", "new user request"),
                ev_completed("after"),
            ]),
        ],
    )
    .await;
    let test = test_codex()
        .with_pre_build_hook(move |home| {
            let script = home.join("pending-hook.py");
            let gate = home.join("release-pending-hook");
            fs::write(&script, format!("import sys, time\nfrom pathlib import Path\nsys.stdin.read()\nwhile not Path(r'{}').exists(): time.sleep(0.01)\n", gate.display())).unwrap();
            let python = if cfg!(windows) { "python" } else { "python3" };
            fs::write(home.join("hooks.json"), json!({"hooks": {"PostToolUse": [{"hooks": [{
                "type": "command", "command": format!("{python} \"{}\"", script.display()),
                "async": true, "asyncRewake": async_rewake,
            }]}]}}).to_string()).unwrap();
        })
        .with_config(move |config| { trust_discovered_hooks(config); config.experimental_backend = experimental_backend; })
        .build_with_auto_env(&server).await?;
    test.submit_turn("run the command and finish independent work")
        .await?;
    let input = calls.requests()[1].body_json()["input"].to_string();
    assert_eq!(
        input.contains("An asyncRewake hook is pending"),
        async_rewake && experimental_backend
    );
    if async_rewake && experimental_backend {
        assert!(input.contains("success does not trigger a wake"));
        assert!(input.contains("Continue any independent work"));
    }
    test.codex.submit(Op::Interrupt).await?;
    test.submit_turn("continue without waiting on the cancelled hook")
        .await?;
    assert!(
        !calls.requests()[2].body_json()["input"]
            .to_string()
            .contains("Background waiting guidance for this step")
    );
    fs::write(
        test.codex_home_path().join("release-pending-hook"),
        "release",
    )?;
    test.codex.shutdown_and_wait().await?;
    Ok(())
}

#[test_case::test_case(2, false, false, false; "disabled_backend_discards_hook_wake")]
#[test_case::test_case(2, false, false, true; "exit_two_wakes_once")]
#[test_case::test_case(0, false, false, true; "success_does_not_wake")]
#[test_case::test_case(2, true, false, true; "interrupt_cancels_wake")]
#[test_case::test_case(2, false, true, true; "budget_limit_prevents_wake")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn async_rewake_stop_hook(
    exit_code: i32,
    interrupt: bool,
    budget_limited: bool,
    experimental_backend: bool,
) -> Result<()> {
    let should_wake = experimental_backend && exit_code == 2 && !interrupt && !budget_limited;
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
                "type": "command", "command": command, "async": true, "asyncRewake": true,
            }]}]}}).to_string()).unwrap();
        })
        .with_config(move |config| { trust_discovered_hooks(config); config.experimental_backend = experimental_backend; })
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

use super::*;
use pretty_assertions::assert_eq;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use test_case::test_case;

fn context(cwd: &impl serde::Serialize, enabled: bool) -> Value {
    json!({
        "cwd": cwd,
        "planning": { "enabled": enabled, "text": "HOST_PLAN_ENABLED", "disabledText": "HOST_PLAN_REVOKED" },
        "browserVerification": { "toolsEnabled": false, "autoVerify": false,
            "text": "HOST_BROWSER_ENABLED", "disabledText": "HOST_BROWSER_REVOKED", "editReminder": "HOST_VERIFY_EDIT" }
    })
}

fn desktop(enabled: bool) -> Value {
    let reviewed: Value = serde_json::from_str(include_str!(
        "../../../../../codex-ui/context/fixtures/managed.json"
    ))
    .expect("reviewed host context");
    let mut desktop = reviewed["desktop"].clone();
    desktop["enabled"] = json!(enabled);
    desktop
}

async fn update(mcp: &mut TestAppServer, id: &str, snapshot: Value) -> Result<()> {
    let request = mcp
        .send_raw_request(
            "thread/settings/update",
            Some(json!({"threadId":id,"codexUiContext":snapshot})),
        )
        .await?;
    let _: ThreadSettingsUpdateResponse =
        timeout(DEFAULT_TIMEOUT, mcp.read_response(request)).await??;
    Ok(())
}

async fn complete_turn(mcp: &mut TestAppServer, id: &str) -> Result<()> {
    let request = mcp
        .send_turn_start_request(TurnStartParams {
            thread_id: id.to_owned(),
            input: vec![V2UserInput::Text {
                text: "hello".into(),
                text_elements: Vec::new(),
            }],
            ..Default::default()
        })
        .await?;
    let started: TurnStartResponse = timeout(DEFAULT_TIMEOUT, mcp.read_response(request)).await??;
    loop {
        let completed: codex_app_server_protocol::TurnCompletedNotification =
            timeout(DEFAULT_TIMEOUT, mcp.read_notification("turn/completed")).await??;
        if completed.turn.id == started.turn.id {
            break;
        }
    }
    Ok(())
}

fn developer_text(body: &Value) -> String {
    body["input"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["role"] == "developer")
        .flat_map(|item| item["content"].as_array().into_iter().flatten())
        .filter_map(|item| item["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

async fn mock_browser(server: &wiremock::MockServer, enabled: Arc<AtomicBool>) {
    use wiremock::matchers::path;
    use wiremock::{Mock, Request, ResponseTemplate};
    Mock::given(path("/browser")).respond_with(move |request: &Request| {
        let body: Value = request.body_json().unwrap();
        if body.get("id").is_none() { return ResponseTemplate::new(202); }
        let result = match body["method"].as_str().unwrap() {
            "initialize" => json!({"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"browser","version":"1"}}),
            "tools/list" if enabled.load(Ordering::SeqCst) => json!({"tools":[{"name":"preview_snapshot","description":"Read the browser","inputSchema":{"type":"object","properties":{}}}]}),
            "tools/list" => json!({"tools":[]}),
            _ => json!({}),
        };
        ResponseTemplate::new(200).set_body_json(json!({"jsonrpc":"2.0","id":body["id"],"result":result}))
    }).mount(server).await;
}

#[tokio::test]
async fn host_context_updates_revoke_deduplicate_and_restore_in_real_model_requests() -> Result<()>
{
    let server = create_mock_responses_server_sequence_unchecked(
        (0..11)
            .map(|_| create_final_assistant_message_sse_response("done").unwrap())
            .collect(),
    )
    .await;
    let home = TempDir::new()?;
    create_config_toml(home.path(), &server.uri())?;
    let config_file = home.path().join("config.toml");
    let existing = std::fs::read_to_string(&config_file)?;
    std::fs::write(
        &config_file,
        format!("developer_instructions = 'USER_RULE_KEEP'\n{existing}"),
    )?;
    let mut mcp = TestAppServer::builder()
        .with_codex_home(home.path())
        .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", Some("1"))])
        .build_initialized()
        .await?;
    let thread = start_thread(&mut mcp).await?.thread;
    let first_batch: Value = serde_json::from_str(include_str!(
        "../../../../../codex-ui/context/fixtures/desktop-v1.json"
    ))?;
    let current_desktop = desktop(true);
    let enabled_text = first_batch["desktop"]["text"].as_str().unwrap();
    let updated_text = current_desktop["text"].as_str().unwrap();
    let disabled_text = current_desktop["disabledText"].as_str().unwrap();
    let mut initial = context(&thread.cwd, true);
    initial["desktop"] = first_batch["desktop"].clone();
    update(&mut mcp, &thread.id, initial).await?;
    complete_turn(&mut mcp, &thread.id).await?;
    complete_turn(&mut mcp, &thread.id).await?;
    let bodies = received_response_bodies(&server).await?;
    assert!(developer_text(&bodies[0]).contains("USER_RULE_KEEP"));
    assert_eq!(
        developer_text(&bodies[1])
            .matches("HOST_PLAN_ENABLED")
            .count(),
        1
    );
    assert!(bodies[1]["tools"].to_string().contains("update_plan"));
    assert_eq!(developer_text(&bodies[1]).matches(enabled_text).count(), 1);
    update(&mut mcp, &thread.id, Value::Null).await?;
    let mut changed = context(&thread.cwd, true);
    changed["planning"]["text"] = json!("HOST_PLAN_UPDATED");
    changed["desktop"] = current_desktop.clone();
    update(&mut mcp, &thread.id, changed).await?;
    complete_turn(&mut mcp, &thread.id).await?;
    let text = developer_text(received_response_bodies(&server).await?.last().unwrap());
    assert!(text.rfind("HOST_PLAN_UPDATED") > text.rfind("HOST_PLAN_ENABLED"));
    assert!(text.rfind(updated_text) > text.find(enabled_text));
    assert_eq!(
        text.matches(enabled_text).count(),
        2,
        "old history is retained alongside the expanded rules"
    );
    update(&mut mcp, &thread.id, context(&thread.cwd, false)).await?;
    complete_turn(&mut mcp, &thread.id).await?;
    let bodies = received_response_bodies(&server).await?;
    let text = developer_text(bodies.last().unwrap());
    assert!(text.rfind("HOST_PLAN_REVOKED") > text.rfind("HOST_PLAN_ENABLED"));
    assert_eq!(text.matches(updated_text).count(), 1);
    assert!(
        !bodies.last().unwrap()["tools"]
            .to_string()
            .contains("update_plan")
    );
    let request = mcp
        .send_thread_fork_request(ThreadForkParams {
            thread_id: thread.id.clone(),
            ..Default::default()
        })
        .await?;
    let fork: ThreadForkResponse = timeout(DEFAULT_TIMEOUT, mcp.read_response(request)).await??;
    complete_turn(&mut mcp, &fork.thread.id).await?;
    assert!(
        developer_text(received_response_bodies(&server).await?.last().unwrap())
            .contains(updated_text)
    );
    assert!(
        !received_response_bodies(&server).await?.last().unwrap()["tools"]
            .to_string()
            .contains("update_plan")
    );
    mcp.shutdown_gracefully().await?;
    // An older backend preserves the legacy snapshot but drops unknown sibling fields.
    let path = thread.path.as_ref().expect("persisted rollout");
    let (items, _, _) = codex_rollout::RolloutRecorder::load_rollout_items(path).await?;
    let mut legacy = items
        .into_iter()
        .rev()
        .find_map(|item| match item {
            codex_rollout::RolloutItem::EventMsg(
                codex_protocol::protocol::EventMsg::ThreadSettingsApplied(event),
            ) if event.thread_id.map(|id| id.to_string()).as_deref() == Some(&thread.id) => {
                Some(event)
            }
            _ => None,
        })
        .expect("latest owned settings");
    assert_eq!(
        legacy
            .thread_settings
            .codex_ui_desktop_context
            .as_ref()
            .unwrap()
            .text,
        updated_text
    );
    let saved = serde_json::to_value(&legacy.thread_settings)?;
    assert!(saved["codex_ui_context"].get("desktop").is_none());
    legacy.thread_settings.codex_ui_desktop_context = None;
    legacy
        .thread_settings
        .codex_ui_context
        .as_mut()
        .unwrap()
        .planning
        .disabled_text = "HOST_PLAN_LEGACY".into();
    codex_rollout::append_rollout_item_to_path(
        path,
        &codex_rollout::RolloutItem::EventMsg(
            codex_protocol::protocol::EventMsg::ThreadSettingsApplied(legacy.clone()),
        ),
    )
    .await?;
    // Copied child settings must never override the owning thread's desktop module.
    let mut oversized_history = legacy.clone();
    legacy.thread_id = Some(codex_protocol::ThreadId::new());
    legacy.thread_settings.codex_ui_desktop_context = Some(serde_json::from_value(desktop(false))?);
    codex_rollout::append_rollout_item_to_path(
        path,
        &codex_rollout::RolloutItem::EventMsg(
            codex_protocol::protocol::EventMsg::ThreadSettingsApplied(legacy),
        ),
    )
    .await?;
    let mut mcp = TestAppServer::builder()
        .with_codex_home(home.path())
        .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", Some("1"))])
        .build_initialized()
        .await?;
    let request = mcp
        .send_thread_resume_request(ThreadResumeParams {
            thread_id: thread.id.clone(),
            ..Default::default()
        })
        .await?;
    let _: ThreadResumeResponse = timeout(DEFAULT_TIMEOUT, mcp.read_response(request)).await??;
    complete_turn(&mut mcp, &thread.id).await?;
    let text = developer_text(received_response_bodies(&server).await?.last().unwrap());
    assert!(text.contains("HOST_PLAN_LEGACY"));
    assert!(text.contains(updated_text));
    assert!(!text.contains(disabled_text));
    assert!(
        !received_response_bodies(&server).await?.last().unwrap()["tools"]
            .to_string()
            .contains("update_plan")
    );
    update(&mut mcp, &thread.id, context(&thread.cwd, true)).await?;
    complete_turn(&mut mcp, &thread.id).await?;
    assert!(
        received_response_bodies(&server).await?.last().unwrap()["tools"]
            .to_string()
            .contains("update_plan")
    );
    let request = mcp
        .send_thread_compact_start_request(codex_app_server_protocol::ThreadCompactStartParams {
            thread_id: thread.id.clone(),
        })
        .await?;
    let _: codex_app_server_protocol::ThreadCompactStartResponse =
        timeout(DEFAULT_TIMEOUT, mcp.read_response(request)).await??;
    loop {
        let item: codex_app_server_protocol::ItemCompletedNotification =
            timeout(DEFAULT_TIMEOUT, mcp.read_notification("item/completed")).await??;
        if matches!(
            item.item,
            codex_app_server_protocol::ThreadItem::ContextCompaction { .. }
        ) {
            loop {
                let completed: codex_app_server_protocol::TurnCompletedNotification =
                    timeout(DEFAULT_TIMEOUT, mcp.read_notification("turn/completed")).await??;
                if completed.turn.id == item.turn_id {
                    break;
                }
            }
            break;
        }
    }
    complete_turn(&mut mcp, &thread.id).await?;
    let bodies = received_response_bodies(&server).await?;
    let text = developer_text(bodies.last().unwrap());
    assert!(text.contains("HOST_PLAN_ENABLED"));
    assert!(text.contains("USER_RULE_KEEP"));
    assert!(text.contains(updated_text));
    mcp.shutdown_gracefully().await?;
    for gate in [Some("0"), None] {
        let mut mcp = TestAppServer::builder()
            .with_codex_home(home.path())
            .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", gate)])
            .build_initialized()
            .await?;
        let request = mcp
            .send_thread_resume_request(ThreadResumeParams {
                thread_id: thread.id.clone(),
                ..Default::default()
            })
            .await?;
        let _: ThreadResumeResponse =
            timeout(DEFAULT_TIMEOUT, mcp.read_response(request)).await??;
        complete_turn(&mut mcp, &thread.id).await?;
        let text = developer_text(received_response_bodies(&server).await?.last().unwrap());
        assert!(text.rfind("HOST_PLAN_REVOKED") > text.rfind("HOST_PLAN_ENABLED"));
        assert!(text.rfind(disabled_text) > text.rfind(updated_text));
        assert!(text.contains("USER_RULE_KEEP"));
        mcp.shutdown_gracefully().await?;
    }
    // A legacy writer can accept 8 KiB without counting the desktop module it cannot see.
    let restored = oversized_history
        .thread_settings
        .codex_ui_context
        .as_mut()
        .unwrap();
    let other_bytes: usize = [
        &restored.planning.disabled_text,
        &restored.browser_verification.text,
        &restored.browser_verification.disabled_text,
        &restored.browser_verification.edit_reminder,
    ]
    .iter()
    .map(|text| text.len())
    .sum();
    restored.planning.text = "x".repeat(8192 - other_bytes);
    assert!(restored.validate().is_ok());
    codex_rollout::append_rollout_item_to_path(
        path,
        &codex_rollout::RolloutItem::EventMsg(
            codex_protocol::protocol::EventMsg::ThreadSettingsApplied(oversized_history),
        ),
    )
    .await?;
    let sampled = received_response_bodies(&server).await?.len();
    let mut mcp = TestAppServer::builder()
        .with_codex_home(home.path())
        .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", Some("1"))])
        .build_initialized()
        .await?;
    let request = mcp
        .send_thread_resume_request(ThreadResumeParams {
            thread_id: thread.id.clone(),
            ..Default::default()
        })
        .await?;
    let error: JSONRPCError = timeout(
        DEFAULT_TIMEOUT,
        mcp.read_stream_until_error_message(RequestId::Integer(request)),
    )
    .await??;
    assert!(error.error.message.contains("8 KiB"), "{error:?}");
    assert_eq!(received_response_bodies(&server).await?.len(), sampled);
    Ok(())
}

#[test_case(0; "direct patches")]
#[test_case(1; "shell intercepted patches")]
#[test_case(2; "automatic compaction")]
#[cfg_attr(windows, test_case(3; "partial write failure"))]
#[tokio::test]
async fn host_context_browser_reminds_once_after_confirmed_edits(mode: u8) -> Result<()> {
    let server = responses::start_mock_server().await;
    mock_browser(&server, Arc::new(AtomicBool::new(true))).await;
    let home = TempDir::new()?;
    create_config_toml(home.path(), &server.uri())?;
    let file = home.path().join("config.toml");
    let config = std::fs::read_to_string(&file)?;
    std::fs::write(
        file,
        format!(
            "{config}\n[mcp_servers.codex_ui_browser]\nurl = '{}/browser'\n",
            server.uri()
        ),
    )?;
    let mut model = codex_models_manager::test_support::construct_model_info_offline_for_tests(
        "gpt-5.4",
        &codex_models_manager::ModelsManagerConfig::default(),
    );
    model.apply_patch_tool_type = Some(codex_protocol::openai_models::ApplyPatchToolType::Freeform);
    model.shell_type = codex_protocol::openai_models::ConfigShellToolType::UnifiedExec;
    app_test_support::write_models_cache_with_models(home.path(), vec![model]).await?;
    let work = TempDir::new()?;
    let locked = work.path().join("locked.html");
    if mode == 3 {
        std::fs::write(&locked, "before\n")?;
        let mut permissions = std::fs::metadata(&locked)?.permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&locked, permissions)?;
    }
    let mut mcp = TestAppServer::builder()
        .with_codex_home(home.path())
        .without_auto_env()
        .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", Some("1"))])
        .build_initialized()
        .await?;
    let request = mcp
        .send_thread_start_request(ThreadStartParams {
            cwd: Some(work.path().to_string_lossy().into_owned()),
            model: Some("gpt-5.4".into()),
            approval_policy: Some(AskForApproval::Never),
            sandbox: Some(SandboxMode::DangerFullAccess),
            ..Default::default()
        })
        .await?;
    let started: ThreadStartResponse =
        timeout(DEFAULT_TIMEOUT, mcp.read_response(request)).await??;
    let thread = started.thread;
    let mut snapshot = context(&thread.cwd, true);
    snapshot["desktop"] = desktop(true);
    snapshot["browserVerification"]["toolsEnabled"] = json!(true);
    snapshot["browserVerification"]["autoVerify"] = json!(true);
    update(&mut mcp, &thread.id, snapshot).await?;
    let patch =
        |name| format!("*** Begin Patch\n*** Add File: {name}.html\n+<p>hello</p>\n*** End Patch");
    let apply = |id: &str, patch: &str| {
        if mode == 1 {
            responses::ev_apply_patch_exec_command_call_via_heredoc(id, patch)
        } else {
            responses::ev_apply_patch_custom_tool_call(id, patch)
        }
    };
    let mut sequence = vec![
        responses::sse(vec![
            apply(
                "notes",
                "*** Begin Patch\n*** Add File: notes.txt\n+notes\n*** End Patch",
            ),
            responses::ev_completed("notes"),
        ]),
        responses::sse(vec![
            apply(
                "failed",
                "*** Begin Patch\n*** Update File: missing.html\n@@\n-before\n+after\n*** End Patch",
            ),
            responses::ev_completed("failed"),
        ]),
        responses::sse(vec![
            apply(
                "edit-a",
                &if mode == 3 {
                    "*** Begin Patch\n*** Add File: a.html\n+<p>hello</p>\n*** Update File: locked.html\n@@\n-before\n+after\n*** End Patch".into()
                } else {
                    patch("a")
                },
            ),
            responses::ev_completed("a"),
        ]),
        responses::sse(vec![
            apply("edit-b", &patch("b")),
            responses::ev_completed_with_tokens("b", if mode == 2 { 330_000 } else { 100 }),
        ]),
    ];
    if mode == 2 {
        sequence.push(responses::sse(vec![
            responses::ev_assistant_message("summary", "Compacted history."),
            responses::ev_completed_with_tokens("summary", 100),
        ]));
    }
    sequence.push(responses::sse(vec![
        responses::ev_assistant_message("done", "done"),
        responses::ev_completed("done"),
    ]));
    responses::mount_sse_sequence(&server, sequence).await;
    complete_turn(&mut mcp, &thread.id).await?;
    if mode == 3 {
        let mut permissions = std::fs::metadata(&locked)?.permissions();
        permissions.set_readonly(false);
        std::fs::set_permissions(&locked, permissions)?;
        assert_eq!(std::fs::read_to_string(&locked)?, "before\n");
    }
    let bodies = received_response_bodies(&server).await?;
    assert_eq!(bodies.len(), if mode == 2 { 6 } else { 5 });
    assert!(work.path().join("a.html").is_file());
    assert!(work.path().join("b.html").is_file());
    assert!(developer_text(&bodies[0]).contains("HOST_BROWSER_ENABLED"));
    for body in &bodies[..3] {
        assert!(!developer_text(body).contains("HOST_VERIFY_EDIT"));
    }
    assert_eq!(
        developer_text(&bodies[3])
            .matches("HOST_VERIFY_EDIT")
            .count(),
        1
    );
    if mode == 2 {
        assert!(developer_text(&bodies[5]).contains("HOST_BROWSER_ENABLED"));
        assert!(developer_text(&bodies[5]).contains("HOST_PLAN_ENABLED"));
        assert!(developer_text(&bodies[5]).contains(desktop(true)["text"].as_str().unwrap()));
        assert!(!developer_text(&bodies[5]).contains("HOST_VERIFY_EDIT"));
    } else {
        assert_eq!(
            developer_text(&bodies[4])
                .matches("HOST_VERIFY_EDIT")
                .count(),
            1
        );
    }
    if mode == 0 {
        mcp.shutdown_gracefully().await?;
        responses::mount_sse_sequence(
            &server,
            vec![create_final_assistant_message_sse_response("done")?],
        )
        .await;
        let mut mcp = TestAppServer::builder()
            .with_codex_home(home.path())
            .without_auto_env()
            .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", None)])
            .build_initialized()
            .await?;
        let request = mcp
            .send_thread_resume_request(ThreadResumeParams {
                thread_id: thread.id.clone(),
                ..Default::default()
            })
            .await?;
        let _: ThreadResumeResponse =
            timeout(DEFAULT_TIMEOUT, mcp.read_response(request)).await??;
        complete_turn(&mut mcp, &thread.id).await?;
        let text = developer_text(received_response_bodies(&server).await?.last().unwrap());
        assert!(text.rfind("HOST_BROWSER_REVOKED") > text.rfind("HOST_VERIFY_EDIT"));
        assert!(text.rfind("HOST_BROWSER_REVOKED") > text.rfind("HOST_BROWSER_ENABLED"));
    }
    Ok(())
}

#[tokio::test]
async fn host_context_browser_reloads_an_initially_empty_tool_catalog() -> Result<()> {
    let server = create_mock_responses_server_sequence_unchecked(
        (0..4)
            .map(|_| create_final_assistant_message_sse_response("done").unwrap())
            .collect(),
    )
    .await;
    let enabled = Arc::new(AtomicBool::new(false));
    mock_browser(&server, Arc::clone(&enabled)).await;
    let home = TempDir::new()?;
    let work = TempDir::new()?;
    create_config_toml(home.path(), &server.uri())?;
    let file = home.path().join("config.toml");
    let config = std::fs::read_to_string(&file)?;
    std::fs::write(
        file,
        format!(
            "{config}\n[mcp_servers.codex_ui_browser]\nurl = '{}/browser'\n",
            server.uri()
        ),
    )?;
    let mut mcp = TestAppServer::builder()
        .with_codex_home(home.path())
        .without_auto_env()
        .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", Some("1"))])
        .build_initialized()
        .await?;
    let request = mcp
        .send_thread_start_request(ThreadStartParams {
            cwd: Some(work.path().to_string_lossy().into_owned()),
            ..Default::default()
        })
        .await?;
    let started: ThreadStartResponse =
        timeout(DEFAULT_TIMEOUT, mcp.read_response(request)).await??;
    let thread = started.thread;
    for tools in [false, true, false, true] {
        enabled.store(tools, Ordering::SeqCst);
        let mut snapshot = context(&thread.cwd, true);
        snapshot["browserVerification"]["toolsEnabled"] = json!(tools);
        snapshot["browserVerification"]["autoVerify"] = json!(tools);
        update(&mut mcp, &thread.id, snapshot).await?;
        complete_turn(&mut mcp, &thread.id).await?;
        let bodies = received_response_bodies(&server).await?;
        let body = bodies.last().unwrap();
        assert_eq!(
            body["tools"].to_string().contains("preview_snapshot"),
            tools
        );
        let text = developer_text(body);
        if tools {
            assert!(text.rfind("HOST_BROWSER_ENABLED") > text.rfind("HOST_BROWSER_REVOKED"));
        } else {
            assert!(text.rfind("HOST_BROWSER_REVOKED") > text.rfind("HOST_BROWSER_ENABLED"));
        }
    }
    Ok(())
}

#[tokio::test]
async fn host_context_child_inherits_rules_without_the_parent_browser_binding() -> Result<()> {
    let server = responses::start_mock_server().await;
    mock_browser(&server, Arc::new(AtomicBool::new(true))).await;
    const CHILD: &str = "HOST_CHILD_TASK";
    const SPAWN: &str = "host-spawn";
    const WAIT: &str = "host-wait";
    responses::mount_sse_once_match(
        &server,
        |r: &wiremock::Request| {
            let body = String::from_utf8_lossy(&r.body);
            !body.contains(CHILD) && !body.contains(SPAWN)
        },
        responses::sse(vec![
            responses::ev_function_call_with_namespace(
                SPAWN,
                "collaboration",
                "spawn_agent",
                &json!({"task_name":"host_worker","message":CHILD,"fork_turns":"none"}).to_string(),
            ),
            responses::ev_completed("spawn"),
        ]),
    )
    .await;
    let child = responses::mount_sse_once_match(
        &server,
        |r: &wiremock::Request| {
            let body = String::from_utf8_lossy(&r.body);
            body.contains(CHILD) && !body.contains(SPAWN)
        },
        create_final_assistant_message_sse_response("child done")?,
    )
    .await;
    responses::mount_sse_once_match(
        &server,
        |r: &wiremock::Request| {
            let body = String::from_utf8_lossy(&r.body);
            body.contains(SPAWN) && !body.contains(WAIT)
        },
        responses::sse(vec![
            responses::ev_function_call_with_namespace(WAIT, "collaboration", "wait_agent", "{}"),
            responses::ev_completed("wait"),
        ]),
    )
    .await;
    responses::mount_sse_once_match(
        &server,
        |r: &wiremock::Request| String::from_utf8_lossy(&r.body).contains(WAIT),
        create_final_assistant_message_sse_response("parent done")?,
    )
    .await;
    let home = TempDir::new()?;
    let work = TempDir::new()?;
    MockResponsesConfig::new(&server.uri()).with_model("gpt-5.5")
        .with_extra_config(&format!("[features.multi_agent_v2]\nenabled = true\n[mcp_servers.codex_ui_browser]\nurl = '{}/browser'", server.uri()))
        .write(home.path())?;
    write_models_cache(home.path()).await?;
    let mut mcp = TestAppServer::builder()
        .with_codex_home(home.path())
        .without_auto_env()
        .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", Some("1"))])
        .build_initialized()
        .await?;
    let request = mcp
        .send_thread_start_request(ThreadStartParams {
            cwd: Some(work.path().to_string_lossy().into_owned()),
            ..Default::default()
        })
        .await?;
    let started: ThreadStartResponse =
        timeout(DEFAULT_TIMEOUT, mcp.read_response(request)).await??;
    let thread = started.thread;
    let mut snapshot = context(&thread.cwd, true);
    snapshot["browserVerification"]["toolsEnabled"] = json!(true);
    snapshot["browserVerification"]["autoVerify"] = json!(true);
    snapshot["desktop"] = desktop(true);
    update(&mut mcp, &thread.id, snapshot).await?;
    complete_turn(&mut mcp, &thread.id).await?;
    let child_request = child
        .requests()
        .into_iter()
        .find(|request| !request.inputs_of_type("agent_message").is_empty())
        .expect("child model sampling request");
    assert_ne!(
        child_request.header("thread-id").as_deref(),
        Some(thread.id.as_str())
    );
    let body = child_request.body_json();
    let text = developer_text(&body);
    assert!(text.contains("HOST_PLAN_ENABLED"));
    assert!(text.contains("HOST_BROWSER_REVOKED"));
    assert!(text.contains(desktop(false)["disabledText"].as_str().unwrap()));
    assert!(!text.contains(desktop(true)["text"].as_str().unwrap()));
    assert!(!text.contains("HOST_BROWSER_ENABLED"));
    assert!(!body["tools"].to_string().contains("preview_snapshot"));
    Ok(())
}

#[tokio::test]
async fn host_context_desktop_retains_null_checks_merged_limit_and_revokes() -> Result<()> {
    let server = create_mock_responses_server_sequence_unchecked(
        (0..3)
            .map(|_| create_final_assistant_message_sse_response("done").unwrap())
            .collect(),
    )
    .await;
    let home = TempDir::new()?;
    create_config_toml(home.path(), &server.uri())?;
    let mut mcp = TestAppServer::builder()
        .with_codex_home(home.path())
        .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", Some("1"))])
        .build_initialized()
        .await?;
    let thread = start_thread(&mut mcp).await?.thread;
    let reviewed = desktop(true);
    let enabled_text = reviewed["text"].as_str().unwrap();
    let disabled_text = reviewed["disabledText"].as_str().unwrap();
    let mut initial = context(&thread.cwd, true);
    initial["desktop"] = reviewed.clone();
    update(&mut mcp, &thread.id, initial).await?;
    complete_turn(&mut mcp, &thread.id).await?;
    assert!(
        developer_text(received_response_bodies(&server).await?.last().unwrap())
            .contains(enabled_text)
    );

    let request = mcp
        .send_thread_resume_request(ThreadResumeParams {
            thread_id: thread.id.clone(),
            ..Default::default()
        })
        .await?;
    let _: ThreadResumeResponse = timeout(DEFAULT_TIMEOUT, mcp.read_response(request)).await??;
    let mut legacy = context(&thread.cwd, false);
    legacy["desktop"] = Value::Null;
    update(&mut mcp, &thread.id, legacy).await?;
    complete_turn(&mut mcp, &thread.id).await?;
    let bodies = received_response_bodies(&server).await?;
    assert_eq!(developer_text(&bodies[1]).matches(enabled_text).count(), 1);
    assert!(!bodies[1]["tools"].to_string().contains("update_plan"));

    let mut oversized = context(&thread.cwd, false);
    let other_bytes = ["disabledText"]
        .iter()
        .map(|key| oversized["planning"][key].as_str().unwrap().len())
        .sum::<usize>()
        + ["text", "disabledText", "editReminder"]
            .iter()
            .map(|key| {
                oversized["browserVerification"][key]
                    .as_str()
                    .unwrap()
                    .len()
            })
            .sum::<usize>();
    oversized["planning"]["text"] = json!("x".repeat(8192 - other_bytes));
    let standalone: codex_protocol::codex_ui_context::CodexUiContext =
        serde_json::from_value(oversized.clone())?;
    assert!(standalone.validate().is_ok());
    let request = mcp
        .send_raw_request(
            "thread/settings/update",
            Some(json!({"threadId":thread.id,"codexUiContext":oversized})),
        )
        .await?;
    let error: JSONRPCError = timeout(
        DEFAULT_TIMEOUT,
        mcp.read_stream_until_error_message(RequestId::Integer(request)),
    )
    .await??;
    assert!(error.error.message.contains("8 KiB"));

    let mut disabled = context(&thread.cwd, true);
    disabled["desktop"] = reviewed.clone();
    disabled["desktop"]["enabled"] = json!(false);
    update(&mut mcp, &thread.id, disabled).await?;
    complete_turn(&mut mcp, &thread.id).await?;
    let bodies = received_response_bodies(&server).await?;
    let text = developer_text(&bodies[2]);
    assert!(text.rfind(disabled_text) > text.rfind(enabled_text));
    assert!(bodies[2]["tools"].to_string().contains("update_plan"));
    assert!(
        !text.contains(&"x".repeat(100)),
        "rejected updates must not reach model history"
    );
    Ok(())
}

#[test_case(true; "experimental API")]
#[test_case(false; "stable API")]
#[tokio::test]
async fn host_context_gate_cannot_be_enabled_by_the_request_or_ordinary_config(
    api: bool,
) -> Result<()> {
    for gate in [None, Some("0"), Some("true"), Some("1")] {
        let server = responses::start_mock_server().await;
        let home = TempDir::new()?;
        create_config_toml(home.path(), &server.uri())?;
        let file = home.path().join("config.toml");
        let config = std::fs::read_to_string(&file)?;
        std::fs::write(file, format!("experimental_backend = true\n{config}"))?;
        let mut mcp = TestAppServer::builder()
            .with_codex_home(home.path())
            .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", gate)])
            .build()
            .await?;
        let initialized = mcp
            .initialize_with_capabilities(
                codex_app_server_protocol::ClientInfo {
                    name: "host_context_test".into(),
                    title: None,
                    version: "1".into(),
                },
                api.then_some(codex_app_server_protocol::InitializeCapabilities {
                    experimental_api: true,
                    ..Default::default()
                }),
            )
            .await?;
        let codex_app_server_protocol::JSONRPCMessage::Response(response) = initialized else {
            panic!("initialize failed")
        };
        assert_eq!(
            response.result.get("codexUiHostContext"),
            (api && gate == Some("1")).then_some(&json!(true))
        );
        assert_eq!(
            response.result.get("codexUiDesktopContext"),
            response.result.get("codexUiHostContext")
        );
        if !api {
            let mut snapshot = context(&home.path(), true);
            snapshot["desktop"] = desktop(true);
            let request = mcp
                .send_raw_request(
                    "thread/settings/update",
                    Some(json!({
                        "threadId":codex_protocol::ThreadId::new(), "codexUiContext":snapshot,
                    })),
                )
                .await?;
            let error: JSONRPCError = timeout(
                DEFAULT_TIMEOUT,
                mcp.read_stream_until_error_message(RequestId::Integer(request)),
            )
            .await??;
            assert!(
                error
                    .error
                    .message
                    .contains("requires experimentalApi capability")
            );
            continue;
        }
        let thread = start_thread(&mut mcp).await?.thread;
        let mut snapshot = context(&thread.cwd, true);
        snapshot["desktop"] = desktop(true);
        if gate == Some("1") {
            snapshot["planning"]["text"] = json!("x".repeat(8193));
        }
        let request = mcp
            .send_raw_request(
                "thread/settings/update",
                Some(json!({"threadId":thread.id,"codexUiContext":snapshot})),
            )
            .await?;
        let error: JSONRPCError = timeout(
            DEFAULT_TIMEOUT,
            mcp.read_stream_until_error_message(RequestId::Integer(request)),
        )
        .await??;
        assert!(error.error.message.contains(if gate == Some("1") {
            "8 KiB"
        } else {
            "experimental backend"
        }));
        assert!(received_response_bodies(&server).await?.is_empty());
    }
    Ok(())
}

#[test_case(false; "disable while a captured request is in flight")]
#[test_case(true; "interrupt after an edit")]
#[tokio::test]
async fn host_context_discards_unsent_or_interrupted_edit_reminders(interrupt: bool) -> Result<()> {
    let server = responses::start_mock_server().await;
    mock_browser(&server, Arc::new(AtomicBool::new(true))).await;
    let home = TempDir::new()?;
    let work = TempDir::new()?;
    MockResponsesConfig::new(&server.uri())
        .with_model("gpt-5.4")
        .with_extra_config(&format!(
            "[mcp_servers.codex_ui_browser]\nurl = '{}/browser'",
            server.uri()
        ))
        .write(home.path())?;
    let mut model = codex_models_manager::test_support::construct_model_info_offline_for_tests(
        "gpt-5.4",
        &codex_models_manager::ModelsManagerConfig::default(),
    );
    model.apply_patch_tool_type = Some(codex_protocol::openai_models::ApplyPatchToolType::Freeform);
    app_test_support::write_models_cache_with_models(home.path(), vec![model]).await?;
    let mut mcp = TestAppServer::builder()
        .with_codex_home(home.path())
        .without_auto_env()
        .with_env_overrides(&[("CODEX_UI_EXPERIMENTAL_BACKEND", Some("1"))])
        .build_initialized()
        .await?;
    let request = mcp
        .send_thread_start_request(ThreadStartParams {
            cwd: Some(work.path().to_string_lossy().into_owned()),
            approval_policy: Some(AskForApproval::Never),
            sandbox: Some(SandboxMode::DangerFullAccess),
            ..Default::default()
        })
        .await?;
    let started: ThreadStartResponse =
        timeout(DEFAULT_TIMEOUT, mcp.read_response(request)).await??;
    let thread = started.thread;
    let mut snapshot = context(&thread.cwd, true);
    snapshot["browserVerification"]["toolsEnabled"] = json!(true);
    snapshot["browserVerification"]["autoVerify"] = json!(true);
    update(&mut mcp, &thread.id, snapshot.clone()).await?;
    let patch = responses::sse(vec![
        responses::ev_apply_patch_custom_tool_call(
            "edit",
            "*** Begin Patch\n*** Add File: page.html\n+<p>hello</p>\n*** End Patch",
        ),
        responses::ev_completed("edit"),
    ]);
    let done = create_final_assistant_message_sse_response("done")?;
    let mock = responses::mount_response_sequence(
        &server,
        vec![
            responses::sse_response(patch).set_delay(if interrupt {
                Duration::ZERO
            } else {
                Duration::from_secs(2)
            }),
            responses::sse_response(done.clone()).set_delay(if interrupt {
                Duration::from_secs(2)
            } else {
                Duration::ZERO
            }),
            responses::sse_response(done),
        ],
    )
    .await;
    let request = mcp
        .send_turn_start_request(TurnStartParams {
            thread_id: thread.id.clone(),
            input: vec![V2UserInput::Text {
                text: "edit".into(),
                text_elements: Vec::new(),
            }],
            ..Default::default()
        })
        .await?;
    let running: TurnStartResponse = timeout(DEFAULT_TIMEOUT, mcp.read_response(request)).await??;
    timeout(DEFAULT_TIMEOUT, async {
        while mock.requests().len() < if interrupt { 2 } else { 1 } {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;
    if interrupt {
        let request = mcp
            .send_turn_interrupt_request(codex_app_server_protocol::TurnInterruptParams {
                thread_id: thread.id.clone(),
                turn_id: running.turn.id.clone(),
            })
            .await?;
        let _: codex_app_server_protocol::TurnInterruptResponse =
            timeout(DEFAULT_TIMEOUT, mcp.read_response(request)).await??;
    } else {
        snapshot["browserVerification"]["autoVerify"] = json!(false);
        update(&mut mcp, &thread.id, snapshot.clone()).await?;
    }
    let _: codex_app_server_protocol::TurnCompletedNotification =
        timeout(DEFAULT_TIMEOUT, mcp.read_notification("turn/completed")).await??;
    assert!(work.path().join("page.html").is_file());
    let bodies = mock.requests();
    assert!(developer_text(&bodies[0].body_json()).contains("HOST_BROWSER_ENABLED"));
    if !interrupt {
        let text = developer_text(&bodies[1].body_json());
        assert!(text.contains("HOST_BROWSER_REVOKED"));
        assert!(!text.contains("HOST_VERIFY_EDIT"));
    }
    snapshot["browserVerification"]["autoVerify"] = json!(true);
    update(&mut mcp, &thread.id, snapshot).await?;
    complete_turn(&mut mcp, &thread.id).await?;
    let text = developer_text(&mock.requests().last().unwrap().body_json());
    assert_eq!(
        text.matches("HOST_VERIFY_EDIT").count(),
        usize::from(interrupt)
    );
    Ok(())
}

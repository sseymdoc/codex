use super::step_context::StepContext;
use super::turn_context::{TurnContext, TurnEnvironment};
use crate::context::world_state::WorldState;
use crate::environment_selection::TurnEnvironmentSnapshot;
use codex_apply_patch::{AppliedPatchDelta, AppliedPatchFileChange};
use codex_extension_api::{
    ExtensionData, PreviousWorldStateSection, RenderedWorldStateFragment,
    WorldStateSectionContribution, input_text,
};
use codex_protocol::codex_ui_context::CodexUiContext;
use serde_json::Value;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

const REMINDER_ID: &str = "codex_ui_browser_reminder";
#[derive(Default)]
struct BrowserEdit {
    pending: AtomicBool,
    reminded: AtomicBool,
}

pub(super) fn clear_pending(turn: &TurnContext) {
    if let Some(edit) = turn.extension_data.get::<BrowserEdit>() {
        edit.pending.store(false, Ordering::Relaxed);
    }
}

pub(crate) fn planning_enabled(turn: &TurnContext, store: &ExtensionData) -> bool {
    if turn.config.experimental_backend
        && let Some(context) = store.get::<CodexUiContext>()
    {
        return context.planning.enabled;
    }
    turn.config.update_plan_enabled
}

pub(crate) fn browser_enabled(step: &StepContext, context: &CodexUiContext) -> bool {
    browser_tools_enabled(&step.turn, &step.environments, context)
        && context.browser_verification.auto_verify
        && step.mcp.tools().iter().any(|tool| {
            tool.server_name == "codex_ui_browser"
                && step.tool_router.exposes_tool(&tool.canonical_tool_name())
        })
}

pub(crate) fn browser_tools_enabled(
    turn: &TurnContext,
    environments: &TurnEnvironmentSnapshot,
    context: &CodexUiContext,
) -> bool {
    turn.config.experimental_backend
        && context.browser_verification.tools_enabled
        // A child inherits the rules, not its parent's desktop thread binding.
        && !matches!(turn.session_source, codex_protocol::protocol::SessionSource::SubAgent(_))
        && environments.primary().is_some_and(|environment| {
            !environment.environment.is_remote()
                && environment.selection.cwd.to_abs_path().ok().as_ref() == Some(&context.cwd)
        })
}

pub(crate) fn desktop_tools_enabled(
    turn: &TurnContext,
    environments: &TurnEnvironmentSnapshot,
    store: &ExtensionData,
) -> bool {
    turn.config.experimental_backend
        && !matches!(
            turn.session_source,
            codex_protocol::protocol::SessionSource::SubAgent(_)
        )
        && store.get::<CodexUiContext>().is_some_and(|context| {
            context.desktop.as_ref().is_some_and(|desktop| {
                desktop.enabled
                    && (desktop.tools_disabled_text.is_none() || desktop.tools_text.is_some())
            }) && environments.primary().is_some_and(|environment| {
                !environment.environment.is_remote()
                    && environment.selection.cwd.to_abs_path().ok().as_ref() == Some(&context.cwd)
            })
        })
}

/// The dynamic `workflow` tool: experimental backend, root agent, and the host's setting on.
pub(crate) fn workflows_enabled(turn: &TurnContext, store: &ExtensionData) -> bool {
    turn.config.experimental_backend
        && !turn.session_source.is_non_root_agent()
        && store.get::<CodexUiContext>().is_some_and(|context| {
            context
                .workflows
                .as_ref()
                .is_some_and(|workflows| workflows.enabled)
        })
}

/// Ultracode reminders: the on text whenever it turns on, the off text only after it was on.
fn ultracode_section(on: bool, text: String, disabled: String) -> WorldStateSectionContribution {
    const MARKERS: (&str, &str) = ("<codex_ui_ultracode>", "</codex_ui_ultracode>");
    let retained =
        [text.clone(), disabled.clone()].map(|body| format!("{}{body}{}", MARKERS.0, MARKERS.1));
    WorldStateSectionContribution::new("codex_ui_ultracode", move |previous| {
        let was_on = matches!(
            previous,
            PreviousWorldStateSection::Known(Value::Bool(true))
        );
        let fragment = |body: &String| {
            RenderedWorldStateFragment::new("developer", MARKERS, input_text(body.clone()))
        };
        if on {
            (Some(Value::Bool(true)), (!was_on).then(|| fragment(&text)))
        } else if was_on {
            (Some(Value::Bool(false)), Some(fragment(&disabled)))
        } else {
            (
                matches!(previous, PreviousWorldStateSection::Known(_))
                    .then_some(Value::Bool(false)),
                None,
            )
        }
    })
    .with_retained_fragment_matcher(move |role, body| {
        role == "developer" && retained.iter().any(|kept| body.trim() == kept)
    })
}

fn section(
    id: &'static str,
    markers: (&'static str, &'static str),
    text: String,
) -> WorldStateSectionContribution {
    let retained = format!("{}{}{}", markers.0, text, markers.1);
    WorldStateSectionContribution::new(id, move |previous| {
        let value = Value::String(text.clone());
        let unchanged = matches!(previous, PreviousWorldStateSection::Known(old) if old == &value);
        (
            Some(value),
            (!unchanged).then(|| {
                RenderedWorldStateFragment::new("developer", markers, input_text(text.clone()))
            }),
        )
    })
    .with_retained_fragment_matcher(move |role, body| {
        role == "developer" && body.trim() == retained
    })
}

pub(super) async fn contribute(
    session: &super::session::Session,
    step: &StepContext,
    world: &mut WorldState,
) {
    if step.turn.config.experimental_backend {
        step.extension_data
            .insert(codex_extension_api::ContextSnapshotReuse);
    } else {
        step.extension_data
            .remove::<codex_extension_api::ContextSnapshotReuse>();
    }
    let Some(context) = step.extension_data.get::<CodexUiContext>() else {
        return;
    };
    if let Some(desktop) = &context.desktop {
        let enabled = step.turn.config.experimental_backend
            && desktop.enabled
            && !matches!(
                step.turn.session_source,
                codex_protocol::protocol::SessionSource::SubAgent(_)
            );
        world.add_extension_section(section(
            "codex_ui_desktop",
            ("<codex_ui_desktop>", "</codex_ui_desktop>"),
            if enabled {
                &desktop.text
            } else {
                &desktop.disabled_text
            }
            .clone(),
        ));
        if let Some(disabled) = &desktop.tools_disabled_text {
            let tools = desktop_tools_enabled(&step.turn, &step.environments, &step.extension_data)
                && step.mcp.tools().iter().any(|tool| {
                    tool.server_name == "codex_ui_desktop"
                        && step.tool_router.exposes_tool(&tool.canonical_tool_name())
                });
            world.add_extension_section(section(
                "codex_ui_desktop_tools",
                ("<codex_ui_desktop_tools>", "</codex_ui_desktop_tools>"),
                if tools {
                    desktop.tools_text.as_ref().unwrap_or(disabled)
                } else {
                    disabled
                }
                .clone(),
            ));
        }
    }
    let planning =
        step.turn.config.experimental_backend && planning_enabled(&step.turn, &step.extension_data);
    world.add_extension_section(section(
        "codex_ui_planning",
        ("<codex_ui_planning>", "</codex_ui_planning>"),
        if planning {
            &context.planning.text
        } else {
            &context.planning.disabled_text
        }
        .clone(),
    ));
    let browser = browser_enabled(step, &context);
    world.add_extension_section(section(
        "codex_ui_browser",
        ("<codex_ui_browser>", "</codex_ui_browser>"),
        if browser {
            &context.browser_verification.text
        } else {
            &context.browser_verification.disabled_text
        }
        .clone(),
    ));
    if let Some(workflows) = &context.workflows {
        world.add_extension_section(ultracode_section(
            workflows.ultracode && workflows_enabled(&step.turn, &step.extension_data),
            workflows.ultracode_text.clone(),
            workflows.ultracode_disabled_text.clone(),
        ));
    }
    if !step.turn.config.experimental_backend {
        return;
    }

    let edit = step.turn.extension_data.get_or_init(BrowserEdit::default);
    let key = format!("{}/{}", session.thread_id(), step.turn.sub_id);
    let checkpoint = session.state.lock().await.history.world_state_checkpoint();
    if checkpoint
        .as_ref()
        .and_then(|state| state.state.get(REMINDER_ID))
        .and_then(Value::as_str)
        == Some(&key)
    {
        edit.reminded.store(true, Ordering::Relaxed);
    }
    if !browser {
        edit.pending.store(false, Ordering::Relaxed);
    }
    let reminded = edit.reminded.load(Ordering::Relaxed);
    let emit = browser && edit.pending.load(Ordering::Relaxed) && !reminded;
    let text = context.browser_verification.edit_reminder.clone();
    world.add_extension_section(WorldStateSectionContribution::new(
        REMINDER_ID,
        move |previous| {
            let value = Value::String(key.clone());
            let already =
                matches!(previous, PreviousWorldStateSection::Known(old) if old == &value);
            let fragment = (emit && !already).then(|| {
                RenderedWorldStateFragment::new(
                    "developer",
                    ("<codex_ui_browser_edit>", "</codex_ui_browser_edit>"),
                    input_text(text.clone()),
                )
            });
            ((emit || reminded || already).then_some(value), fragment)
        },
    ));
}

pub(crate) fn record_patch(
    step: &StepContext,
    environment: &TurnEnvironment,
    delta: &AppliedPatchDelta,
) {
    if !step.turn.config.experimental_backend || environment.environment.is_remote() {
        return;
    }
    let Some(context) = step.extension_data.get::<CodexUiContext>() else {
        return;
    };
    if !browser_enabled(step, &context) {
        return;
    }
    let relevant = |path: &codex_utils_path_uri::PathUri| {
        path.to_abs_path()
            .ok()
            .and_then(|path| {
                path.as_path()
                    .strip_prefix(context.cwd.as_path())
                    .ok()
                    .map(is_web_file)
            })
            .unwrap_or(false)
    };
    if delta.changes().iter().any(|change| {
        relevant(&change.path) || matches!(&change.change, AppliedPatchFileChange::Update { move_path: Some(path), .. } if relevant(path))
    }) {
        step.turn.extension_data.get_or_init(BrowserEdit::default).pending.store(true, Ordering::Relaxed);
    }
}

fn is_web_file(path: &Path) -> bool {
    if path.components().any(|part| {
        matches!(
            part.as_os_str()
                .to_str()
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str(),
            ".git"
                | "node_modules"
                | "dist"
                | "build"
                | "out"
                | "coverage"
                | ".next"
                | ".nuxt"
                | "tests"
                | "test"
                | "__tests__"
                | "__snapshots__"
        )
    }) {
        return false;
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if name.contains(".test.") || name.contains(".spec.") {
        return false;
    }
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "html"
            | "htm"
            | "css"
            | "scss"
            | "sass"
            | "less"
            | "jsx"
            | "tsx"
            | "vue"
            | "svelte"
            | "astro"
            | "svg"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::session::SessionSettingsUpdate;
    use crate::session::tests::make_session_and_context_with_auth_and_config_and_rx;
    use codex_login::CodexAuth;
    use codex_protocol::codex_ui_context::{
        CodexUiBrowserContext, CodexUiDesktopContext, CodexUiPlanningContext,
    };
    use codex_tools::ToolName;
    use std::sync::Arc;
    use tokio_util::sync::CancellationToken;

    fn sample(cwd: codex_utils_absolute_path::AbsolutePathBuf) -> CodexUiContext {
        CodexUiContext {
            desktop: None,
            workflows: None,
            cwd,
            planning: CodexUiPlanningContext {
                enabled: true,
                text: "HOST_PLAN_ENABLED".into(),
                disabled_text: "HOST_PLAN_REVOKED".into(),
            },
            browser_verification: CodexUiBrowserContext {
                tools_enabled: false,
                auto_verify: false,
                text: "HOST_BROWSER_ENABLED".into(),
                disabled_text: "HOST_BROWSER_REVOKED".into(),
                edit_reminder: "HOST_VERIFY_EDIT".into(),
            },
        }
    }

    #[tokio::test]
    async fn host_context_keeps_captured_steps_and_child_snapshots_independent() {
        let (session, turn, _events) = make_session_and_context_with_auth_and_config_and_rx(
            CodexAuth::from_api_key("test"),
            Vec::new(),
            |config| {
                config.experimental_backend = true;
            },
        )
        .await;
        let mut context = sample(session.get_config().await.cwd.clone());
        context.desktop = Some(CodexUiDesktopContext {
            enabled: true,
            text: "HOST_DESKTOP_ENABLED".into(),
            disabled_text: "HOST_DESKTOP_REVOKED".into(),
            tools_text: Some("HOST_DESKTOP_TOOLS".into()),
            tools_disabled_text: Some("HOST_DESKTOP_TOOLS_REVOKED".into()),
        });
        session
            .update_settings(SessionSettingsUpdate {
                codex_ui_context: Some(context.clone()),
                ..Default::default()
            })
            .await
            .unwrap();
        let first = session
            .capture_step_context(Arc::clone(&turn), &CancellationToken::new())
            .await
            .unwrap();
        assert!(
            first
                .tool_router
                .exposes_tool(&ToolName::plain("update_plan"))
        );
        session
            .record_context_updates_and_set_reference_context_item(&first)
            .await
            .unwrap();
        let initial = serde_json::to_string(
            &session
                .clone_history()
                .await
                .raw_items()
                .collect::<Vec<_>>(),
        )
        .unwrap();
        assert!(initial.contains("HOST_PLAN_ENABLED"));
        assert!(initial.contains("HOST_DESKTOP_ENABLED"));
        assert!(
            initial.contains("HOST_DESKTOP_TOOLS_REVOKED"),
            "no MCP catalog means no tool guidance"
        );
        context.planning.enabled = false;
        context.desktop.as_mut().unwrap().enabled = false;
        session
            .update_settings(SessionSettingsUpdate {
                codex_ui_context: Some(context.clone()),
                ..Default::default()
            })
            .await
            .unwrap();
        let second = session
            .capture_step_context(Arc::clone(&turn), &CancellationToken::new())
            .await
            .unwrap();
        assert!(desktop_tools_enabled(
            &first.turn,
            &first.environments,
            &first.extension_data
        ));
        assert!(!desktop_tools_enabled(
            &second.turn,
            &second.environments,
            &second.extension_data
        ));
        assert!(!desktop_tools_enabled(
            &first.turn,
            &TurnEnvironmentSnapshot::default(),
            &first.extension_data
        ));
        let mut remote = first.environments.clone();
        let crate::environment_selection::TurnEnvironmentState::Ready(environment) =
            &mut remote.environments[0]
        else {
            panic!("ready local fixture")
        };
        environment.environment = Arc::new(
            codex_exec_server::Environment::create_for_tests(Some("ws://127.0.0.1:9".into()))
                .unwrap(),
        );
        assert!(!desktop_tools_enabled(
            &first.turn,
            &remote,
            &first.extension_data
        ));
        assert!(
            first
                .tool_router
                .exposes_tool(&ToolName::plain("update_plan"))
        );
        assert!(
            !second
                .tool_router
                .exposes_tool(&ToolName::plain("update_plan"))
        );
        assert!(
            first
                .extension_data
                .get::<CodexUiContext>()
                .unwrap()
                .planning
                .enabled
        );
        let base = codex_protocol::models::BaseInstructions {
            text: "base".into(),
            provenance: None,
        };
        let child = crate::agent::child_config::build_agent_spawn_config(&base, &first).unwrap();
        let inherited = child.codex_ui_context.unwrap();
        assert!(inherited.planning.enabled);
        assert!(inherited.desktop.unwrap().enabled);
        assert!(
            !second
                .extension_data
                .get::<CodexUiContext>()
                .unwrap()
                .desktop
                .as_ref()
                .unwrap()
                .enabled
        );
        let snapshot = session.thread_settings_snapshot().await;
        assert!(!snapshot.codex_ui_desktop_context.unwrap().enabled);
        let saved = snapshot.codex_ui_context.unwrap();
        assert!(!saved.planning.enabled);
        assert!(
            saved.desktop.is_none(),
            "older readers require the legacy nested shape"
        );
        session
            .record_context_updates_and_set_reference_context_item(&second)
            .await
            .unwrap();
        let history = session.clone_history().await;
        let text = serde_json::to_string(&history.raw_items().collect::<Vec<_>>()).unwrap();
        assert!(text.rfind("HOST_PLAN_REVOKED") > text.rfind("HOST_PLAN_ENABLED"));
        assert!(text.rfind("HOST_DESKTOP_REVOKED") > text.rfind("HOST_DESKTOP_ENABLED"));
        session
            .record_context_updates_and_set_reference_context_item(&second)
            .await
            .unwrap();
        assert_eq!(
            text,
            serde_json::to_string(
                &session
                    .clone_history()
                    .await
                    .raw_items()
                    .collect::<Vec<_>>()
            )
            .unwrap()
        );
        session.replace_history(Vec::new(), None).await;
        session
            .record_context_updates_and_set_reference_context_item(&second)
            .await
            .unwrap();
        assert!(
            serde_json::to_string(
                &session
                    .clone_history()
                    .await
                    .raw_items()
                    .collect::<Vec<_>>()
            )
            .unwrap()
            .contains("HOST_PLAN_REVOKED")
        );
    }

    #[tokio::test]
    async fn host_context_rejects_disabled_backend_and_wrong_working_directory() {
        for enabled in [false, true] {
            let (session, _turn, _events) = make_session_and_context_with_auth_and_config_and_rx(
                CodexAuth::from_api_key("test"),
                Vec::new(),
                |config| {
                    config.experimental_backend = enabled;
                },
            )
            .await;
            let mut context = sample(session.get_config().await.cwd.clone());
            if enabled {
                context.cwd = context.cwd.join("different");
            }
            assert!(
                session
                    .update_settings(SessionSettingsUpdate {
                        codex_ui_context: Some(context),
                        ..Default::default()
                    })
                    .await
                    .is_err()
            );
            assert!(
                session
                    .thread_settings_snapshot()
                    .await
                    .codex_ui_context
                    .is_none()
            );
        }
    }
    #[test]
    fn web_files_exclude_unconfirmed_code_tests_and_outputs() {
        for path in [
            "src/App.tsx",
            "index.html",
            "styles/theme.SCSS",
            "public/logo.svg",
        ] {
            assert!(is_web_file(Path::new(path)), "{path}");
        }
        for path in [
            "src/api.ts",
            "src/main.js",
            "README.md",
            "src/App.test.tsx",
            "node_modules/x/index.html",
            "dist/index.html",
            "tests/page.html",
        ] {
            assert!(!is_web_file(Path::new(path)), "{path}");
        }
    }
    #[test]
    fn section_replaces_and_revokes_without_touching_other_instructions() {
        let enabled = section("test", ("<test>", "</test>"), "enabled".into());
        let (snapshot, first) = enabled.render_diff(PreviousWorldStateSection::Absent);
        assert!(first.is_some());
        assert!(
            enabled
                .render_diff(PreviousWorldStateSection::Known(snapshot.as_ref().unwrap()))
                .1
                .is_none()
        );
        assert!(
            enabled
                .render_diff(PreviousWorldStateSection::Absent)
                .1
                .is_some()
        );
        assert!(enabled.matches_retained_fragment("developer", "<test>enabled</test>"));
        assert!(!enabled.matches_retained_fragment("user", "<test>enabled</test>"));
        let disabled = section("test", ("<test>", "</test>"), "disabled".into());
        assert!(
            disabled
                .render_diff(PreviousWorldStateSection::Known(snapshot.as_ref().unwrap()))
                .1
                .is_some()
        );
    }
}

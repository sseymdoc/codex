use super::*;
use crate::catalog::SkillAuthority;
use crate::catalog::SkillCatalogEntry;
use crate::catalog::SkillPackageId;
use crate::catalog::SkillResourceId;
use crate::catalog::SkillSourceKind;
use codex_extension_api::ExtensionData;
use codex_extension_api::NoopExtensionEventSink;
use codex_extension_api::PreviousWorldStateSection;
use codex_extension_api::RenderedWorldStateFragment;
use codex_models_manager::model_info::model_info_from_slug;
use codex_protocol::openai_models::ModelInfo;
use std::num::NonZeroUsize;
use std::time::Instant;

struct Fixture {
    session: ExtensionData,
    thread: ExtensionData,
    turn: ExtensionData,
    providers: SkillProviders,
    sink: Arc<dyn ExtensionEventSink>,
    model: ModelInfo,
    environments: Vec<TurnEnvironmentSelection>,
    previous: Option<serde_json::Map<String, serde_json::Value>>,
}

type Rendered = Vec<(
    Option<serde_json::Value>,
    Option<RenderedWorldStateFragment>,
)>;

impl Fixture {
    fn new() -> Self {
        let thread = ExtensionData::new("thread");
        thread.insert(SkillsThreadState::new(
            SkillsExtensionConfig {
                include_instructions: true,
                max_context_tokens: None,
                bundled_skills_enabled: true,
                cloud_skill_enabled: true,
                shadow_selection_enabled: false,
            },
            true,
        ));
        Self {
            session: ExtensionData::new("session"),
            thread,
            turn: ExtensionData::new("turn"),
            providers: SkillProviders::new(),
            sink: Arc::new(NoopExtensionEventSink),
            model: model_info_from_slug("test-model"),
            environments: Vec::new(),
            previous: None,
        }
    }

    fn context(&self, enabled: bool) -> CatalogContext<'_> {
        if enabled {
            self.turn.insert(codex_extension_api::ContextSnapshotReuse);
        } else {
            self.turn.remove::<codex_extension_api::ContextSnapshotReuse>();
        }
        CatalogContext::new(
            &self.providers,
            Arc::clone(&self.sink),
            WorldStateContributionInput {
                thread_id: codex_protocol::ThreadId::default(),
                turn_id: self.turn.level_id(),
                model_info: &self.model,
                environments: &self.environments,
                ready_selected_capability_roots: &[],
                executor_capability_discovery: None,
                executor_capability_discovery_v2: None,
                extension_metrics: None,
                session_store: &self.session,
                thread_store: &self.thread,
                turn_store: &self.turn,
                step_store: &self.turn,
                previous_world_state: self.previous.as_ref(),
            },
        )
        .unwrap()
    }

    fn render(&self, enabled: bool, catalogs: CatalogContributions) -> Rendered {
        let context = self.context(enabled);
        context
            .render_catalogs(catalogs)
            .into_iter()
            .map(|catalog| {
                context
                    .build_world_state_section(catalog)
                    .render_diff(PreviousWorldStateSection::Absent)
            })
            .collect()
    }

    fn cached(&self) -> Arc<RenderedCatalogSnapshot> {
        self.thread
            .get::<RenderedCatalogCache>()
            .unwrap()
            .0
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .clone()
    }
}

fn catalogs(count: usize) -> CatalogContributions {
    let host = SkillCatalog {
        entries: (0..count).map(|index| {
            SkillCatalogEntry::new(
                SkillPackageId(format!("host-{index}")),
                SkillAuthority::new(SkillSourceKind::Host, "local"),
                format!("skill-{index}"),
                "Read project context, verify current inputs, and apply the documented workflow. 验证项目规则。".repeat(3),
                SkillResourceId::new(format!("file:///workspace/skills/skill-{index}/SKILL.md")),
            )
        }).collect(),
        warnings: Vec::new(),
        is_partial: false,
    };
    CatalogContributions {
        executor: CatalogContribution {
            catalog: SkillCatalog::default(),
            status: CatalogStatus::Enabled,
        },
        cloud: CatalogContribution {
            catalog: SkillCatalog::default(),
            status: CatalogStatus::Enabled,
        },
        host: CatalogContribution {
            catalog: host,
            status: CatalogStatus::Enabled,
        },
    }
}

#[test]
fn context_snapshot_reuses_identical_rendering_and_direct_disable_bypasses_it() {
    let f = Fixture::new();
    let native = f.render(false, catalogs(24));
    assert!(f.thread.get::<RenderedCatalogCache>().is_none());
    assert_eq!(f.render(true, catalogs(24)), native);
    let first = f.cached();
    assert_eq!(f.render(true, catalogs(24)), native);
    assert!(Arc::ptr_eq(&first, &f.cached()));
    assert_eq!(f.render(false, catalogs(24)), native);
    assert!(f.thread.get::<RenderedCatalogCache>().is_none());
    f.render(true, catalogs(24));
    assert!(!Arc::ptr_eq(&first, &f.cached()));
}

#[test]
fn context_snapshot_invalidates_every_rendering_dependency() {
    for changed in [
        "description",
        "path",
        "enabled",
        "authority",
        "plugin",
        "warnings",
        "status",
        "model",
        "budget",
        "usage",
        "config",
        "environment",
        "allocation",
    ] {
        let mut f = Fixture::new();
        f.render(true, catalogs(24));
        let previous = f.cached();
        let mut current = catalogs(24);
        match changed {
            "description" => current.host.catalog.entries[0].description = "changed".to_string(),
            "path" => {
                current.host.catalog.entries[0].main_prompt =
                    SkillResourceId::new("file:///other/SKILL.md")
            }
            "enabled" => current.host.catalog.entries[0].enabled = false,
            "authority" => {
                current.host.catalog.entries[0].authority.id = "different-owner".to_string()
            }
            "plugin" => {
                current.host.catalog.entries[0].plugin_id = Some("changed-plugin".to_string())
            }
            "warnings" => current
                .host
                .catalog
                .warnings
                .push("discovery warning".to_string()),
            "status" => current.host.status = CatalogStatus::Unavailable,
            "model" => f.model.slug = "another-model".to_string(),
            "budget" => f.model.context_window = Some(1_000),
            "usage" => {
                f.model.include_skills_usage_instructions =
                    !f.model.include_skills_usage_instructions
            }
            "config" => {
                let state = f.thread.get::<SkillsThreadState>().unwrap();
                let mut config = state.config();
                config.include_instructions = false;
                state.set_config(config);
            }
            "environment" => {
                f.environments = vec![TurnEnvironmentSelection::new(
                    codex_protocol::protocol::TurnEnvironmentRequest {
                        environment_id: "other-environment".to_string(),
                        cwd: codex_utils_path_uri::PathUri::parse("file:///other").unwrap(),
                        workspace_roots: Vec::new(),
                        config: codex_protocol::protocol::EnvironmentConfigState::FromThread,
                    },
                    &[],
                )];
            }
            "allocation" => {
                let mut allocation = previous.allocation;
                allocation.cloud_limit /= 2;
                f.previous = Some(
                    serde_json::from_value(serde_json::json!({
                        "cloud_skills": { "allocation": allocation }
                    }))
                    .unwrap(),
                );
            }
            _ => unreachable!(),
        }
        let current_copy = CatalogContributions {
            executor: CatalogContribution {
                catalog: current.executor.catalog.clone(),
                status: current.executor.status,
            },
            cloud: CatalogContribution {
                catalog: current.cloud.catalog.clone(),
                status: current.cloud.status,
            },
            host: CatalogContribution {
                catalog: current.host.catalog.clone(),
                status: current.host.status,
            },
        };
        let actual = f.render(true, current);
        assert!(
            !Arc::ptr_eq(&previous, &f.cached()),
            "{changed} must invalidate"
        );
        assert_eq!(
            actual,
            f.render(false, current_copy),
            "{changed} must match a fresh render"
        );
    }
}

#[test]
fn context_snapshot_is_thread_owned_and_reuses_its_persisted_allocation() {
    let mut f = Fixture::new();
    let first = f.render(true, catalogs(24));
    let snapshot = f.cached();
    f.previous =
        Some(serde_json::from_value(serde_json::json!({ "cloud_skills": first[1].0 })).unwrap());
    assert_eq!(f.render(true, catalogs(24)), first);
    assert!(Arc::ptr_eq(&snapshot, &f.cached()));
    let other = Fixture::new();
    assert!(other.thread.get::<RenderedCatalogCache>().is_none());
    assert_eq!(other.render(true, catalogs(24)), first);
    assert!(!Arc::ptr_eq(&snapshot, &other.cached()));
}

#[test]
fn context_snapshot_rebinds_warnings_to_the_current_turn() {
    #[derive(Default)]
    struct Warnings(Mutex<Vec<ExtensionWarning>>);
    impl ExtensionEventSink for Warnings {
        fn emit(&self, _: codex_protocol::protocol::Event) {}
        fn emit_warning(&self, warning: ExtensionWarning) {
            self.0.lock().unwrap().push(warning);
        }
    }
    let mut f = Fixture::new();
    let state = f.thread.get::<SkillsThreadState>().unwrap();
    let mut config = state.config();
    config.max_context_tokens = NonZeroUsize::new(1);
    state.set_config(config);
    let sink = Arc::new(Warnings::default());
    f.sink = sink.clone();
    for turn in ["first", "second"] {
        f.turn = ExtensionData::new(turn);
        let context = f.context(true);
        let rendered = context.render_catalogs(catalogs(24));
        for catalog in rendered {
            context
                .build_world_state_section(catalog)
                .render_diff(PreviousWorldStateSection::Absent);
        }
    }
    let warnings = sink.0.lock().unwrap();
    assert!(
        warnings
            .iter()
            .any(|warning| warning.turn_id.as_deref() == Some("first"))
    );
    assert!(
        warnings
            .iter()
            .any(|warning| warning.turn_id.as_deref() == Some("second"))
    );
}

#[tokio::test]
async fn context_snapshot_keeps_discovery_fresh_before_reuse() {
    use crate::catalog::SkillReadResult;
    use crate::catalog::SkillSearchResult;
    use crate::provider::SkillProvider;
    use crate::provider::SkillProviderFuture;
    use crate::provider::SkillReadRequest;
    use crate::provider::SkillSearchRequest;
    use std::sync::atomic::AtomicUsize;
    use std::sync::atomic::Ordering;

    struct Provider {
        calls: AtomicUsize,
        catalog: Mutex<SkillCatalog>,
    }
    impl SkillProvider for Provider {
        fn list(&self, _: SkillListQuery) -> SkillProviderFuture<'_, SkillCatalog> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let catalog = self.catalog.lock().unwrap().clone();
            Box::pin(async { Ok(catalog) })
        }
        fn read<'a>(&'a self, _: SkillReadRequest<'a>) -> SkillProviderFuture<'a, SkillReadResult> {
            unreachable!("rendering must not read skill bodies")
        }
        fn search(&self, _: SkillSearchRequest) -> SkillProviderFuture<'_, SkillSearchResult> {
            unreachable!("rendering must not search skills")
        }
    }
    let mut f = Fixture::new();
    let provider = Arc::new(Provider {
        calls: AtomicUsize::new(0),
        catalog: Mutex::new(catalogs(24).host.catalog),
    });
    f.providers = SkillProviders::new().with_host_provider(provider.clone());
    f.turn.insert(HostSkillsSnapshot::new(Arc::new(
        crate::SkillLoadOutcome::default(),
    )));
    let discovered = f.context(true).discover_catalogs().await;
    let first = f.render(true, discovered);
    let cached = f.cached();
    let discovered = f.context(true).discover_catalogs().await;
    assert_eq!(f.render(true, discovered), first);
    assert!(Arc::ptr_eq(&cached, &f.cached()));
    provider.catalog.lock().unwrap().entries.clear();
    let discovered = f.context(true).discover_catalogs().await;
    assert_ne!(f.render(true, discovered), first);
    assert!(!Arc::ptr_eq(&cached, &f.cached()));
    assert_eq!(provider.calls.load(Ordering::SeqCst), 3);
}

#[test]
fn context_snapshot_render_benchmark() {
    let f = Fixture::new();
    let mut samples = [Vec::new(), Vec::new()];
    for enabled in [false, true] {
        f.render(enabled, catalogs(128));
        for _ in 0..40 {
            let input = catalogs(128);
            let context = f.context(enabled);
            let start = Instant::now();
            std::hint::black_box(context.render_catalogs(input));
            samples[usize::from(enabled)].push(start.elapsed().as_secs_f64() * 1000.0);
        }
    }
    for values in &mut samples {
        values.sort_by(f64::total_cmp);
    }
    println!(
        "context snapshot rendering (128 synthetic skills, 40 iterations, current build): uncached_median_ms={:.4}, reused_median_ms={:.4}",
        samples[0][20], samples[1][20]
    );
}

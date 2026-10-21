use std::sync::Arc;
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::Ordering;
use std::time::Duration;

use codex_http_client::HttpClientFactory;
use codex_http_client::OutboundProxyPolicy;
use codex_login::AuthManager;
use codex_login::CodexAuth;
use codex_login::ExternalAuth;
use codex_login::ExternalAuthFuture;
use codex_login::ExternalAuthRefreshContext;
use tokio::sync::Notify;
use wiremock::Mock;
use wiremock::MockServer;
use wiremock::ResponseTemplate;
use wiremock::matchers::method;
use wiremock::matchers::path;

use super::policy::resolve_attribution_policy;

fn enterprise_auth_manager() -> Arc<AuthManager> {
    AuthManager::from_auth_for_testing(enterprise_auth("workspace-123"))
}

fn http_client_factory() -> HttpClientFactory {
    HttpClientFactory::new(OutboundProxyPolicy::ReqwestDefault)
}

fn enterprise_auth(account_id: &str) -> CodexAuth {
    CodexAuth::from_external_chatgpt_tokens("e30.e30.c2ln", account_id, Some("enterprise"))
        .expect("fake ChatGPT auth should parse")
}

struct StaticExternalAuth(CodexAuth);

impl ExternalAuth for StaticExternalAuth {
    fn resolve(&self) -> ExternalAuthFuture<'_, CodexAuth> {
        Box::pin(async { Ok(self.0.clone()) })
    }

    fn refresh(&self, _context: ExternalAuthRefreshContext) -> ExternalAuthFuture<'_, CodexAuth> {
        self.resolve()
    }
}

async fn set_auth(auth_manager: &AuthManager, account_id: &str) {
    auth_manager
        .set_external_auth(Arc::new(StaticExternalAuth(enterprise_auth(account_id))))
        .await
        .expect("auth refresh should succeed");
}

#[tokio::test]
async fn policy_resolution_recovers_after_unauthorized() {
    let server = MockServer::start().await;
    let request_count = Arc::new(AtomicUsize::new(0));
    Mock::given(method("GET"))
        .and(path("/backend-api/wham/settings/user"))
        .respond_with({
            let request_count = request_count.clone();
            move |_request: &wiremock::Request| {
                if request_count.fetch_add(1, Ordering::SeqCst) == 0 {
                    ResponseTemplate::new(401)
                } else {
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({"commit_attribution_enabled": true}))
                }
            }
        })
        .expect(2)
        .mount(&server)
        .await;
    let auth_manager = enterprise_auth_manager();
    set_auth(auth_manager.as_ref(), "workspace-123").await;

    let policy = resolve_attribution_policy(
        &auth_manager,
        &format!("{}/backend-api", server.uri()),
        &http_client_factory(),
    )
    .await
    .expect("policy resolution should not time out")
    .expect("policy should resolve after auth recovery");

    assert!(policy.enabled);
    assert_eq!(request_count.load(Ordering::SeqCst), 2);
    server.verify().await;
}

#[tokio::test]
async fn policy_resolution_retries_after_auth_refresh() {
    let server = MockServer::start().await;
    let request_started = Arc::new(Notify::new());
    let request_count = Arc::new(AtomicUsize::new(0));
    Mock::given(method("GET"))
        .and(path("/backend-api/wham/settings/user"))
        .respond_with({
            let request_started = request_started.clone();
            let request_count = request_count.clone();
            move |_request: &wiremock::Request| match request_count.fetch_add(1, Ordering::SeqCst) {
                0 => {
                    request_started.notify_one();
                    ResponseTemplate::new(200)
                        .set_delay(Duration::from_millis(100))
                        .set_body_json(serde_json::json!({
                            "commit_attribution_enabled": true,
                        }))
                }
                1 => ResponseTemplate::new(401),
                _ => ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "commit_attribution_enabled": true,
                })),
            }
        })
        .expect(3)
        .mount(&server)
        .await;
    let auth_manager = enterprise_auth_manager();
    let resolve = tokio::spawn({
        let auth_manager = auth_manager.clone();
        let base_url = format!("{}/backend-api", server.uri());
        async move {
            resolve_attribution_policy(&auth_manager, &base_url, &http_client_factory())
                .await
                .ok()
                .flatten()
        }
    });

    tokio::time::timeout(Duration::from_secs(5), request_started.notified())
        .await
        .expect("first settings request should start");
    set_auth(auth_manager.as_ref(), "workspace-456").await;

    assert!(
        resolve
            .await
            .expect("policy task should complete")
            .expect("policy should resolve after refresh")
            .enabled
    );
    server.verify().await;
}

fn extension(server: &MockServer, enabled: bool) -> super::GitAttributionExtension {
    super::GitAttributionExtension {
        auth_manager: enterprise_auth_manager(),
        base_url: format!("{}/backend-api", server.uri()),
        http_client_factory: http_client_factory(),
        prewarm_enabled: enabled,
    }
}

async fn start(
    extension: &super::GitAttributionExtension,
    store: &codex_extension_api::ExtensionData,
) {
    use codex_extension_api::ThreadLifecycleContributor;
    extension
        .on_thread_start(codex_extension_api::ThreadStartInput {
            config: &(),
            session_source: &Default::default(),
            persistent_thread_state_available: true,
            environments: &[],
            mcp_resource_client: None,
            extension_metrics: None,
            session_store: store,
            thread_store: store,
        })
        .await;
}

#[tokio::test]
async fn experimental_prewarm_starts_before_input_and_reuses_the_inflight_request() {
    let server = MockServer::start().await;
    let started = Arc::new(Notify::new());
    Mock::given(method("GET"))
        .and(path("/backend-api/wham/settings/user"))
        .respond_with({
            let started = Arc::clone(&started);
            move |_: &wiremock::Request| {
                started.notify_one();
                ResponseTemplate::new(200)
                    .set_delay(Duration::from_millis(150))
                    .set_body_json(serde_json::json!({"commit_attribution_enabled": true}))
            }
        })
        .expect(1)
        .mount(&server)
        .await;
    let extension = extension(&server, true);
    let store = codex_extension_api::ExtensionData::new("prewarm");
    tokio::time::timeout(Duration::from_millis(50), start(&extension, &store))
        .await
        .expect("opening the thread must not wait for the network");
    start(&extension, &store).await;
    tokio::time::timeout(Duration::from_secs(5), started.notified())
        .await
        .expect("settings request should start before the first turn");
    assert!(
        extension
            .resolve_policy(&store)
            .await
            .unwrap()
            .unwrap()
            .enabled
    );
    server.verify().await;
}

#[tokio::test]
async fn native_mode_does_not_schedule_or_consume_speculative_policy() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/backend-api/wham/settings/user"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({"commit_attribution_enabled": false})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let extension = extension(&server, false);
    let store = codex_extension_api::ExtensionData::new("native");
    start(&extension, &store).await;
    assert!(store.get::<super::policy::PolicyPrewarm>().is_none());
    assert!(server.received_requests().await.unwrap().is_empty());

    // An injected prewarm cannot bypass the startup-owned gate.
    let other = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({"commit_attribution_enabled": true})),
        )
        .mount(&other)
        .await;
    store.insert(super::policy::PolicyPrewarm::start(
        Arc::clone(&extension.auth_manager),
        format!("{}/backend-api", other.uri()),
        http_client_factory(),
    ));
    assert!(
        !extension
            .resolve_policy(&store)
            .await
            .unwrap()
            .unwrap()
            .enabled
    );
    server.verify().await;
}

#[tokio::test]
async fn prewarm_is_discarded_when_auth_changes_before_first_turn() {
    let server = MockServer::start().await;
    let count = Arc::new(AtomicUsize::new(0));
    Mock::given(method("GET"))
        .and(path("/backend-api/wham/settings/user"))
        .respond_with({
            let count = Arc::clone(&count);
            move |_: &wiremock::Request| {
                ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "commit_attribution_enabled": count.fetch_add(1, Ordering::SeqCst) == 0
                }))
            }
        })
        .expect(2)
        .mount(&server)
        .await;
    let extension = extension(&server, true);
    let store = codex_extension_api::ExtensionData::new("auth-change");
    start(&extension, &store).await;
    let prewarm = store.get::<super::policy::PolicyPrewarm>().unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if prewarm.is_finished() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("prewarm should finish");
    set_auth(&extension.auth_manager, "workspace-new").await;
    let result = extension.resolve_policy(&store).await.unwrap().unwrap();
    assert!(!result.enabled);
    assert_eq!(
        result.auth_generation,
        super::policy::auth_generation(&extension.auth_manager)
    );
    server.verify().await;
}

#[tokio::test]
async fn stopping_thread_cancels_and_joins_policy_prewarm() {
    use codex_extension_api::ThreadLifecycleContributor;
    let server = MockServer::start().await;
    let started = Arc::new(Notify::new());
    Mock::given(method("GET"))
        .respond_with({
            let started = Arc::clone(&started);
            move |_: &wiremock::Request| {
                started.notify_one();
                ResponseTemplate::new(200).set_delay(Duration::from_secs(10))
            }
        })
        .mount(&server)
        .await;
    let extension = extension(&server, true);
    let store = Arc::new(codex_extension_api::ExtensionData::new("stop"));
    start(&extension, &store).await;
    tokio::time::timeout(Duration::from_secs(5), started.notified())
        .await
        .unwrap();
    let prewarm = store.get::<super::policy::PolicyPrewarm>().unwrap();
    set_auth(&extension.auth_manager, "workspace-closing").await;
    let resolving = tokio::spawn({
        let extension = extension.clone();
        let store = Arc::clone(&store);
        async move { extension.resolve_policy(&store).await }
    });
    tokio::task::yield_now().await;
    tokio::time::timeout(
        Duration::from_millis(100),
        <super::GitAttributionExtension as ThreadLifecycleContributor<()>>::on_thread_stop(
            &extension,
            codex_extension_api::ThreadStopInput {
                session_store: &store,
                thread_store: &store,
            },
        ),
    )
    .await
    .expect("stop must cancel instead of waiting for the request timeout");
    assert!(prewarm.is_finished());
    assert!(store.get::<super::policy::PolicyPrewarm>().is_none());
    assert!(resolving.await.unwrap().unwrap().is_none());
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn completed_prewarm_removes_the_policy_wait_from_first_turn() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/backend-api/wham/settings/user"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(Duration::from_millis(150))
                .set_body_json(serde_json::json!({"commit_attribution_enabled": true})),
        )
        .expect(2)
        .mount(&server)
        .await;
    let cold = extension(&server, false);
    let cold_store = codex_extension_api::ExtensionData::new("cold");
    let before = std::time::Instant::now();
    assert!(
        cold.resolve_policy(&cold_store)
            .await
            .unwrap()
            .unwrap()
            .enabled
    );
    let cold_ms = before.elapsed().as_secs_f64() * 1000.0;

    let warm = extension(&server, true);
    let warm_store = codex_extension_api::ExtensionData::new("warm");
    start(&warm, &warm_store).await;
    let prewarm = warm_store.get::<super::policy::PolicyPrewarm>().unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while !prewarm.is_finished() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("background initialization should complete");
    let before = std::time::Instant::now();
    assert!(
        warm.resolve_policy(&warm_store)
            .await
            .unwrap()
            .unwrap()
            .enabled
    );
    let warm_ms = before.elapsed().as_secs_f64() * 1000.0;
    eprintln!("controlled policy lookup: cold_ms={cold_ms:.3} warm_ms={warm_ms:.3}");
    server.verify().await;
}

#[tokio::test]
async fn failed_prewarm_is_consumed_so_a_later_turn_can_retry() {
    let server = MockServer::start().await;
    let count = Arc::new(AtomicUsize::new(0));
    Mock::given(method("GET"))
        .and(path("/backend-api/wham/settings/user"))
        .respond_with(move |_: &wiremock::Request| {
            if count.fetch_add(1, Ordering::SeqCst) == 0 {
                ResponseTemplate::new(403)
            } else {
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"commit_attribution_enabled": true}))
            }
        })
        .expect(2)
        .mount(&server)
        .await;
    let extension = extension(&server, true);
    let store = codex_extension_api::ExtensionData::new("retry");
    start(&extension, &store).await;
    assert!(extension.resolve_policy(&store).await.unwrap().is_none());
    assert!(store.get::<super::policy::PolicyPrewarm>().is_none());
    assert!(
        extension
            .resolve_policy(&store)
            .await
            .unwrap()
            .unwrap()
            .enabled
    );
    server.verify().await;
}

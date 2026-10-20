//! Local preparation diagnostics, enabled only by the UI-owned backend gate.

use std::future::Future;
use std::time::Instant;

use crate::config::Config;
use codex_protocol::ThreadId;

pub(crate) struct PreparationTiming<'a> {
    config: &'a Config,
    thread_id: &'a ThreadId,
    turn_id: &'a str,
}

impl<'a> PreparationTiming<'a> {
    pub(crate) fn new(config: &'a Config, thread_id: &'a ThreadId, turn_id: &'a str) -> Self {
        Self {
            config,
            thread_id,
            turn_id,
        }
    }

    pub(crate) fn phase(&self, phase: &'static str) -> PreparationPhase<'_> {
        PreparationPhase {
            thread_id: self.thread_id,
            turn_id: self.turn_id,
            phase,
            started: self.config.experimental_backend.then(Instant::now),
            finished: false,
        }
    }

    pub(crate) async fn measure<F: Future>(&self, phase: &'static str, work: F) -> F::Output {
        let timing = self.phase(phase);
        let output = work.await;
        timing.finish();
        output
    }
}

#[must_use]
pub(crate) struct PreparationPhase<'a> {
    thread_id: &'a ThreadId,
    turn_id: &'a str,
    phase: &'static str,
    started: Option<Instant>,
    finished: bool,
}

impl PreparationPhase<'_> {
    // Finished means the measured future returned, including an error or a blocked hook.
    pub(crate) fn finish(mut self) {
        self.finished = true;
    }
}

impl Drop for PreparationPhase<'_> {
    fn drop(&mut self) {
        if let Some(started) = self.started {
            tracing::info!(
                target: "codex_core::turn_preparation",
                thread_id = %self.thread_id,
                turn_id = self.turn_id,
                phase = self.phase,
                duration_ms = started.elapsed().as_secs_f64() * 1000.0,
                outcome = if self.finished { "finished" } else { "interrupted" },
                "turn preparation phase"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::FutureExt;
    use tracing_test::internal::MockWriter;

    #[tokio::test]
    async fn preparation_measurement_respects_backend_gate_even_when_called_directly() {
        let mut config = crate::config::test_config().await;
        let thread_id = ThreadId::default();
        for enabled in [false, true] {
            config.experimental_backend = enabled;
            let buffer = Box::leak(Box::new(std::sync::Mutex::new(Vec::new())));
            let subscriber = tracing_subscriber::fmt()
                .without_time()
                .with_ansi(false)
                .with_writer(MockWriter::new(buffer))
                .finish();
            let _subscriber_guard = tracing::subscriber::set_default(subscriber);
            let timing = PreparationTiming::new(&config, &thread_id, "turn-test");
            let output = timing
                .measure("input_context", async { Err::<(), _>("unchanged") })
                .await;
            assert_eq!(output, Err("unchanged"));
            timing.phase("direct_phase").finish();
            let logs =
                String::from_utf8(buffer.lock().expect("log buffer").clone()).expect("utf8 logs");
            if enabled {
                assert_eq!(logs.lines().count(), 2);
                assert!(logs.contains("phase=\"input_context\""));
                assert!(logs.contains("phase=\"direct_phase\""));
                assert!(logs.contains("turn_id=\"turn-test\""));
                assert!(logs.contains(&format!("thread_id={thread_id}")));
                assert!(logs.contains("duration_ms="));
                assert!(logs.contains("outcome=\"finished\""));
                assert!(!logs.contains("unchanged"));
            } else {
                assert!(logs.is_empty());
            }
        }
    }

    #[tokio::test]
    async fn nested_preparation_phases_share_the_backend_gate_and_turn() {
        let mut config = crate::config::test_config().await;
        let thread_id = ThreadId::default();
        for enabled in [false, true] {
            config.experimental_backend = enabled;
            let buffer = Box::leak(Box::new(std::sync::Mutex::new(Vec::new())));
            let subscriber = tracing_subscriber::fmt()
                .without_time()
                .with_ansi(false)
                .with_writer(MockWriter::new(buffer))
                .finish();
            let _subscriber_guard = tracing::subscriber::set_default(subscriber);
            let timing = PreparationTiming::new(&config, &thread_id, "nested-turn");
            let parent = timing.phase("initial_context");
            let value = timing.measure("context_environment", async { 42 }).await;
            parent.finish();
            assert_eq!(value, 42);
            let logs =
                String::from_utf8(buffer.lock().expect("log buffer").clone()).expect("utf8 logs");
            if enabled {
                assert_eq!(logs.lines().count(), 2);
                assert!(logs.contains("phase=\"initial_context\""));
                assert!(logs.contains("phase=\"context_environment\""));
                assert!(
                    logs.lines()
                        .all(|line| line.contains("turn_id=\"nested-turn\""))
                );
                assert_eq!(logs.matches("outcome=\"finished\"").count(), 2);
            } else {
                assert!(logs.is_empty());
            }
        }
    }

    #[tokio::test]
    async fn preparation_measurement_includes_time_awaiting_work() {
        let mut config = crate::config::test_config().await;
        config.experimental_backend = true;
        let thread_id = ThreadId::default();
        let buffer = Box::leak(Box::new(std::sync::Mutex::new(Vec::new())));
        let subscriber = tracing_subscriber::fmt()
            .without_time()
            .with_ansi(false)
            .with_writer(MockWriter::new(buffer))
            .finish();
        let _subscriber_guard = tracing::subscriber::set_default(subscriber);
        let timing = PreparationTiming::new(&config, &thread_id, "delayed-turn");
        timing
            .measure(
                "initial_context",
                tokio::time::sleep(std::time::Duration::from_millis(5)),
            )
            .await;
        let logs =
            String::from_utf8(buffer.lock().expect("log buffer").clone()).expect("utf8 logs");
        let duration_ms: f64 = logs
            .split("duration_ms=")
            .nth(1)
            .expect("duration field")
            .split_whitespace()
            .next()
            .expect("duration value")
            .parse()
            .expect("numeric milliseconds");
        assert!(duration_ms >= 5.0, "awaited work must count: {logs}");
    }

    #[tokio::test]
    async fn preparation_measurement_records_dropped_work_as_interrupted() {
        let mut config = crate::config::test_config().await;
        config.experimental_backend = true;
        let thread_id = ThreadId::default();
        let buffer = Box::leak(Box::new(std::sync::Mutex::new(Vec::new())));
        let subscriber = tracing_subscriber::fmt()
            .without_time()
            .with_ansi(false)
            .with_writer(MockWriter::new(buffer))
            .finish();
        let _subscriber_guard = tracing::subscriber::set_default(subscriber);
        let timing = PreparationTiming::new(&config, &thread_id, "cancelled-turn");
        assert!(
            timing
                .measure("mcp_requirements", std::future::pending::<()>())
                .now_or_never()
                .is_none()
        );
        drop(timing.phase("turn_setup_total"));
        let logs =
            String::from_utf8(buffer.lock().expect("log buffer").clone()).expect("utf8 logs");
        assert_eq!(logs.lines().count(), 2);
        assert_eq!(logs.matches("outcome=\"interrupted\"").count(), 2);
        assert!(!logs.contains("finished"));
    }
}

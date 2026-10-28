//! Dynamic workflows (Codex UI experimental backend).
//!
//! The `workflow` tool runs a JavaScript orchestration script in the code-mode host. The
//! script fans out one-shot sub-agents through `agent()`, groups them with `phase()`, and
//! its return value reaches the model as a `<workflow_result>` once the run ends. Progress is
//! a `workflow.run` extension item re-sent as snapshots.

mod agent;
mod handler;
mod journal;
mod result;
mod run;
mod script;

use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;

use tokio_util::sync::CancellationToken;

use crate::session::session::Session;

pub(crate) use handler::WorkflowHandler;
pub(crate) use result::WorkflowResult;

/// Multi-agent mode while Ultracode is on: workflows take over delegation at every effort level.
pub(crate) const ULTRACODE_MULTI_AGENT_MODE: &str = include_str!("ultracode_mode.md");

/// Live runs of one thread, plus the workflow names approved for this session.
#[derive(Default)]
pub(crate) struct WorkflowRuns {
    runs: Mutex<HashMap<String, RunControl>>,
    session_approved: Mutex<HashSet<String>>,
}

#[derive(Clone)]
struct RunControl {
    cancel: CancellationToken,
    stopped: Arc<AtomicBool>,
}

impl WorkflowRuns {
    fn of(session: &Session) -> Arc<Self> {
        session
            .services
            .thread_extension_data
            .get_or_init(Self::default)
    }

    fn insert(&self, run_id: &str, control: RunControl) -> bool {
        let mut runs = self
            .runs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if runs.contains_key(run_id) {
            return false;
        }
        runs.insert(run_id.to_string(), control);
        true
    }

    fn remove(&self, run_id: &str) {
        self.runs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(run_id);
    }

    fn is_running(&self, run_id: &str) -> bool {
        self.runs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains_key(run_id)
    }

    fn approved(&self, name: &str) -> bool {
        self.session_approved
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains(name)
    }

    fn approve(&self, name: &str) {
        self.session_approved
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(name.to_string());
    }
}

/// Stops a run and every agent it started; `false` when it is not running here.
pub(crate) fn stop(session: &Session, run_id: &str) -> bool {
    let control = WorkflowRuns::of(session)
        .runs
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(run_id)
        .cloned();
    match control {
        Some(control) => {
            control.stopped.store(true, Ordering::Release);
            control.cancel.cancel();
            true
        }
        None => false,
    }
}

/// Run ids still live in this thread (running or awaiting approval).
pub(crate) fn running(session: &Session) -> Vec<String> {
    let mut ids: Vec<String> = WorkflowRuns::of(session)
        .runs
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .keys()
        .cloned()
        .collect();
    ids.sort();
    ids
}

/// Stops every run without reporting back to the model (session shutdown).
pub(crate) fn stop_all(session: &Session) {
    for run_id in running(session) {
        stop(session, &run_id);
    }
}

#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;

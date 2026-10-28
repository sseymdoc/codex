//! Resume journal: each finished `agent()` call's result, keyed by its inputs.
//!
//! A resumed run answers calls from the journal until the first call it cannot answer;
//! from then on every call runs live (the longest unchanged prefix is reused).

use std::collections::BTreeMap;
use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;

use serde_json::Value as JsonValue;
use serde_json::json;
use tokio::io::AsyncWriteExt;

pub(super) const JOURNAL_FILE: &str = "journal.jsonl";

pub(super) struct Journal {
    path: PathBuf,
    cached: HashMap<(String, u32), JsonValue>,
    seen: Mutex<HashMap<String, u32>>,
    diverged: AtomicBool,
    writer: tokio::sync::Mutex<()>,
}

impl Journal {
    /// Starts a fresh journal, or loads the previous one of the same run when resuming.
    pub(super) async fn open(dir: &Path, resume: bool) -> std::io::Result<Self> {
        tokio::fs::create_dir_all(dir).await?;
        let path = dir.join(JOURNAL_FILE);
        let mut cached = HashMap::new();
        if resume {
            let text = tokio::fs::read_to_string(&path).await?;
            for line in text.lines() {
                let Ok(entry) = serde_json::from_str::<JsonValue>(line) else {
                    continue;
                };
                if entry["type"] == "result"
                    && let (Some(key), Some(n)) = (entry["key"].as_str(), entry["n"].as_u64())
                {
                    cached.insert((key.to_string(), n as u32), entry["result"].clone());
                }
            }
        } else {
            tokio::fs::write(&path, format!("{}\n", json!({"type": "launched"}))).await?;
        }
        Ok(Self {
            path,
            cached,
            seen: Mutex::new(HashMap::new()),
            diverged: AtomicBool::new(!resume),
            writer: tokio::sync::Mutex::new(()),
        })
    }

    /// Claims the next occurrence of `key`; returns it with the cached result, if any.
    pub(super) fn lookup(&self, key: &str) -> (u32, Option<JsonValue>) {
        let occurrence = {
            let mut seen = self
                .seen
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let n = seen.entry(key.to_string()).or_insert(0);
            *n += 1;
            *n
        };
        if self.diverged.load(Ordering::Acquire) {
            return (occurrence, None);
        }
        match self.cached.get(&(key.to_string(), occurrence)) {
            Some(result) => (occurrence, Some(result.clone())),
            None => {
                self.diverged.store(true, Ordering::Release);
                (occurrence, None)
            }
        }
    }

    #[expect(
        clippy::await_holding_invalid_type,
        reason = "appends must not interleave; the guard protects only this file write"
    )]
    pub(super) async fn record(&self, key: &str, occurrence: u32, result: &JsonValue) {
        let line = format!(
            "{}\n",
            json!({"type": "result", "key": key, "n": occurrence, "result": result})
        );
        let _guard = self.writer.lock().await;
        let file = tokio::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(&self.path)
            .await;
        if let Ok(mut file) = file
            && let Err(error) = file.write_all(line.as_bytes()).await
        {
            tracing::warn!(%error, "failed to append workflow journal");
        }
    }
}

/// Stable cache key for an `agent()` call: its prompt and result-shaping options.
pub(super) fn call_key(prompt: &str, options: &JsonValue) -> String {
    canonical(&json!({"prompt": prompt, "options": options}))
}

/// JSON with object keys sorted, independent of map ordering.
pub(super) fn canonical(value: &JsonValue) -> String {
    fn sort(value: &JsonValue) -> JsonValue {
        match value {
            JsonValue::Object(map) => {
                let sorted: BTreeMap<&String, JsonValue> =
                    map.iter().map(|(key, value)| (key, sort(value))).collect();
                let mut out = serde_json::Map::new();
                for (key, value) in sorted {
                    out.insert(key.clone(), value);
                }
                JsonValue::Object(out)
            }
            JsonValue::Array(items) => JsonValue::Array(items.iter().map(sort).collect()),
            other => other.clone(),
        }
    }
    sort(value).to_string()
}

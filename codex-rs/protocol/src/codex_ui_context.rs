use codex_utils_absolute_path::AbsolutePathBuf;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Fixed, host-owned sections. This cannot enable the experimental backend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexUiContext {
    pub cwd: AbsolutePathBuf,
    pub planning: CodexUiPlanningContext,
    pub browser_verification: CodexUiBrowserContext,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexUiPlanningContext {
    pub enabled: bool,
    pub text: String,
    pub disabled_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexUiBrowserContext {
    pub tools_enabled: bool,
    pub auto_verify: bool,
    pub text: String,
    pub disabled_text: String,
    pub edit_reminder: String,
}

impl CodexUiContext {
    pub fn validate(&self) -> Result<(), &'static str> {
        let texts = [
            &self.planning.text,
            &self.planning.disabled_text,
            &self.browser_verification.text,
            &self.browser_verification.disabled_text,
            &self.browser_verification.edit_reminder,
        ];
        if texts.iter().map(|text| text.len()).sum::<usize>() > 8192 {
            return Err("codexUiContext text exceeds 8 KiB");
        }
        if texts.iter().any(|text| text.trim().is_empty()) {
            return Err("codexUiContext requires non-empty module text");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_utf8_bytes_without_truncating_or_accepting_empty_revocations() {
        let mut context = CodexUiContext {
            cwd: AbsolutePathBuf::current_dir().unwrap(),
            planning: CodexUiPlanningContext {
                enabled: true,
                text: "plan".into(),
                disabled_text: "off".into(),
            },
            browser_verification: CodexUiBrowserContext {
                tools_enabled: true,
                auto_verify: true,
                text: "browser".into(),
                disabled_text: "off".into(),
                edit_reminder: "verify".into(),
            },
        };
        assert!(context.validate().is_ok());
        context.planning.text = "界".repeat(3000);
        assert_eq!(context.validate(), Err("codexUiContext text exceeds 8 KiB"));
        context.planning.text = "plan".into();
        context.planning.disabled_text = " \n".into();
        assert!(context.validate().is_err());
    }
}

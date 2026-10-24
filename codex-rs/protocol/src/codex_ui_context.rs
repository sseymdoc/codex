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
    /// Omitted/null preserves the previously applied desktop module.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub desktop: Option<CodexUiDesktopContext>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexUiDesktopContext {
    pub enabled: bool,
    pub text: String,
    pub disabled_text: String,
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
        let mut texts = vec![
            &self.planning.text,
            &self.planning.disabled_text,
            &self.browser_verification.text,
            &self.browser_verification.disabled_text,
            &self.browser_verification.edit_reminder,
        ];
        if let Some(desktop) = &self.desktop {
            texts.extend([&desktop.text, &desktop.disabled_text]);
        }
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
            desktop: None,
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
        context.planning.disabled_text = "off".into();
        let mut old_payload = serde_json::to_value(&context).unwrap();
        assert!(old_payload.get("desktop").is_none());
        assert!(
            serde_json::from_value::<CodexUiContext>(old_payload.clone())
                .unwrap()
                .desktop
                .is_none()
        );
        old_payload["desktop"] = serde_json::Value::Null;
        assert!(
            serde_json::from_value::<CodexUiContext>(old_payload)
                .unwrap()
                .desktop
                .is_none()
        );
        context.desktop = Some(CodexUiDesktopContext {
            enabled: true,
            text: "界".repeat(2722),
            disabled_text: "off".into(),
        });
        assert!(
            context.validate().is_ok(),
            "all seven texts total exactly 8192 UTF-8 bytes"
        );
        context.desktop.as_mut().unwrap().text.push('x');
        assert_eq!(context.validate(), Err("codexUiContext text exceeds 8 KiB"));
        context.desktop.as_mut().unwrap().text = "desktop".into();
        context.desktop.as_mut().unwrap().disabled_text = " ".into();
        assert!(context.validate().is_err());
    }
}

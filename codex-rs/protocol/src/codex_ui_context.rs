use codex_utils_absolute_path::AbsolutePathBuf;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Total UTF-8 bytes of host text, matching Claude Desktop's system prompt append cap.
pub const CODEX_UI_CONTEXT_MAX_BYTES: usize = 512 * 1024;

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
    /// Dynamic workflows. Omitted/null keeps the `workflow` tool off; send it only to a
    /// backend that reports `codexUiWorkflows`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub workflows: Option<CodexUiWorkflowsContext>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexUiWorkflowsContext {
    /// The dynamic workflows setting: offers the `workflow` tool.
    pub enabled: bool,
    /// Ultracode is on for this thread: a standing opt-in to orchestrate with workflows.
    pub ultracode: bool,
    /// Sent when Ultracode turns on.
    pub ultracode_text: String,
    /// Sent when Ultracode turns off after having been on.
    pub ultracode_disabled_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexUiDesktopContext {
    pub enabled: bool,
    pub text: String,
    pub disabled_text: String,
    /// V2 local tool guidance, selected from the same snapshot as tool execution.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub tools_text: Option<String>,
    /// V2 revocation. Present without tools_text explicitly disables local tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub tools_disabled_text: Option<String>,
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
            if desktop.tools_text.is_some() && desktop.tools_disabled_text.is_none() {
                return Err("codexUiContext desktop tools require revocation text");
            }
            texts.extend(desktop.tools_text.iter());
            texts.extend(desktop.tools_disabled_text.iter());
        }
        if let Some(workflows) = &self.workflows {
            texts.extend([
                &workflows.ultracode_text,
                &workflows.ultracode_disabled_text,
            ]);
        }
        if texts.iter().map(|text| text.len()).sum::<usize>() > CODEX_UI_CONTEXT_MAX_BYTES {
            return Err("codexUiContext text exceeds 512 KiB");
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
            workflows: None,
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
        context.planning.text = "界".repeat(CODEX_UI_CONTEXT_MAX_BYTES / 3 + 1);
        assert_eq!(
            context.validate(),
            Err("codexUiContext text exceeds 512 KiB")
        );
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
            text: "界".repeat((CODEX_UI_CONTEXT_MAX_BYTES - 26) / 3),
            disabled_text: "off".into(),
            tools_text: None,
            tools_disabled_text: None,
        });
        assert!(
            context.validate().is_ok(),
            "all seven texts total exactly 512 KiB of UTF-8 bytes"
        );
        context.desktop.as_mut().unwrap().text.push('x');
        assert_eq!(
            context.validate(),
            Err("codexUiContext text exceeds 512 KiB")
        );
        context.desktop.as_mut().unwrap().text = "desktop".into();
        context.desktop.as_mut().unwrap().disabled_text = " ".into();
        assert!(context.validate().is_err());
        let desktop = context.desktop.as_mut().unwrap();
        desktop.disabled_text = "off".into();
        desktop.tools_text = Some("tools".into());
        assert!(context.validate().is_err());
        context.desktop.as_mut().unwrap().tools_disabled_text = Some("tools off".into());
        assert!(context.validate().is_ok());
        context.desktop.as_mut().unwrap().tools_text =
            Some("界".repeat(CODEX_UI_CONTEXT_MAX_BYTES / 3 + 1));
        assert_eq!(
            context.validate(),
            Err("codexUiContext text exceeds 512 KiB")
        );
        context.desktop.as_mut().unwrap().tools_text = None;
        assert!(context.validate().is_ok());
        context.desktop.as_mut().unwrap().tools_disabled_text = Some(" \n".into());
        assert!(context.validate().is_err());
    }
}

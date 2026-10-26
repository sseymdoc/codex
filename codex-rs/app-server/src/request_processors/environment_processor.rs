use super::*;
use codex_app_server_protocol::FsReadDirectoryEntry;
use codex_config::ScopedSkillsConfig;
use codex_exec_server::RemoteEnvironmentOptions;
use codex_exec_server::StdioEnvironmentOptions;
use std::time::Duration;

#[derive(Clone)]
pub(crate) struct EnvironmentRequestProcessor {
    environment_manager: Arc<EnvironmentManager>,
    /// Codex UI's experimental backend: the only switch that admits stdio environments.
    experimental_backend: bool,
}

impl EnvironmentRequestProcessor {
    pub(crate) fn new(
        environment_manager: Arc<EnvironmentManager>,
        experimental_backend: bool,
    ) -> Self {
        Self {
            environment_manager,
            experimental_backend,
        }
    }

    fn require_experimental_backend(&self, method: &str) -> Result<(), JSONRPCErrorError> {
        if self.experimental_backend {
            Ok(())
        } else {
            Err(invalid_request(format!(
                "{method} requires the Codex UI experimental backend"
            )))
        }
    }

    pub(crate) async fn environment_add_stdio(
        &self,
        params: EnvironmentAddStdioParams,
    ) -> Result<Option<ClientResponsePayload>, JSONRPCErrorError> {
        self.require_experimental_backend("environment/addStdio")?;
        let options = StdioEnvironmentOptions {
            program: params.program,
            args: params.args,
            env: params.env.unwrap_or_default(),
            cwd: params.cwd.map(AbsolutePathBuf::into_path_buf),
        };
        self.environment_manager
            .upsert_stdio_environment(
                params.environment_id,
                options,
                ScopedSkillsConfig::default(),
            )
            .map_err(|err| invalid_request(err.to_string()))?;
        Ok(Some(EnvironmentAddStdioResponse {}.into()))
    }

    pub(crate) async fn environment_read_directory(
        &self,
        params: EnvironmentReadDirectoryParams,
    ) -> Result<Option<ClientResponsePayload>, JSONRPCErrorError> {
        self.require_experimental_backend("environment/readDirectory")?;
        let environment_id = params.environment_id;
        let environment = self
            .environment_manager
            .get_environment(&environment_id)
            .ok_or_else(|| invalid_request(format!("unknown environment id `{environment_id}`")))?;
        let path = params.path.to_inferred_path_uri().ok_or_else(|| {
            invalid_request(format!(
                "path `{}` does not use absolute POSIX or Windows path syntax",
                params.path
            ))
        })?;
        let entries = environment
            .get_filesystem()
            .read_directory(&path, /*sandbox*/ None)
            .await
            .map_err(|err| {
                internal_error(format!(
                    "failed to read a directory of environment `{environment_id}`: {err}"
                ))
            })?;
        Ok(Some(
            EnvironmentReadDirectoryResponse {
                entries: entries
                    .into_iter()
                    .map(|entry| FsReadDirectoryEntry {
                        file_name: entry.file_name,
                        is_directory: entry.is_directory,
                        is_file: entry.is_file,
                    })
                    .collect(),
            }
            .into(),
        ))
    }

    pub(crate) async fn environment_add(
        &self,
        params: EnvironmentAddParams,
    ) -> Result<Option<ClientResponsePayload>, JSONRPCErrorError> {
        let skills = ScopedSkillsConfig {
            required: params
                .skills
                .and_then(|skills| skills.required)
                .unwrap_or_default(),
        };
        let options = RemoteEnvironmentOptions {
            exec_server_url: params.exec_server_url,
            connect_timeout: params.connect_timeout_ms.map(Duration::from_millis),
            http_headers: params
                .auth_bearer_token
                .into_iter()
                .map(|token| {
                    (
                        "Authorization".to_string(),
                        format!("Bearer {}", token.into_inner()),
                    )
                })
                .chain(
                    params
                        .websocket_request_id
                        .map(|request_id| ("X-Request-ID".to_string(), request_id)),
                )
                .collect(),
        };
        self.environment_manager
            .upsert_environment_with_options(params.environment_id, options, skills)
            .map_err(|err| invalid_request(err.to_string()))?;
        Ok(Some(EnvironmentAddResponse {}.into()))
    }

    pub(crate) async fn environment_info(
        &self,
        params: EnvironmentInfoParams,
    ) -> Result<Option<ClientResponsePayload>, JSONRPCErrorError> {
        let environment_id = params.environment_id;
        let environment = self
            .environment_manager
            .get_environment(&environment_id)
            .ok_or_else(|| invalid_request(format!("unknown environment id `{environment_id}`")))?;
        let info = environment.force_info().await.map_err(|err| {
            internal_error(format!(
                "failed to get info for environment `{environment_id}`: {err}"
            ))
        })?;
        Ok(Some(
            EnvironmentInfoResponse {
                shell: EnvironmentShellInfo {
                    name: info.shell.name,
                    path: info.shell.path,
                },
                cwd: info.cwd,
            }
            .into(),
        ))
    }

    pub(crate) async fn environment_status(
        &self,
        params: EnvironmentStatusParams,
    ) -> Result<Option<ClientResponsePayload>, JSONRPCErrorError> {
        let environment_id = params.environment_id;
        let (status, error) = match self
            .environment_manager
            .get_environment_status(&environment_id)
            .await
        {
            Some(EnvironmentObservedStatus::Ready) => (EnvironmentStatusKind::Ready, None),
            Some(EnvironmentObservedStatus::Pending) => (EnvironmentStatusKind::Pending, None),
            Some(EnvironmentObservedStatus::Disconnected { error }) => {
                (EnvironmentStatusKind::Disconnected, Some(error))
            }
            None => (
                EnvironmentStatusKind::Unknown,
                Some(format!("unknown environment id `{environment_id}`")),
            ),
        };
        Ok(Some(EnvironmentStatusResponse { status, error }.into()))
    }
}

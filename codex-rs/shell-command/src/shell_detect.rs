use std::path::PathBuf;

use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, PartialEq, Eq, Clone, Copy, Serialize, Deserialize)]
pub enum ShellType {
    Zsh,
    Bash,
    PowerShell,
    Sh,
    Cmd,
}

impl ShellType {
    pub fn name(self) -> &'static str {
        match self {
            Self::Zsh => "zsh",
            Self::Bash => "bash",
            Self::PowerShell => "powershell",
            Self::Sh => "sh",
            Self::Cmd => "cmd",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetectedShell {
    pub shell_type: ShellType,
    pub shell_path: PathBuf,
}

impl DetectedShell {
    pub fn name(&self) -> &'static str {
        self.shell_type.name()
    }
}

pub fn detect_shell_type(shell_path: impl AsRef<std::path::Path>) -> Option<ShellType> {
    let shell_path = shell_path.as_ref();
    match shell_path.as_os_str().to_str() {
        Some("zsh") => Some(ShellType::Zsh),
        Some("sh") => Some(ShellType::Sh),
        Some("cmd") => Some(ShellType::Cmd),
        Some("bash") => Some(ShellType::Bash),
        Some("pwsh") => Some(ShellType::PowerShell),
        Some("powershell") => Some(ShellType::PowerShell),
        _ => {
            let shell_name = shell_path.file_stem();
            if let Some(shell_name) = shell_name {
                let shell_name_path = std::path::Path::new(shell_name);
                if shell_name_path != shell_path {
                    return detect_shell_type(shell_name_path);
                }
            }
            None
        }
    }
}

#[cfg(unix)]
fn get_user_shell_path() -> Option<PathBuf> {
    get_user_path(|passwd| passwd.pw_shell)
        .map(|path| PathBuf::from(path.to_string_lossy().into_owned()))
}

/// Read the current account's home directory without consulting the environment.
#[cfg(unix)]
pub fn get_user_home_path() -> Option<PathBuf> {
    get_user_path(|passwd| passwd.pw_dir).filter(|path| !path.as_os_str().is_empty())
}

#[cfg(unix)]
fn get_user_path(field: fn(&libc::passwd) -> *mut libc::c_char) -> Option<PathBuf> {
    let uid = unsafe { libc::getuid() };
    use std::ffi::CStr;
    use std::mem::MaybeUninit;
    use std::os::unix::ffi::OsStrExt;
    use std::ptr;

    let mut passwd = MaybeUninit::<libc::passwd>::uninit();

    // We cannot use getpwuid here: it returns pointers into libc-managed
    // storage, which is not safe to read concurrently on all targets (the musl
    // static build used by the CLI can segfault when parallel callers race on
    // that buffer). getpwuid_r keeps the passwd data in caller-owned memory.
    let suggested_buffer_len = unsafe { libc::sysconf(libc::_SC_GETPW_R_SIZE_MAX) };
    let buffer_len = usize::try_from(suggested_buffer_len)
        .ok()
        .filter(|len| *len > 0)
        .unwrap_or(1024);
    let mut buffer = vec![0; buffer_len];

    loop {
        let mut result = ptr::null_mut();
        let status = unsafe {
            libc::getpwuid_r(
                uid,
                passwd.as_mut_ptr(),
                buffer.as_mut_ptr().cast(),
                buffer.len(),
                &mut result,
            )
        };

        if status == 0 {
            if result.is_null() {
                return None;
            }

            let passwd = unsafe { passwd.assume_init_ref() };
            let path = field(passwd);
            if path.is_null() {
                return None;
            }

            // Both callers select a field stored in the still-live passwd buffer.
            let path = unsafe { CStr::from_ptr(path) };
            return Some(PathBuf::from(std::ffi::OsStr::from_bytes(path.to_bytes())));
        }

        if status != libc::ERANGE {
            return None;
        }

        // Retry with a larger buffer until libc can materialize the passwd entry.
        let new_len = buffer.len().checked_mul(2)?;
        if new_len > 1024 * 1024 {
            return None;
        }
        buffer.resize(new_len, 0);
    }
}

#[cfg(not(unix))]
fn get_user_shell_path() -> Option<PathBuf> {
    None
}

fn file_exists(path: &std::path::Path) -> Option<PathBuf> {
    if std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file()) {
        Some(PathBuf::from(path))
    } else {
        None
    }
}

// Store PowerShell cannot run under MXC and can be inaccessible to the elevated sandbox account;
// WindowsApps also contains valid Codex frameworks.
fn is_inaccessible_windows_apps_powershell_path(path: &std::path::Path) -> bool {
    path.as_os_str()
        .to_string_lossy()
        .split(['\\', '/'])
        .skip_while(|component| !component.eq_ignore_ascii_case("WindowsApps"))
        .nth(1)
        .is_some_and(|component| {
            component.eq_ignore_ascii_case("pwsh.exe")
                || component.eq_ignore_ascii_case("powershell.exe")
                || component
                    .to_ascii_lowercase()
                    .starts_with("microsoft.powershell")
        })
}

fn targets_inaccessible_windows_apps_powershell(path: &std::path::Path) -> bool {
    is_inaccessible_windows_apps_powershell_path(path)
        || std::fs::canonicalize(path)
            .ok()
            .is_some_and(|resolved| is_inaccessible_windows_apps_powershell_path(&resolved))
}

fn is_windows_sandbox_compatible_powershell_path(path: &std::path::Path) -> bool {
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    {
        return false;
    }

    !targets_inaccessible_windows_apps_powershell(path)
}

fn get_windows_sandbox_compatible_powershell_path(
    binary_name: &str,
    fallback_paths: &[&str],
) -> Option<PathBuf> {
    if let Ok(mut paths) = which::which_all(binary_name)
        && let Some(path) = paths.find(|path| is_windows_sandbox_compatible_powershell_path(path))
    {
        return Some(path);
    }

    for path in fallback_paths {
        let path = std::path::Path::new(path);
        if is_windows_sandbox_compatible_powershell_path(path)
            && let Some(path) = file_exists(path)
        {
            return Some(path);
        }
    }

    None
}

fn get_shell_path(
    shell_type: ShellType,
    binary_name: &str,
    fallback_paths: &[&str],
) -> Option<PathBuf> {
    let default_shell_path = get_user_shell_path();
    if let Some(default_shell_path) = default_shell_path
        && detect_shell_type(&default_shell_path) == Some(shell_type)
        && file_exists(&default_shell_path).is_some()
    {
        return Some(default_shell_path);
    }

    if let Ok(path) = which::which(binary_name) {
        return Some(path);
    }

    for path in fallback_paths {
        if let Some(path) = file_exists(std::path::Path::new(path)) {
            return Some(path);
        }
    }

    None
}

const ZSH_FALLBACK_PATHS: &[&str] = &["/bin/zsh"];

fn get_zsh_shell() -> Option<DetectedShell> {
    let shell_path = get_shell_path(ShellType::Zsh, "zsh", ZSH_FALLBACK_PATHS);

    shell_path.map(|shell_path| DetectedShell {
        shell_type: ShellType::Zsh,
        shell_path,
    })
}

const BASH_FALLBACK_PATHS: &[&str] = &["/bin/bash", "/usr/bin/bash"];

fn get_bash_shell() -> Option<DetectedShell> {
    let shell_path = get_shell_path(ShellType::Bash, "bash", BASH_FALLBACK_PATHS);

    shell_path.map(|shell_path| DetectedShell {
        shell_type: ShellType::Bash,
        shell_path,
    })
}

/// Finds Git for Windows' bash: the standard install directories first, then the installation
/// that owns a `git.exe` on `PATH`. Never returns the WSL `bash.exe` launchers.
pub fn get_git_bash_shell() -> Option<DetectedShell> {
    if !cfg!(windows) {
        return None;
    }
    let install_roots = ["ProgramFiles", "ProgramFiles(x86)"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(|dir| PathBuf::from(dir).join("Git"));
    // `<root>\cmd\git.exe`, `<root>\bin\git.exe` or `<root>\mingw64\bin\git.exe`.
    let path_roots = which::which_all("git")
        .into_iter()
        .flatten()
        .flat_map(|git| {
            git.ancestors()
                .skip(2)
                .take(2)
                .map(std::path::Path::to_path_buf)
                .collect::<Vec<_>>()
        });
    find_git_bash(install_roots.chain(path_roots)).map(|shell_path| DetectedShell {
        shell_type: ShellType::Bash,
        shell_path,
    })
}

fn find_git_bash(roots: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    roots
        .into_iter()
        .flat_map(|root| {
            [
                root.join("bin").join("bash.exe"),
                root.join("usr").join("bin").join("bash.exe"),
            ]
        })
        .filter(|path| !is_wsl_launcher_location(path))
        .find_map(|path| file_exists(&path))
}

// System32 and WindowsApps hold the WSL `bash.exe` launchers, not Git Bash.
fn is_wsl_launcher_location(path: &std::path::Path) -> bool {
    path.components().any(|component| {
        let component = component.as_os_str();
        component.eq_ignore_ascii_case("System32") || component.eq_ignore_ascii_case("WindowsApps")
    })
}

const SH_FALLBACK_PATHS: &[&str] = &["/bin/sh"];

fn get_sh_shell() -> Option<DetectedShell> {
    let shell_path = get_shell_path(ShellType::Sh, "sh", SH_FALLBACK_PATHS);

    shell_path.map(|shell_path| DetectedShell {
        shell_type: ShellType::Sh,
        shell_path,
    })
}

// Note the `pwsh` and `powershell` fallback paths are where the respective
// shells are commonly installed on GitHub Actions Windows runners, but may not
// be present on all Windows machines:
// https://docs.github.com/en/actions/tutorials/build-and-test-code/powershell

#[cfg(windows)]
const PWSH_FALLBACK_PATHS: &[&str] = &[r#"C:\Program Files\PowerShell\7\pwsh.exe"#];
#[cfg(not(windows))]
const PWSH_FALLBACK_PATHS: &[&str] = &["/usr/local/bin/pwsh"];

#[cfg(windows)]
const POWERSHELL_FALLBACK_PATHS: &[&str] =
    &[r#"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"#];
#[cfg(not(windows))]
const POWERSHELL_FALLBACK_PATHS: &[&str] = &[];

fn get_powershell_shell() -> Option<DetectedShell> {
    let shell_path =
        get_shell_path(ShellType::PowerShell, "pwsh", PWSH_FALLBACK_PATHS).or_else(|| {
            get_shell_path(
                ShellType::PowerShell,
                "powershell",
                POWERSHELL_FALLBACK_PATHS,
            )
        });

    shell_path.map(|shell_path| DetectedShell {
        shell_type: ShellType::PowerShell,
        shell_path,
    })
}

/// Returns a replacement only when shell_path targets Store PowerShell and
/// an unpackaged PowerShell executable can be discovered.
///
/// The caller decides whether the sandbox backend requires a fallback. Normal shell discovery
/// intentionally keeps the user's ordered PATH selection unchanged.
pub fn fallback_powershell_shell_for_windows_sandbox(
    shell_path: &std::path::Path,
) -> Option<DetectedShell> {
    if !cfg!(windows) || !targets_inaccessible_windows_apps_powershell(shell_path) {
        return None;
    }

    let shell_path = get_windows_sandbox_compatible_powershell_path("pwsh", PWSH_FALLBACK_PATHS)
        .or_else(|| {
            get_windows_sandbox_compatible_powershell_path("powershell", POWERSHELL_FALLBACK_PATHS)
        })?;

    Some(DetectedShell {
        shell_type: ShellType::PowerShell,
        shell_path,
    })
}

fn get_cmd_shell() -> Option<DetectedShell> {
    let shell_path = get_shell_path(ShellType::Cmd, "cmd", &[]);

    shell_path.map(|shell_path| DetectedShell {
        shell_type: ShellType::Cmd,
        shell_path,
    })
}

pub fn ultimate_fallback_shell() -> DetectedShell {
    if cfg!(windows) {
        DetectedShell {
            shell_type: ShellType::Cmd,
            shell_path: PathBuf::from("cmd.exe"),
        }
    } else {
        DetectedShell {
            shell_type: ShellType::Sh,
            shell_path: PathBuf::from("/bin/sh"),
        }
    }
}

/// Uses the model-provided path only to select a shell type, then discovers its executable.
pub fn get_shell_by_model_provided_path(shell_path: &PathBuf) -> DetectedShell {
    detect_shell_type(shell_path)
        .and_then(get_shell)
        .unwrap_or_else(ultimate_fallback_shell)
}

pub fn get_shell(shell_type: ShellType) -> Option<DetectedShell> {
    match shell_type {
        ShellType::Zsh => get_zsh_shell(),
        ShellType::Bash => get_bash_shell(),
        ShellType::PowerShell => get_powershell_shell(),
        ShellType::Sh => get_sh_shell(),
        ShellType::Cmd => get_cmd_shell(),
    }
}

pub fn default_user_shell() -> DetectedShell {
    default_user_shell_from_path(get_user_shell_path())
}

pub fn default_user_shell_from_path(user_shell_path: Option<PathBuf>) -> DetectedShell {
    if cfg!(windows) {
        get_shell(ShellType::PowerShell).unwrap_or_else(ultimate_fallback_shell)
    } else {
        let user_default_shell = user_shell_path
            .and_then(|shell| detect_shell_type(&shell))
            .and_then(get_shell);

        let shell_with_fallback = if cfg!(target_os = "macos") {
            user_default_shell
                .or_else(|| get_shell(ShellType::Zsh))
                .or_else(|| get_shell(ShellType::Bash))
        } else {
            user_default_shell
                .or_else(|| get_shell(ShellType::Bash))
                .or_else(|| get_shell(ShellType::Zsh))
        };

        shell_with_fallback.unwrap_or_else(ultimate_fallback_shell)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn elevated_sandbox_filter_rejects_store_and_script_powershell_paths() {
        for path in [
            r"C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.4.0_x64__8wekyb3d8bbwe\pwsh.exe",
            r"C:\Program Files\WindowsApps\Microsoft.PowerShellPreview_8wekyb3d8bbwe\pwsh.exe",
            r"C:\Users\user\AppData\Local\Microsoft\WindowsApps\pwsh.exe",
            r"C:\Users\user\AppData\Local\Microsoft\WindowsApps\powershell.exe",
            r"C:\Users\user\AppData\Local\Microsoft\WindowsApps\Microsoft.PowerShell_8wekyb3d8bbwe\pwsh.exe",
            r"C:\PROGRAM FILES\WINDOWSAPPS\MICROSOFT.POWERSHELL\PWSH.EXE",
            r"C:\portable\pwsh.cmd",
        ] {
            assert!(!is_windows_sandbox_compatible_powershell_path(
                std::path::Path::new(path)
            ));
        }

        for path in [
            r"C:\Program Files\PowerShell\7\pwsh.exe",
            r"C:\Program Files\WindowsApps\OpenAI.CodexPrimaryRuntime.v26-813-10124-0_26.813.10124.0_x64__3k8sg7r9htsxt\dependencies\native\powershell\pwsh.exe",
            r"C:\Program Files\WindowsApps\OpenAI.CodexPrimaryRuntime.v26-813-10124-0_26.813.10124.0_arm64__3k8sg7r9htsxt\dependencies\native\powershell\pwsh.exe",
            r"C:\PROGRAM FILES\WINDOWSAPPS\OPENAI.CODEXPRIMARYRUNTIME.V26-813-10124-0\DEPENDENCIES\NATIVE\POWERSHELL\PWSH.EXE",
            r"\\?\C:\Program Files\WindowsApps\OpenAI.CodexPrimaryRuntime.v26-813-10124-0\dependencies\native\powershell\pwsh.exe",
            r"C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe",
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
            r"C:\portable\NotWindowsApps\pwsh.EXE",
        ] {
            assert!(is_windows_sandbox_compatible_powershell_path(
                std::path::Path::new(path)
            ));
        }
    }

    #[test]
    fn elevated_sandbox_filter_preserves_ordered_fallback() {
        let portable = PathBuf::from(
            r"C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe",
        );
        let found = [
            PathBuf::from(
                r"C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.4.0_x64__8wekyb3d8bbwe\pwsh.exe",
            ),
            PathBuf::from(r"C:\Users\user\AppData\Local\Microsoft\WindowsApps\pwsh.exe"),
            PathBuf::from(r"C:\runtime\dependencies\bin\fallback\pwsh.cmd"),
            portable.clone(),
            PathBuf::from(r"C:\Program Files\PowerShell\7\pwsh.exe"),
        ]
        .into_iter()
        .find(|path| is_windows_sandbox_compatible_powershell_path(path));

        assert_eq!(found, Some(portable));
    }

    #[test]
    fn git_bash_prefers_bin_and_skips_wsl_launchers() -> anyhow::Result<()> {
        let temp = tempfile::tempdir()?;
        let touch = |relative: &str| -> anyhow::Result<PathBuf> {
            let path = relative
                .split('/')
                .fold(temp.path().to_path_buf(), |path, part| path.join(part));
            std::fs::create_dir_all(path.parent().expect("file has a parent"))?;
            std::fs::write(&path, "")?;
            Ok(path)
        };
        let wsl = temp.path().join("Windows").join("System32");
        touch("Windows/System32/bin/bash.exe")?;
        touch("WindowsApps/usr/bin/bash.exe")?;
        let usr_bash = touch("Git/usr/bin/bash.exe")?;
        let missing = temp.path().join("Missing");
        let git = temp.path().join("Git");

        assert_eq!(
            find_git_bash([
                missing.clone(),
                wsl.clone(),
                temp.path().join("WindowsApps"),
                git.clone(),
            ]),
            Some(usr_bash)
        );

        let bin_bash = touch("Git/bin/bash.exe")?;
        assert_eq!(find_git_bash([missing, git]), Some(bin_bash));
        assert_eq!(find_git_bash([wsl]), None);
        Ok(())
    }

    #[test]
    fn test_detect_shell_type() {
        assert_eq!(
            detect_shell_type(PathBuf::from("zsh")),
            Some(ShellType::Zsh)
        );
        assert_eq!(
            detect_shell_type(PathBuf::from("bash")),
            Some(ShellType::Bash)
        );
        assert_eq!(
            detect_shell_type(PathBuf::from("pwsh")),
            Some(ShellType::PowerShell)
        );
        assert_eq!(
            detect_shell_type(PathBuf::from("powershell")),
            Some(ShellType::PowerShell)
        );
        assert_eq!(detect_shell_type(PathBuf::from("fish")), None);
        assert_eq!(detect_shell_type(PathBuf::from("other")), None);
        assert_eq!(
            detect_shell_type(PathBuf::from("/bin/zsh")),
            Some(ShellType::Zsh)
        );
        assert_eq!(
            detect_shell_type(PathBuf::from("/bin/bash")),
            Some(ShellType::Bash)
        );
        assert_eq!(
            detect_shell_type(PathBuf::from("/usr/bin/bash")),
            Some(ShellType::Bash)
        );
        assert_eq!(
            detect_shell_type(PathBuf::from("powershell.exe")),
            Some(ShellType::PowerShell)
        );
        assert_eq!(
            detect_shell_type(PathBuf::from(if cfg!(windows) {
                "C:\\windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
            } else {
                "/usr/local/bin/pwsh"
            })),
            Some(ShellType::PowerShell)
        );
        assert_eq!(
            detect_shell_type(PathBuf::from("pwsh.exe")),
            Some(ShellType::PowerShell)
        );
        assert_eq!(
            detect_shell_type(PathBuf::from("/usr/local/bin/pwsh")),
            Some(ShellType::PowerShell)
        );
        assert_eq!(
            detect_shell_type(PathBuf::from("/bin/sh")),
            Some(ShellType::Sh)
        );
        assert_eq!(detect_shell_type(PathBuf::from("sh")), Some(ShellType::Sh));
        assert_eq!(
            detect_shell_type(PathBuf::from("cmd")),
            Some(ShellType::Cmd)
        );
        assert_eq!(
            detect_shell_type(PathBuf::from("cmd.exe")),
            Some(ShellType::Cmd)
        );
    }
}

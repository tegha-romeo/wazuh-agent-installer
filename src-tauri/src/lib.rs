use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LogLine {
    pub line: String,
    pub level: String, // "info" | "error" | "success"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstallConfig {
    pub wazuh_manager: String,
    pub wazuh_agent_version: String,
    pub wazuh_agent_name: String,
    pub ids_engine: String,    // "suricata" | "snort"
    pub suricata_mode: String, // "ids" | "ips"
    pub install_trivy: bool,
    pub log_level: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstallResult {
    pub success: bool,
    pub exit_code: i32,
    pub message: String,
}

fn classify_line(line: &str) -> &'static str {
    let l = line.to_lowercase();
    if l.contains("[error]") || l.contains("failed") || l.contains("error:") {
        "error"
    } else if l.contains("[success]") || l.contains("successfully") || l.contains("completed") {
        "success"
    } else {
        "info"
    }
}

/// Resolve the bundled setup-agent.sh path, copy it to a temp file,
/// ensure it is executable, and return the temp path.
/// This avoids permission errors when the bundled resource is in a read-only system directory.
fn resolve_script(app: &AppHandle) -> Result<String, String> {
    let resource_path = app
        .path()
        .resolve("setup-agent.sh", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve resource path: {}", e))?;

    // Copy to a writable temp location so we can chmod it
    let tmp_path = std::env::temp_dir().join("wazuh-setup-agent.sh");
    std::fs::copy(&resource_path, &tmp_path)
        .map_err(|e| format!("Failed to copy script to temp dir: {}", e))?;

    // Make the copy executable (rwxr-xr-x)
    #[cfg(unix)]
    std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("Failed to set script permissions: {}", e))?;

    tmp_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Script path contains invalid UTF-8".to_string())
}

#[tauri::command]
async fn run_install(
    app: AppHandle,
    config: InstallConfig,
    script_path: Option<String>,
) -> Result<InstallResult, String> {
    // Resolve script: prefer caller-supplied path, fall back to bundled resource
    let resolved_path = match script_path {
        Some(ref p) if !p.is_empty() => p.clone(),
        _ => resolve_script(&app)?,
    };

    // Build CLI args from config
    let mut args: Vec<String> = vec![];

    if config.ids_engine == "suricata" {
        args.push("-s".to_string());
        let mode = if config.suricata_mode.is_empty() {
            "ids".to_string()
        } else {
            config.suricata_mode.clone()
        };
        args.push(mode);
    } else if config.ids_engine == "snort" {
        args.push("-n".to_string());
    }

    if config.install_trivy {
        args.push("-t".to_string());
    }

    // On Linux/macOS use pkexec for a GUI privilege prompt.
    // On Windows, run bash directly (WSL or Git Bash) — the script handles elevation internally.
    #[cfg(unix)]
    let mut cmd = {
        let mut c = Command::new("pkexec");
        c.arg("env")
            .arg(format!("WAZUH_MANAGER={}", &config.wazuh_manager))
            .arg(format!("WAZUH_AGENT_VERSION={}", &config.wazuh_agent_version))
            .arg(format!("WAZUH_AGENT_NAME={}", &config.wazuh_agent_name))
            .arg(format!("LOG_LEVEL={}", &config.log_level))
            .arg("bash")
            .arg(&resolved_path)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        c
    };

    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("bash");
        c.arg(&resolved_path)
            .args(&args)
            .env("WAZUH_MANAGER", &config.wazuh_manager)
            .env("WAZUH_AGENT_VERSION", &config.wazuh_agent_version)
            .env("WAZUH_AGENT_NAME", &config.wazuh_agent_name)
            .env("LOG_LEVEL", &config.log_level)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        c
    };

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn process: {}", e))?;

    // Stream stdout
    let stdout = child.stdout.take().expect("Failed to capture stdout");
    let stderr = child.stderr.take().expect("Failed to capture stderr");

    let app_stdout = app.clone();
    let stdout_task = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let level = classify_line(&line);
            let _ = app_stdout.emit(
                "install-log",
                LogLine {
                    line,
                    level: level.to_string(),
                },
            );
        }
    });

    let app_stderr = app.clone();
    let stderr_task = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_stderr.emit(
                "install-log",
                LogLine {
                    line,
                    level: "error".to_string(),
                },
            );
        }
    });

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for process: {}", e))?;

    let _ = tokio::join!(stdout_task, stderr_task);

    let exit_code = status.code().unwrap_or(-1);
    let success = status.success();

    let message = if success {
        "Wazuh Agent installed successfully!".to_string()
    } else {
        format!("Installation failed with exit code {}", exit_code)
    };

    let _ = app.emit(
        "install-done",
        InstallResult {
            success,
            exit_code,
            message: message.clone(),
        },
    );

    Ok(InstallResult {
        success,
        exit_code,
        message,
    })
}

#[tauri::command]
fn validate_config(config: InstallConfig) -> Result<(), String> {
    if config.wazuh_manager.is_empty() {
        return Err("Wazuh Manager address is required".to_string());
    }
    if config.wazuh_agent_name.is_empty() {
        return Err("Agent name is required".to_string());
    }
    if config.wazuh_agent_version.is_empty() {
        return Err("Agent version is required".to_string());
    }
    if config.ids_engine != "suricata" && config.ids_engine != "snort" {
        return Err("IDS engine must be 'suricata' or 'snort'".to_string());
    }
    if config.ids_engine == "suricata"
        && config.suricata_mode != "ids"
        && config.suricata_mode != "ips"
    {
        return Err("Suricata mode must be 'ids' or 'ips'".to_string());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![run_install, validate_config])
        .setup(|app| {
            // ---- Build tray menu ----
            let show_item = MenuItem::with_id(app, "show", "Show Installer", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            // ---- Load tray icon — use the app's default window icon ----
            let icon = app
                .default_window_icon()
                .cloned()
                .expect("No default window icon found");

            // ---- Create the tray icon ----
            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Wazuh Agent Installer")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click toggles the window
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

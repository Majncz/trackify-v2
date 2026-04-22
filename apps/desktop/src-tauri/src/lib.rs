use keyring::{Entry, Error as KeyringError};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};

const AUTH_SERVICE: &str = "co.bitterlemon.trackify";
const AUTH_ACCOUNT: &str = "desktop-auth-token";

struct TrayMenuState {
    status: MenuItem<tauri::Wry>,
    start: MenuItem<tauri::Wry>,
    stop: MenuItem<tauri::Wry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowVisibilityAction {
    Hide,
    ShowAndFocus,
}

fn is_autostart_launch<I>(args: I) -> bool
where
    I: IntoIterator,
    I::Item: AsRef<str>,
{
    args.into_iter().any(|arg| arg.as_ref() == "--autostart")
}

fn launch_visibility_action(launched_via_autostart: bool) -> WindowVisibilityAction {
    if launched_via_autostart {
        WindowVisibilityAction::Hide
    } else {
        WindowVisibilityAction::ShowAndFocus
    }
}

fn tray_show_toggle_action(is_visible: bool) -> WindowVisibilityAction {
    if is_visible {
        WindowVisibilityAction::Hide
    } else {
        WindowVisibilityAction::ShowAndFocus
    }
}

fn apply_window_visibility_action(
    window: &tauri::WebviewWindow<tauri::Wry>,
    action: WindowVisibilityAction,
) {
    match action {
        WindowVisibilityAction::Hide => {
            let _ = window.hide();
        }
        WindowVisibilityAction::ShowAndFocus => {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn auth_entry() -> Result<Entry, String> {
    Entry::new(AUTH_SERVICE, AUTH_ACCOUNT).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_auth_token(token: String) -> Result<(), String> {
    let entry = auth_entry()?;
    entry
        .set_password(&token)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_auth_token() -> Result<Option<String>, String> {
    let entry = auth_entry()?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn clear_auth_token() -> Result<(), String> {
    let entry = auth_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn update_tray_state(
    app: tauri::AppHandle,
    status: String,
    detail: Option<String>,
    running: bool,
) -> Result<(), String> {
    let tray = app.state::<TrayMenuState>();
    let suffix = detail
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!(" — {value}"))
        .unwrap_or_default();

    tray.status
        .set_text(format!("Status: {status}{suffix}"))
        .map_err(|error| error.to_string())?;
    tray.start
        .set_enabled(!running)
        .map_err(|error| error.to_string())?;
    tray.start
        .set_text(if running {
            "Start timer"
        } else {
            "Resume timer"
        })
        .map_err(|error| error.to_string())?;
    tray.stop
        .set_enabled(running)
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--autostart"])
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let launched_via_autostart = is_autostart_launch(std::env::args());
            let status = MenuItem::with_id(app, "status", "Status: Idle", false, None::<&str>)?;
            let start = MenuItem::with_id(app, "start", "Resume timer", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "Stop timer", false, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Open Trackify", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&status, &start, &stop, &show, &quit])?;

            app.manage(TrayMenuState {
                status: status.clone(),
                start: start.clone(),
                stop: stop.clone(),
            });

            TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "start" => {
                        let _ = app.emit_to("main", "trackify://tray-action", "start");
                    }
                    "stop" => {
                        let _ = app.emit_to("main", "trackify://tray-action", "stop");
                    }
                    "show" => {
                        let _ = app.emit_to("main", "trackify://tray-action", "show");
                        if let Some(window) = app.get_webview_window("main") {
                            let visible = window.is_visible().unwrap_or(false);
                            apply_window_visibility_action(
                                &window,
                                tray_show_toggle_action(visible),
                            );
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                apply_window_visibility_action(
                    &window,
                    launch_visibility_action(launched_via_autostart),
                );
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            save_auth_token,
            load_auth_token,
            clear_auth_token,
            update_tray_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running trackify desktop app");
}

#[cfg(test)]
mod tests {
    use super::{
        is_autostart_launch, launch_visibility_action, tray_show_toggle_action,
        WindowVisibilityAction,
    };

    #[test]
    fn detects_autostart_launch_argument() {
        assert!(is_autostart_launch(["trackify-desktop", "--autostart"]));
        assert!(!is_autostart_launch(["trackify-desktop"]));
    }

    #[test]
    fn launch_visibility_hides_autostart_windows() {
        assert_eq!(launch_visibility_action(true), WindowVisibilityAction::Hide);
        assert_eq!(
            launch_visibility_action(false),
            WindowVisibilityAction::ShowAndFocus
        );
    }

    #[test]
    fn tray_show_action_toggles_visibility() {
        assert_eq!(tray_show_toggle_action(true), WindowVisibilityAction::Hide);
        assert_eq!(
            tray_show_toggle_action(false),
            WindowVisibilityAction::ShowAndFocus
        );
    }
}

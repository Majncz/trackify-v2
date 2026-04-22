use keyring::{Entry, Error as KeyringError};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};

const AUTH_SERVICE: &str = "co.bitterlemon.trackify";
const AUTH_ACCOUNT: &str = "desktop-auth-token";

fn auth_entry() -> Result<Entry, String> {
    Entry::new(AUTH_SERVICE, AUTH_ACCOUNT).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_auth_token(token: String) -> Result<(), String> {
    let entry = auth_entry()?;
    entry.set_password(&token).map_err(|error| error.to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Open Trackify", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let visible = window.is_visible().unwrap_or(false);
                            if visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![save_auth_token, load_auth_token, clear_auth_token])
        .run(tauri::generate_context!())
        .expect("error while running trackify desktop app");
}

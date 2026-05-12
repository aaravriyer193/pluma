use enigo::{Direction, Enigo, Key, Keyboard, Settings as EnigoSettings};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
async fn hide_window(window: tauri::Window) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_api_key(key: String) -> Result<(), String> {
    keyring::Entry::new("pluma", "openrouter_api_key")
        .map_err(|e| e.to_string())?
        .set_password(&key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_api_key() -> Result<String, String> {
    keyring::Entry::new("pluma", "openrouter_api_key")
        .map_err(|e| e.to_string())?
        .get_password()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_api_key() -> Result<(), String> {
    keyring::Entry::new("pluma", "openrouter_api_key")
        .map_err(|e| e.to_string())?
        .delete_password()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_clipboard(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().read_text().map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_clipboard(app: tauri::AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

// Capture primary monitor as base64 PNG
#[tauri::command]
async fn take_screenshot() -> Result<String, String> {
    use base64::Engine;
    use image::ImageEncoder;

    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors.into_iter().next().ok_or("No monitor found")?;
    let img = monitor.capture_image().map_err(|e| e.to_string())?;

    let mut png: Vec<u8> = Vec::new();
    let enc = image::codecs::png::PngEncoder::new(&mut png);
    enc.write_image(img.as_raw(), img.width(), img.height(), image::ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;

    Ok(base64::engine::general_purpose::STANDARD.encode(&png))
}

// Write to clipboard, hide, wait, then simulate Ctrl/Cmd+V
#[tauri::command]
async fn paste_result(app: tauri::AppHandle, window: tauri::Window, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text).map_err(|e| e.to_string())?;
    window.hide().map_err(|e| e.to_string())?;
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;

    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        enigo.key(Key::Meta, Direction::Press).map_err(|e| e.to_string())?;
        enigo.key(Key::Unicode('v'), Direction::Click).map_err(|e| e.to_string())?;
        enigo.key(Key::Meta, Direction::Release).map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        enigo.key(Key::Control, Direction::Press).map_err(|e| e.to_string())?;
        enigo.key(Key::Unicode('v'), Direction::Click).map_err(|e| e.to_string())?;
        enigo.key(Key::Control, Direction::Release).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn resize_window(window: tauri::Window, height: u32) -> Result<(), String> {
    use tauri::LogicalSize;
    window.set_size(LogicalSize::new(660_u32, height)).map_err(|e| e.to_string())
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Tray
            let show_i = MenuItem::with_id(app, "show", "Open Pluma  (Alt+P)", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &sep, &quit_i])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Pluma – Alt+P")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => std::process::exit(0),
                    "show" => toggle_window(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Global shortcut Alt+P
            let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyP);
            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut(shortcut, move |_app, _s, event| {
                if event.state() == ShortcutState::Pressed { toggle_window(&handle); }
            })?;

            // Re-emit clipboard on focus
            let handle2 = app.handle().clone();
            app.listen("tauri://focus", move |_| {
                let app = handle2.clone();
                tauri::async_runtime::spawn(async move {
                    use tauri_plugin_clipboard_manager::ClipboardExt;
                    if let Ok(t) = app.clipboard().read_text() {
                        let _ = app.emit("clipboard-ready", t);
                    }
                });
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(false) = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    let _ = window.emit("window-hidden", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            hide_window,
            save_api_key,
            get_api_key,
            delete_api_key,
            read_clipboard,
            write_clipboard,
            take_screenshot,
            paste_result,
            resize_window,
        ])
        .run(tauri::generate_context!())
        .expect("error running Pluma");
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            let _ = w.emit("window-hidden", ());
        } else {
            let _ = w.center();
            let _ = w.show();
            let _ = w.set_focus();
            let _ = w.emit("window-shown", ());
        }
    }
}

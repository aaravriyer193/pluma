use enigo::{Direction, Enigo, Key, Keyboard, Mouse, Button, Coordinate, Axis, Settings as EnigoSettings};
use rusqlite::{Connection, params};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub struct DbState(pub Mutex<Connection>);

// ── Quick helpers ─────────────────────────────────────────────────────────────

fn blocked_cmd(cmd: &str) -> Option<&'static str> {
    let lo = cmd.to_lowercase();
    let blocked = [
        "format ", "diskpart", "shutdown /s", "shutdown /r", "del /f /s /q c:\\",
        "rd /s /q c:\\", "rmdir /s /q c:\\", "reg delete hklm", "bcdedit",
    ];
    blocked.iter().find(|b| lo.contains(*b)).copied()
}

// ── Existing commands ─────────────────────────────────────────────────────────

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

// ── Terminal ──────────────────────────────────────────────────────────────────

#[tauri::command]
async fn execute_terminal(command: String) -> Result<serde_json::Value, String> {
    if let Some(b) = blocked_cmd(&command) {
        return Err(format!("Blocked: command contains '{b}'"));
    }
    let out = std::process::Command::new("powershell")
        .args(["-NonInteractive", "-NoProfile", "-Command", &command])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "stdout": String::from_utf8_lossy(&out.stdout).trim().to_string(),
        "stderr": String::from_utf8_lossy(&out.stderr).trim().to_string(),
        "exit_code": out.status.code().unwrap_or(-1)
    }))
}

// ── File I/O ──────────────────────────────────────────────────────────────────

#[tauri::command]
async fn read_file_content(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
async fn write_file_content(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
async fn list_directory(path: String) -> Result<Vec<serde_json::Value>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let meta = entry.metadata().ok();
        out.push(serde_json::json!({
            "name": entry.file_name().to_string_lossy(),
            "path": entry.path().to_string_lossy(),
            "is_dir": meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
            "size": meta.as_ref().map(|m| m.len()).unwrap_or(0),
        }));
    }
    Ok(out)
}

// ── Computer use ──────────────────────────────────────────────────────────────

#[tauri::command]
fn get_screen_size() -> serde_json::Value {
    if let Ok(monitors) = xcap::Monitor::all() {
        if let Some(m) = monitors.first() {
            return serde_json::json!({"width": m.width(), "height": m.height()});
        }
    }
    serde_json::json!({"width": 1920, "height": 1080})
}

#[tauri::command]
async fn mouse_click(app: tauri::AppHandle, x: i32, y: i32, button: Option<String>) -> Result<(), String> {
    // Re-assert topmost so cursor overlay stays above other always-on-top windows
    if let Some(cursor_win) = app.get_webview_window("cursor") {
        let _ = cursor_win.set_always_on_top(true);
    }
    let _ = app.emit("click-at", serde_json::json!({"x": x, "y": y}));
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let btn = match button.as_deref() {
        Some("right") => Button::Right,
        Some("middle") => Button::Middle,
        _ => Button::Left,
    };
    enigo.button(btn, Direction::Click).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn mouse_double_click(x: i32, y: i32) -> Result<(), String> {
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
    enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
    tokio::time::sleep(std::time::Duration::from_millis(60)).await;
    enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn type_text(text: String) -> Result<(), String> {
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    enigo.text(&text).map_err(|e| e.to_string())?;
    Ok(())
}

fn parse_key(s: &str) -> Key {
    match s {
        "enter" | "return"      => Key::Return,
        "escape" | "esc"        => Key::Escape,
        "tab"                   => Key::Tab,
        "backspace"             => Key::Backspace,
        "delete"                => Key::Delete,
        "up"                    => Key::UpArrow,
        "down"                  => Key::DownArrow,
        "left"                  => Key::LeftArrow,
        "right"                 => Key::RightArrow,
        "home"                  => Key::Home,
        "end"                   => Key::End,
        "pageup"                => Key::PageUp,
        "pagedown"              => Key::PageDown,
        "space"                 => Key::Unicode(' '),
        "f1"  => Key::F1,  "f2"  => Key::F2,  "f3"  => Key::F3,  "f4"  => Key::F4,
        "f5"  => Key::F5,  "f6"  => Key::F6,  "f7"  => Key::F7,  "f8"  => Key::F8,
        "f9"  => Key::F9,  "f10" => Key::F10, "f11" => Key::F11, "f12" => Key::F12,
        _                       => Key::Unicode(s.chars().next().unwrap_or(' ')),
    }
}

#[tauri::command]
async fn key_press(key: String) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    let lo = key.to_lowercase();
    let parts: Vec<&str> = lo.split('+').map(str::trim).collect();

    if parts.len() > 1 {
        // Combo: e.g. "ctrl+c", "ctrl+shift+t", "win+d"
        let mods: Vec<Key> = parts[..parts.len()-1].iter().filter_map(|p| match *p {
            "ctrl" | "control"               => Some(Key::Control),
            "alt"                            => Some(Key::Alt),
            "shift"                          => Some(Key::Shift),
            "win" | "windows" | "super" | "meta" | "cmd" => Some(Key::Meta),
            _ => None,
        }).collect();
        for m in &mods { enigo.key(*m, Direction::Press).map_err(|e| e.to_string())?; }
        enigo.key(parse_key(parts[parts.len()-1]), Direction::Click).map_err(|e| e.to_string())?;
        for m in mods.iter().rev() { enigo.key(*m, Direction::Release).map_err(|e| e.to_string())?; }
    } else {
        // Special modifier-only keys
        let k = match lo.as_str() {
            "ctrl" | "control"               => Key::Control,
            "alt"                            => Key::Alt,
            "shift"                          => Key::Shift,
            "win" | "windows" | "super" | "meta" => Key::Meta,
            other                            => parse_key(other),
        };
        enigo.key(k, Direction::Click).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn mouse_scroll(x: i32, y: i32, amount: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
    enigo.scroll(amount, Axis::Vertical).map_err(|e| e.to_string())?;
    Ok(())
}

// ── RAG memory ────────────────────────────────────────────────────────────────

#[tauri::command]
fn rag_insert(state: tauri::State<'_, DbState>, content: String, source: String) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    db.execute(
        "INSERT INTO memory(content, source, ts) VALUES (?1, ?2, ?3)",
        params![content, source, ts as i64],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn rag_query(state: tauri::State<'_, DbState>, query: String, limit: Option<usize>) -> Result<Vec<serde_json::Value>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let n = limit.unwrap_or(6) as i64;
    let mut stmt = db.prepare(
        "SELECT content, source, ts FROM memory WHERE memory MATCH ?1 ORDER BY rank LIMIT ?2"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![query, n], |row| {
        Ok(serde_json::json!({
            "content": row.get::<_, String>(0)?,
            "source":  row.get::<_, String>(1)?,
            "ts":      row.get::<_, i64>(2)?
        }))
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ── Widget window ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn show_widget(app: tauri::AppHandle, task: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("widget") {
        // Position bottom-right of primary monitor
        if let Ok(Some(monitor)) = w.primary_monitor() {
            let sz = monitor.size();
            let scale = monitor.scale_factor();
            let w_px = (300.0 * scale) as u32;
            let h_px = (52.0 * scale) as u32;
            let x = sz.width.saturating_sub(w_px + (20.0 * scale) as u32) as i32;
            let y = sz.height.saturating_sub(h_px + (64.0 * scale) as u32) as i32;
            let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
        }
        let _ = w.emit("widget-task", &task);
        let _ = w.show();
    }
    Ok(())
}

#[tauri::command]
async fn hide_widget(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("widget") {
        let _ = w.hide();
    }
    Ok(())
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

            // ── SQLite RAG DB ──────────────────────────────────────────────
            let data_dir = app.path().app_data_dir().expect("no data dir");
            std::fs::create_dir_all(&data_dir).ok();
            let db_path = data_dir.join("pluma.db");
            let conn = Connection::open(&db_path).expect("Failed to open DB");
            conn.execute_batch(
                "CREATE VIRTUAL TABLE IF NOT EXISTS memory USING fts5(content, source, ts UNINDEXED);"
            ).expect("Failed to create memory table");
            app.manage(DbState(Mutex::new(conn)));

            // ── Cursor overlay (full-screen, transparent, always-on-top) ──
            if let Some(cursor_win) = app.get_webview_window("cursor") {
                if let Ok(Some(monitor)) = cursor_win.primary_monitor() {
                    let sz = monitor.size();
                    let _ = cursor_win.set_size(tauri::PhysicalSize::new(sz.width, sz.height));
                    let _ = cursor_win.set_position(tauri::PhysicalPosition::new(0i32, 0i32));
                }
                let _ = cursor_win.set_ignore_cursor_events(true);
                let _ = cursor_win.show();
            }

            // ── Tray ───────────────────────────────────────────────────────
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

            // ── Global shortcut Alt+P ──────────────────────────────────────
            let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyP);
            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut(shortcut, move |_app, _s, event| {
                if event.state() == ShortcutState::Pressed { toggle_window(&handle); }
            })?;

            // ── Re-emit clipboard on focus ─────────────────────────────────
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
            execute_terminal,
            read_file_content,
            write_file_content,
            list_directory,
            mouse_click,
            mouse_double_click,
            type_text,
            key_press,
            mouse_scroll,
            rag_insert,
            rag_query,
            show_widget,
            hide_widget,
            get_screen_size,
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

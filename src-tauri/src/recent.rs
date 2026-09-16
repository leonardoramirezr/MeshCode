//! Recently opened folders, persisted as JSON in the app config directory.

use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};

use crate::menu;

const MAX_RECENT: usize = 12;

fn store_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("recent-folders.json"))
}

fn load(app: &AppHandle) -> Vec<String> {
    store_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, folders: &[String]) {
    let Some(path) = store_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(folders) {
        let _ = fs::write(path, json);
    }
}

pub fn add(app: &AppHandle, folder: &str) {
    let mut folders = load(app);
    folders.retain(|existing| existing != folder);
    folders.insert(0, folder.to_owned());
    folders.truncate(MAX_RECENT);
    save(app, &folders);
}

/// Recent folders that still exist on disk (missing ones are kept in case a drive is unmounted).
pub fn existing(app: &AppHandle) -> Vec<String> {
    load(app)
        .into_iter()
        .filter(|folder| PathBuf::from(folder).is_dir())
        .collect()
}

#[tauri::command]
pub fn recent_folders(app: AppHandle) -> Vec<String> {
    existing(&app)
}

#[tauri::command]
pub fn remove_recent_folder(app: AppHandle, path: String) {
    let mut folders = load(&app);
    folders.retain(|existing| *existing != path);
    save(&app, &folders);
    menu::refresh(&app);
}

#[tauri::command]
pub fn clear_recent_folders(app: AppHandle) {
    save(&app, &[]);
    menu::refresh(&app);
}

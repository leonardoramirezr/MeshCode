//! The opened folder: listing its contents and watching it for changes.

use std::{collections::BTreeSet, fs, path::Path, sync::Mutex, time::Duration};

use notify_debouncer_mini::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::{menu, recent};

/// Entries hidden from the explorer, like VS Code's default `files.exclude`.
const HIDDEN_ENTRIES: &[&str] = &[".git", ".svn", ".hg", ".DS_Store", "Thumbs.db"];

#[derive(Default)]
pub struct WatcherState(Mutex<Option<Debouncer<RecommendedWatcher>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Clone, Serialize)]
pub struct FsChange {
    /// Paths that were created, modified or removed.
    paths: BTreeSet<String>,
    /// Directories whose listing may have changed.
    dirs: BTreeSet<String>,
}

/// Opens a folder: resolves its canonical path, starts watching it and records it as recent.
#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> Result<String, String> {
    let root = dunce::canonicalize(&path).map_err(|e| format!("No se pudo abrir {path}: {e}"))?;
    if !root.is_dir() {
        return Err(format!("{path} no es una carpeta"));
    }

    watch(&app, &root)?;
    let root = root.to_string_lossy().into_owned();
    recent::add(&app, &root);
    menu::refresh(&app);
    Ok(root)
}

#[tauri::command]
pub fn close_folder(app: AppHandle) {
    app.state::<WatcherState>().0.lock().unwrap().take();
}

#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = fs::read_dir(&path)
        .map_err(|e| format!("No se pudo leer {path}: {e}"))?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if HIDDEN_ENTRIES.contains(&name.as_str()) {
                return None;
            }
            let path = entry.path();
            Some(DirEntry {
                name,
                is_dir: path.is_dir(),
                path: path.to_string_lossy().into_owned(),
            })
        })
        .collect();

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

fn watch(app: &AppHandle, root: &Path) -> Result<(), String> {
    let handle = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(400),
        move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return;
            };
            let mut change = FsChange {
                paths: BTreeSet::new(),
                dirs: BTreeSet::new(),
            };
            let mut git_changed = false;
            for event in events {
                let components: Vec<_> = event
                    .path
                    .components()
                    .map(|component| component.as_os_str().to_string_lossy())
                    .collect();
                if components.iter().any(|name| name == ".git") {
                    // Commits, branch switches and the like, possibly made outside MeshCode.
                    git_changed = true;
                }
                if components
                    .iter()
                    .any(|name| HIDDEN_ENTRIES.contains(&name.as_ref()))
                {
                    continue;
                }
                if let Some(parent) = event.path.parent() {
                    change.dirs.insert(parent.to_string_lossy().into_owned());
                }
                change
                    .paths
                    .insert(event.path.to_string_lossy().into_owned());
            }
            if !change.paths.is_empty() {
                let _ = handle.emit("fs-change", change);
            }
            if git_changed {
                let _ = handle.emit("git-change", ());
            }
        },
    )
    .map_err(|e| format!("No se pudo vigilar la carpeta: {e}"))?;

    debouncer
        .watcher()
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| format!("No se pudo vigilar la carpeta: {e}"))?;

    // Replacing the previous debouncer drops it, which stops watching the old folder.
    *app.state::<WatcherState>().0.lock().unwrap() = Some(debouncer);
    Ok(())
}

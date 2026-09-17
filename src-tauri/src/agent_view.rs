//! What the agent last checked visually. Its `render_preview` tool writes the camera it used to a
//! JSON file (the path reaches the Blender tools as `MESHCODE_AGENT_VIEW`), and every write is
//! forwarded to the frontend as an `agent-view` event, so the viewer can show the user the same
//! framing the agent just looked at.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use notify_debouncer_mini::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer,
};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

const EVENT: &str = "agent-view";
/// Kept in a folder of its own, so the watcher only ever wakes up for it.
const DIR: &str = "agent-view";
const FILE: &str = "view.json";

#[derive(Default)]
pub struct AgentViewState(Mutex<Option<Debouncer<RecommendedWatcher>>>);

/// The file the Blender tools report each preview's camera in.
pub fn file(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join(DIR);
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join(FILE))
}

/// Starts watching for previews. Left-over cameras from previous runs are discarded first.
pub fn watch(app: &AppHandle) {
    let Some(path) = file(app) else {
        return;
    };
    let _ = fs::remove_file(&path);
    let Some(dir) = path.parent().map(Path::to_path_buf) else {
        return;
    };

    let handle = app.clone();
    let debouncer = new_debouncer(
        Duration::from_millis(100),
        move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return;
            };
            // The file is renamed into place, so only the final name is of interest.
            if !events.iter().any(|event| event.path.ends_with(FILE)) {
                return;
            }
            if let Some(view) = fs::read_to_string(&path)
                .ok()
                .and_then(|json| serde_json::from_str::<Value>(&json).ok())
            {
                let _ = handle.emit(EVENT, view);
            }
        },
    );
    let Ok(mut debouncer) = debouncer else {
        return;
    };
    if debouncer
        .watcher()
        .watch(&dir, RecursiveMode::NonRecursive)
        .is_ok()
    {
        *app.state::<AgentViewState>().0.lock().unwrap() = Some(debouncer);
    }
}

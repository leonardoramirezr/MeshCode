//! Converts .blend files to GLB using a local Blender install, with an on-disk cache.

use std::{
    fs,
    hash::{DefaultHasher, Hash, Hasher},
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, UNIX_EPOCH},
};

use tauri::{ipc::Response, AppHandle, Manager};

use crate::executable;

const EXPORT_SCRIPT: &str = include_str!("export_glb.py");

static CONVERSION_ID: AtomicU64 = AtomicU64::new(0);

/// Returns the GLB bytes for a .blend file, converting it with Blender if the cache is stale.
#[tauri::command]
pub async fn load_blend(app: AppHandle, path: String) -> Result<Response, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("glb");

    tauri::async_runtime::spawn_blocking(move || convert(Path::new(&path), &cache_dir))
        .await
        .map_err(|e| e.to_string())?
        .map(Response::new)
}

fn convert(source: &Path, cache_dir: &Path) -> Result<Vec<u8>, String> {
    let metadata = wait_for_file(source)?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_nanos());

    let prefix = format!("{:016x}-", path_hash(source));
    let cached = cache_dir.join(format!("{prefix}{modified:x}-{:x}.glb", metadata.len()));
    if let Ok(bytes) = fs::read(&cached) {
        return Ok(bytes);
    }

    fs::create_dir_all(cache_dir).map_err(|e| format!("No se pudo crear la caché: {e}"))?;
    let blender = find_blender()
        .ok_or("No se encontró Blender. Instálalo o define la variable de entorno BLENDER_PATH.")?;

    let id = CONVERSION_ID.fetch_add(1, Ordering::Relaxed);
    let temp = cache_dir.join(format!("{prefix}{}-{id}.tmp.glb", std::process::id()));
    let output = Command::new(&blender)
        .arg("--background")
        .arg("--factory-startup")
        .arg(source)
        .args([
            "--python-exit-code",
            "1",
            "--python-expr",
            EXPORT_SCRIPT,
            "--",
        ])
        .arg(&temp)
        .output()
        .map_err(|e| format!("No se pudo ejecutar Blender ({}): {e}", blender.display()))?;

    if !output.status.success() || !temp.is_file() {
        let _ = fs::remove_file(&temp);
        return Err(format!(
            "Blender no pudo convertir el archivo.\n\n{}",
            error_summary(&output)
        ));
    }

    remove_stale_entries(cache_dir, &prefix);
    fs::rename(&temp, &cached).map_err(|e| e.to_string())?;
    fs::read(&cached).map_err(|e| e.to_string())
}

/// Blender saves by renaming files around, so the file can briefly be missing.
fn wait_for_file(path: &Path) -> Result<fs::Metadata, String> {
    let mut attempts = 0;
    loop {
        match fs::metadata(path) {
            Ok(metadata) => return Ok(metadata),
            Err(_) if attempts < 10 => {
                attempts += 1;
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("No se pudo leer {}: {e}", path.display())),
        }
    }
}

fn path_hash(path: &Path) -> u64 {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    hasher.finish()
}

/// Removes previously cached GLBs for the same source file (leaves in-flight conversions alone).
fn remove_stale_entries(cache_dir: &Path, prefix: &str) {
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(prefix) && name.ends_with(".glb") && !name.ends_with(".tmp.glb") {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn error_summary(output: &Output) -> String {
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let lines: Vec<&str> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let errors: Vec<&str> = lines
        .iter()
        .copied()
        .filter(|line| {
            let lower = line.to_lowercase();
            lower.contains("error") || lower.contains("traceback")
        })
        .collect();
    let relevant = if errors.is_empty() { &lines } else { &errors };
    relevant[relevant.len().saturating_sub(12)..].join("\n")
}

pub fn find_blender() -> Option<PathBuf> {
    executable::find("BLENDER_PATH", "blender", install_locations())
}

#[cfg(target_os = "macos")]
fn install_locations() -> Vec<PathBuf> {
    let mut locations = vec![PathBuf::from(
        "/Applications/Blender.app/Contents/MacOS/Blender",
    )];
    if let Some(home) = executable::home_dir() {
        locations.push(home.join("Applications/Blender.app/Contents/MacOS/Blender"));
    }
    locations.extend(["/opt/homebrew/bin/blender", "/usr/local/bin/blender"].map(PathBuf::from));
    locations
}

#[cfg(target_os = "windows")]
fn install_locations() -> Vec<PathBuf> {
    let root = Path::new(r"C:\Program Files\Blender Foundation");
    let mut versions: Vec<PathBuf> = fs::read_dir(root)
        .map(|entries| entries.flatten().map(|entry| entry.path()).collect())
        .unwrap_or_default();
    // Folder names look like "Blender 4.2"; sort descending so the newest comes first.
    versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    versions
        .into_iter()
        .map(|dir| dir.join("blender.exe"))
        .collect()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn install_locations() -> Vec<PathBuf> {
    [
        "/usr/bin/blender",
        "/usr/local/bin/blender",
        "/snap/bin/blender",
        "/var/lib/flatpak/exports/bin/org.blender.Blender",
    ]
    .map(PathBuf::from)
    .to_vec()
}

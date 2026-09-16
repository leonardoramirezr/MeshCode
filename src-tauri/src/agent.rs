//! The chat agent: a Node.js sidecar (`agent/main.ts`) running the Claude Agent SDK.
//! Commands are written to its stdin and its events are forwarded to the frontend as
//! `agent-event`s; both directions carry one JSON object per line.

use std::{
    collections::VecDeque,
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::{auth, blend, executable};

const EVENT: &str = "agent-event";
/// Stderr lines kept to explain an unexpected exit.
const STDERR_LINES: usize = 20;

static SIDECAR_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct AgentState(Mutex<Option<Sidecar>>);

struct Sidecar {
    id: u64,
    child: Child,
    stdin: ChildStdin,
}

/// Starts the sidecar, replacing the running one if there is one.
#[tauri::command]
pub async fn agent_start(app: AppHandle) -> Result<(), String> {
    let (api_key, _) =
        auth::api_key()?.ok_or("Configura una API key de Anthropic para usar el chat.")?;
    let node = executable::find("MESHCODE_NODE", "node", node_locations()).ok_or(
        "No se encontró Node.js. Instálalo o define la variable de entorno MESHCODE_NODE.",
    )?;
    let script = sidecar_script(&app)?;
    let config_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("claude");
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("No se pudo crear {}: {e}", config_dir.display()))?;

    let mut command = Command::new(&node);
    command
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // The agent authenticates with this API key only, and keeps its sessions and settings apart
    // from any Claude Code setup (or session, if MeshCode was launched from one) on the machine.
    for (name, _) in std::env::vars_os() {
        let name = name.to_string_lossy();
        if name.starts_with("CLAUDECODE")
            || name.starts_with("CLAUDE_CODE_")
            || name.starts_with("CLAUDE_AGENT_")
            || name.starts_with("ANTHROPIC_")
        {
            command.env_remove(name.as_ref());
        }
    }
    command
        .env("ANTHROPIC_API_KEY", api_key)
        .env("CLAUDE_CONFIG_DIR", &config_dir);
    if let Some(blender) = blend::find_blender() {
        command.env("MESHCODE_BLENDER", blender);
    }
    if !cfg!(debug_assertions) {
        // Bundles have no node_modules for the SDK to find its Claude Code binary in.
        let claude = if cfg!(windows) {
            "claude.exe"
        } else {
            "claude"
        };
        command.env("MESHCODE_CLAUDE_BIN", script.with_file_name(claude));
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("No se pudo iniciar el agente con {}: {e}", node.display()))?;
    let stdin = child.stdin.take().expect("stdin is piped");
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let id = SIDECAR_ID.fetch_add(1, Ordering::Relaxed);

    let stderr_tail = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_LINES)));
    let stderr_reader = thread::spawn({
        let tail = stderr_tail.clone();
        move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                eprintln!("[agent] {line}");
                let mut tail = tail.lock().unwrap();
                if tail.len() == STDERR_LINES {
                    tail.pop_front();
                }
                tail.push_back(line);
            }
        }
    });

    thread::spawn({
        let app = app.clone();
        move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                match serde_json::from_str::<Value>(&line) {
                    Ok(event) => {
                        let _ = app.emit(EVENT, event);
                    }
                    Err(_) => eprintln!("[agent] {line}"),
                }
            }
            // stdout closed, so the process is exiting. Stopped or replaced sidecars were already
            // taken out of the state and exit quietly.
            let state = app.state::<AgentState>();
            let Some(mut sidecar) = state.0.lock().unwrap().take_if(|sidecar| sidecar.id == id)
            else {
                return;
            };
            let code = sidecar.child.wait().ok().and_then(|status| status.code());
            let _ = stderr_reader.join();
            let message = Vec::from(stderr_tail.lock().unwrap().clone()).join("\n");
            let _ = app.emit(
                EVENT,
                json!({ "type": "exit", "code": code, "message": message }),
            );
        }
    });

    let previous = app
        .state::<AgentState>()
        .0
        .lock()
        .unwrap()
        .replace(Sidecar { id, child, stdin });
    if let Some(previous) = previous {
        stop(previous);
    }
    Ok(())
}

/// Sends a command to the sidecar.
#[tauri::command]
pub fn agent_send(app: AppHandle, command: Value) -> Result<(), String> {
    let state = app.state::<AgentState>();
    let mut current = state.0.lock().unwrap();
    let sidecar = current.as_mut().ok_or("El agente no está en ejecución.")?;
    let mut line = command.to_string();
    line.push('\n');
    sidecar
        .stdin
        .write_all(line.as_bytes())
        .and_then(|()| sidecar.stdin.flush())
        .map_err(|e| format!("No se pudo comunicar con el agente: {e}"))
}

#[tauri::command]
pub fn agent_stop(app: AppHandle) {
    if let Some(sidecar) = app.state::<AgentState>().0.lock().unwrap().take() {
        stop(sidecar);
    }
}

/// Closing stdin makes the sidecar end its session and exit; it is killed if it takes too long.
fn stop(sidecar: Sidecar) {
    let Sidecar {
        mut child, stdin, ..
    } = sidecar;
    drop(stdin);
    thread::spawn(move || {
        for _ in 0..30 {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            thread::sleep(Duration::from_millis(100));
        }
        let _ = child.kill();
        let _ = child.wait();
    });
}

/// Development runs the TypeScript source directly (Node strips the types); bundles ship the build
/// from `pnpm build:agent`.
fn sidecar_script(app: &AppHandle) -> Result<PathBuf, String> {
    let script = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../agent/main.ts")
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("agent/main.mjs")
    };
    if script.is_file() {
        Ok(script)
    } else {
        Err(format!("No se encontró el agente en {}", script.display()))
    }
}

fn node_locations() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    let mut locations: Vec<PathBuf> = ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
        .map(PathBuf::from)
        .to_vec();
    #[cfg(target_os = "windows")]
    let mut locations = vec![PathBuf::from(r"C:\Program Files\nodejs\node.exe")];
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut locations: Vec<PathBuf> = ["/usr/bin/node", "/usr/local/bin/node"]
        .map(PathBuf::from)
        .to_vec();

    if let Some(home) = executable::home_dir() {
        locations.push(home.join(".volta/bin/node"));
        // nvm keeps one folder per version, like `v22.11.0`; prefer the newest.
        let mut versions: Vec<(Vec<u64>, PathBuf)> = fs::read_dir(home.join(".nvm/versions/node"))
            .map(|entries| {
                entries
                    .flatten()
                    .map(|entry| {
                        let name = entry.file_name().to_string_lossy().into_owned();
                        let version = name
                            .trim_start_matches('v')
                            .split('.')
                            .map(|part| part.parse().unwrap_or(0))
                            .collect();
                        (version, entry.path().join("bin/node"))
                    })
                    .collect()
            })
            .unwrap_or_default();
        versions.sort_by(|a, b| b.0.cmp(&a.0));
        locations.extend(versions.into_iter().map(|(_, path)| path));
    }
    locations
}

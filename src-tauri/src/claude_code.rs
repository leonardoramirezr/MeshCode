//! Claude Code, as installed on the user's machine, running in a pseudo-terminal for the chat.
//! It runs with the user's own login and settings, so usage counts against their Claude plan.
//! The terminal's output reaches the frontend through a channel as raw bytes, followed by
//! `{ "exit": code }` if the process ends on its own.

use std::{
    io::{ErrorKind, Read, Write},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Mutex,
    },
    thread,
    time::Duration,
};

#[cfg(windows)]
use portable_pty::ChildKiller;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Manager,
};

use crate::{agent, blend};

/// The name Claude Code knows MeshCode's MCP server (`agent/mcp.ts`) by.
const MCP_SERVER: &str = "meshcode";
/// Its tools that never modify files, which run without asking, as in `agent/blender.ts`.
const READ_ONLY_TOOLS: [&str; 2] = ["inspect_blend", "render_preview"];
const NOT_RUNNING: &str = "Claude Code no está en ejecución.";

static TERMINAL_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct ClaudeCodeState(Mutex<Option<Terminal>>);

struct Terminal {
    id: u64,
    master: Box<dyn MasterPty + Send>,
    input: mpsc::Sender<String>,
    #[cfg(unix)]
    pid: Option<u32>,
    #[cfg(windows)]
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// Receives a message when the process exits.
    exited: mpsc::Receiver<()>,
}

/// Starts Claude Code in `cwd` with a terminal of the given size, replacing the running one.
#[tauri::command]
pub async fn claude_code_start(
    app: AppHandle,
    cwd: String,
    cols: u16,
    rows: u16,
    events: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let command = command(&app, &cwd)?;
    let pty = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|e| format!("No se pudo abrir una terminal: {e}"))?;
    let mut reader = pty.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pty.master.take_writer().map_err(|e| e.to_string())?;
    let mut child = pty
        .slave
        .spawn_command(command)
        .map_err(|e| format!("No se pudo iniciar Claude Code: {e}"))?;
    // The output only ends once nothing has the terminal open, and that includes this process.
    drop(pty.slave);

    let id = TERMINAL_ID.fetch_add(1, Ordering::Relaxed);
    let (input, input_queue) = mpsc::channel::<String>();
    let (exit_sender, exited) = mpsc::channel();
    let (output_sender, output_ended) = mpsc::channel();
    // In the state before the process can exit, so that the exit isn't mistaken for a stop.
    let previous = app
        .state::<ClaudeCodeState>()
        .0
        .lock()
        .unwrap()
        .replace(Terminal {
            id,
            master: pty.master,
            input,
            #[cfg(unix)]
            pid: child.process_id(),
            #[cfg(windows)]
            killer: child.clone_killer(),
            exited,
        });
    if let Some(previous) = previous {
        stop(previous);
    }

    thread::spawn({
        let events = events.clone();
        move || {
            let mut buffer = vec![0; 64 * 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        let chunk = InvokeResponseBody::Raw(buffer[..read].to_vec());
                        if events.send(chunk).is_err() {
                            break;
                        }
                    }
                    Err(e) if e.kind() == ErrorKind::Interrupted => {}
                    Err(_) => break,
                }
            }
            let _ = output_sender.send(());
        }
    });

    // Writes block while the terminal's input buffer is full, so they don't happen in the command.
    thread::spawn(move || {
        for data in input_queue {
            if writer
                .write_all(data.as_bytes())
                .and_then(|()| writer.flush())
                .is_err()
            {
                break;
            }
        }
    });

    thread::spawn(move || {
        let code = child.wait().ok().map(|status| status.exit_code());
        let _ = exit_sender.send(());
        // Stopped or replaced terminals were already taken out of the state and end quietly.
        let state = app.state::<ClaudeCodeState>();
        let Some(terminal) = state
            .0
            .lock()
            .unwrap()
            .take_if(|terminal| terminal.id == id)
        else {
            return;
        };
        drop(terminal);
        // Let the last output arrive first.
        let _ = output_ended.recv_timeout(Duration::from_millis(500));
        let _ = events.send(InvokeResponseBody::Json(
            json!({ "exit": code }).to_string(),
        ));
    });

    Ok(())
}

/// Sends keystrokes (or pasted text, or replies to terminal queries) to Claude Code.
#[tauri::command]
pub fn claude_code_write(app: AppHandle, data: String) -> Result<(), String> {
    let state = app.state::<ClaudeCodeState>();
    let current = state.0.lock().unwrap();
    let terminal = current.as_ref().ok_or(NOT_RUNNING)?;
    terminal
        .input
        .send(data)
        .map_err(|_| NOT_RUNNING.to_owned())
}

#[tauri::command]
pub fn claude_code_resize(app: AppHandle, cols: u16, rows: u16) -> Result<(), String> {
    let state = app.state::<ClaudeCodeState>();
    let current = state.0.lock().unwrap();
    let terminal = current.as_ref().ok_or(NOT_RUNNING)?;
    terminal
        .master
        .resize(size(cols, rows))
        .map_err(|e| format!("No se pudo cambiar el tamaño de la terminal: {e}"))
}

#[tauri::command]
pub fn claude_code_stop(app: AppHandle) {
    if let Some(terminal) = app.state::<ClaudeCodeState>().0.lock().unwrap().take() {
        stop(terminal);
    }
}

/// Asks Claude Code to exit, and kills it if it takes too long. The terminal is closed afterwards:
/// Claude Code ignores the hangup while the output reader keeps the terminal open, and closing the
/// terminal types a newline into it (see portable-pty's `UnixMasterWriter`), which could send a draft.
fn stop(terminal: Terminal) {
    thread::spawn(move || {
        #[cfg(unix)]
        if let Some(pid) = terminal.pid.and_then(|pid| libc::pid_t::try_from(pid).ok()) {
            // SAFETY: `kill` only sends a signal.
            unsafe { libc::kill(pid, libc::SIGTERM) };
            if terminal.exited.recv_timeout(Duration::from_secs(5)).is_ok() {
                return;
            }
            // Claude Code leads the terminal's process group, so this also ends what it started there.
            unsafe { libc::kill(-pid, libc::SIGKILL) };
        }
        #[cfg(windows)]
        {
            let mut killer = terminal.killer;
            let _ = killer.kill();
        }
        let _ = terminal.exited.recv_timeout(Duration::from_secs(1));
    });
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// `claude` with MeshCode's Blender tools, run as a terminal would: from the user's login shell,
/// since apps opened from the Finder or the Dock don't get the PATH and variables set in shell
/// profiles, which Claude Code needs to be found and to run hooks, MCP servers and commands.
fn command(app: &AppHandle, cwd: &str) -> Result<CommandBuilder, String> {
    let mut server = json!({
        "type": "stdio",
        "command": agent::find_node()?.to_string_lossy(),
        "args": [agent::script(app, "mcp")?.to_string_lossy(), cwd],
        // Makes the tools available from the first message, instead of once the server has started.
        "alwaysLoad": true,
    });
    if let Some(blender) = blend::find_blender() {
        server["env"] = json!({ "MESHCODE_BLENDER": blender.to_string_lossy() });
    }
    let read_only_tools = READ_ONLY_TOOLS.map(|tool| format!("mcp__{MCP_SERVER}__{tool}"));

    let program = std::env::var_os("MESHCODE_CLAUDE")
        .filter(|program| !program.is_empty())
        .unwrap_or_else(|| "claude".into());
    #[cfg(unix)]
    let mut command = {
        let shell = std::env::var_os("SHELL")
            .filter(|shell| !shell.is_empty())
            .unwrap_or_else(|| "/bin/sh".into());
        let script = if std::path::Path::new(&shell).ends_with("fish") {
            "exec $argv"
        } else {
            r#"exec "$0" "$@""#
        };
        let mut command = CommandBuilder::new(shell);
        command.args(["-l", "-i", "-c", script]);
        command.arg(program);
        command
    };
    #[cfg(windows)]
    let mut command = CommandBuilder::new(program);

    command.args([
        "--mcp-config".to_owned(),
        json!({ "mcpServers": { MCP_SERVER: server } }).to_string(),
        "--allowedTools".to_owned(),
        read_only_tools.join(","),
    ]);
    command.cwd(cwd);
    // Start like a new terminal would: without what MeshCode inherited from where it was launched
    // (such as a Claude Code session). The login shell sets the user's own variables again.
    for (name, _) in std::env::vars_os() {
        if agent::is_claude_variable(&name.to_string_lossy()) {
            command.env_remove(name);
        }
    }
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "MeshCode");
    command.env(
        "TERM_PROGRAM_VERSION",
        app.package_info().version.to_string(),
    );
    Ok(command)
}

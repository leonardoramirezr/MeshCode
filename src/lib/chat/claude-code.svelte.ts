import { Channel } from "@tauri-apps/api/core";
import { api, type TerminalEvent } from "$lib/api";

/** Claude Code, as installed on the user's machine, running in a terminal on the open folder. */
export class ClaudeCodeSession {
  readonly folder: string;

  /** `exited`: the process ended on its own (e.g. with `/exit`), with `exitCode`. */
  status = $state<"stopped" | "running" | "exited">("stopped");
  exitCode = $state<number | null>(null);
  error = $state<string | null>(null);
  /** Claude Code rang the terminal bell while the terminal was hidden. */
  attention = $state(false);

  /** Identifies the current process, so output from a replaced one is ignored. */
  private run = 0;
  private size = { cols: 0, rows: 0 };

  constructor(folder: string) {
    this.folder = folder;
  }

  /** Starts Claude Code, replacing the running one, and passes its output to `output`. */
  async start(cols: number, rows: number, output: (data: Uint8Array) => void) {
    const run = ++this.run;
    this.status = "running";
    this.exitCode = null;
    this.error = null;
    this.size = { cols, rows };
    const events = new Channel<TerminalEvent>((event) => {
      if (run !== this.run) return;
      if (event instanceof ArrayBuffer) {
        output(new Uint8Array(event));
      } else {
        this.status = "exited";
        this.exitCode = event.exit;
      }
    });
    try {
      await api.claudeCodeStart(this.folder, cols, rows, events);
    } catch (error) {
      if (run !== this.run) return;
      this.status = "stopped";
      this.error = String(error);
      return;
    }
    // Resizes while it was starting didn't reach it.
    const { size } = this;
    if (run === this.run && (size.cols !== cols || size.rows !== rows)) this.resize(size.cols, size.rows);
  }

  write(data: string) {
    if (this.status === "running") api.claudeCodeWrite(data).catch(() => {});
  }

  resize(cols: number, rows: number) {
    this.size = { cols, rows };
    if (this.status === "running") api.claudeCodeResize(cols, rows).catch(() => {});
  }

  stop() {
    this.run++;
    if (this.status === "running") void api.claudeCodeStop();
    this.status = "stopped";
  }
}

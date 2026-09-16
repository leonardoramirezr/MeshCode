import { invoke, type Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentCommand, AgentEvent } from "../../agent/protocol";

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface FsChange {
  /** Paths that were created, modified or removed. */
  paths: string[];
  /** Directories whose listing may have changed. */
  dirs: string[];
}

export type MenuAction =
  | {
      action:
        | "open_folder"
        | "clear_recent"
        | "close_folder"
        | "close_editor"
        | "show_explorer"
        | "show_chat"
        | "show_source_control"
        | "toggle_sidebar";
    }
  | { action: "open_recent"; path: string };

export interface AuthStatus {
  /** Where the Anthropic API key comes from, or `null` when there is none. */
  source: "keychain" | "env" | null;
  /** The last characters of the key. */
  hint: string | null;
}

export interface GitStatus {
  /** The repository's top-level folder, which may contain the open folder. */
  root: string;
  /** `null` when HEAD is detached. */
  branch: string | null;
  /** Abbreviated HEAD commit, `null` before the first commit. */
  commit: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileChange[];
}

export interface GitFileChange {
  /** Relative to the repository root. */
  path: string;
  /** The source of a rename or copy. */
  origPath: string | null;
  /** Status letter in the index (`M`, `A`, `D`, `R`, `C`, `T`), if staged. */
  staged: string | null;
  /** Status letter in the working tree (`M`, `D`, `T`, or `?` when untracked), if changed. */
  unstaged: string | null;
  /** Unmerged, with both sides' letters in `staged` and `unstaged`. */
  conflict: boolean;
}

export interface GitBranch {
  /** Short name, like `main` or `origin/main`. */
  name: string;
  remote: boolean;
  current: boolean;
}

/** Claude Code's terminal output, then its exit code if it exits on its own. */
export type TerminalEvent = ArrayBuffer | { exit: number | null };

export const api = {
  /** Opens and starts watching a folder. Resolves to its canonical path. */
  openFolder: (path: string) => invoke<string>("open_folder", { path }),
  closeFolder: () => invoke<void>("close_folder"),
  readDir: (path: string) => invoke<DirEntry[]>("read_dir", { path }),
  recentFolders: () => invoke<string[]>("recent_folders"),
  removeRecentFolder: (path: string) => invoke<void>("remove_recent_folder", { path }),
  clearRecentFolders: () => invoke<void>("clear_recent_folders"),
  /** Converts a .blend file with Blender and returns the GLB bytes. */
  loadBlend: (path: string) => invoke<ArrayBuffer>("load_blend", { path }),
  /** Starts (or restarts) the chat agent sidecar. */
  agentStart: () => invoke<void>("agent_start"),
  agentSend: (command: AgentCommand) => invoke<void>("agent_send", { command }),
  agentStop: () => invoke<void>("agent_stop"),
  /** Starts (or restarts) Claude Code in a terminal of the given size. */
  claudeCodeStart: (cwd: string, cols: number, rows: number, events: Channel<TerminalEvent>) =>
    invoke<void>("claude_code_start", { cwd, cols, rows, events }),
  claudeCodeWrite: (data: string) => invoke<void>("claude_code_write", { data }),
  claudeCodeResize: (cols: number, rows: number) => invoke<void>("claude_code_resize", { cols, rows }),
  claudeCodeStop: () => invoke<void>("claude_code_stop"),
  /** The repository containing `cwd`, or `null` when it isn't in one. Other git calls take its root. */
  gitStatus: (cwd: string) => invoke<GitStatus | null>("git_status", { cwd }),
  gitInit: (cwd: string) => invoke<void>("git_init", { cwd }),
  gitStage: (root: string, paths: string[]) => invoke<void>("git_stage", { root, paths }),
  gitUnstage: (root: string, paths: string[]) => invoke<void>("git_unstage", { root, paths }),
  /** Restores tracked files from the index and deletes untracked ones. */
  gitDiscard: (root: string, tracked: string[], untracked: string[]) =>
    invoke<void>("git_discard", { root, tracked, untracked }),
  /** Commits the staged changes, or every change when `all` is set. */
  gitCommit: (root: string, message: string, all: boolean) => invoke<void>("git_commit", { root, message, all }),
  /** Undoes the last commit, keeping its changes staged, and returns its message. */
  gitUndoCommit: (root: string) => invoke<string>("git_undo_commit", { root }),
  gitBranches: (root: string) => invoke<GitBranch[]>("git_branches", { root }),
  gitCheckout: (root: string, name: string, remote: boolean) => invoke<void>("git_checkout", { root, name, remote }),
  gitCreateBranch: (root: string, name: string) => invoke<void>("git_create_branch", { root, name }),
  /** Pushes the current branch, publishing it if it has no upstream yet. */
  gitPush: (root: string) => invoke<void>("git_push", { root }),
  gitPull: (root: string) => invoke<void>("git_pull", { root }),
  authStatus: () => invoke<AuthStatus>("auth_status"),
  saveApiKey: (key: string) => invoke<AuthStatus>("save_api_key", { key }),
  removeApiKey: () => invoke<AuthStatus>("remove_api_key"),
};

export const onFsChange = (handler: (change: FsChange) => void): Promise<UnlistenFn> =>
  listen<FsChange>("fs-change", (event) => handler(event.payload));

/** Something changed inside a `.git` folder of the open folder. */
export const onGitChange = (handler: () => void): Promise<UnlistenFn> => listen("git-change", handler);

export const onAgentEvent = (handler: (event: AgentEvent) => void): Promise<UnlistenFn> =>
  listen<AgentEvent>("agent-event", (event) => handler(event.payload));

export const onMenuAction = (handler: (action: MenuAction) => void): Promise<UnlistenFn> =>
  listen<MenuAction>("menu", (event) => handler(event.payload));

/** Blender files, including numbered backups like `scene.blend1`. */
export const isBlendFile = (path: string) => /\.blend\d*$/i.test(path);

export const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export const dirname = (path: string) => path.replace(/[\\/][^\\/]*[\\/]?$/, "");

/** Registers a Tauri listener from an effect/onMount and returns its cleanup. */
export function subscribe(listener: Promise<UnlistenFn>): () => void {
  return () => void listener.then((unlisten) => unlisten());
}

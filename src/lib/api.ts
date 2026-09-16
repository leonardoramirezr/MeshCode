import { invoke } from "@tauri-apps/api/core";
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
        | "toggle_sidebar";
    }
  | { action: "open_recent"; path: string };

export interface AuthStatus {
  /** Where the Anthropic API key comes from, or `null` when there is none. */
  source: "keychain" | "env" | null;
  /** The last characters of the key. */
  hint: string | null;
}

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
  authStatus: () => invoke<AuthStatus>("auth_status"),
  saveApiKey: (key: string) => invoke<AuthStatus>("save_api_key", { key }),
  removeApiKey: () => invoke<AuthStatus>("remove_api_key"),
};

export const onFsChange = (handler: (change: FsChange) => void): Promise<UnlistenFn> =>
  listen<FsChange>("fs-change", (event) => handler(event.payload));

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

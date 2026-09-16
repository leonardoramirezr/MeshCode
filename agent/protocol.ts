// Messages exchanged between the app and the agent sidecar, one JSON object per line.
import type {
  AccountInfo,
  EffortLevel,
  ModelInfo,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

export const BLENDER_SERVER = "blender";

/** Full names of the Blender tools, as the agent sees them. */
export const BLENDER_TOOLS = {
  inspect: `mcp__${BLENDER_SERVER}__inspect_blend`,
  run: `mcp__${BLENDER_SERVER}__run_blender_python`,
  render: `mcp__${BLENDER_SERVER}__render_preview`,
} as const;

export interface SessionConfig {
  /** Chosen by the app; events from the session carry it so stale ones can be ignored. */
  session: number;
  cwd: string;
  model?: string;
  effort?: EffortLevel | null;
  permissionMode: PermissionMode;
  /** Session ID of a conversation to continue, e.g. after the sidecar restarted. */
  resume?: string;
}

/** App → sidecar (stdin). A `start` replaces the current session. */
export type AgentCommand =
  | ({ type: "start" } & SessionConfig)
  | { type: "send"; text: string }
  | { type: "interrupt" }
  | { type: "set_model"; model: string }
  | { type: "set_effort"; effort: EffortLevel | null }
  | { type: "set_permission_mode"; mode: PermissionMode }
  | { type: "permission_response"; id: string; result: PermissionResult };

export interface PermissionRequest {
  id: string;
  toolName: string;
  toolUseId?: string;
  input: Record<string, unknown>;
  blockedPath?: string;
  /** Rules that would stop the same request from prompting again this session. */
  suggestions?: PermissionUpdate[];
  /** The request must not offer an "always allow" choice. */
  suppressAlwaysAllow?: boolean;
}

/** Sidecar (stdout) → app. `exit` is sent by the app itself when the sidecar process ends. */
export type AgentEvent =
  | { type: "ready"; session: number; models: ModelInfo[]; account: AccountInfo }
  | { type: "sdk"; session: number; message: SDKMessage }
  | ({ type: "permission_request"; session: number } & PermissionRequest)
  | { type: "permission_cancelled"; session: number; id: string }
  /** The session stopped on its own (e.g. a fatal error); a new `start` is needed. */
  | { type: "session_ended"; session: number }
  | { type: "error"; session?: number; message: string }
  | { type: "exit"; code: number | null; message: string };

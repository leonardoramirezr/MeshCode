// MeshCode's agent sidecar: runs a Claude Agent SDK session on the open folder.
// The app writes AgentCommands to stdin and reads AgentEvents from stdout, one JSON object per line.
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import {
  query,
  type CanUseTool,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { createBlenderServer, isInside, READ_ONLY_TOOLS } from "./blender.ts";
import { BLENDER_SERVER, BLENDER_TOOLS, type AgentCommand, type AgentEvent, type SessionConfig } from "./protocol.ts";

// stdout carries the protocol, so stray console output goes to stderr.
console.log = console.info = console.debug = console.error;

const emit = (event: AgentEvent) => process.stdout.write(`${JSON.stringify(event)}\n`);

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const instructions = (cwd: string) => `
You are the assistant inside MeshCode, a desktop app for viewing and editing Blender files. The user has the folder ${cwd} open, and MeshCode's 3D viewer reloads a .blend file as soon as it changes on disk.

Your main job is editing the .blend files in this folder. They are binary, so never read or write them with Read, Edit, Write or Bash; use the Blender tools instead:
- ${BLENDER_TOOLS.inspect} summarizes a file (scenes, collections, objects, materials). Start there.
- ${BLENDER_TOOLS.run} runs bpy code on a file and can save the result. Use it for every change, and to create new .blend files.
- ${BLENDER_TOOLS.render} renders an image of a file so you can check your changes visually.

Work in small, verified steps: inspect, change and save, then inspect or render again to confirm the result.`;

/** The session's prompt stream: user messages are pushed as they arrive from the app. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiting: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  push(message: SDKUserMessage) {
    if (this.waiting) {
      this.waiting({ value: message, done: false });
      this.waiting = null;
    } else {
      this.items.push(message);
    }
  }

  close() {
    this.closed = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}

class Session {
  readonly query: Query;
  permissionMode: PermissionMode;
  private readonly id: number;
  private readonly cwd: string;
  private readonly input = new InputQueue();
  private readonly pending = new Map<string, (result: PermissionResult) => void>();
  private closed = false;

  constructor(config: SessionConfig) {
    this.id = config.session;
    this.cwd = config.cwd;
    this.permissionMode = config.permissionMode;
    this.query = query({
      prompt: this.input,
      options: {
        cwd: config.cwd,
        model: config.model,
        effort: config.effort ?? undefined,
        permissionMode: config.permissionMode,
        allowDangerouslySkipPermissions: true,
        resume: config.resume,
        includePartialMessages: true,
        systemPrompt: { type: "preset", preset: "claude_code", append: instructions(config.cwd) },
        mcpServers: { [BLENDER_SERVER]: createBlenderServer(config.cwd) },
        allowedTools: READ_ONLY_TOOLS,
        canUseTool: this.canUseTool,
        pathToClaudeCodeExecutable: process.env.MESHCODE_CLAUDE_BIN || undefined,
        env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "meshcode/0.1.0" },
        stderr: (data) => process.stderr.write(data),
      },
    });
  }

  async run() {
    // Init failures also end the message loop below, which reports them.
    this.query.initializationResult().then(
      ({ models, account }) => emit({ type: "ready", session: this.id, models, account }),
      () => {},
    );
    try {
      for await (const message of this.query) {
        if (message.type === "system" && (message.subtype === "init" || message.subtype === "status")) {
          if (message.permissionMode) this.permissionMode = message.permissionMode;
        }
        emit({ type: "sdk", session: this.id, message });
      }
    } catch (error) {
      if (!this.closed) emit({ type: "error", session: this.id, message: errorMessage(error) });
    } finally {
      if (!this.closed) {
        this.close();
        emit({ type: "session_ended", session: this.id });
      }
    }
  }

  send(text: string) {
    this.input.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
  }

  respond(id: string, result: PermissionResult) {
    const resolve = this.pending.get(id);
    this.pending.delete(id);
    resolve?.(result);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const id of [...this.pending.keys()]) {
      this.respond(id, { behavior: "deny", message: "The session was closed." });
    }
    this.input.close();
    this.query.close();
  }

  private canUseTool: CanUseTool = async (toolName, input, options) => {
    if (toolName === BLENDER_TOOLS.run) {
      if (this.permissionMode === "plan" && input.save) {
        return { behavior: "deny", message: "Plan mode is active: don't save files until the plan is approved." };
      }
      // Blender edits are file edits, so "accept edits" covers them like Edit and Write do.
      if (this.permissionMode === "acceptEdits" && isInside(this.cwd, String(input.file ?? ""))) {
        return { behavior: "allow", updatedInput: input };
      }
    }

    const id = randomUUID();
    emit({
      type: "permission_request",
      session: this.id,
      id,
      toolName,
      toolUseId: options.toolUseID,
      input,
      blockedPath: options.blockedPath,
      suggestions: options.suggestions,
      suppressAlwaysAllow: options.suppressAlwaysAllowRule,
    });
    return new Promise<PermissionResult>((resolve) => {
      const onAbort = () => {
        if (!this.pending.delete(id)) return;
        emit({ type: "permission_cancelled", session: this.id, id });
        resolve({ behavior: "deny", message: "The request was cancelled." });
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, (result) => {
        options.signal.removeEventListener("abort", onAbort);
        resolve(result);
      });
    });
  };
}

let session: Session | null = null;

async function handle(command: AgentCommand) {
  switch (command.type) {
    case "start":
      session?.close();
      session = new Session(command);
      void session.run();
      return;
    case "send":
      if (!session) throw new Error("The chat session has not started.");
      return session.send(command.text);
    case "interrupt":
      await session?.query.interrupt();
      return;
    case "set_model":
      await session?.query.setModel(command.model);
      return;
    case "set_effort":
      await session?.query.applyFlagSettings({ effortLevel: command.effort });
      return;
    case "set_permission_mode":
      if (!session) return;
      await session.query.setPermissionMode(command.mode);
      session.permissionMode = command.mode;
      return;
    case "permission_response":
      session?.respond(command.id, command.result);
      return;
  }
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (!line.trim()) return;
  try {
    handle(JSON.parse(line) as AgentCommand).catch((error) => emit({ type: "error", message: errorMessage(error) }));
  } catch (error) {
    emit({ type: "error", message: `Invalid command: ${errorMessage(error)}` });
  }
});
// The app closes stdin when it quits or stops the agent.
lines.on("close", () => {
  session?.close();
  process.exit(0);
});

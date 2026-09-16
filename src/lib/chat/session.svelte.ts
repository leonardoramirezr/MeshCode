import type {
  AccountInfo,
  EffortLevel,
  ModelInfo,
  PermissionMode,
  PermissionResult,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentCommand, AgentEvent, PermissionRequest } from "../../../agent/protocol";
import { api, onAgentEvent, subscribe, type AuthStatus } from "$lib/api";

export interface ToolResult {
  text: string;
  /** Data URLs of the images in the result. */
  images: string[];
  isError: boolean;
}

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "text"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string; done: boolean }
  | {
      kind: "tool";
      /** The tool use ID. */
      id: string;
      name: string;
      /** `null` while the input is still being generated. */
      input: Record<string, unknown> | null;
      result: ToolResult | null;
      interrupted: boolean;
    }
  | {
      kind: "permission";
      id: string;
      request: PermissionRequest;
      state: "pending" | "allowed" | "denied" | "cancelled";
      /** What the user chose, shown once the request is answered. */
      answer?: string;
    }
  | { kind: "result"; id: string; isError: boolean; interrupted: boolean; durationMs: number; costUsd: number }
  | { kind: "error"; id: string; message: string; auth: boolean }
  | { kind: "notice"; id: string; text: string };

export type ToolItem = Extract<ChatItem, { kind: "tool" }>;
export type PermissionItem = Extract<ChatItem, { kind: "permission" }>;

type StreamEvent = SDKPartialAssistantMessage["event"];
type ToolResultBlock = Extract<Exclude<SDKUserMessage["message"]["content"], string>[number], { type: "tool_result" }>;

export const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/** Assistant errors after which retrying won't help until the user does something. */
const FATAL_ERRORS: Record<string, string> = {
  authentication_failed: "La API key no es válida o fue revocada.",
  billing_error: "La cuenta de la API no tiene crédito disponible. Revisa la facturación en Claude Console.",
  oauth_org_not_allowed: "La organización de esta cuenta no puede usar la API.",
  account_on_hold: "La cuenta de Anthropic está suspendida.",
};

const preferences = {
  get: (key: string) => {
    try {
      return localStorage.getItem(`meshcode.chat.${key}`);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string | null) => {
    try {
      if (value === null) localStorage.removeItem(`meshcode.chat.${key}`);
      else localStorage.setItem(`meshcode.chat.${key}`, value);
    } catch {
      // Preferences are a convenience; ignore storage failures.
    }
  },
};

/** The chat for the open folder, backed by the agent sidecar. */
export class ChatSession {
  readonly folder: string;

  items = $state<ChatItem[]>([]);
  draft = $state("");
  auth = $state<AuthStatus | null>(null);
  authError = $state<string | null>(null);
  /** `stopped`: no sidecar; `starting`: sidecar spawned, session initializing; `ready`: session initialized. */
  connection = $state<"stopped" | "starting" | "ready">("stopped");
  /** A turn is in progress. */
  busy = $state(false);
  models = $state<ModelInfo[]>([]);
  account = $state<AccountInfo | null>(null);
  model = $state(preferences.get("model") ?? "default");
  effort = $state<EffortLevel | null>((preferences.get("effort") as EffortLevel | null) ?? null);
  mode = $state<PermissionMode>("default");

  pendingPermissions = $derived(
    this.items.filter((item) => item.kind === "permission" && item.state === "pending").length,
  );
  /** Effort levels the selected model supports. */
  effortLevels = $derived.by(() => {
    const model = this.models.find((model) => model.value === this.model);
    if (!model) return EFFORT_LEVELS;
    return model.supportsEffort ? (model.supportedEffortLevels ?? EFFORT_LEVELS) : [];
  });

  /** Identifies the current conversation, so events from a replaced one are ignored. */
  private sessionNumber = 0;
  private sessionId: string | null = null;
  private starting: Promise<boolean> | null = null;
  private nextId = 0;
  private tools = new Map<string, ToolItem>();
  /** Items of the message being streamed, by content block index. */
  private streamBlocks = new Map<number, ChatItem>();
  /** Streamed text and thinking items not yet confirmed by their complete message, by message ID. */
  private unconfirmed = new Map<string, ChatItem[]>();
  private streamMessageId: string | null = null;
  private authFailureReported = false;

  constructor(folder: string) {
    this.folder = folder;
  }

  /** Subscribes to agent events and loads the auth status. Returns the cleanup. */
  connect(): () => void {
    const unsubscribe = subscribe(onAgentEvent((event) => this.handleEvent(event)));
    void this.refreshAuth();
    return () => {
      unsubscribe();
      void api.agentStop();
    };
  }

  async refreshAuth() {
    try {
      this.auth = await api.authStatus();
      this.authError = null;
    } catch (error) {
      this.authError = String(error);
    }
  }

  /** Saves a key and restarts the agent with it, continuing the conversation. */
  async saveApiKey(key: string) {
    this.auth = await api.saveApiKey(key);
    await this.restart();
  }

  async removeApiKey() {
    this.auth = await api.removeApiKey();
    await this.restart();
  }

  /** Starts the sidecar if it isn't running. Resolves to whether it accepts commands. */
  start(): Promise<boolean> {
    if (this.connection === "stopped") {
      if (!this.auth?.source) return Promise.resolve(false);
      this.starting = this.spawn();
    }
    return this.starting ?? Promise.resolve(false);
  }

  async send() {
    const text = this.draft.trim();
    if (!text) return;
    this.draft = "";
    this.add({ kind: "user", id: this.newId(), text });
    this.busy = true;
    this.authFailureReported = false;
    if (await this.start()) await this.command({ type: "send", text });
    else this.busy = false;
  }

  interrupt() {
    if (this.connection !== "stopped") void this.command({ type: "interrupt" });
  }

  newConversation() {
    this.items = [];
    this.sessionId = null;
    this.busy = false;
    this.resetStreamState();
    if (this.connection !== "stopped") {
      void this.start().then((running) => {
        if (running) return this.startSession();
      });
    }
  }

  setModel(model: string) {
    this.model = model;
    preferences.set("model", model);
    if (this.connection !== "stopped") void this.command({ type: "set_model", model });
    if (this.effort && !this.effortLevels.includes(this.effort)) this.setEffort(null);
  }

  setEffort(effort: EffortLevel | null) {
    this.effort = effort;
    preferences.set("effort", effort);
    if (this.connection !== "stopped") void this.command({ type: "set_effort", effort });
  }

  setMode(mode: PermissionMode) {
    this.mode = mode;
    if (this.connection !== "stopped") void this.command({ type: "set_permission_mode", mode });
  }

  respond(item: PermissionItem, result: PermissionResult, answer?: string) {
    if (item.state !== "pending") return;
    item.state = result.behavior === "allow" ? "allowed" : "denied";
    item.answer = answer;
    void this.command({ type: "permission_response", id: item.request.id, result });
  }

  private async restart() {
    await api.agentStop();
    this.connection = "stopped";
    this.busy = false;
    if (this.auth?.source) await this.start();
  }

  private async spawn(): Promise<boolean> {
    this.connection = "starting";
    try {
      await api.agentStart();
      await this.startSession();
      return true;
    } catch (error) {
      this.connection = "stopped";
      this.addError(String(error));
      return false;
    }
  }

  private startSession() {
    this.sessionNumber++;
    return api.agentSend({
      type: "start",
      session: this.sessionNumber,
      cwd: this.folder,
      model: this.model,
      effort: this.effort,
      permissionMode: this.mode,
      resume: this.sessionId ?? undefined,
    });
  }

  private async command(command: AgentCommand) {
    try {
      await api.agentSend(command);
    } catch (error) {
      this.addError(String(error));
      this.busy = false;
    }
  }

  private handleEvent(event: AgentEvent) {
    if ("session" in event && event.session !== undefined && event.session !== this.sessionNumber) return;
    switch (event.type) {
      case "ready":
        this.connection = "ready";
        this.models = event.models;
        this.account = event.account;
        break;
      case "sdk":
        this.handleMessage(event.message);
        break;
      case "permission_request": {
        const { type: _type, session: _session, ...request } = event;
        this.add({ kind: "permission", id: request.id, request, state: "pending" });
        break;
      }
      case "permission_cancelled": {
        const item = this.items.find((item) => item.kind === "permission" && item.id === event.id);
        if (item?.kind === "permission" && item.state === "pending") item.state = "cancelled";
        break;
      }
      case "error":
        this.addError(event.message);
        break;
      case "session_ended":
        // Nothing left to talk to; the next message starts a fresh sidecar that resumes the conversation.
        void api.agentStop();
        this.stopped();
        break;
      case "exit":
        this.stopped();
        this.addError(`El agente se cerró inesperadamente${event.code === null ? "" : ` (código ${event.code})`}.${event.message ? `\n\n${event.message}` : ""}`);
        break;
    }
  }

  private stopped() {
    this.connection = "stopped";
    this.busy = false;
    for (const item of this.items) {
      if (item.kind === "permission" && item.state === "pending") item.state = "cancelled";
    }
    this.finishTurn();
  }

  private handleMessage(message: SDKMessage) {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          this.sessionId = message.session_id;
          this.mode = message.permissionMode;
        } else if (message.subtype === "status" && message.permissionMode) {
          this.mode = message.permissionMode;
        } else if (message.subtype === "api_retry") {
          const fatal = FATAL_ERRORS[message.error];
          if (fatal) {
            // The CLI keeps retrying these for minutes; stop the turn right away instead.
            this.reportFatal(message.error);
            this.interrupt();
          } else {
            this.addNotice(`Reintentando la solicitud (${message.attempt}/${message.max_retries})…`);
          }
        } else if (message.subtype === "compact_boundary") {
          this.addNotice("La conversación se resumió para liberar contexto.");
        }
        break;
      case "stream_event":
        if (!message.parent_tool_use_id) this.handleStreamEvent(message.event);
        break;
      case "assistant":
        if (!message.parent_tool_use_id) this.handleAssistant(message);
        break;
      case "user":
        if (!message.parent_tool_use_id && typeof message.message.content !== "string") {
          for (const block of message.message.content) {
            if (block.type === "tool_result") this.handleToolResult(block);
          }
        }
        break;
      case "result":
        this.handleResult(message);
        break;
      case "auth_status":
        if (message.error) this.addError(message.error, true);
        break;
    }
  }

  private handleStreamEvent(event: StreamEvent) {
    switch (event.type) {
      case "message_start":
        this.streamMessageId = event.message.id;
        this.streamBlocks.clear();
        break;
      case "content_block_start": {
        const block = event.content_block;
        let item: ChatItem | null = null;
        if (block.type === "text") item = this.add({ kind: "text", id: this.newId(), text: block.text });
        else if (block.type === "thinking") {
          item = this.add({ kind: "thinking", id: this.newId(), text: block.thinking, done: false });
        } else if (block.type === "tool_use") item = this.tool(block.id, block.name);
        if (!item) break;
        this.streamBlocks.set(event.index, item);
        if (item.kind !== "tool" && this.streamMessageId) {
          const list = this.unconfirmed.get(this.streamMessageId) ?? [];
          list.push(item);
          this.unconfirmed.set(this.streamMessageId, list);
        }
        break;
      }
      case "content_block_delta": {
        const item = this.streamBlocks.get(event.index);
        if (event.delta.type === "text_delta" && item?.kind === "text") item.text += event.delta.text;
        else if (event.delta.type === "thinking_delta" && item?.kind === "thinking") item.text += event.delta.thinking;
        break;
      }
      case "content_block_stop": {
        const item = this.streamBlocks.get(event.index);
        if (item?.kind === "thinking") item.done = true;
        break;
      }
    }
  }

  /** Complete messages replace what was streamed (or add it, when nothing was). */
  private handleAssistant(message: SDKAssistantMessage) {
    const { id, content } = message.message;
    if (message.error) {
      const text = content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
      if (FATAL_ERRORS[message.error]) this.reportFatal(message.error, text);
      else this.addError(text || `Error de la API (${message.error}).`);
      this.discardUnconfirmed(id);
      return;
    }

    const unconfirmed = this.unconfirmed.get(id) ?? [];
    for (const block of content) {
      if (block.type === "tool_use") {
        this.tool(block.id, block.name).input = block.input as Record<string, unknown>;
      } else if (block.type === "text" || block.type === "thinking") {
        const index = unconfirmed.findIndex((item) => item.kind === block.type);
        const item = index === -1 ? null : unconfirmed.splice(index, 1)[0];
        if (block.type === "text") {
          if (item?.kind === "text") item.text = block.text;
          else this.add({ kind: "text", id: this.newId(), text: block.text });
        } else if (item?.kind === "thinking") {
          item.text = block.thinking;
          item.done = true;
        } else {
          this.add({ kind: "thinking", id: this.newId(), text: block.thinking, done: true });
        }
      }
    }
    if (unconfirmed.length === 0) this.unconfirmed.delete(id);
  }

  private handleToolResult(block: ToolResultBlock) {
    const tool = this.tools.get(block.tool_use_id);
    if (!tool) return;
    const parts = typeof block.content === "string" ? [{ type: "text" as const, text: block.content }] : (block.content ?? []);
    const text: string[] = [];
    const images: string[] = [];
    for (const part of parts) {
      if (part.type === "text") text.push(part.text);
      else if (part.type === "image" && part.source.type === "base64") {
        images.push(`data:${part.source.media_type};base64,${part.source.data}`);
      }
    }
    tool.result = { text: text.join("\n"), images, isError: Boolean(block.is_error) };
  }

  private handleResult(message: SDKResultMessage) {
    const interrupted = message.subtype === "error_during_execution";
    // Messages sent during the turn are queued; the session stays busy with them.
    if (!message.queued_turn_count) {
      this.busy = false;
      this.finishTurn();
    }
    this.add({
      kind: "result",
      id: this.newId(),
      isError: message.is_error && !interrupted,
      interrupted,
      durationMs: message.duration_ms,
      costUsd: message.total_cost_usd,
    });
  }

  private finishTurn() {
    for (const tool of this.tools.values()) {
      if (!tool.result) tool.interrupted = true;
    }
    for (const item of this.items) {
      if (item.kind === "thinking") item.done = true;
    }
    this.resetStreamState();
  }

  private resetStreamState() {
    this.tools.clear();
    this.streamBlocks.clear();
    this.unconfirmed.clear();
    this.streamMessageId = null;
  }

  private discardUnconfirmed(messageId: string) {
    const discarded = new Set(this.unconfirmed.get(messageId) ?? []);
    this.unconfirmed.delete(messageId);
    if (discarded.size) this.items = this.items.filter((item) => !discarded.has(item));
  }

  private reportFatal(error: string, detail?: string) {
    if (this.authFailureReported) return;
    this.authFailureReported = true;
    const auth = error === "authentication_failed";
    this.addError(detail && !auth ? `${FATAL_ERRORS[error]}\n${detail}` : FATAL_ERRORS[error], auth);
  }

  /** The tool item for a tool use, created on first sight. */
  private tool(id: string, name: string): ToolItem {
    const existing = this.tools.get(id);
    if (existing) return existing;
    const item = this.add({ kind: "tool", id, name, input: null, result: null, interrupted: false });
    this.tools.set(id, item);
    return item;
  }

  /** Appends an item and returns its reactive proxy, which is what later mutations must go through. */
  private add<T extends ChatItem>(item: T): T {
    this.items.push(item);
    return this.items[this.items.length - 1] as T;
  }

  private addError(message: string, auth = false) {
    this.add({ kind: "error", id: this.newId(), message, auth });
  }

  private addNotice(text: string) {
    this.add({ kind: "notice", id: this.newId(), text });
  }

  private newId() {
    return `item-${this.nextId++}`;
  }
}

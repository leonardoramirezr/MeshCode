<script lang="ts">
  import type { EffortLevel, ModelInfo, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
  import type { ChatSession } from "$lib/chat/session.svelte";
  import { EFFORT_LABELS, PERMISSION_MODES } from "$lib/chat/tools";
  import Picker from "./Picker.svelte";

  let { session, onSend }: { session: ChatSession; onSend: () => void } = $props();

  let textarea: HTMLTextAreaElement;

  /** Shift+Tab cycles through these, as in Claude Code. */
  const MODE_CYCLE: PermissionMode[] = ["default", "acceptEdits", "plan", "auto"];
  const MAX_HEIGHT = 240;

  const models = $derived<Pick<ModelInfo, "value" | "displayName" | "description">[]>(
    session.models.length ? session.models : [{ value: session.model, displayName: session.model, description: "" }],
  );
  const selectedModel = $derived(models.find((model) => model.value === session.model));
  const selectedMode = $derived(PERMISSION_MODES.find((mode) => mode.value === session.mode));
  const canSend = $derived(session.draft.trim().length > 0);

  $effect(() => {
    void session.draft;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT)}px`;
  });

  export function focus() {
    textarea.focus();
  }

  function send() {
    if (!canSend) return;
    onSend();
    void session.send();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    } else if (event.key === "Escape" && session.busy) {
      event.preventDefault();
      session.interrupt();
    } else if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      const next = MODE_CYCLE[(MODE_CYCLE.indexOf(session.mode) + 1) % MODE_CYCLE.length];
      session.setMode(next);
    }
  }

  const modelLabel = (model: Pick<ModelInfo, "value" | "displayName">) =>
    model.value === "default" ? "Predeterminado" : model.displayName;
</script>

<div class="composer">
  <textarea
    bind:this={textarea}
    bind:value={session.draft}
    rows="1"
    placeholder={session.busy ? "Añade instrucciones…" : "Pide cambios en tus archivos .blend…"}
    aria-label="Mensaje para Claude"
    {onkeydown}
  ></textarea>

  <div class="toolbar">
    <div class="pickers">
      <Picker
        class="mode {session.mode}"
        label="Modo de permisos"
        title="{selectedMode?.description ?? ''} (⇧Tab para cambiar)"
        value={session.mode}
        options={PERMISSION_MODES}
        onchange={(mode) => session.setMode(mode)}
      />
      <Picker
        label="Modelo"
        title={selectedModel?.description}
        value={session.model}
        options={models.map((model) => ({ value: model.value, label: modelLabel(model) }))}
        onchange={(model) => session.setModel(model)}
      />
      {#if session.effortLevels.length}
        <Picker
          label="Esfuerzo"
          title="Esfuerzo: cuánto razona Claude antes de responder"
          value={session.effort ?? ""}
          options={[
            { value: "", label: "Esfuerzo: auto" },
            ...session.effortLevels.map((level) => ({ value: level, label: `Esfuerzo: ${EFFORT_LABELS[level].toLowerCase()}` })),
          ]}
          onchange={(effort) => session.setEffort((effort || null) as EffortLevel | null)}
        />
      {/if}
    </div>

    {#if session.busy && !canSend}
      <button class="action stop" title="Detener (Esc)" aria-label="Detener" onclick={() => session.interrupt()}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1" /></svg>
      </button>
    {:else}
      <button class="action" title="Enviar (Enter)" aria-label="Enviar" disabled={!canSend} onclick={send}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg>
      </button>
    {/if}
  </div>
</div>

<style>
  .composer {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 10px 10px;
    padding: 8px 8px 6px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--bg-input);
  }

  .composer:focus-within {
    border-color: var(--accent);
  }

  textarea {
    width: 100%;
    min-height: 20px;
    padding: 0 2px;
    border: none;
    outline: none;
    resize: none;
    background: none;
    color: var(--text);
    font: inherit;
    line-height: 20px;
  }

  textarea::placeholder {
    color: var(--text-muted);
  }

  .toolbar {
    display: flex;
    align-items: flex-end;
    gap: 4px;
  }

  .pickers {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    min-width: 0;
    gap: 0 2px;
  }

  .toolbar :global(.mode.acceptEdits) {
    color: #c586c0;
  }

  .toolbar :global(.mode.plan) {
    color: #4ec9b0;
  }

  .toolbar :global(.mode.auto) {
    color: #dcdcaa;
  }

  .toolbar :global(.mode.bypassPermissions) {
    color: var(--error);
  }

  .action {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background: var(--accent);
    color: #fff;
  }

  .action:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .action:disabled {
    background: var(--bg-button-secondary);
    color: var(--text-muted);
    cursor: default;
  }

  .action svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .stop svg {
    fill: currentColor;
    stroke: none;
  }
</style>

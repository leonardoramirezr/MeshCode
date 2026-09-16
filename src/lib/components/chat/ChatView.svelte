<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import type { ChatSession } from "$lib/chat/session.svelte";
  import { basename } from "$lib/api";
  import ApiKeyForm from "./ApiKeyForm.svelte";
  import Composer from "./Composer.svelte";
  import Markdown from "./Markdown.svelte";
  import PermissionCard from "./PermissionCard.svelte";
  import ToolCall from "./ToolCall.svelte";

  let { session }: { session: ChatSession } = $props();

  const API_KEYS_URL = "https://platform.claude.com/settings/keys";
  const SUGGESTIONS = [
    "¿Qué contienen los archivos .blend de esta carpeta?",
    "Crea escena.blend con un suelo, una mesa y una lámpara",
    "Muéstrame una vista previa del modelo desde arriba",
  ];

  let transcript = $state<HTMLDivElement>();
  let composer = $state<Composer>();
  let showAccount = $state(false);
  let changingKey = $state(false);
  /** Follow new content unless the user scrolled up to read. */
  let followOutput = true;

  const currency = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });

  export function focus() {
    composer?.focus();
  }

  function keepScrolledToBottom(node: HTMLElement) {
    const observer = new ResizeObserver(() => {
      if (followOutput && transcript) transcript.scrollTop = transcript.scrollHeight;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }

  function onscroll() {
    if (!transcript) return;
    followOutput = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 40;
  }

  async function saveKey(key: string) {
    await session.saveApiKey(key);
    changingKey = false;
    showAccount = false;
  }

  function useSuggestion(text: string) {
    session.draft = text;
    focus();
  }

  function formatDuration(ms: number) {
    const seconds = ms / 1000;
    return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
  }
</script>

<section class="chat" aria-label="Chat">
  <header>
    <span class="title">Chat</span>
    {#if session.auth?.source}
      <button
        class="icon-button"
        title="Nueva conversación"
        aria-label="Nueva conversación"
        disabled={session.items.length === 0}
        onclick={() => session.newConversation()}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
      </button>
      <button
        class="icon-button"
        class:active={showAccount}
        title="API key de Anthropic"
        aria-label="API key de Anthropic"
        aria-expanded={showAccount}
        onclick={() => {
          showAccount = !showAccount;
          changingKey = false;
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="5.5" cy="10.5" r="3" />
          <path d="M7.7 8.3 13.5 2.5M11.5 4.5l1.5 1.5M10 6l1.2 1.2" />
        </svg>
      </button>
    {/if}
  </header>

  {#if session.authError}
    <p class="banner error">{session.authError}</p>
  {/if}

  {#if showAccount && session.auth?.source}
    <div class="account">
      <div>
        API key <span class="mono">{session.auth.hint}</span>
        <div class="muted">
          {session.auth.source === "keychain"
            ? "Guardada en el llavero del sistema"
            : "Tomada de la variable de entorno ANTHROPIC_API_KEY"}
        </div>
      </div>
      {#if changingKey}
        <ApiKeyForm onSave={saveKey} onCancel={() => (changingKey = false)} />
      {:else}
        <div class="account-actions">
          <button class="link" onclick={() => (changingKey = true)}>Cambiar</button>
          {#if session.auth.source === "keychain"}
            <button class="link" onclick={() => session.removeApiKey()}>Quitar</button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if session.auth && !session.auth.source}
    <div class="setup">
      <svg class="setup-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10.5L6 19.8V16h-.5A1.5 1.5 0 0 1 4 14.5v-9A1.5 1.5 0 0 1 5.5 4z" />
      </svg>
      <h2>Edita tus modelos con Claude</h2>
      <p>
        El chat usa la API de Anthropic. Crea una API key en Claude Console y pégala aquí; se guarda en el llavero
        del sistema y el uso se cobra a esa cuenta de la API.
      </p>
      <ApiKeyForm onSave={saveKey} />
      <button class="link" onclick={() => openUrl(API_KEYS_URL)}>Crear una API key ↗</button>
    </div>
  {:else if session.auth}
    <div class="transcript" bind:this={transcript} {onscroll}>
      <div class="content" {@attach keepScrolledToBottom}>
        {#if session.items.length === 0}
          <div class="empty">
            <h2>¿Qué quieres cambiar?</h2>
            <p>Claude puede inspeccionar, editar y crear archivos .blend en <strong>{basename(session.folder)}</strong>. El visor se actualiza con cada cambio.</p>
            <div class="suggestions">
              {#each SUGGESTIONS as suggestion (suggestion)}
                <button onclick={() => useSuggestion(suggestion)}>{suggestion}</button>
              {/each}
            </div>
          </div>
        {/if}

        {#each session.items as item (item.id)}
          {#if item.kind === "user"}
            <div class="user">{item.text}</div>
          {:else if item.kind === "text"}
            <div class="assistant"><Markdown text={item.text} /></div>
          {:else if item.kind === "thinking"}
            {#if item.text}
              <details class="thinking">
                <summary>{item.done ? "Razonamiento" : "Pensando…"}</summary>
                <div class="thinking-text">{item.text}</div>
              </details>
            {:else if !item.done}
              <div class="thinking pending">Pensando…</div>
            {/if}
          {:else if item.kind === "tool"}
            <ToolCall {item} cwd={session.folder} />
          {:else if item.kind === "permission"}
            <PermissionCard {item} {session} />
          {:else if item.kind === "result"}
            <div class="result" class:error={item.isError}>
              {item.interrupted ? "Interrumpido" : item.isError ? "Terminó con un error" : "Listo"} · {formatDuration(item.durationMs)}
              {#if item.costUsd > 0}· {currency.format(item.costUsd)}{/if}
            </div>
          {:else if item.kind === "error"}
            <div class="banner error">
              <span>{item.message}</span>
              {#if item.auth}
                <button
                  class="link"
                  onclick={() => {
                    showAccount = true;
                    changingKey = true;
                  }}>Cambiar la API key</button
                >
              {/if}
            </div>
          {:else}
            <div class="notice">{item.text}</div>
          {/if}
        {/each}

        {#if session.busy && session.pendingPermissions === 0}
          <div class="working"><span class="spinner"></span>Trabajando…</div>
        {:else if session.connection === "starting" && session.items.length > 0}
          <div class="working"><span class="spinner"></span>Iniciando…</div>
        {/if}
      </div>
    </div>

    <Composer bind:this={composer} {session} onSend={() => (followOutput = true)} />
  {/if}
</section>

<style>
  .chat {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  header {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 35px;
    flex-shrink: 0;
    padding: 0 8px 0 20px;
  }

  .title {
    flex: 1;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .icon-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    color: var(--text-muted);
  }

  .icon-button:hover:not(:disabled),
  .icon-button.active {
    background: var(--bg-hover);
    color: var(--text);
  }

  .icon-button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .icon-button svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
  }

  .account {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0 10px 8px;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--bg-widget);
  }

  .account-actions {
    display: flex;
    gap: 12px;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .muted {
    font-size: 12px;
    color: var(--text-muted);
  }

  .link {
    align-self: flex-start;
    color: var(--accent-text);
  }

  .link:hover {
    text-decoration: underline;
  }

  .setup {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 24px 20px;
    overflow: auto;
  }

  .setup-icon {
    width: 32px;
    height: 32px;
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1.2;
    stroke-linejoin: round;
  }

  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-bright);
  }

  .setup p,
  .empty p {
    margin: 0;
    color: var(--text-muted);
  }

  .transcript {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    user-select: text;
    -webkit-user-select: text;
    cursor: auto;
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px 14px 12px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px 0;
  }

  .suggestions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    margin-top: 4px;
  }

  .suggestions button {
    padding: 4px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    font-size: 12px;
    text-align: left;
    color: var(--text);
  }

  .suggestions button:hover {
    background: var(--bg-hover);
  }

  .user {
    margin-top: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--bg-widget);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text-bright);
  }

  .user:first-child {
    margin-top: 0;
  }

  .thinking {
    font-size: 12px;
    color: var(--text-muted);
  }

  .thinking summary {
    cursor: pointer;
    font-style: italic;
  }

  .thinking.pending {
    font-style: italic;
  }

  .thinking-text {
    margin: 4px 0 0 12px;
    padding-left: 8px;
    border-left: 2px solid var(--border-strong);
    white-space: pre-wrap;
  }

  .result {
    font-size: 12px;
    color: var(--text-muted);
  }

  .result.error {
    color: var(--error);
  }

  .banner {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 6px 10px;
    border-radius: 4px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .banner.error {
    border: 1px solid rgba(244, 135, 113, 0.35);
    background: rgba(244, 135, 113, 0.08);
    color: var(--error);
  }

  header + .banner {
    margin: 0 10px 8px;
  }

  .notice {
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
  }

  .working {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .spinner {
    width: 10px;
    height: 10px;
    border: 2px solid var(--text-muted);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>

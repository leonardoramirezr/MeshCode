<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import { Terminal } from "@xterm/xterm";
  import "@xterm/xterm/css/xterm.css";
  import { onDestroy, untrack } from "svelte";
  import type { ClaudeCodeSession } from "$lib/chat/claude-code.svelte";

  let { session, visible }: { session: ClaudeCodeSession; visible: boolean } = $props();

  const SETUP_URL = "https://code.claude.com/docs/en/setup";
  /** What the shell exits with when it can't find the `claude` command. */
  const NOT_FOUND = 127;

  let container = $state<HTMLDivElement>();
  let terminal: Terminal | null = null;
  const fit = new FitAddon();

  // xterm measures its font when it opens, so the terminal opens (and Claude Code starts) once it's shown.
  $effect(() => {
    if (!visible || !container) return;
    const element = container;
    untrack(() => {
      terminal ??= open(element);
      fit.fit();
      session.attention = false;
      if (session.status === "stopped" && !session.error) restart();
    });
  });

  onDestroy(() => terminal?.dispose());

  export function focus() {
    terminal?.focus();
  }

  /** Starts a new Claude Code session in a clean terminal. */
  export function restart() {
    if (!terminal) return;
    terminal.reset();
    void session.start(terminal.cols, terminal.rows, (data) => terminal?.write(data));
    terminal.focus();
  }

  function open(element: HTMLElement): Terminal {
    const style = getComputedStyle(element);
    const css = (name: string) => style.getPropertyValue(name).trim();
    const terminal = new Terminal({
      fontFamily: css("--font-mono"),
      fontSize: 12,
      scrollback: 5000,
      theme: {
        background: css("--bg-sidebar"),
        foreground: css("--text"),
        cursor: css("--text-bright"),
        selectionBackground: "#264f78",
      },
      linkHandler: { activate: (_event, uri) => void openUrl(uri) },
    });
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon((_event, uri) => void openUrl(uri)));
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.key !== "Enter" || !event.shiftKey) return true;
      // Claude Code adds a line on Esc+Enter, which is what Option+Enter sends in terminals set up for it.
      if (event.type === "keydown") session.write("\x1b\r");
      return false;
    });
    terminal.onData((data) => session.write(data));
    terminal.onResize(({ cols, rows }) => session.resize(cols, rows));
    terminal.onBell(() => {
      if (!visible) session.attention = true;
    });
    terminal.open(element);
    return terminal;
  }

  function fitOnResize(node: HTMLElement) {
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(node);
    return () => observer.disconnect();
  }
</script>

<div class="claude-code">
  <div class="terminal" bind:this={container} {@attach fitOnResize}></div>

  {#if session.error}
    <div class="banner error">
      <span>{session.error}</span>
      <button class="link" onclick={restart}>Reintentar</button>
    </div>
  {:else if session.status === "exited"}
    <div class="banner" class:error={session.exitCode === NOT_FOUND}>
      {#if session.exitCode === NOT_FOUND}
        <span>No se encontró Claude Code. Instálalo o indica su ruta con la variable de entorno MESHCODE_CLAUDE.</span>
        <button class="link" onclick={() => openUrl(SETUP_URL)}>Cómo instalar Claude Code ↗</button>
      {:else}
        <span>Claude Code terminó.</span>
      {/if}
      <button class="link" onclick={restart}>Reiniciar</button>
    </div>
  {/if}
</div>

<style>
  .claude-code {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  /* Margins rather than padding: the fit addon sizes the terminal to this element's width and height. */
  .terminal {
    flex: 1;
    min-height: 0;
    margin: 0 0 6px 12px;
    overflow: hidden;
  }

  .banner {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    margin: 0 10px 10px;
    padding: 6px 10px;
    border-radius: 4px;
    background: var(--bg-widget);
    overflow-wrap: anywhere;
  }

  .banner.error {
    border: 1px solid rgba(244, 135, 113, 0.35);
    background: rgba(244, 135, 113, 0.08);
    color: var(--error);
  }

  .link {
    color: var(--accent-text);
  }

  .link:hover {
    text-decoration: underline;
  }
</style>

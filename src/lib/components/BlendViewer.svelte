<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { api } from "$lib/api";
  import { ModelViewer, type NavigationMode } from "$lib/viewer/ModelViewer";

  interface Props {
    path: string;
    /** Bumped whenever the file changes on disk. */
    version: number;
  }

  let { path, version }: Props = $props();

  let container: HTMLDivElement;
  let viewer: ModelViewer | null = null;
  let mode = $state<NavigationMode>("orbit");
  let loading = $state(true);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let speed = $state(1);
  let pointerLocked = $state(false);
  let requestId = 0;

  onMount(() => {
    viewer = new ModelViewer(container);
    viewer.onSpeedChange = (factor) => (speed = factor);
    viewer.onPointerLockChange = (locked) => (pointerLocked = locked);
    return () => {
      requestId++;
      viewer?.dispose();
      viewer = null;
    };
  });

  $effect(() => {
    void path;
    void version;
    untrack(load);
  });

  async function load() {
    const id = ++requestId;
    loading = true;
    try {
      const glb = await api.loadBlend(path);
      if (id !== requestId || !viewer) return;
      await viewer.setModel(glb, !loaded);
      if (id !== requestId) return;
      loaded = true;
      error = null;
    } catch (e) {
      if (id === requestId) error = String(e);
    } finally {
      if (id === requestId) loading = false;
    }
  }

  function setMode(next: NavigationMode) {
    mode = next;
    viewer?.setMode(next);
  }
</script>

<div class="viewer">
  <div class="toolbar">
    <div class="segmented" role="group" aria-label="Modo de navegación">
      <button class:active={mode === "orbit"} onclick={() => setMode("orbit")} title="Rotar alrededor del modelo">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <ellipse cx="8" cy="8" rx="6.5" ry="3" fill="none" stroke="currentColor" />
          <path d="M11.5 4.2 13.6 5l-.6 2.2" fill="none" stroke="currentColor" />
          <circle cx="8" cy="8" r="1.8" fill="currentColor" />
        </svg>
        Rotar
      </button>
      <button class:active={mode === "walk"} onclick={() => setMode("walk")} title="Caminar en primera persona">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="9" cy="2.5" r="1.5" fill="currentColor" />
          <path
            d="M8 5 5.5 8.5l2 .8L6.5 14M8 5l1.5 3.5 2.5 1M8 5l-2.8 1.2L4 8.5M8.2 9.5 10 14"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
          />
        </svg>
        Caminar
      </button>
    </div>
    <button class="tool" onclick={() => viewer?.frameModel()} title="Encuadrar el modelo completo">
      Encuadrar
    </button>
    <button class="tool" onclick={() => viewer?.goToCenter()} title="Ir al centro del modelo">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" />
        <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" />
        <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      </svg>
      Centro
    </button>
    <div class="spacer"></div>
    {#if loading}
      <span class="status"><span class="spinner"></span>{loaded ? "Actualizando…" : "Convirtiendo con Blender…"}</span>
    {/if}
  </div>

  <div class="canvas" bind:this={container}>
    {#if mode === "walk" && loaded}
      <div class="hint">
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> moverse</span>
        <span><kbd>3</kbd> subir</span>
        <span><kbd>X</kbd> bajar</span>
        <span><kbd>Shift</kbd> correr</span>
        <span>Rueda: velocidad ×{speed.toFixed(2)}</span>
        <span>{pointerLocked ? "Esc para liberar el ratón" : "Haz clic o arrastra para mirar"}</span>
      </div>
    {/if}

    {#if error}
      <div class="error" class:overlay={!loaded}>
        <strong>{loaded ? "No se pudo actualizar el modelo" : "No se pudo abrir el archivo"}</strong>
        <pre>{error}</pre>
      </div>
    {:else if loading && !loaded}
      <div class="placeholder"><span class="spinner large"></span></div>
    {/if}
  </div>
</div>

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-editor);
  }

  .segmented {
    display: flex;
    background: var(--bg-input);
    border-radius: 4px;
    padding: 2px;
  }

  .segmented button,
  .tool {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 8px;
    border-radius: 3px;
    color: var(--text-muted);
  }

  .segmented button:hover,
  .tool:hover {
    color: var(--text);
  }

  .segmented button.active {
    background: var(--accent);
    color: var(--text-bright);
  }

  .tool:hover {
    background: var(--bg-hover);
  }

  svg {
    width: 14px;
    height: 14px;
  }

  .spacer {
    flex: 1;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    font-size: 12px;
  }

  .canvas {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .hint {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 14px;
    max-width: calc(100% - 24px);
    padding: 6px 12px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.55);
    color: #ddd;
    font-size: 12px;
    pointer-events: none;
  }

  kbd {
    display: inline-block;
    min-width: 16px;
    margin-right: 2px;
    padding: 0 4px;
    border: 1px solid #666;
    border-bottom-width: 2px;
    border-radius: 3px;
    font: inherit;
    font-size: 11px;
    text-align: center;
  }

  .placeholder,
  .error.overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--bg-editor);
  }

  .error {
    position: absolute;
    top: 12px;
    right: 12px;
    max-width: min(520px, calc(100% - 24px));
    padding: 10px 14px;
    border-radius: 6px;
    background: #2b1d1b;
    border: 1px solid rgba(244, 135, 113, 0.4);
    color: var(--error);
    user-select: text;
    -webkit-user-select: text;
  }

  .error.overlay {
    max-width: none;
    border: none;
    border-radius: 0;
    padding: 24px;
  }

  pre {
    margin: 8px 0 0;
    max-width: 720px;
    max-height: 50vh;
    overflow: auto;
    white-space: pre-wrap;
    font-size: 12px;
    color: var(--text-muted);
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--text-muted);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .spinner.large {
    width: 28px;
    height: 28px;
    border-width: 3px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>

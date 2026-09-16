<script lang="ts">
  import { basename, dirname, type GitFileChange } from "$lib/api";
  import type { SourceControl } from "$lib/source-control.svelte";
  import FileIcon from "../FileIcon.svelte";
  import BranchPicker from "./BranchPicker.svelte";

  interface Props {
    scm: SourceControl;
    onOpenFile: (path: string) => void;
  }

  let { scm, onOpenFile }: Props = $props();

  type Group = "conflicts" | "staged" | "changes";

  const isMac = navigator.userAgent.includes("Mac");
  const STATUS_LABELS: Record<string, string> = {
    M: "Modificado",
    A: "Añadido",
    D: "Eliminado",
    R: "Renombrado",
    C: "Copiado",
    T: "Tipo de archivo cambiado",
    "?": "Sin seguimiento",
  };
  const LETTER_CLASSES: Record<string, string> = {
    M: "modified",
    T: "modified",
    A: "added",
    U: "added",
    R: "added",
    C: "added",
    D: "deleted",
    "!": "conflict",
  };
  const MAX_MESSAGE_HEIGHT = 160;

  let textarea = $state<HTMLTextAreaElement>();
  let menuOpen = $state(false);
  let picker = $state<"switch" | "create" | null>(null);
  let collapsed = $state<Record<Group, boolean>>({ conflicts: false, staged: false, changes: false });

  const status = $derived(scm.status);
  const busy = $derived(scm.operation !== null);
  const hasChanges = $derived(scm.conflicts.length + scm.staged.length + scm.changes.length > 0);
  const canCommit = $derived(!busy && hasChanges && scm.message.trim().length > 0);
  const branchLabel = $derived(
    status ? (status.branch ?? `HEAD desacoplado (${status.commit ?? "sin commits"})`) : "",
  );
  const syncLabel = $derived.by(() => {
    if (!status?.upstream) return "Publicar la rama";
    const counts = `${status.behind ? ` ${status.behind}↓` : ""}${status.ahead ? ` ${status.ahead}↑` : ""}`;
    return (status.behind ? "Sincronizar cambios" : "Hacer push") + counts;
  });

  $effect(() => {
    if (!textarea) return;
    void scm.message;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_MESSAGE_HEIGHT)}px`;
  });

  export function focus() {
    textarea?.focus();
  }

  /** Closes a popup when clicking outside of `node` or pressing Escape. */
  function dismissable(close: () => void) {
    return (node: HTMLElement) => {
      const onpointerdown = (event: PointerEvent) => {
        if (!node.contains(event.target as Node)) close();
      };
      const onkeydown = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        close();
      };
      window.addEventListener("pointerdown", onpointerdown, true);
      node.addEventListener("keydown", onkeydown);
      return () => {
        window.removeEventListener("pointerdown", onpointerdown, true);
        node.removeEventListener("keydown", onkeydown);
      };
    };
  }

  function menuAction(action: () => unknown) {
    menuOpen = false;
    action();
  }

  function onMessageKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && (isMac ? event.metaKey : event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      if (canCommit) scm.commit();
    }
  }

  function letter(file: GitFileChange, group: Group) {
    if (group === "conflicts") return "!";
    const code = group === "staged" ? file.staged : file.unstaged;
    return code === "?" ? "U" : (code ?? "");
  }

  function describe(file: GitFileChange, group: Group) {
    if (group === "conflicts") return "Conflicto";
    const code = (group === "staged" ? file.staged : file.unstaged) ?? "";
    const label = STATUS_LABELS[code] ?? code;
    return file.origPath ? `${label} (antes ${file.origPath})` : label;
  }

  function isDeleted(file: GitFileChange, group: Group) {
    return group !== "conflicts" && (group === "staged" ? file.staged : file.unstaged) === "D";
  }

  function open(file: GitFileChange, group: Group) {
    if (!isDeleted(file, group)) onOpenFile(scm.absolutePath(file));
  }
</script>

{#snippet icon(name: "stage" | "unstage" | "discard")}
  <svg viewBox="0 0 16 16" aria-hidden="true">
    {#if name === "stage"}
      <path d="M8 3.5v9M3.5 8h9" />
    {:else if name === "unstage"}
      <path d="M3.5 8h9" />
    {:else}
      <path d="M5.5 3.5 3 6l2.5 2.5" /><path d="M3.3 6h6.2a3 3 0 0 1 0 6H6.5" />
    {/if}
  </svg>
{/snippet}

{#snippet group(id: Group, title: string, files: GitFileChange[])}
  {#if files.length > 0}
    <div class="group">
      <div class="group-header">
        <button
          class="group-toggle"
          aria-expanded={!collapsed[id]}
          onclick={() => (collapsed[id] = !collapsed[id])}
        >
          <svg class="chevron" class:expanded={!collapsed[id]} viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 4l4 4-4 4" />
          </svg>
          <span class="group-title">{title}</span>
        </button>
        <span class="actions">
          {#if id === "changes"}
            <button
              class="icon-button"
              title="Descartar todos los cambios"
              aria-label="Descartar todos los cambios"
              disabled={busy}
              onclick={() => scm.discard(files)}>{@render icon("discard")}</button
            >
          {/if}
          {#if id === "staged"}
            <button
              class="icon-button"
              title="Quitar todos los cambios del stage"
              aria-label="Quitar todos los cambios del stage"
              disabled={busy}
              onclick={() => scm.unstage(files)}>{@render icon("unstage")}</button
            >
          {:else}
            <button
              class="icon-button"
              title={id === "conflicts" ? "Marcar todos como resueltos" : "Preparar todos los cambios"}
              aria-label={id === "conflicts" ? "Marcar todos como resueltos" : "Preparar todos los cambios"}
              disabled={busy}
              onclick={() => scm.stage(files)}>{@render icon("stage")}</button
            >
          {/if}
        </span>
        <span class="count">{files.length}</span>
      </div>

      {#if !collapsed[id]}
        {#each files as file (file.path)}
          {@const dir = file.path.includes("/") ? dirname(file.path) : ""}
          <div
            class="file"
            role="button"
            tabindex="0"
            title="{file.path} • {describe(file, id)}"
            onclick={() => open(file, id)}
            onkeydown={(event) => event.key === "Enter" && event.target === event.currentTarget && open(file, id)}
          >
            <FileIcon path={file.path} />
            <span class="file-name" class:deleted={isDeleted(file, id)}>{basename(file.path)}</span>
            <span class="file-dir">{dir}</span>
            <span class="actions">
              {#if id === "changes"}
                <button
                  class="icon-button"
                  title="Descartar cambios"
                  aria-label="Descartar los cambios de {basename(file.path)}"
                  disabled={busy}
                  onclick={(event) => {
                    event.stopPropagation();
                    scm.discard([file]);
                  }}>{@render icon("discard")}</button
                >
              {/if}
              {#if id === "staged"}
                <button
                  class="icon-button"
                  title="Quitar del stage"
                  aria-label="Quitar {basename(file.path)} del stage"
                  disabled={busy}
                  onclick={(event) => {
                    event.stopPropagation();
                    scm.unstage([file]);
                  }}>{@render icon("unstage")}</button
                >
              {:else}
                <button
                  class="icon-button"
                  title={id === "conflicts" ? "Marcar como resuelto" : "Preparar cambios"}
                  aria-label="{id === 'conflicts' ? 'Marcar como resuelto' : 'Preparar'} {basename(file.path)}"
                  disabled={busy}
                  onclick={(event) => {
                    event.stopPropagation();
                    scm.stage([file]);
                  }}>{@render icon("stage")}</button
                >
              {/if}
            </span>
            <span class="letter {LETTER_CLASSES[letter(file, id)] ?? ''}">{letter(file, id)}</span>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
{/snippet}

<section class="scm" aria-label="Control de código fuente">
  <header>
    <span class="title">Control de código fuente</span>
    <span class="spacer"></span>
    {#if status}
      <button
        class="icon-button"
        title="Actualizar"
        aria-label="Actualizar"
        onclick={() => scm.refresh()}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M12.8 8.5A4.8 4.8 0 1 1 11.3 4.4" /><path d="M12 2v2.8H9.2" />
        </svg>
      </button>
      <div class="menu-anchor" {@attach menuOpen ? dismissable(() => (menuOpen = false)) : undefined}>
        <button
          class="icon-button"
          class:active={menuOpen}
          title="Más acciones"
          aria-label="Más acciones"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onclick={() => (menuOpen = !menuOpen)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" class="filled">
            <circle cx="3.5" cy="8" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="12.5" cy="8" r="1" />
          </svg>
        </button>
        {#if menuOpen}
          <div class="menu" role="menu">
            <button role="menuitem" disabled={busy || !status.upstream} onclick={() => menuAction(() => scm.pull())}>
              Pull
            </button>
            <button
              role="menuitem"
              disabled={busy || !status.branch || !status.commit}
              onclick={() => menuAction(() => scm.push())}
            >
              {status.upstream ? "Push" : "Publicar la rama"}
            </button>
            <hr />
            <button role="menuitem" disabled={busy} onclick={() => menuAction(() => (picker = "switch"))}>
              Cambiar de rama…
            </button>
            <button role="menuitem" disabled={busy} onclick={() => menuAction(() => (picker = "create"))}>
              Crear rama…
            </button>
            <hr />
            <button role="menuitem" disabled={busy || !status.commit} onclick={() => menuAction(() => scm.undoCommit())}>
              Deshacer el último commit
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </header>

  {#if busy}
    <div class="progress" role="progressbar" aria-label={scm.operation}></div>
  {/if}

  {#if status === null}
    <div class="empty">
      <p>La carpeta abierta no está en un repositorio de Git.</p>
      <button class="primary" disabled={busy} onclick={() => scm.init()}>Inicializar repositorio</button>
      <p class="muted">Crea un repositorio para guardar versiones de tus archivos .blend con commits.</p>
    </div>
  {:else if status}
    <div class="body">
      <div class="branch-anchor" {@attach picker ? dismissable(() => (picker = null)) : undefined}>
        <button
          class="branch"
          title="Cambiar de rama"
          aria-haspopup="listbox"
          aria-expanded={picker !== null}
          disabled={busy}
          onclick={() => (picker = picker ? null : "switch")}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="5" cy="3.8" r="1.4" /><circle cx="5" cy="12.2" r="1.4" /><circle cx="11" cy="5.2" r="1.4" />
            <path d="M5 5.2v5.6M11 6.6c0 2.6-6 1.8-6 4.2" />
          </svg>
          <span class="branch-name">{branchLabel}</span>
          <svg class="caret" viewBox="0 0 8 5" aria-hidden="true"><path d="M.5.5 4 4 7.5.5" /></svg>
        </button>
        {#if status.upstream && (status.ahead || status.behind)}
          <span class="sync-counts" title="{status.behind} commits por traer y {status.ahead} por enviar a {status.upstream}">
            {[status.behind && `${status.behind}↓`, status.ahead && `${status.ahead}↑`].filter(Boolean).join(" ")}
          </span>
        {/if}
        {#if picker}
          <div class="popup">
            <BranchPicker {scm} creating={picker === "create"} onClose={() => (picker = null)} />
          </div>
        {/if}
      </div>

      <textarea
        bind:this={textarea}
        bind:value={scm.message}
        rows="1"
        placeholder="Mensaje ({isMac ? '⌘' : 'Ctrl+'}Enter para hacer commit{status.branch ? ` en «${status.branch}»` : ''})"
        aria-label="Mensaje del commit"
        spellcheck="false"
        onkeydown={onMessageKeydown}
      ></textarea>

      {#if busy}
        <button class="primary" disabled>{scm.operation}</button>
      {:else if !hasChanges && scm.canSync}
        <button class="primary" onclick={() => scm.sync()}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 13V3M2.5 5.5 5 3l2.5 2.5M11 3v10M8.5 10.5 11 13l2.5-2.5" /></svg>
          {syncLabel}
        </button>
      {:else}
        <button
          class="primary"
          disabled={!canCommit}
          title={scm.staged.length === 0 && hasChanges ? "No hay cambios preparados: se incluirán todos los cambios" : undefined}
          onclick={() => scm.commit()}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
          Commit
        </button>
      {/if}

      <div class="groups">
        {@render group("conflicts", "Conflictos de fusión", scm.conflicts)}
        {@render group("staged", "Cambios preparados", scm.staged)}
        {@render group("changes", "Cambios", scm.changes)}
        {#if !hasChanges}
          <p class="muted no-changes">No hay cambios.</p>
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .scm {
    position: relative;
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
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .spacer {
    flex: 1;
  }

  .progress {
    position: absolute;
    top: 35px;
    left: 0;
    right: 0;
    height: 2px;
    overflow: hidden;
  }

  .progress::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    width: 30%;
    background: var(--accent);
    animation: progress 1.2s ease-in-out infinite;
  }

  @keyframes progress {
    from {
      left: -30%;
    }
    to {
      left: 100%;
    }
  }

  .icon-button {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
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

  svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  svg.filled {
    fill: currentColor;
    stroke: none;
  }

  .menu-anchor,
  .branch-anchor {
    position: relative;
  }

  .menu {
    position: absolute;
    top: 26px;
    right: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    min-width: 200px;
    padding: 4px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--bg-widget);
    box-shadow: 0 6px 20px rgb(0 0 0 / 45%);
  }

  .menu button {
    height: 24px;
    padding: 0 10px;
    border-radius: 3px;
    text-align: left;
    white-space: nowrap;
  }

  .menu button:hover:not(:disabled) {
    background: var(--accent);
    color: #fff;
  }

  .menu button:disabled {
    color: var(--text-inactive);
    opacity: 0.6;
    cursor: default;
  }

  .menu hr {
    width: 100%;
    margin: 4px 0;
    border: none;
    border-top: 1px solid var(--border-strong);
  }

  .body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .branch-anchor {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 12px 6px;
  }

  .branch {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    height: 22px;
    padding: 0 5px;
    border-radius: 3px;
    color: var(--text-muted);
  }

  .branch:hover:not(:disabled),
  .branch[aria-expanded="true"] {
    background: var(--bg-hover);
    color: var(--text);
  }

  .branch:disabled {
    cursor: default;
  }

  .branch-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .caret {
    width: 8px;
    height: 5px;
    stroke-width: 1;
  }

  .sync-counts {
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .popup {
    position: absolute;
    top: 26px;
    left: 0;
    right: 0;
    z-index: 20;
  }

  textarea {
    margin: 0 12px;
    min-height: 28px;
    padding: 4px 6px;
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    outline: none;
    resize: none;
    background: var(--bg-input);
    color: var(--text);
    font: inherit;
    line-height: 18px;
  }

  textarea:focus {
    border-color: var(--accent);
  }

  textarea::placeholder {
    color: var(--text-muted);
  }

  .primary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 28px;
    padding: 0 12px;
    border-radius: 3px;
    background: var(--accent);
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
  }

  .body > .primary {
    margin: 8px 12px 10px;
  }

  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .groups {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 12px;
  }

  .group-header,
  .file {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding-right: 12px;
  }

  .group-header:hover,
  .file:hover,
  .file:focus-visible {
    background: var(--bg-hover);
  }

  .file:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .group-toggle {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 2px;
    min-width: 0;
    height: 100%;
    padding-left: 8px;
    text-align: left;
  }

  .group-title {
    overflow: hidden;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron {
    color: var(--text-muted);
    transition: transform 0.1s;
  }

  .chevron.expanded {
    transform: rotate(90deg);
  }

  .count {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--bg-button-secondary-hover);
    font-size: 11px;
    line-height: 18px;
    text-align: center;
  }

  .file {
    padding-left: 30px;
    cursor: default;
  }

  .file-name {
    flex-shrink: 0;
    max-width: 70%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-name.deleted {
    text-decoration: line-through;
  }

  .file-dir {
    flex: 1;
    min-width: 0;
    margin-left: 2px;
    overflow: hidden;
    font-size: 12px;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: none;
    gap: 1px;
  }

  .group-header:hover .actions,
  .file:hover .actions,
  .file:focus-within .actions {
    display: flex;
  }

  .letter {
    width: 14px;
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 600;
    text-align: center;
  }

  .letter.modified {
    color: #e2c08d;
  }

  .letter.added {
    color: #73c991;
  }

  .letter.deleted {
    color: #c74e39;
  }

  .letter.conflict {
    color: #e4676b;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding: 4px 20px;
  }

  .empty p {
    margin: 0;
  }

  .muted {
    font-size: 12px;
    color: var(--text-muted);
  }

  .no-changes {
    margin: 4px 20px;
  }
</style>

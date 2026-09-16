<script lang="ts">
  import { basename, dirname } from "$lib/api";

  interface Props {
    recent: string[];
    error: string | null;
    onOpenFolder: () => void;
    onOpenRecent: (path: string) => void;
    onRemoveRecent: (path: string) => void;
    onClearRecent: () => void;
  }

  let { recent, error, onOpenFolder, onOpenRecent, onRemoveRecent, onClearRecent }: Props = $props();

  const isMac = navigator.userAgent.includes("Mac");
</script>

<main class="welcome">
  <div class="content">
    <header>
      <h1>MeshCode</h1>
      <p class="subtitle">Visor de modelos de Blender</p>
    </header>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <div class="columns">
      <section>
        <h2>Inicio</h2>
        <button class="action" onclick={onOpenFolder}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M1.5 3h4.5l1.5 1.5H14a.5.5 0 0 1 .5.5v7.5a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5zm1 2.5V12h11V5.5z"
            />
          </svg>
          Abrir carpeta…
          <kbd>{isMac ? "⌘O" : "Ctrl+O"}</kbd>
        </button>
      </section>

      <section>
        <div class="section-header">
          <h2>Recientes</h2>
          {#if recent.length > 0}
            <button class="link muted" onclick={onClearRecent}>Limpiar</button>
          {/if}
        </div>
        {#if recent.length === 0}
          <p class="muted">No hay carpetas recientes.</p>
        {:else}
          <ul>
            {#each recent as folder (folder)}
              <li>
                <button class="link" title={folder} onclick={() => onOpenRecent(folder)}>
                  {basename(folder)}
                </button>
                <span class="path" title={folder}>{dirname(folder)}</span>
                <button
                  class="remove"
                  title="Quitar de recientes"
                  aria-label="Quitar {basename(folder)} de recientes"
                  onclick={() => onRemoveRecent(folder)}>×</button
                >
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  </div>
</main>

<style>
  .welcome {
    height: 100vh;
    overflow: auto;
    display: flex;
    justify-content: center;
    background: var(--bg-editor);
  }

  .content {
    width: min(760px, 100% - 64px);
    padding: 12vh 0 48px;
  }

  h1 {
    margin: 0;
    font-size: 36px;
    font-weight: 400;
    color: var(--text-bright);
  }

  .subtitle {
    margin: 4px 0 40px;
    font-size: 18px;
    color: var(--text-muted);
  }

  .columns {
    display: grid;
    grid-template-columns: 1fr 1.6fr;
    gap: 48px;
  }

  @media (max-width: 640px) {
    .columns {
      grid-template-columns: 1fr;
      gap: 24px;
    }
  }

  h2 {
    margin: 0 0 10px;
    font-size: 16px;
    font-weight: 400;
    color: var(--text-bright);
  }

  .section-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .action {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--accent-text);
    padding: 3px 0;
  }

  .action svg {
    width: 16px;
    height: 16px;
  }

  .action:hover {
    color: #6fbcff;
  }

  kbd {
    font: inherit;
    font-size: 11px;
    color: var(--text-muted);
    margin-left: 6px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 2px 0;
  }

  .link {
    color: var(--accent-text);
    white-space: nowrap;
  }

  .link:hover {
    text-decoration: underline;
  }

  .link.muted {
    color: var(--text-muted);
    font-size: 12px;
  }

  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
  }

  .remove {
    visibility: hidden;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 16px;
    line-height: 1;
  }

  li:hover .remove,
  .remove:focus-visible {
    visibility: visible;
  }

  .remove:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .muted {
    color: var(--text-muted);
  }

  .error {
    color: var(--error);
    background: rgba(244, 135, 113, 0.1);
    border: 1px solid rgba(244, 135, 113, 0.3);
    padding: 8px 12px;
    border-radius: 4px;
    margin: 0 0 24px;
  }
</style>

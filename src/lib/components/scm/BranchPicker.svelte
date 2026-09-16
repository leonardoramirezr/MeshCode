<script lang="ts">
  import { onMount } from "svelte";
  import type { GitBranch } from "$lib/api";
  import type { SourceControl } from "$lib/source-control.svelte";

  interface Props {
    scm: SourceControl;
    /** Start with the text field ready for a new branch's name. */
    creating?: boolean;
    onClose: () => void;
  }

  let { scm, creating = false, onClose }: Props = $props();

  type Item = { kind: "create"; name: string } | { kind: "branch"; branch: GitBranch };

  let branches = $state<GitBranch[] | null>(null);
  let query = $state("");
  let highlighted = $state(0);
  let input: HTMLInputElement;
  let list = $state<HTMLElement>();

  /** Git doesn't allow spaces in branch names; VS Code turns them into dashes too. */
  const newName = $derived(query.trim().replace(/\s+/g, "-"));
  const local = $derived(branches?.filter((branch) => !branch.remote) ?? []);
  // A remote branch with a local counterpart is reached through the local one.
  const remote = $derived(
    branches?.filter(
      (branch) => branch.remote && !local.some((other) => other.name === branch.name.replace(/^[^/]+\//, "")),
    ) ?? [],
  );
  const matches = (branch: GitBranch) => branch.name.toLowerCase().includes(query.trim().toLowerCase());
  const shownLocal = $derived(local.filter(matches));
  const shownRemote = $derived(remote.filter(matches));
  const items = $derived<Item[]>([
    ...(newName && !local.some((branch) => branch.name === newName) ? [{ kind: "create" as const, name: newName }] : []),
    ...shownLocal.map((branch) => ({ kind: "branch" as const, branch })),
    ...shownRemote.map((branch) => ({ kind: "branch" as const, branch })),
  ]);

  onMount(async () => {
    input.focus();
    branches = await scm.branches();
  });

  $effect(() => {
    void query;
    highlighted = 0;
  });

  $effect(() => {
    list?.querySelector(`[data-index="${highlighted}"]`)?.scrollIntoView({ block: "nearest" });
  });

  function choose(item: Item | undefined) {
    if (!item) return;
    onClose();
    if (item.kind === "create") scm.createBranch(item.name);
    else if (!item.branch.current) scm.checkout(item.branch);
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      highlighted = (highlighted + step + items.length) % Math.max(items.length, 1);
    } else if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      choose(items[highlighted]);
    }
  }
</script>

{#snippet row(item: Item, index: number)}
  <button
    class="item"
    class:highlighted={index === highlighted}
    data-index={index}
    role="option"
    aria-selected={index === highlighted}
    onpointermove={() => (highlighted = index)}
    onclick={() => choose(item)}
  >
    {#if item.kind === "create"}
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
      <span class="name">Crear la rama <strong>{item.name}</strong></span>
    {:else}
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {#if item.branch.remote}
          <path d="M4.5 11.5a3 3 0 0 1 .4-6 4 4 0 0 1 7.6 1.2 2.4 2.4 0 0 1-.5 4.8z" />
        {:else}
          <circle cx="5" cy="3.8" r="1.4" /><circle cx="5" cy="12.2" r="1.4" /><circle cx="11" cy="5.2" r="1.4" />
          <path d="M5 5.2v5.6M11 6.6c0 2.6-6 1.8-6 4.2" />
        {/if}
      </svg>
      <span class="name">{item.branch.name}</span>
      {#if item.branch.current}<span class="hint">actual</span>{/if}
    {/if}
  </button>
{/snippet}

<div class="picker">
  <input
    bind:this={input}
    bind:value={query}
    placeholder={creating ? "Nombre de la nueva rama" : "Selecciona o crea una rama"}
    aria-label="Rama"
    spellcheck="false"
    autocomplete="off"
    {onkeydown}
  />
  <div class="list" role="listbox" aria-label="Ramas" bind:this={list}>
    {#if branches === null}
      <p class="message">Cargando ramas…</p>
    {:else if items.length === 0}
      <p class="message">{creating ? "Escribe el nombre de la rama." : "No hay ramas que coincidan."}</p>
    {:else}
      {#each items as item, index (item.kind === "create" ? "create" : `${item.branch.remote}:${item.branch.name}`)}
        {#if shownRemote.length > 0 && index === items.length - shownRemote.length}
          <div class="section">Ramas remotas</div>
        {/if}
        {@render row(item, index)}
      {/each}
    {/if}
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    max-height: min(360px, 60vh);
    padding: 6px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--bg-widget);
    box-shadow: 0 6px 20px rgb(0 0 0 / 45%);
  }

  input {
    height: 26px;
    padding: 0 6px;
    border: 1px solid var(--accent);
    border-radius: 3px;
    outline: none;
    background: var(--bg-input);
    color: var(--text);
    font: inherit;
  }

  input::placeholder {
    color: var(--text-muted);
  }

  .list {
    margin-top: 4px;
    overflow-y: auto;
  }

  .section {
    padding: 6px 6px 2px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 24px;
    padding: 0 6px;
    border-radius: 3px;
    text-align: left;
    white-space: nowrap;
  }

  .item.highlighted {
    background: var(--bg-selected);
    color: var(--text-bright);
  }

  .item svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.1;
    stroke-linecap: round;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hint {
    font-size: 11px;
    color: var(--text-muted);
  }

  .message {
    margin: 6px;
    color: var(--text-muted);
  }
</style>

<script lang="ts">
  import type { ToolItem } from "$lib/chat/session.svelte";
  import { describeTool } from "$lib/chat/tools";
  import ToolInput from "./ToolInput.svelte";

  interface Todo {
    content: string;
    status: "pending" | "in_progress" | "completed";
    activeForm?: string;
  }

  let { item, cwd }: { item: ToolItem; cwd: string } = $props();

  let expanded = $state(false);

  const description = $derived(describeTool(item.name, item.input, cwd));
  const status = $derived(
    item.result ? (item.result.isError ? "error" : "done") : item.interrupted ? "interrupted" : "running",
  );
  const todos = $derived(
    item.name === "TodoWrite" && Array.isArray(item.input?.todos) ? (item.input.todos as Todo[]) : null,
  );
  /** Last lines of a failed result (where a traceback's exception is), shown without expanding. */
  const errorPreview = $derived(
    item.result?.isError ? item.result.text.trim().split("\n").filter(Boolean).slice(-2).join("\n") : "",
  );
</script>

<div class="tool {status}">
  <button class="row" aria-expanded={expanded} onclick={() => (expanded = !expanded)}>
    <span class="status" aria-hidden="true"></span>
    <span class="label">{description.label}</span>
    <span class="detail" title={description.detail}>{description.detail}</span>
    <svg class="chevron" class:expanded viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 4l4 4-4 4" />
    </svg>
  </button>

  {#if todos}
    <ul class="todos">
      {#each todos as todo, index (index)}
        <li class={todo.status}>
          <span class="check" aria-hidden="true">{todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "›" : ""}</span>
          <span>{todo.status === "in_progress" ? (todo.activeForm ?? todo.content) : todo.content}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if errorPreview && !expanded}
    <pre class="error-preview">{errorPreview}</pre>
  {/if}

  {#if item.result?.images.length}
    <div class="images">
      {#each item.result.images as src, index (index)}
        <img {src} alt="Imagen del resultado de {description.label}" />
      {/each}
    </div>
  {/if}

  {#if expanded}
    <div class="details">
      {#if item.input && !todos}
        <div class="section-label">Entrada</div>
        <ToolInput name={item.name} input={item.input} />
      {/if}
      {#if item.result?.text}
        <div class="section-label">{item.result.isError ? "Error" : "Resultado"}</div>
        <pre class="output" class:error={item.result.isError}>{item.result.text}</pre>
      {:else if status === "running"}
        <div class="section-label">En curso…</div>
      {:else if status === "interrupted"}
        <div class="section-label">Interrumpido</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool {
    margin: 2px 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    min-height: 24px;
    padding: 2px 4px;
    border-radius: 4px;
    text-align: left;
    color: var(--text);
  }

  .row:hover {
    background: var(--bg-hover);
  }

  .status {
    width: 7px;
    height: 7px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--success);
  }

  .error .status {
    background: var(--error);
  }

  .interrupted .status {
    background: var(--text-muted);
  }

  .running .status {
    background: var(--accent-text);
    animation: pulse 1s ease-in-out infinite;
  }

  .label {
    font-weight: 600;
    white-space: nowrap;
  }

  .detail {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }

  .chevron {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1.3;
    visibility: hidden;
    transition: transform 0.1s;
  }

  .row:hover .chevron,
  .chevron.expanded {
    visibility: visible;
  }

  .chevron.expanded {
    transform: rotate(90deg);
  }

  .todos {
    list-style: none;
    margin: 2px 0 4px 18px;
    padding: 0;
  }

  .todos li {
    display: flex;
    gap: 6px;
    padding: 1px 0;
  }

  .check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    height: 13px;
    margin-top: 2px;
    flex-shrink: 0;
    border: 1px solid var(--text-muted);
    border-radius: 3px;
    font-size: 10px;
    line-height: 1;
  }

  .todos .completed {
    color: var(--text-muted);
    text-decoration: line-through;
  }

  .todos .completed .check {
    border-color: var(--success);
    color: var(--success);
  }

  .todos .in_progress {
    color: var(--text-bright);
    font-weight: 600;
  }

  .todos .in_progress .check {
    border-color: var(--accent-text);
    color: var(--accent-text);
  }

  .error-preview {
    margin: 0 0 4px 18px;
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--error);
  }

  .images {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 4px 0 6px 18px;
  }

  .images img {
    display: block;
    max-width: 100%;
    border-radius: 4px;
    border: 1px solid var(--border-strong);
  }

  .details {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 2px 0 8px 18px;
  }

  .section-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .output {
    margin: 0;
    max-height: 260px;
    overflow: auto;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--bg-code);
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .output.error {
    color: var(--error);
  }

  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
</style>

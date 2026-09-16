<script lang="ts">
  import { BLENDER_TOOLS } from "../../../../agent/protocol";

  let { name, input }: { name: string; input: Record<string, unknown> | null } = $props();

  const text = (key: string) => (typeof input?.[key] === "string" ? (input[key] as string) : null);
  const code = $derived(
    name === BLENDER_TOOLS.run ? text("code") : name === "Bash" ? text("command") : name === "Write" ? text("content") : null,
  );
  const edit = $derived(name === "Edit" ? { removed: text("old_string"), added: text("new_string") } : null);
</script>

{#if input}
  {#if code !== null}
    <pre class="code">{code}</pre>
  {:else if edit?.removed != null && edit.added != null}
    <pre class="code diff">{#each edit.removed.split("\n") as line, index (index)}<span class="removed">- {line}</span
      >{/each}{#each edit.added.split("\n") as line, index (index)}<span class="added">+ {line}</span>{/each}</pre>
  {:else}
    <pre class="code">{JSON.stringify(input, null, 2)}</pre>
  {/if}
{/if}

<style>
  .code {
    margin: 0;
    max-height: 260px;
    overflow: auto;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--bg-code);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.45;
    /* Keep indentation intact: it is significant in Python. */
    white-space: pre;
  }

  .diff span {
    display: block;
  }

  .removed {
    color: #f28b82;
    background: rgba(242, 139, 130, 0.08);
  }

  .added {
    color: #81c995;
    background: rgba(129, 201, 149, 0.08);
  }
</style>

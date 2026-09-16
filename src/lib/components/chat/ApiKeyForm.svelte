<script lang="ts">
  interface Props {
    onSave: (key: string) => Promise<void>;
    onCancel?: () => void;
  }

  let { onSave, onCancel }: Props = $props();

  let key = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    error = null;
    try {
      await onSave(key);
      key = "";
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }
</script>

<form onsubmit={submit}>
  <!-- svelte-ignore a11y_autofocus -->
  <input
    type="password"
    bind:value={key}
    placeholder="sk-ant-api03-…"
    aria-label="API key de Anthropic"
    autocomplete="off"
    spellcheck="false"
    autofocus
  />
  <div class="buttons">
    <button type="submit" class="primary" disabled={!key.trim() || saving}>
      {saving ? "Guardando…" : "Guardar"}
    </button>
    {#if onCancel}
      <button type="button" class="secondary" onclick={onCancel}>Cancelar</button>
    {/if}
  </div>
  {#if error}
    <p class="error">{error}</p>
  {/if}
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  input {
    width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    background: var(--bg-input);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  input:focus {
    outline: 1px solid var(--accent);
    border-color: var(--accent);
  }

  .buttons {
    display: flex;
    gap: 6px;
  }

  .primary,
  .secondary {
    padding: 4px 12px;
    border-radius: 3px;
  }

  .primary {
    background: var(--accent);
    color: #fff;
  }

  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .secondary {
    background: var(--bg-button-secondary);
  }

  .secondary:hover {
    background: var(--bg-button-secondary-hover);
  }

  .error {
    margin: 0;
    color: var(--error);
    overflow-wrap: anywhere;
  }
</style>

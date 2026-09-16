<script lang="ts" generics="T extends string">
  interface Props {
    value: T;
    options: { value: T; label: string }[];
    label: string;
    title?: string;
    class?: string;
    onchange: (value: T) => void;
  }

  let { value, options, label, title, class: className = "", onchange }: Props = $props();

  const selected = $derived(options.find((option) => option.value === value)?.label ?? value);
</script>

<!-- A native select laid transparently over its current label, so the control is only as wide as the label. -->
<label class="picker {className}" {title}>
  <span>{selected}</span>
  <svg viewBox="0 0 8 5" aria-hidden="true"><path d="M.5.5 4 4 7.5.5" /></svg>
  <select aria-label={label} {value} onchange={(event) => onchange(event.currentTarget.value as T)}>
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
</label>

<style>
  .picker {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 5px;
    border-radius: 3px;
    color: var(--text-muted);
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
  }

  .picker:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .picker:focus-within {
    outline: 1px solid var(--accent);
  }

  svg {
    width: 8px;
    height: 5px;
    fill: none;
    stroke: currentColor;
  }

  select {
    position: absolute;
    inset: 0;
    width: 100%;
    opacity: 0;
    font: inherit;
    cursor: pointer;
  }
</style>

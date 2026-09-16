<script lang="ts">
  import { isBlendFile } from "$lib/api";

  let { path, isDir = false, open = false }: { path: string; isDir?: boolean; open?: boolean } = $props();
</script>

<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
  {#if isDir && open}
    <path fill="#c09553" d="M1.5 3h4l1.5 1.5H14a.5.5 0 0 1 .5.5v1H4L1.5 12V3.5A.5.5 0 0 1 2 3z" />
    <path fill="#dcb67a" d="M4 6h11.5l-2.5 7H1.5z" />
  {:else if isDir}
    <path fill="#dcb67a" d="M1.5 3h4.5l1.5 1.5H14a.5.5 0 0 1 .5.5v7.5a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5z" />
  {:else if isBlendFile(path)}
    <path fill="var(--blender)" d="M8 1.5 14 5v6l-6 3.5L2 11V5z" />
    <path fill="#1f1f1f" opacity="0.35" d="M8 8v6.5L2 11V5zM8 8l6-3v6l-6 3.5z" />
    <path fill="#ffffff" opacity="0.25" d="M8 1.5 14 5 8 8 2 5z" />
  {:else}
    <path fill="none" stroke="#9d9d9d" d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3" />
  {/if}
</svg>

<style>
  .icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
</style>

<script lang="ts" module>
  export interface TreeNode {
    name: string;
    path: string;
    isDir: boolean;
    expanded: boolean;
    /** `null` until the directory has been read. */
    children: TreeNode[] | null;
  }
</script>

<script lang="ts">
  import FileIcon from "./FileIcon.svelte";
  import TreeItem from "./TreeItem.svelte";

  interface Props {
    node: TreeNode;
    depth: number;
    selected: string | null;
    onToggle: (node: TreeNode) => void;
    onOpen: (node: TreeNode) => void;
  }

  let { node, depth, selected, onToggle, onOpen }: Props = $props();
</script>

<button
  class="row"
  class:selected={node.path === selected}
  style:padding-left="{8 + depth * 12}px"
  title={node.path}
  onclick={() => (node.isDir ? onToggle(node) : onOpen(node))}
>
  <svg class="chevron" class:hidden={!node.isDir} class:expanded={node.expanded} viewBox="0 0 16 16" aria-hidden="true">
    <path fill="none" stroke="currentColor" stroke-width="1.3" d="M6 4l4 4-4 4" />
  </svg>
  <FileIcon path={node.path} isDir={node.isDir} open={node.expanded} />
  <span class="name">{node.name}</span>
</button>

{#if node.isDir && node.expanded && node.children}
  {#each node.children as child (child.path)}
    <TreeItem node={child} depth={depth + 1} {selected} {onToggle} {onOpen} />
  {/each}
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    height: 22px;
    padding-right: 8px;
    text-align: left;
    white-space: nowrap;
    cursor: default;
  }

  .row:hover {
    background: var(--bg-hover);
  }

  .row.selected {
    background: var(--bg-selected);
    color: var(--text-bright);
  }

  .chevron {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    color: var(--text-muted);
    transition: transform 0.1s;
  }

  .chevron.expanded {
    transform: rotate(90deg);
  }

  .chevron.hidden {
    visibility: hidden;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>

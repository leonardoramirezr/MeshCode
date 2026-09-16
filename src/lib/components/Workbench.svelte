<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { api, basename, isBlendFile, onFsChange, subscribe, type FsChange } from "$lib/api";
  import BlendViewer from "./BlendViewer.svelte";
  import FileIcon from "./FileIcon.svelte";
  import TreeItem, { type TreeNode } from "./TreeItem.svelte";

  interface Props {
    folder: string;
    onCloseFolder: () => void;
  }

  let { folder, onCloseFolder }: Props = $props();

  // The parent re-mounts the workbench for each folder, so the initial value is enough.
  let root = $state<TreeNode>(
    untrack(() => ({ name: basename(folder), path: folder, isDir: true, expanded: true, children: null })),
  );
  let rootError = $state<string | null>(null);
  let tabs = $state<string[]>([]);
  let activeTab = $state<string | null>(null);
  /** Per-file counter bumped on disk changes so the open viewer reloads. */
  let versions = $state<Record<string, number>>({});

  onMount(() => {
    loadChildren(root);
    return subscribe(onFsChange(handleFsChange));
  });

  async function loadChildren(node: TreeNode) {
    try {
      const entries = await api.readDir(node.path);
      const previous = new Map((node.children ?? []).map((child) => [child.path, child]));
      node.children = entries.map((entry) => {
        const existing = previous.get(entry.path);
        // Keep expanded subfolders (and what they already loaded) across refreshes.
        return existing && existing.isDir === entry.isDir
          ? existing
          : { ...entry, expanded: false, children: null };
      });
      if (node === root) rootError = null;
    } catch (error) {
      if (node === root) rootError = String(error);
      else node.children = [];
    }
  }

  function findNode(node: TreeNode, path: string): TreeNode | null {
    if (node.path === path) return node;
    if (!node.children || !path.startsWith(node.path)) return null;
    for (const child of node.children) {
      const found = child.isDir ? findNode(child, path) : null;
      if (found) return found;
    }
    return null;
  }

  function handleFsChange(change: FsChange) {
    for (const dir of new Set([...change.dirs, ...change.paths])) {
      const node = findNode(root, dir);
      if (node?.isDir && node.children) loadChildren(node);
    }
    for (const path of change.paths) {
      if (tabs.includes(path)) versions[path] = (versions[path] ?? 0) + 1;
    }
  }

  function toggle(node: TreeNode) {
    node.expanded = !node.expanded;
    if (node.expanded && !node.children) loadChildren(node);
  }

  function openFile(node: TreeNode) {
    if (!tabs.includes(node.path)) tabs.push(node.path);
    activeTab = node.path;
  }

  export function closeTab(path: string | null = activeTab) {
    if (!path) return;
    const index = tabs.indexOf(path);
    if (index === -1) return;
    tabs.splice(index, 1);
    if (activeTab === path) activeTab = tabs[Math.min(index, tabs.length - 1)] ?? null;
  }
</script>

<div class="workbench">
  <aside class="sidebar">
    <div class="sidebar-title">
      <span>Explorador</span>
      <button class="icon-button" title="Cerrar carpeta" aria-label="Cerrar carpeta" onclick={onCloseFolder}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.3" />
        </svg>
      </button>
    </div>
    <div class="folder-name" title={folder}>{root.name}</div>
    <div class="tree">
      {#if rootError}
        <p class="tree-message error">{rootError}</p>
      {:else if root.children?.length === 0}
        <p class="tree-message">La carpeta está vacía.</p>
      {:else if root.children}
        {#each root.children as child (child.path)}
          <TreeItem node={child} depth={0} selected={activeTab} onToggle={toggle} onOpen={openFile} />
        {/each}
      {/if}
    </div>
  </aside>

  <main class="editor">
    {#if tabs.length > 0}
      <div class="tabs" role="tablist">
        {#each tabs as path (path)}
          <div
            class="tab"
            class:active={path === activeTab}
            role="tab"
            tabindex="0"
            aria-selected={path === activeTab}
            title={path}
            onclick={() => (activeTab = path)}
            onauxclick={(event) => event.button === 1 && closeTab(path)}
            onkeydown={(event) => event.key === "Enter" && (activeTab = path)}
          >
            <FileIcon {path} />
            <span class="tab-name">{basename(path)}</span>
            <button
              class="icon-button close"
              aria-label="Cerrar {basename(path)}"
              onclick={(event) => {
                event.stopPropagation();
                closeTab(path);
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.2" />
              </svg>
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="editor-content">
      {#if !activeTab}
        <div class="empty">
          <p>Selecciona un archivo <strong>.blend</strong> en el explorador para visualizarlo.</p>
        </div>
      {:else if isBlendFile(activeTab)}
        {#key activeTab}
          <BlendViewer path={activeTab} version={versions[activeTab] ?? 0} />
        {/key}
      {:else}
        <div class="empty">
          <FileIcon path={activeTab} />
          <p class="unsupported-title">No se puede abrir este archivo</p>
          <p>MeshCode solo puede mostrar archivos de Blender (<strong>.blend</strong>).</p>
        </div>
      {/if}
    </div>
  </main>
</div>

<style>
  .workbench {
    display: flex;
    height: 100vh;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    width: 260px;
    flex-shrink: 0;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
  }

  .sidebar-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 35px;
    padding: 0 8px 0 20px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .folder-name {
    padding: 2px 20px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tree {
    flex: 1;
    overflow: auto;
    padding-bottom: 12px;
  }

  .tree-message {
    margin: 8px 20px;
    color: var(--text-muted);
  }

  .tree-message.error {
    color: var(--error);
  }

  .icon-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    color: var(--text-muted);
  }

  .icon-button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .icon-button svg {
    width: 16px;
    height: 16px;
  }

  .editor {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .tabs {
    display: flex;
    height: 35px;
    flex-shrink: 0;
    overflow-x: auto;
    background: var(--bg-tabs);
    border-bottom: 1px solid var(--border);
  }

  .tabs::-webkit-scrollbar {
    height: 3px;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px 0 12px;
    border-right: 1px solid var(--border);
    border-top: 1px solid transparent;
    color: var(--text-muted);
    white-space: nowrap;
    cursor: pointer;
  }

  .tab.active {
    background: var(--bg-tab-active);
    border-top-color: var(--accent);
    color: var(--text-bright);
    margin-bottom: -1px;
  }

  .tab .close {
    visibility: hidden;
    width: 20px;
    height: 20px;
  }

  .tab.active .close,
  .tab:hover .close {
    visibility: visible;
  }

  .editor-content {
    flex: 1;
    min-height: 0;
    background: var(--bg-editor);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 100%;
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
  }

  .empty p {
    margin: 0;
  }

  .unsupported-title {
    margin-top: 8px !important;
    font-size: 15px;
    color: var(--text);
  }
</style>

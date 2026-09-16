<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { message, open } from "@tauri-apps/plugin-dialog";
  import { api, basename, onMenuAction, subscribe, type MenuAction } from "$lib/api";
  import Welcome from "$lib/components/Welcome.svelte";
  import Workbench from "$lib/components/Workbench.svelte";

  let folder = $state<string | null>(null);
  let recent = $state<string[]>([]);
  let error = $state<string | null>(null);
  let workbench = $state<Workbench>();

  onMount(() => {
    refreshRecent();
    return subscribe(onMenuAction(handleMenuAction));
  });

  $effect(() => {
    getCurrentWindow().setTitle(folder ? `${basename(folder)} — MeshCode` : "MeshCode");
  });

  async function refreshRecent() {
    recent = await api.recentFolders();
  }

  async function openFolder(path: string) {
    try {
      folder = await api.openFolder(path);
      error = null;
    } catch (e) {
      // The welcome page shows errors inline; with a folder open, keep it and show a dialog instead.
      if (folder) await message(String(e), { title: "MeshCode", kind: "error" });
      else error = String(e);
    }
    await refreshRecent();
  }

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false, title: "Abrir carpeta" });
    if (typeof selected === "string") await openFolder(selected);
  }

  async function closeFolder() {
    await api.closeFolder();
    folder = null;
    await refreshRecent();
  }

  async function removeRecent(path: string) {
    await api.removeRecentFolder(path);
    await refreshRecent();
  }

  async function clearRecent() {
    await api.clearRecentFolders();
    await refreshRecent();
  }

  function handleMenuAction(menu: MenuAction) {
    switch (menu.action) {
      case "open_folder":
        return pickFolder();
      case "open_recent":
        return openFolder(menu.path);
      case "clear_recent":
        return clearRecent();
      case "close_folder":
        return folder && closeFolder();
      case "close_editor":
        return workbench?.closeTab();
    }
  }
</script>

{#if folder}
  {#key folder}
    <Workbench bind:this={workbench} {folder} onCloseFolder={closeFolder} />
  {/key}
{:else}
  <Welcome
    {recent}
    {error}
    onOpenFolder={pickFolder}
    onOpenRecent={openFolder}
    onRemoveRecent={removeRecent}
    onClearRecent={clearRecent}
  />
{/if}

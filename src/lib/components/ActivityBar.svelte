<script lang="ts" module>
  export type SidebarView = "explorer" | "scm" | "chat";
</script>

<script lang="ts">
  interface Props {
    active: SidebarView;
    sidebarVisible: boolean;
    /** Chat activity to flag while the chat is hidden. */
    chatBadge: "attention" | "busy" | null;
    /** Changed files in the repository. */
    scmCount: number;
    onSelect: (view: SidebarView) => void;
  }

  let { active, sidebarVisible, chatBadge, scmCount, onSelect }: Props = $props();

  const isMac = navigator.userAgent.includes("Mac");
  const views: { id: SidebarView; label: string; shortcut: string }[] = [
    { id: "explorer", label: "Explorador", shortcut: isMac ? "⇧⌘E" : "Ctrl+Shift+E" },
    { id: "scm", label: "Control de código fuente", shortcut: isMac ? "⌃⇧G" : "Ctrl+Shift+G" },
    { id: "chat", label: "Chat", shortcut: isMac ? "⌃⌘I" : "Ctrl+Alt+I" },
  ];
</script>

<nav class="activity-bar" aria-label="Vistas">
  {#each views as view (view.id)}
    {@const selected = sidebarVisible && active === view.id}
    <button
      class="item"
      class:selected
      title="{view.label} ({view.shortcut})"
      aria-label={view.label}
      aria-pressed={selected}
      onclick={() => onSelect(view.id)}
    >
      {#if view.id === "explorer"}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9.5 3.5h5.8l4.2 4.2v10.3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
          <path d="M15 3.5v4.5h4.5" />
          <path d="M5.5 7.5v12.5a1 1 0 0 0 1 1h9" />
        </svg>
      {:else if view.id === "scm"}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="7" cy="5.5" r="2.2" />
          <circle cx="7" cy="18.5" r="2.2" />
          <circle cx="17" cy="7.5" r="2.2" />
          <path d="M7 7.7v8.6M17 9.7c0 4.3-10 2.8-10 6.6" />
        </svg>
        {#if scmCount > 0}
          <span class="count">{scmCount > 99 ? "99+" : scmCount}</span>
        {/if}
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10.5L6 19.8V16h-.5A1.5 1.5 0 0 1 4 14.5v-9A1.5 1.5 0 0 1 5.5 4z" />
          <path class="spark" d="M12 6.6l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" />
        </svg>
        {#if chatBadge}
          <span class="badge {chatBadge}"></span>
        {/if}
      {/if}
    </button>
  {/each}
</nav>

<style>
  .activity-bar {
    display: flex;
    flex-direction: column;
    width: 48px;
    flex-shrink: 0;
    background: var(--bg-activity-bar);
    border-right: 1px solid var(--border);
  }

  .item {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    color: var(--text-inactive);
  }

  .item:hover,
  .item.selected {
    color: var(--text-bright);
  }

  .item.selected::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent);
  }

  svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linejoin: round;
  }

  .spark {
    fill: currentColor;
    stroke-width: 0.8;
  }

  .badge {
    position: absolute;
    right: 10px;
    bottom: 11px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 2px solid var(--bg-activity-bar);
    box-sizing: content-box;
  }

  .count {
    position: absolute;
    right: 5px;
    bottom: 7px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent);
    color: #fff;
    font-size: 9px;
    font-weight: 600;
    line-height: 16px;
    text-align: center;
  }

  .badge.attention {
    background: var(--accent-text);
  }

  .badge.busy {
    background: var(--text-muted);
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
</style>

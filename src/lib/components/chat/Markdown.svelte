<script lang="ts">
  import DOMPurify from "dompurify";
  import { marked } from "marked";
  import { openUrl } from "@tauri-apps/plugin-opener";

  let { text }: { text: string } = $props();

  // Model output is untrusted: sanitize it before it reaches a page that can call the backend.
  const html = $derived(DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true })));

  /** Opens web links in the browser instead of navigating the app. */
  function externalLinks(node: HTMLElement) {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element).closest("a");
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute("href") ?? "";
      if (/^https?:\/\//i.test(href)) void openUrl(href);
    };
    node.addEventListener("click", onClick);
    return () => node.removeEventListener("click", onClick);
  }
</script>

<div class="markdown" {@attach externalLinks}>{@html html}</div>

<style>
  .markdown {
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .markdown :global(:first-child) {
    margin-top: 0;
  }

  .markdown :global(:last-child) {
    margin-bottom: 0;
  }

  .markdown :global(p),
  .markdown :global(ul),
  .markdown :global(ol),
  .markdown :global(pre),
  .markdown :global(table),
  .markdown :global(blockquote) {
    margin: 0 0 8px;
  }

  .markdown :global(ul),
  .markdown :global(ol) {
    padding-left: 20px;
  }

  .markdown :global(li + li) {
    margin-top: 2px;
  }

  .markdown :global(h1),
  .markdown :global(h2),
  .markdown :global(h3),
  .markdown :global(h4) {
    margin: 14px 0 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-bright);
  }

  .markdown :global(h1) {
    font-size: 15px;
  }

  .markdown :global(h2) {
    font-size: 14px;
  }

  .markdown :global(a) {
    color: var(--accent-text);
    text-decoration: none;
    cursor: pointer;
  }

  .markdown :global(a:hover) {
    text-decoration: underline;
  }

  .markdown :global(code) {
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--bg-code);
  }

  .markdown :global(pre) {
    padding: 8px 10px;
    border-radius: 4px;
    background: var(--bg-code);
    overflow-x: auto;
  }

  .markdown :global(pre code) {
    padding: 0;
    background: none;
  }

  .markdown :global(blockquote) {
    padding-left: 10px;
    border-left: 3px solid var(--border-strong);
    color: var(--text-muted);
  }

  .markdown :global(table) {
    border-collapse: collapse;
    display: block;
    overflow-x: auto;
  }

  .markdown :global(th),
  .markdown :global(td) {
    padding: 3px 8px;
    border: 1px solid var(--border-strong);
    text-align: left;
  }

  .markdown :global(hr) {
    border: none;
    border-top: 1px solid var(--border-strong);
    margin: 12px 0;
  }

  .markdown :global(img) {
    max-width: 100%;
  }
</style>

// Builds the agent sidecar into src-tauri/resources/agent for app bundles: single-file bundles
// of main.ts (the chat agent) and mcp.ts (the Blender tools for Claude Code), the Blender scripts,
// and the Claude Code binary for the current platform.
// Usage: node agent/build.ts
import { chmodSync, copyFileSync, cpSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "rolldown";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}src-tauri/resources/agent`;

rmSync(out, { recursive: true, force: true });
for (const entry of ["main", "mcp"]) {
  await build({
    input: `${root}agent/${entry}.ts`,
    platform: "node",
    output: { file: `${out}/${entry}.mjs`, format: "esm", codeSplitting: false },
  });
}
cpSync(`${root}agent/blender`, `${out}/blender`, { recursive: true });

// The SDK looks the binary up in node_modules, which bundles don't have; the app passes this copy instead.
const sdk = createRequire(createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk"));
const executable = process.platform === "win32" ? "claude.exe" : "claude";
const binary = sdk.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${executable}`);
copyFileSync(binary, `${out}/${executable}`);
chmodSync(`${out}/${executable}`, 0o755);

console.log(`Agent built in ${out}`);

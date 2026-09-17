# MeshCode

Blender file (`.blend`) viewer and editor with a VS Code–style interface, built with Tauri + SvelteKit + three.js.
Includes a chat with Claude that edits the files in the open folder: with the Claude Agent SDK and an API key,
or with your own Claude Code and the limits of your Claude plan.

## Requirements

- [Blender](https://www.blender.org/download/) installed. MeshCode uses it in the background to convert `.blend` files to glTF.
  It is searched for in the usual installation paths and in `PATH`; you can also specify the path with the `BLENDER_PATH` environment variable.
- Node.js ≥ 22.18 for the chat (runs the agent and the Blender tools). It is searched for in the usual paths
  (Homebrew, Volta, nvm) and in `PATH`; you can also specify the path with the `MESHCODE_NODE` environment variable.
- For the chat, one of the following two:
  - An Anthropic API key ([Claude Console](https://platform.claude.com/settings/keys)).
  - [Claude Code](https://code.claude.com/docs/en/setup) installed, with your Claude account (Pro, Max, Team, or Enterprise).
- [Git](https://git-scm.com/downloads) for the source control panel. It is searched for in the usual paths and in `PATH`;
  you can also specify the path with the `MESHCODE_GIT` environment variable.
- pnpm and Rust for development (see `make help`).

## Usage

1. On startup, open a folder (**Open Folder…**, `⌘O` / `Ctrl+O`) or choose one of the recent ones.
2. In the explorer on the left, click a `.blend` file to view it. Other files cannot be opened.
3. In the viewer you can choose the navigation mode:
   - **Orbit**: drag to orbit, right-click to pan, scroll to zoom.
   - **Walk**: `W` `A` `S` `D` to move, `3` to go up, `X` to go down, `Shift` to run,
     scroll to change speed. Click or drag in the viewer to look around with the mouse (`Esc` releases the mouse).
4. If the file changes on disk (for example, when saved in Blender), the viewer updates automatically.

Converted models are saved in the app's cache folder, so reopening an unchanged file is instant.

The icon bar on the left switches the sidebar between the **Explorer** (`⇧⌘E`) and the **Chat** (`⌃⌘I`);
clicking the active icon hides the sidebar (`⌘B`). Drag its edge to resize it.

### Chat

The selector in the chat header chooses what it works with: **Anthropic API** or **Claude Code**.

#### Anthropic API

The chat uses the Claude Agent SDK to edit the files in the open folder. Its main function is `.blend` files:
the agent has tools that run Blender in the background to inspect a file, modify it with `bpy` code
(or create a new one), and render a preview to check the result. Each save keeps the previous version as
`file.blend1`, and the viewer shows the changes as soon as they're saved.

- **API key**: the first time, paste your Anthropic API key. It's stored in the system keychain; `ANTHROPIC_API_KEY`
  is also used if defined. Usage is billed to that API account.
- **Mode** (`⇧Tab` in the text box): *Ask for permission* asks before editing or running commands,
  *Accept edits* edits the files in the folder without asking, *Plan* analyzes and proposes a plan before touching anything,
  *Auto* lets a classifier approve safe actions, and *No permissions* runs everything without asking.
- **Model** and **effort**: the model list comes from the SDK; effort controls how much Claude reasons.
- `Enter` sends, `Shift+Enter` adds a line, and `Esc` stops the response.

The agent saves its sessions in the app's data folder, separate from any Claude Code configuration.

#### Claude Code

Runs the Claude Code installed on your machine in a terminal inside the chat, with your session, your configuration
(`~/.claude`), and the limits of your Claude plan. It's the same Claude Code you use in the terminal: if you haven't
logged in, use `/login`; `/resume` picks up previous conversations from the folder.

- It's started from your login shell, as in a terminal, so it has your `PATH` and your variables.
  To use a different executable, define the `MESHCODE_CLAUDE` environment variable with its path.
- MeshCode adds its Blender tools as an MCP server called `meshcode`: inspecting and rendering
  a preview are allowed without asking, and running `bpy` code follows your Claude Code permissions, like any
  other tool.
- The first time in each folder, Claude Code asks if you trust it.
- `Shift+Enter` adds a line. The **+** button in the header restarts Claude Code with a new conversation.

## Development

```sh
make dev      # Tauri app in development mode
make check    # type checking (frontend and agent) and Rust build
make build    # app bundle, with the agent packaged
```

The agent lives in `agent/`: a Node process that the app starts and communicates with over stdin/stdout
(see `agent/protocol.ts`). `agent/mcp.ts` exposes the same Blender tools as an MCP server over stdio for
Claude Code, which the app runs in a pseudoterminal (`src-tauri/src/claude_code.rs`). In development, the
`.ts` files run directly; `make build` bundles them with `pnpm build:agent` into `src-tauri/resources/agent`,
along with the Blender scripts and the Claude Code SDK executable.

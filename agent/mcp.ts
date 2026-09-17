// MeshCode's Blender tools as a stdio MCP server, for Claude Code running in the chat's terminal.
// Usage: node agent/mcp.ts <folder>
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBlenderServer } from "./blender.ts";

// stdout carries the protocol, so stray console output goes to stderr.
console.log = console.info = console.debug = console.error;

const instructions = `MeshCode, the app this session runs in, shows the .blend files of this folder in a 3D viewer that reloads a file as soon as it changes on disk.

.blend files are binary, so never read or write them with Read, Edit, Write or Bash; use this server's tools instead:
- inspect_blend summarizes a file (scenes, collections, objects, materials). Start there.
- run_blender_python runs bpy code on a file and saves it. Use it for every change, and to create new .blend files.
- render_preview renders an image of a file so you can check your changes visually. While the user has the agent
view on, MeshCode moves their viewer to the camera of each preview, so rendering also shows them what you are checking.

Every run_blender_python call writes the file, and the user watches each write appear in the viewer. So work in small, verified steps: inspect, then one change per call, then inspect or render again to confirm the result. Don't put several unrelated changes in one call to save a round trip; the user would only see the end result.`;

const server = createBlenderServer(process.argv[2] ?? process.cwd(), instructions);
await server.instance.connect(new StdioServerTransport());

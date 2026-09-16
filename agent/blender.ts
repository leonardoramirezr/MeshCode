// Blender tools for the agent. .blend files are binary, so every read and edit goes through
// Blender itself, running in background mode with the scripts in ./blender/.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { BLENDER_SERVER, BLENDER_TOOLS } from "./protocol.ts";

const SCRIPTS_DIR = fileURLToPath(new URL("./blender/", import.meta.url));
const TIMEOUT_MS = 10 * 60_000;

/** Tools that never modify files, so they run without asking. */
export const READ_ONLY_TOOLS = [BLENDER_TOOLS.inspect, BLENDER_TOOLS.render];

export const isInside = (dir: string, file: string) => {
  const relative = path.relative(dir, path.resolve(dir, file));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

const fileArg = z.string().describe("Path to the .blend file, absolute or relative to the working directory");

/** `instructions` are shown to the model with the tools, for sessions whose system prompt doesn't cover them. */
export function createBlenderServer(cwd: string, instructions?: string) {
  return createSdkMcpServer({
    name: BLENDER_SERVER,
    version: "1.0.0",
    instructions,
    alwaysLoad: true,
    tools: [
      tool(
        "inspect_blend",
        "Summarize a .blend file as JSON: Blender version, scenes, collections, objects (type, transform, " +
          "dimensions, modifiers, materials, custom properties), materials, images, node groups and actions. " +
          "Use it before editing a file and to verify changes.",
        { file: fileArg },
        async ({ file }) => {
          const target = resolveBlend(cwd, file, true);
          return exclusive(target, () =>
            withRequest(async (dir, request) => {
              const output = path.join(dir, "summary.json");
              await request({ output });
              await runBlender([target, "--python", script("inspect.py")], dir);
              return text(await readFile(output, "utf-8"));
            }),
          );
        },
        { annotations: { readOnlyHint: true } },
      ),

      tool(
        "run_blender_python",
        "Run Python code with Blender's bpy API on a .blend file, in background mode: there is no UI, so " +
          "bpy.context has no window, screen or 3D view; prefer bpy.data and bmesh over operators that need " +
          "one. print() output is returned. Each call starts from the file on disk, so changes only persist " +
          "with save=true, which saves the file once the code finishes without errors (Blender keeps the " +
          "previous version as <file>.blend1). If the file does not exist, the code starts from an empty " +
          "scene and saving creates it.",
        {
          file: fileArg,
          code: z.string().describe("Python code to run; `bpy` is already imported"),
          save: z.boolean().describe("Save the file after the code runs without errors"),
        },
        async ({ file, code, save }) => {
          const target = resolveBlend(cwd, file, false);
          return exclusive(target, () =>
            withRequest(async (dir, request) => {
              const newFile = !existsSync(target);
              if (newFile && save) await mkdir(path.dirname(target), { recursive: true });
              const result = path.join(dir, "result.json");
              await request({ file: target, code, save, new_file: newFile, result });
              await runBlender([...(newFile ? [] : [target]), "--python", script("run.py")], dir);

              const { output, error, saved } = JSON.parse(await readFile(result, "utf-8")) as {
                output: string;
                error: string | null;
                saved: boolean;
              };
              const parts = [output.trim() ? `Output:\n${output}` : "No output."];
              if (error) parts.push(`Error:\n${error}`);
              parts.push(saved ? `Saved ${target}` : "The file was not saved.");
              return { ...text(parts.join("\n\n")), isError: Boolean(error) };
            }),
          );
        },
      ),

      tool(
        "render_preview",
        "Render a quick solid-shaded (Workbench) preview image of a .blend file to check it visually. " +
          "The file is not modified. By default it frames every visible object from an isometric angle.",
        {
          file: fileArg,
          view: z
            .enum(["isometric", "front", "back", "left", "right", "top", "camera"])
            .optional()
            .describe("Viewing direction; 'camera' uses the scene's active camera. Default: isometric"),
          focus: z.array(z.string()).optional().describe("Names of the objects to frame instead of all of them"),
          camera: z
            .object({
              location: z.array(z.number()).length(3),
              look_at: z.array(z.number()).length(3),
              lens: z.number().optional().describe("Focal length in mm"),
            })
            .optional()
            .describe("Custom camera in world coordinates; overrides view and focus"),
          width: z.number().int().min(64).max(1920).optional().describe("Default: 960"),
          height: z.number().int().min(64).max(1920).optional().describe("Default: 720"),
        },
        async ({ file, view = "isometric", focus, camera, width = 960, height = 720 }) => {
          const target = resolveBlend(cwd, file, true);
          return exclusive(target, () =>
            withRequest(async (dir, request) => {
              const output = path.join(dir, "preview.jpg");
              await request({ output, view, focus, camera, width, height });
              await runBlender([target, "--python", script("render.py")], dir);
              const image = await readFile(output);
              return {
                content: [
                  { type: "image", data: image.toString("base64"), mimeType: "image/jpeg" },
                  { type: "text", text: `Preview of ${path.basename(target)} (${camera ? "custom camera" : view}, ${width}×${height})` },
                ],
              };
            }),
          );
        },
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });
}

const script = (name: string) => path.join(SCRIPTS_DIR, name);

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

function resolveBlend(cwd: string, file: string, mustExist: boolean): string {
  const target = path.resolve(cwd, file);
  if (!/\.blend$/i.test(target)) throw new Error(`${file} is not a .blend file`);
  if (mustExist && !existsSync(target)) throw new Error(`${file} does not exist`);
  return target;
}

/** Runs a task with a temp dir and a `request.json` in it that the Blender script reads. */
async function withRequest<T>(
  task: (dir: string, request: (data: object) => Promise<void>) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "meshcode-"));
  try {
    return await task(dir, (data) => writeFile(path.join(dir, "request.json"), JSON.stringify(data)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runBlender(args: string[], dir: string): Promise<void> {
  const blender = process.env.MESHCODE_BLENDER;
  if (!blender) {
    throw new Error("Blender was not found. Install it or set the BLENDER_PATH environment variable.");
  }
  const fullArgs = ["--background", "--factory-startup", "--python-exit-code", "1", ...args];
  fullArgs.push("--", path.join(dir, "request.json"));
  return new Promise((resolve, reject) => {
    execFile(blender, fullArgs, { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`Blender failed:\n${errorSummary(`${stdout}\n${stderr}`) || error.message}`));
      else resolve();
    });
  });
}

/** The last error lines of Blender's output, or its last lines when none look like errors. */
function errorSummary(output: string): string {
  const lines = output.split("\n").filter((line) => line.trim());
  const errors = lines.filter((line) => /error|traceback/i.test(line));
  return (errors.length ? errors : lines).slice(-12).join("\n");
}

const locks = new Map<string, Promise<unknown>>();

/** Runs tasks on the same file one at a time, so parallel tool calls don't race on disk. */
function exclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  const next = (locks.get(key) ?? Promise.resolve()).then(task, task);
  const cleanup = () => {
    if (locks.get(key) === next) locks.delete(key);
  };
  locks.set(key, next);
  next.then(cleanup, cleanup);
  return next;
}

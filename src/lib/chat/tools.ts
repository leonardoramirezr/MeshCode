import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { BLENDER_TOOLS } from "../../../agent/protocol";

export const PERMISSION_MODES: { value: PermissionMode; label: string; description: string }[] = [
  { value: "default", label: "Pedir permiso", description: "Pide aprobación antes de editar archivos o ejecutar comandos" },
  { value: "acceptEdits", label: "Aceptar ediciones", description: "Edita los archivos de la carpeta sin preguntar" },
  { value: "plan", label: "Plan", description: "Analiza y propone un plan sin modificar nada" },
  { value: "auto", label: "Auto", description: "Un clasificador decide qué acciones son seguras" },
  { value: "bypassPermissions", label: "Sin permisos", description: "Ejecuta todo sin preguntar. Úsalo con cuidado" },
];

export const EFFORT_LABELS: Record<string, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  xhigh: "Muy alto",
  max: "Máximo",
};

export interface ToolDescription {
  label: string;
  /** The tool's main argument (file, command, pattern…), if any. */
  detail: string;
}

/** A short, human description of a tool call, like "Leer src/app.ts". */
export function describeTool(name: string, input: Record<string, unknown> | null, cwd: string): ToolDescription {
  const value = (key: string) => (typeof input?.[key] === "string" ? (input[key] as string) : "");
  const file = (key: string) => relativePath(value(key), cwd);

  switch (name) {
    case BLENDER_TOOLS.inspect:
      return { label: "Inspeccionar", detail: file("file") };
    case BLENDER_TOOLS.run:
      return { label: "Editar con Blender", detail: file("file") };
    case BLENDER_TOOLS.render:
      return { label: "Vista previa", detail: file("file") };
    case "Read":
      return { label: "Leer", detail: file("file_path") };
    case "Write":
      return { label: "Escribir", detail: file("file_path") };
    case "Edit":
      return { label: "Editar", detail: file("file_path") };
    case "NotebookEdit":
      return { label: "Editar notebook", detail: file("notebook_path") };
    case "Bash":
      return { label: "Terminal", detail: value("command") };
    case "Glob":
      return { label: "Buscar archivos", detail: value("pattern") };
    case "Grep":
      return { label: "Buscar", detail: value("pattern") };
    case "WebSearch":
      return { label: "Buscar en la web", detail: value("query") };
    case "WebFetch":
      return { label: "Abrir", detail: value("url") };
    case "TodoWrite":
      return { label: "Tareas", detail: "" };
    case "Task":
    case "Agent":
      return { label: "Subagente", detail: value("description") };
    case "ExitPlanMode":
      return { label: "Plan", detail: "" };
    case "AskUserQuestion":
      return { label: "Pregunta", detail: "" };
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
      return { label: mcp ? `${mcp[1]}: ${mcp[2]}` : name, detail: "" };
    }
  }
}

export function relativePath(path: string, cwd: string): string {
  const root = cwd.replace(/[\\/]+$/, "");
  if (path.startsWith(root) && /^[\\/]/.test(path.slice(root.length))) return path.slice(root.length + 1);
  return path;
}

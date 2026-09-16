import { ask, message } from "@tauri-apps/plugin-dialog";
import { api, basename, type GitBranch, type GitFileChange, type GitStatus } from "$lib/api";

/** The Git repository of the open folder, as shown in the source control view. */
export class SourceControl {
  readonly folder: string;

  /** `null` when the folder isn't in a repository; `undefined` until the first check. */
  status = $state<GitStatus | null | undefined>(undefined);
  /** What's running, like "Haciendo push…", while a command that changes the repository runs. */
  operation = $state<string | null>(null);
  message = $state("");

  readonly conflicts = $derived(this.status?.files.filter((file) => file.conflict) ?? []);
  readonly staged = $derived(this.status?.files.filter((file) => !file.conflict && file.staged) ?? []);
  readonly changes = $derived(this.status?.files.filter((file) => !file.conflict && file.unstaged) ?? []);
  /** The branch has commits that aren't on a remote yet, or is behind its upstream. */
  readonly canSync = $derived(
    !!this.status?.branch &&
      !!this.status.commit &&
      (!this.status.upstream || this.status.ahead > 0 || this.status.behind > 0),
  );

  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;

  constructor(folder: string) {
    this.folder = folder;
  }

  /** Reloads the status. Calls while loading coalesce into one more load. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        try {
          this.status = await api.gitStatus(this.folder);
        } catch (error) {
          // Keep showing the last status; a missing Git install still needs to be reported once.
          if (this.status === undefined) {
            this.status = null;
            await showError(error);
          }
        }
      } while (this.refreshAgain);
      this.refreshing = null;
    })();
    return this.refreshing;
  }

  /** The file's absolute path, for opening it. */
  absolutePath(file: GitFileChange): string {
    const path = `${this.status?.root}/${file.path}`;
    return this.folder.includes("\\") ? path.replaceAll("/", "\\") : path;
  }

  init() {
    return this.run("Inicializando el repositorio…", () => api.gitInit(this.folder));
  }

  stage(files: GitFileChange[]) {
    return this.withRoot(null, (root) => api.gitStage(root, files.map((file) => file.path)));
  }

  unstage(files: GitFileChange[]) {
    return this.withRoot(null, (root) => api.gitUnstage(root, files.map((file) => file.path)));
  }

  async discard(files: GitFileChange[]) {
    const untracked = files.filter((file) => file.unstaged === "?");
    const tracked = files.filter((file) => file.unstaged !== "?");
    const what = files.length === 1 ? `los cambios de «${basename(files[0].path)}»` : `los cambios de ${files.length} archivos`;
    const detail =
      untracked.length === 0
        ? "No se puede deshacer."
        : untracked.length === files.length
          ? `${untracked.length === 1 ? "El archivo no tiene" : "Los archivos no tienen"} seguimiento y se eliminará${untracked.length === 1 ? "" : "n"}. No se puede deshacer.`
          : `${untracked.length} de ellos no tienen seguimiento y se eliminarán. No se puede deshacer.`;
    const confirmed = await ask(`¿Descartar ${what}?\n\n${detail}`, {
      title: "Descartar cambios",
      kind: "warning",
      okLabel: "Descartar",
      cancelLabel: "Cancelar",
    });
    if (!confirmed) return;
    await this.withRoot(null, (root) =>
      api.gitDiscard(
        root,
        tracked.map((file) => file.path),
        untracked.map((file) => file.path),
      ),
    );
  }

  /** Commits the staged changes, or every change when none are staged, like VS Code's smart commit. */
  async commit() {
    const text = this.message.trim();
    if (!text || this.conflicts.length + this.staged.length + this.changes.length === 0) return;
    const all = this.staged.length === 0;
    const done = await this.withRoot("Haciendo commit…", (root) => api.gitCommit(root, text, all));
    if (done) this.message = "";
  }

  async undoCommit() {
    const status = this.status;
    if (!status?.commit) return;
    if (status.upstream && status.ahead === 0) {
      const confirmed = await ask(
        `El último commit ya está en ${status.upstream}. Si lo deshaces, tendrás que forzar el push para quitarlo del remoto.`,
        { title: "Deshacer último commit", kind: "warning", okLabel: "Deshacer", cancelLabel: "Cancelar" },
      );
      if (!confirmed) return;
    }
    await this.withRoot("Deshaciendo el último commit…", async (root) => {
      const undone = await api.gitUndoCommit(root);
      if (!this.message.trim()) this.message = undone;
    });
  }

  async branches(): Promise<GitBranch[]> {
    const root = this.status?.root;
    if (!root) return [];
    try {
      return await api.gitBranches(root);
    } catch (error) {
      await showError(error);
      return [];
    }
  }

  checkout(branch: GitBranch) {
    const label = `Cambiando a ${branch.name}…`;
    return this.withRoot(label, (root) => api.gitCheckout(root, branch.name, branch.remote));
  }

  createBranch(name: string) {
    return this.withRoot(`Creando la rama ${name}…`, (root) => api.gitCreateBranch(root, name));
  }

  push() {
    const label = this.status?.upstream ? "Haciendo push…" : "Publicando la rama…";
    return this.withRoot(label, (root) => api.gitPush(root));
  }

  pull() {
    return this.withRoot("Haciendo pull…", (root) => api.gitPull(root));
  }

  /** Pulls if the branch is behind, then pushes, like VS Code's "Sync Changes". */
  async sync() {
    if (this.status?.upstream && this.status.behind > 0 && !(await this.pull())) return;
    if (!this.status?.upstream || this.status.ahead > 0) await this.push();
  }

  private withRoot(label: string | null, task: (root: string) => Promise<unknown>) {
    const root = this.status?.root;
    return root ? this.run(label, () => task(root)) : Promise.resolve(false);
  }

  /** Runs a command that changes the repository, reports its error and reloads the status. */
  private async run(label: string | null, task: () => Promise<unknown>): Promise<boolean> {
    if (label) this.operation = label;
    try {
      await task();
      return true;
    } catch (error) {
      await showError(error);
      return false;
    } finally {
      if (label) this.operation = null;
      await this.refresh();
    }
  }
}

const showError = (error: unknown) => message(String(error), { title: "Git", kind: "error" });

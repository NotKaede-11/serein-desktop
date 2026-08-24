import type {
  AttachmentImport,
  AttachmentInventoryEntry,
  AttachmentIssue,
  AttachmentMoveResult,
  AttachmentSettings,
  CleanupSummary,
  FolderEntry,
  NoteDocument,
  NoteEntry,
  RecoverySettings,
  TrashItem,
  TrashRestorePolicy,
  VersionComparison,
  VersionPreview,
  VersionRestoreMode,
  VersionSnapshot,
  VaultChange,
  VaultPort,
} from "../platform/vault";

export type SaveState = "loading" | "saved" | "saving" | "unsaved" | "conflict" | "error";
export type ConflictAction = "keep-mine" | "use-disk" | "save-both" | "merge";

export interface NoteConflict {
  localContent: string;
  disk: NoteDocument;
}

export interface VaultWorkspaceState {
  root: string | null;
  notes: NoteEntry[];
  folders: FolderEntry[];
  activePath: string | null;
  document: NoteDocument | null;
  content: string;
  saveState: SaveState;
  conflict: NoteConflict | null;
  error: string | null;
  lastTrash: TrashItem | null;
  recoverySettings: RecoverySettings;
  versions: VersionSnapshot[];
  versionPreview: VersionPreview | null;
  versionComparison: VersionComparison | null;
  trashItems: TrashItem[];
  recoveryActivity: { phase: "idle" | "working" | "ready" | "error"; message: string };
  attachmentSettings: AttachmentSettings;
  attachments: AttachmentInventoryEntry[];
  attachmentIssues: AttachmentIssue[];
  attachmentActivity: { phase: "idle" | "working" | "ready" | "error"; message: string };
}

interface ControllerOptions {
  debounceMs?: number;
}

const initialState: VaultWorkspaceState = {
  root: null,
  notes: [],
  folders: [],
  activePath: null,
  document: null,
  content: "",
  saveState: "loading",
  conflict: null,
  error: null,
  lastTrash: null,
  recoverySettings: {
    snapshotIntervalMinutes: 15,
    retentionDays: 30,
    maxStorageBytes: 2 * 1024 * 1024 * 1024,
    automaticCleanup: true,
    trashRetentionDays: null,
  },
  versions: [],
  versionPreview: null,
  versionComparison: null,
  trashItems: [],
  recoveryActivity: { phase: "idle", message: "" },
  attachmentSettings: { directory: "Attachments" },
  attachments: [],
  attachmentIssues: [],
  attachmentActivity: { phase: "idle", message: "" },
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class VaultWorkspaceController {
  private state: VaultWorkspaceState = initialState;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unlisten: (() => void) | null = null;
  private watchId: string | null = null;
  private disposed = false;
  private lifecycleGeneration = 0;
  private debounceMs: number;
  private editVersion = 0;
  private inFlightSave: Promise<void> | null = null;
  private inFlightPathMutation: Promise<void> | null = null;

  constructor(
    private readonly port: VaultPort,
    options: ControllerOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 750;
  }

  getSnapshot = () => this.state;
  getServerSnapshot = () => initialState;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async initialize(preferredRoot: string | null = null) {
    const generation = ++this.lifecycleGeneration;
    this.disposed = false;
    try {
      const snapshot = preferredRoot
        ? await this.port.openTestVault(preferredRoot)
        : await this.port.createTestVault();
      if (!this.isCurrentLifecycle(generation)) return;
      const activePath =
        snapshot.notes.find((note) => note.relativePath === "Notes/Welcome.md")?.relativePath
        ?? snapshot.notes[0]?.relativePath
        ?? null;
      const document = activePath ? await this.port.readNote(snapshot.root, activePath) : null;
      const [attachmentSettings, recoverySettings, trashItems] = await Promise.all([
        this.port.getAttachmentSettings(snapshot.root),
        this.port.getRecoverySettings(snapshot.root),
        this.port.listTrash(snapshot.root),
      ]);
      this.patch({
        root: snapshot.root,
        notes: snapshot.notes,
        folders: snapshot.folders,
        activePath,
        document,
        content: document?.content ?? "",
        saveState: "saved",
        error: null,
        attachmentSettings,
        recoverySettings,
        trashItems,
      });
      if (recoverySettings.automaticCleanup) {
        void this.port.cleanupRecovery(snapshot.root).then((summary) => {
          if (!this.isCurrentLifecycle(generation)) return;
          if (summary.removedTrashItems) void this.refreshTrash();
          this.patch({ recoveryActivity: { phase: "ready", message: this.cleanupMessage(summary) } });
        }).catch((error) => {
          if (this.isCurrentLifecycle(generation)) {
            this.patch({ recoveryActivity: { phase: "error", message: errorMessage(error) } });
          }
        });
      }
      const unlisten = await this.port.onChange((change) => {
        void this.handleFilesystemChange(change);
      });
      if (!this.isCurrentLifecycle(generation)) {
        unlisten();
        return;
      }
      this.unlisten = unlisten;
      const watchId = await this.port.startWatch(snapshot.root);
      if (!this.isCurrentLifecycle(generation)) {
        unlisten();
        await this.port.stopWatch(watchId);
        return;
      }
      this.watchId = watchId;
    } catch (error) {
      if (this.isCurrentLifecycle(generation)) {
        this.patch({
          root: null,
          notes: [],
          folders: [],
          activePath: null,
          document: null,
          content: "",
          saveState: "error",
          error: errorMessage(error),
        });
      }
    }
  }

  async dispose() {
    this.lifecycleGeneration += 1;
    this.disposed = true;
    this.clearTimer();
    const unlisten = this.unlisten;
    this.unlisten = null;
    unlisten?.();
    const watchId = this.watchId;
    this.watchId = null;
    if (this.inFlightSave) await this.inFlightSave;
    if (watchId) await this.port.stopWatch(watchId);
  }

  setDebounceMs(value: number) {
    this.debounceMs = Math.max(250, Math.min(value, 5_000));
    if (this.state.saveState === "unsaved") this.scheduleSave();
  }

  updateContent(content: string) {
    if (!this.state.document || this.state.conflict) return;
    this.editVersion += 1;
    this.patch({ content, saveState: "unsaved", error: null });
    this.scheduleSave();
  }

  async openNote(relativePath: string) {
    const root = this.requireRoot();
    if (relativePath === this.state.activePath) return;
    if (this.state.saveState === "unsaved" || this.state.saveState === "saving") {
      await this.saveNow();
    }
    if (this.state.conflict || this.state.saveState === "error") return;
    const document = await this.port.readNote(root, relativePath);
    this.editVersion += 1;
    this.patch({
      activePath: relativePath,
      document,
      content: document.content,
      saveState: "saved",
      conflict: null,
      error: null,
    });
  }

  async saveNow() {
    this.clearTimer();
    while (this.inFlightPathMutation) {
      await this.inFlightPathMutation;
    }
    if (this.inFlightSave) {
      await this.inFlightSave;
      if (this.state.saveState === "unsaved") await this.saveNow();
      return;
    }
    const operation = this.performSave();
    this.inFlightSave = operation;
    try {
      await operation;
    } finally {
      if (this.inFlightSave === operation) this.inFlightSave = null;
    }
  }

  private async performSave() {
    const { root, activePath, document, content, saveState } = this.state;
    if (!root || !activePath || !document || saveState === "conflict") return;
    if (saveState === "saved") return;

    const submittedContent = content;
    const submittedVersion = this.editVersion;
    const submittedPath = activePath;
    this.patch({ saveState: "saving", error: null });
    try {
      const outcome = await this.port.saveNote(
        root,
        submittedPath,
        submittedContent,
        document.revision,
      );
      if (this.state.activePath !== submittedPath) return;
      if (outcome.status === "conflict") {
        this.patch({
          conflict: { localContent: this.state.content, disk: outcome.disk },
          saveState: "conflict",
        });
        return;
      }
      if (this.editVersion === submittedVersion && this.state.content === submittedContent) {
        this.patch({ document: outcome.document, saveState: "saved", conflict: null });
      } else {
        this.patch({ document: outcome.document, saveState: "unsaved" });
        this.scheduleSave();
      }
    } catch (error) {
      this.patch({ saveState: "error", error: errorMessage(error) });
    }
  }

  async resolveConflict(action: ConflictAction, mergedContent?: string) {
    const root = this.requireRoot();
    const path = this.state.activePath;
    const conflict = this.state.conflict;
    if (!path || !conflict) return;

    if (action === "use-disk") {
      await this.port.saveConflictCopy(root, path, conflict.localContent);
      await this.refreshSnapshot();
      this.editVersion += 1;
      this.patch({
        document: conflict.disk,
        content: conflict.disk.content,
        conflict: null,
        saveState: "saved",
      });
      return;
    }

    if (action === "save-both") {
      const copy = await this.port.saveConflictCopy(root, path, conflict.localContent);
      await this.refreshSnapshot();
      this.editVersion += 1;
      this.patch({
        activePath: copy.relativePath,
        document: copy,
        content: copy.content,
        conflict: null,
        saveState: "saved",
      });
      return;
    }

    const content = action === "merge" ? (mergedContent ?? conflict.localContent) : conflict.localContent;
    this.patch({ saveState: "saving", error: null });
    const preserved = await this.port.preserveAndSave(
      root,
      path,
      content,
      conflict.disk.revision,
    );
    if (preserved.outcome.status === "conflict") {
      this.patch({
        content,
        conflict: { localContent: content, disk: preserved.outcome.disk },
        saveState: "conflict",
      });
      return;
    }
    this.editVersion += 1;
    this.patch({
      document: preserved.outcome.document,
      content,
      conflict: null,
      saveState: "saved",
    });
  }

  async createNote(relativePath: string) {
    const root = this.requireRoot();
    if (this.state.saveState === "unsaved" || this.state.saveState === "saving") await this.saveNow();
    if (this.state.conflict || this.state.saveState === "error") {
      throw new Error("Save the current note successfully before creating another note.");
    }
    const title = relativePath.split("/").at(-1)?.replace(/\.md$/i, "") || "Untitled";
    const document = await this.port.createNote(root, relativePath, `# ${title}\n\n`);
    await this.refreshSnapshot();
    this.editVersion += 1;
    this.patch({
      activePath: document.relativePath,
      document,
      content: document.content,
      saveState: "saved",
      conflict: null,
    });
  }

  async createFolder(relativePath: string) {
    const root = this.requireRoot();
    await this.port.createFolder(root, relativePath);
    await this.refreshSnapshot();
  }

  async moveEntry(path: string, destination: string) {
    while (this.inFlightPathMutation) await this.inFlightPathMutation;
    const root = this.requireRoot();
    if (this.state.saveState === "unsaved" || this.state.saveState === "saving") {
      await this.saveNow();
    }
    if (this.state.conflict || this.state.saveState === "error") return;
    this.clearTimer();
    const versionBeforeMove = this.editVersion;
    const operation = this.performMove(root, path, destination, versionBeforeMove);
    this.inFlightPathMutation = operation;
    try {
      await operation;
    } finally {
      if (this.inFlightPathMutation === operation) this.inFlightPathMutation = null;
      if (this.state.saveState === "unsaved") this.scheduleSave();
    }
  }

  private async performMove(
    root: string,
    path: string,
    destination: string,
    versionBeforeMove: number,
  ) {
    await this.port.moveEntry(root, path, destination);
    await this.refreshSnapshot();
    const activePath = this.state.activePath;
    const movedActivePath = activePath === path
      ? destination
      : activePath?.startsWith(path + "/")
        ? destination + activePath.slice(path.length)
        : null;
    if (!movedActivePath) {
      this.patch({ error: null });
      return;
    }
    const document = await this.port.readNote(root, movedActivePath);
    const editedDuringMove = this.editVersion !== versionBeforeMove;
    if (!editedDuringMove) this.editVersion += 1;
    this.patch({
      activePath: movedActivePath,
      document,
      content: editedDuringMove ? this.state.content : document.content,
      saveState: editedDuringMove ? "unsaved" : "saved",
      error: null,
    });
  }

  async moveActiveEntry(destination: string) {
    const path = this.state.activePath;
    if (path) await this.moveEntry(path, destination);
  }

  async trashEntry(path: string) {
    const root = this.requireRoot();
    if (this.state.saveState === "unsaved" || this.state.saveState === "saving") {
      await this.saveNow();
    }
    if (this.state.conflict || this.state.saveState === "error") return;
    const activePath = this.state.activePath;
    const removesActiveNote = activePath === path || activePath?.startsWith(path + "/") === true;
    const record = await this.port.trashEntry(root, path);
    await this.refreshSnapshot();
    await this.refreshTrash();
    if (!removesActiveNote) {
      this.patch({ lastTrash: record, error: null });
      return;
    }
    const next = this.state.notes[0]?.relativePath ?? null;
    const document = next ? await this.port.readNote(root, next) : null;
    this.editVersion += 1;
    this.patch({
      activePath: next,
      document,
      content: document?.content ?? "",
      saveState: "saved",
      lastTrash: record,
    });
  }

  async trashActiveNote() {
    const path = this.state.activePath;
    if (path) await this.trashEntry(path);
  }

  async restoreLastTrash() {
    const root = this.requireRoot();
    const record = this.state.lastTrash;
    if (!record) return;
    try {
      const [restored] = await this.port.restoreTrash(root, [record.id], "original");
      await this.refreshSnapshot();
      await this.refreshTrash();
      const document = await this.port.readNote(root, restored.restoredPath);
      this.editVersion += 1;
      this.patch({
        activePath: restored.restoredPath,
        document,
        content: document.content,
        saveState: "saved",
        lastTrash: null,
        error: null,
      });
    } catch (error) {
      this.patch({ error: errorMessage(error) });
    }
  }

  async refreshTrash() {
    const root = this.requireRoot();
    const trashItems = await this.port.listTrash(root);
    this.patch({ trashItems });
    return trashItems;
  }

  async restoreTrash(ids: string[], policy: TrashRestorePolicy) {
    if (!ids.length) return [];
    const root = this.requireRoot();
    this.patch({ recoveryActivity: { phase: "working", message: "Restoring from Trash…" }, error: null });
    try {
      const results = await this.port.restoreTrash(root, ids, policy);
      await this.refreshSnapshot();
      await this.refreshTrash();
      const first = results[0];
      if (first?.restoredPath.toLowerCase().endsWith(".md")) {
        const document = await this.port.readNote(root, first.restoredPath);
        this.editVersion += 1;
        this.patch({ activePath: first.restoredPath, document, content: document.content, saveState: "saved" });
      }
      this.patch({
        lastTrash: this.state.lastTrash && ids.includes(this.state.lastTrash.id) ? null : this.state.lastTrash,
        recoveryActivity: { phase: "ready", message: `${results.length} ${results.length === 1 ? "item" : "items"} restored` },
      });
      return results;
    } catch (error) {
      const message = errorMessage(error);
      this.patch({ error: message, recoveryActivity: { phase: "error", message } });
      throw error;
    }
  }

  async deleteTrash(ids: string[]) {
    if (!ids.length) return 0;
    const root = this.requireRoot();
    this.patch({ recoveryActivity: { phase: "working", message: "Deleting selected Trash items…" }, error: null });
    try {
      const removed = await this.port.deleteTrash(root, ids);
      await this.refreshTrash();
      this.patch({
        lastTrash: this.state.lastTrash && ids.includes(this.state.lastTrash.id) ? null : this.state.lastTrash,
        recoveryActivity: { phase: "ready", message: `${removed} ${removed === 1 ? "item" : "items"} permanently deleted` },
      });
      return removed;
    } catch (error) {
      const message = errorMessage(error);
      this.patch({ error: message, recoveryActivity: { phase: "error", message } });
      throw error;
    }
  }

  async emptyTrash() {
    const root = this.requireRoot();
    this.patch({ recoveryActivity: { phase: "working", message: "Emptying Trash…" }, error: null });
    try {
      const removed = await this.port.emptyTrash(root);
      await this.refreshTrash();
      this.patch({ lastTrash: null, recoveryActivity: { phase: "ready", message: `${removed} ${removed === 1 ? "item" : "items"} permanently deleted` } });
      return removed;
    } catch (error) {
      const message = errorMessage(error);
      this.patch({ error: message, recoveryActivity: { phase: "error", message } });
      throw error;
    }
  }

  async loadVersionHistory() {
    const root = this.requireRoot();
    const path = this.requireActiveNote();
    if (this.state.saveState === "unsaved" || this.state.saveState === "saving") await this.saveNow();
    if (this.state.saveState === "error") throw new Error("Save the current note successfully before opening version history.");
    if (this.state.conflict) throw new Error("Resolve the open conflict before viewing version history.");
    const versions = await this.port.listNoteVersions(root, path);
    this.patch({ versions, versionPreview: null, versionComparison: null });
    return versions;
  }

  async previewVersion(id: string) {
    const root = this.requireRoot();
    const versionPreview = await this.port.previewNoteVersion(root, id);
    this.patch({ versionPreview, versionComparison: null });
    return versionPreview;
  }

  async compareVersion(id: string) {
    const root = this.requireRoot();
    const versionComparison = await this.port.compareNoteVersion(root, id);
    this.patch({ versionComparison, versionPreview: null });
    return versionComparison;
  }

  async restoreVersion(id: string, mode: VersionRestoreMode) {
    const root = this.requireRoot();
    if (this.state.saveState === "unsaved" || this.state.saveState === "saving") await this.saveNow();
    if (this.state.saveState === "error") throw new Error("Save the current note successfully before restoring a version.");
    if (this.state.conflict) throw new Error("Resolve the open conflict before restoring a version.");
    this.patch({ recoveryActivity: { phase: "working", message: mode === "copy" ? "Restoring version as a copy…" : "Restoring version…" }, error: null });
    try {
      const result = await this.port.restoreNoteVersion(root, id, mode);
      await this.refreshSnapshot();
      this.editVersion += 1;
      this.patch({
        activePath: result.document.relativePath,
        document: result.document,
        content: result.document.content,
        saveState: "saved",
        versionPreview: null,
        versionComparison: null,
        recoveryActivity: { phase: "ready", message: result.restoredAsCopy ? "Version restored as a new note" : "Earlier version restored; the replaced content was preserved" },
      });
      await this.loadVersionHistory();
      return result;
    } catch (error) {
      const message = errorMessage(error);
      this.patch({ error: message, recoveryActivity: { phase: "error", message } });
      throw error;
    }
  }

  async configureRecovery(settings: RecoverySettings) {
    const root = this.requireRoot();
    try {
      const recoverySettings = await this.port.setRecoverySettings(root, settings);
      this.patch({ recoverySettings, recoveryActivity: { phase: "ready", message: "Recovery settings saved" }, error: null });
      return recoverySettings;
    } catch (error) {
      const message = errorMessage(error);
      this.patch({ error: message, recoveryActivity: { phase: "error", message } });
      throw error;
    }
  }

  async cleanupRecovery() {
    const root = this.requireRoot();
    this.patch({ recoveryActivity: { phase: "working", message: "Cleaning old recovery data…" }, error: null });
    try {
      const summary = await this.port.cleanupRecovery(root);
      await this.refreshTrash();
      if (this.state.activePath) await this.loadVersionHistory();
      this.patch({ recoveryActivity: { phase: "ready", message: this.cleanupMessage(summary) } });
      return summary;
    } catch (error) {
      const message = errorMessage(error);
      this.patch({ error: message, recoveryActivity: { phase: "error", message } });
      throw error;
    }
  }

  private cleanupMessage(summary: CleanupSummary) {
    const removed = summary.removedVersions + summary.removedTrashItems;
    return removed ? `Cleanup removed ${removed} recovery ${removed === 1 ? "item" : "items"}` : "Recovery storage is already tidy";
  }

  async importAttachmentBytes(fileName: string, mediaType: string, bytes: number[]) {
    const root = this.requireRoot();
    const notePath = this.requireActiveNote();
    return this.runAttachmentImport(
      `Importing ${fileName}…`,
      () => this.port.importAttachmentBytes(root, notePath, fileName, mediaType, bytes),
    );
  }

  async importAttachmentPath(sourcePath: string) {
    const root = this.requireRoot();
    const notePath = this.requireActiveNote();
    const fileName = sourcePath.split(/[\\/]/).at(-1) || "attachment";
    return this.runAttachmentImport(
      `Importing ${fileName}…`,
      () => this.port.importAttachmentPath(root, notePath, sourcePath),
    );
  }

  async rollbackAttachment(imported: AttachmentImport) {
    const root = this.requireRoot();
    if (!imported.created || !imported.rollbackToken) return false;
    try {
      const rolledBack = await this.port.rollbackAttachmentImport(
        root,
        imported.relativePath,
        imported.rollbackToken,
      );
      await this.refreshAttachments();
      this.patch({
        attachmentActivity: {
          phase: rolledBack ? "ready" : "error",
          message: rolledBack
            ? `Removed incomplete attachment ${imported.displayName}`
            : `Kept ${imported.displayName} because it changed after import`,
        },
      });
      return rolledBack;
    } catch (error) {
      const message = errorMessage(error);
      this.patch({
        error: message,
        attachmentActivity: { phase: "error", message },
      });
      return false;
    }
  }

  async configureAttachmentDirectory(directory: string) {
    const root = this.requireRoot();
    this.patch({
      attachmentActivity: { phase: "working", message: "Updating attachment directory…" },
      error: null,
    });
    try {
      const settings = await this.port.setAttachmentDirectory(root, directory);
      await this.refreshSnapshot();
      await this.refreshAttachments();
      this.patch({
        attachmentSettings: settings,
        attachmentActivity: { phase: "ready", message: `Attachments save to ${settings.directory}` },
      });
      return settings;
    } catch (error) {
      const message = errorMessage(error);
      this.patch({ error: message, attachmentActivity: { phase: "error", message } });
      throw error;
    }
  }

  async refreshAttachments() {
    const root = this.requireRoot();
    const attachments = await this.port.listAttachments(root);
    this.patch({ attachments });
    return attachments;
  }

  async moveAttachment(from: string, to: string): Promise<AttachmentMoveResult> {
    const root = this.requireRoot();
    if (this.state.saveState === "unsaved" || this.state.saveState === "saving") {
      await this.saveNow();
    }
    if (this.state.conflict || this.state.saveState === "error") {
      throw new Error("Resolve the open note before moving an attachment.");
    }
    this.patch({
      attachmentActivity: { phase: "working", message: "Moving attachment and updating references…" },
      error: null,
    });
    try {
      const result = await this.port.moveAttachmentAndRepair(root, from, to);
      const updatedActive = result.updatedNotes.find((note) => note.relativePath === this.state.activePath);
      await this.refreshAttachments();
      if (updatedActive) {
        this.editVersion += 1;
        this.patch({ document: updatedActive, content: updatedActive.content, saveState: "saved" });
      }
      for (const note of result.updatedNotes) {
        void this.port.updateSearchEntry(root, note.relativePath, "modified").catch(() => {});
      }
      this.patch({
        attachmentActivity: { phase: "ready", message: `Moved attachment to ${result.relativePath}` },
      });
      return result;
    } catch (error) {
      const message = errorMessage(error);
      this.patch({ error: message, attachmentActivity: { phase: "error", message } });
      throw error;
    }
  }

  async repairAttachmentIssue(issue: AttachmentIssue) {
    const root = this.requireRoot();
    if (this.state.saveState === "unsaved" || this.state.saveState === "saving") {
      await this.saveNow();
    }
    if (this.state.conflict) throw new Error("Resolve the open note before repairing links.");
    this.patch({
      attachmentActivity: { phase: "working", message: "Repairing attachment reference…" },
      error: null,
    });
    try {
      const document = await this.port.repairAttachmentIssue(root, issue);
      const issues = await this.port.scanAttachmentIssues(root);
      if (document.relativePath === this.state.activePath) {
        this.editVersion += 1;
        this.patch({ document, content: document.content, saveState: "saved" });
      }
      this.patch({
        attachmentIssues: issues,
        attachmentActivity: { phase: "ready", message: "Attachment reference repaired" },
      });
      void this.port.updateSearchEntry(root, document.relativePath, "modified").catch(() => {});
      return document;
    } catch (error) {
      const message = errorMessage(error);
      this.patch({ error: message, attachmentActivity: { phase: "error", message } });
      throw error;
    }
  }

  reportAttachmentError(message: string) {
    this.patch({
      error: message,
      attachmentActivity: { phase: "error", message },
    });
  }

  private async runAttachmentImport(
    pendingMessage: string,
    operation: () => Promise<AttachmentImport>,
  ) {
    if (this.state.conflict) throw new Error("Resolve the open note before importing an attachment.");
    this.patch({
      attachmentActivity: { phase: "working", message: pendingMessage },
      error: null,
    });
    try {
      const imported = await operation();
      this.patch({
        attachmentActivity: { phase: "ready", message: `Attached ${imported.relativePath.split("/").at(-1)}` },
      });
      return imported;
    } catch (error) {
      const message = errorMessage(error);
      this.patch({ error: message, attachmentActivity: { phase: "error", message } });
      throw error;
    }
  }

  private async refreshSnapshot() {
    const root = this.requireRoot();
    const snapshot = await this.port.openTestVault(root);
    this.patch({ notes: snapshot.notes, folders: snapshot.folders });
  }

  private async handleFilesystemChange(change: VaultChange) {
    if (!this.state.root) return;
    const isMarkdown = change.relativePath.toLocaleLowerCase().endsWith(".md");
    if (isMarkdown) {
      void this.port.updateSearchEntry(this.state.root, change.relativePath, change.kind).catch(() => {
        // Search is a disposable derived cache; editor safety must not depend on index availability.
      });
    }
    if (change.origin === "serein") return;
    try {
      if (!isMarkdown) {
        const attachmentIssues = await this.port.scanAttachmentIssues(this.state.root);
        this.patch({ attachmentIssues });
        return;
      }
      await this.refreshSnapshot();
      if (change.relativePath !== this.state.activePath) return;
      if (change.kind === "removed") {
        this.clearTimer();
        this.patch({
          saveState: "error",
          error: "The open note was removed outside Serein. Your editor text is still held in memory.",
        });
        return;
      }
      const disk = await this.port.readNote(this.state.root, change.relativePath);
      if (this.state.saveState === "saved") {
        this.editVersion += 1;
        this.patch({ document: disk, content: disk.content, saveState: "saved", error: null });
      } else {
        this.clearTimer();
        this.patch({
          conflict: { localContent: this.state.content, disk },
          saveState: "conflict",
        });
      }
    } catch (error) {
      this.patch({ saveState: "error", error: errorMessage(error) });
    }
  }

  private scheduleSave() {
    this.clearTimer();
    if (this.inFlightPathMutation) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.saveNow();
    }, this.debounceMs);
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private requireRoot() {
    if (!this.state.root) throw new Error("Synthetic vault is not open");
    return this.state.root;
  }

  private requireActiveNote() {
    if (!this.state.activePath || !this.state.document) {
      throw new Error("Open a Markdown note before importing an attachment.");
    }
    return this.state.activePath;
  }

  private isCurrentLifecycle(generation: number) {
    return !this.disposed && generation === this.lifecycleGeneration;
  }

  private patch(patch: Partial<VaultWorkspaceState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

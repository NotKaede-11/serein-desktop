import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AttachmentImport,
  AttachmentIssue,
  RecoverySettings,
  FolderEntry,
  NoteDocument,
  NoteEntry,
  PreservedSaveOutcome,
  SaveOutcome,
  TrashRecord,
  TrashItem,
  VersionPreview,
  VaultChange,
  VaultPort,
  VaultSnapshot,
} from "../platform/vault";
import { VaultWorkspaceController } from "./VaultWorkspaceController";

function revision(content: string) {
  return `rev:${content}`;
}

class MemoryVaultPort implements VaultPort {
  root = "C:\\Temp\\serein-synthetic";
  files = new Map<string, string>([
    ["Notes/Welcome.md", "# Welcome\n"],
    ["Daily/2026-08-23.md", "# Daily\n"],
  ]);
  folders = new Set(["Notes", "Daily", "Attachments"]);
  listeners = new Set<(change: VaultChange) => void>();
  saveCalls = 0;
  saveError: Error | null = null;
  forcedSaveCalls = 0;
  moveGate: Promise<void> | null = null;
  attachmentDirectory = "Attachments";
  attachments = new Map<string, number[]>();
  attachmentIssues: AttachmentIssue[] = [];
  importError: Error | null = null;
  trash = new Map<string, { item: TrashItem; content: string }>();
  versions = new Map<string, VersionPreview>();
  recoverySettings: RecoverySettings = {
    snapshotIntervalMinutes: 15, retentionDays: 30, maxStorageBytes: 2_147_483_648,
    automaticCleanup: true, trashRetentionDays: null,
  };
  applicationSettings: unknown | null = null;
  workspaceSession: unknown | null = null;

  private note(path: string): NoteDocument {
    const content = this.files.get(path);
    if (content === undefined) throw new Error("note was not found");
    return { relativePath: path, content, revision: revision(content), modifiedMs: 1 };
  }

  private snapshot(): VaultSnapshot {
    return {
      root: this.root,
      notes: [...this.files].map(([relativePath, content]) => ({
        relativePath,
        fileName: relativePath.split("/").at(-1)!,
        byteLength: content.length,
        modifiedMs: 1,
      })),
      folders: [...this.folders].map((relativePath) => ({
        relativePath,
        name: relativePath.split("/").at(-1)!,
      })),
    };
  }

  async loadApplicationSettings() { return { value: this.applicationSettings, warning: null }; }
  async saveApplicationSettings(value: unknown) { this.applicationSettings = value; }
  async loadVaultWorkspaceSession() { return { value: this.workspaceSession, warning: null }; }
  async saveVaultWorkspaceSession(_root: string, value: unknown) { this.workspaceSession = value; }
  async createTestVault() { return this.snapshot(); }
  async openTestVault() { return this.snapshot(); }
  async listNotes() { return this.snapshot().notes; }
  async readNote(_root: string, path: string) { return this.note(path); }
  async saveNote(_root: string, path: string, content: string, expected: string): Promise<SaveOutcome> {
    this.saveCalls += 1;
    if (this.saveError) throw this.saveError;
    const disk = this.note(path);
    if (disk.revision !== expected) return { status: "conflict", expectedRevision: expected, disk };
    this.files.set(path, content);
    return { status: "saved", previousRevision: expected, document: this.note(path) };
  }
  async preserveAndSave(_root: string, path: string, content: string, expected: string): Promise<PreservedSaveOutcome> {
    this.forcedSaveCalls += 1;
    const outcome = await this.saveNote(this.root, path, content, expected);
    return { outcome, backupPath: ".serein/backups/conflicts/1/Shared.md" };
  }
  async saveConflictCopy(_root: string, path: string, content: string) {
    const copy = path.replace(/\.md$/i, " (conflict).md");
    this.files.set(copy, content);
    return this.note(copy);
  }
  async createNote(_root: string, path: string, content: string) {
    if (this.files.has(path)) throw new Error("destination already exists");
    this.files.set(path, content);
    return this.note(path);
  }
  async createFolder(_root: string, path: string): Promise<FolderEntry> {
    this.folders.add(path);
    return { relativePath: path, name: path.split("/").at(-1)! };
  }
  async moveEntry(_root: string, from: string, to: string) {
    if (this.moveGate) await this.moveGate;
    if (this.files.has(from)) {
      const content = this.files.get(from)!;
      this.files.delete(from);
      this.files.set(to, content);
    } else {
      for (const folder of [...this.folders]) {
        if (folder === from || folder.startsWith(from + "/")) {
          this.folders.delete(folder);
          this.folders.add(to + folder.slice(from.length));
        }
      }
      for (const [path, content] of [...this.files]) {
        if (path.startsWith(from + "/")) {
          this.files.delete(path);
          this.files.set(to + path.slice(from.length), content);
        }
      }
    }
  }
  async trashEntry(_root: string, path: string): Promise<TrashItem> {
    const folder = this.folders.has(path);
    const content = this.files.get(path) ?? "";
    if (folder) {
      for (const filePath of [...this.files.keys()]) if (filePath.startsWith(path + "/")) this.files.delete(filePath);
      for (const folderPath of [...this.folders]) if (folderPath === path || folderPath.startsWith(path + "/")) this.folders.delete(folderPath);
    } else {
      this.files.delete(path);
    }
    const item: TrashItem = { id: String(this.trash.size + 1), originalPath: path, deletedMs: Date.now(), kind: folder ? "folder" : "note", byteLength: content.length };
    this.trash.set(item.id, { item, content });
    return item;
  }
  async restoreEntry(_root: string, record: TrashRecord) {
    if (this.files.has(record.originalPath)) throw new Error("destination already exists");
    this.files.set(record.originalPath, "# Restored\n");
  }
  async getRecoverySettings() { return { ...this.recoverySettings }; }
  async setRecoverySettings(_root: string, settings: RecoverySettings) {
    this.recoverySettings = { ...settings };
    return { ...settings };
  }
  async listNoteVersions(_root: string, path: string) {
    return [...this.versions.values()].map((entry) => entry.snapshot).filter((entry) => entry.notePath === path);
  }
  async previewNoteVersion(_root: string, id: string) { return this.versions.get(id)!; }
  async compareNoteVersion(_root: string, id: string) {
    const version = this.versions.get(id)!;
    return { snapshot: version.snapshot, currentContent: this.note(version.snapshot.notePath).content, snapshotContent: version.content, addedLines: 1, removedLines: 1 };
  }
  async restoreNoteVersion(_root: string, id: string, mode: "replaceCurrent" | "copy") {
    const version = this.versions.get(id)!;
    const path = mode === "copy" ? version.snapshot.notePath.replace(/\.md$/i, " (restored).md") : version.snapshot.notePath;
    this.files.set(path, version.content);
    return { document: this.note(path), preservedSnapshotId: mode === "copy" ? null : "preserved", restoredAsCopy: mode === "copy" };
  }
  async listTrash() { return [...this.trash.values()].map((entry) => entry.item); }
  async restoreTrash(_root: string, ids: string[], policy: "original" | "alternate") {
    return ids.map((id) => {
      const entry = this.trash.get(id)!;
      let path = entry.item.originalPath;
      if (this.files.has(path)) {
        if (policy === "original") throw new Error("destination already exists");
        path = path.replace(/\.md$/i, " (restored).md");
      }
      this.files.set(path, entry.content || "# Restored\n");
      this.trash.delete(id);
      return { id, restoredPath: path };
    });
  }
  async deleteTrash(_root: string, ids: string[]) { let removed = 0; for (const id of ids) if (this.trash.delete(id)) removed += 1; return removed; }
  async emptyTrash() { const removed = this.trash.size; this.trash.clear(); return removed; }
  async cleanupRecovery() { return { removedVersions: 0, removedTrashItems: 0, reclaimedBytes: 0 }; }
  async getAttachmentSettings() { return { directory: this.attachmentDirectory }; }
  async setAttachmentDirectory(_root: string, directory: string) {
    this.attachmentDirectory = directory;
    return { directory };
  }
  async importAttachmentBytes(_root: string, notePath: string, fileName: string, mediaType: string, bytes: number[]): Promise<AttachmentImport> {
    if (this.importError) throw this.importError;
    const relativePath = `${this.attachmentDirectory}/${fileName}`;
    this.attachments.set(relativePath, bytes);
    const displayName = fileName.replace(/\.[^.]+$/, "");
    return {
      relativePath,
      markdown: mediaType.startsWith("image/") ? `![${displayName}](../${relativePath})` : `[${displayName}](../${relativePath})`,
      displayName,
      created: true,
      rollbackToken: "rollback-1",
    };
  }
  async importAttachmentPath(_root: string, notePath: string, sourcePath: string) {
    return this.importAttachmentBytes(this.root, notePath, sourcePath.split(/[\\/]/).at(-1)!, "application/pdf", [1]);
  }
  async rollbackAttachmentImport(_root: string, relativePath: string) {
    return this.attachments.delete(relativePath);
  }
  async moveAttachmentAndRepair(_root: string, from: string, to: string) {
    const bytes = this.attachments.get(from) ?? [1];
    this.attachments.delete(from);
    this.attachments.set(to, bytes);
    const updatedNotes: NoteDocument[] = [];
    for (const [path, content] of this.files) {
      const updated = content.replaceAll(from, to);
      if (updated !== content) {
        this.files.set(path, updated);
        updatedNotes.push(this.note(path));
      }
    }
    return { relativePath: to, updatedNotes };
  }
  async scanAttachmentIssues() { return this.attachmentIssues; }
  async repairAttachmentIssue(_root: string, issue: AttachmentIssue) {
    const content = this.files.get(issue.notePath)!.replace(issue.brokenTarget, issue.suggestedPath!);
    this.files.set(issue.notePath, content);
    this.attachmentIssues = [];
    return this.note(issue.notePath);
  }
  async listAttachments() {
    return [...this.attachments].map(([relativePath, bytes]) => ({ relativePath, byteLength: bytes.length, referenced: true }));
  }
  async attachmentPreviewUrl(_root: string, relativePath: string) { return `asset://${relativePath}`; }
  async syncSearchIndex() { return { indexedNotes: this.files.size, updatedNotes: 0, removedNotes: 0, durationMs: 0 }; }
  async rebuildSearchIndex() { return { indexedNotes: this.files.size, updatedNotes: this.files.size, removedNotes: 0, durationMs: 0 }; }
  async updateSearchEntry() {}
  async search() { return []; }
  async searchStatus() { return { ready: true, indexedNotes: this.files.size, updatedMs: 1 }; }
  async startWatch() { return "watch-1"; }
  async stopWatch() { return true; }
  async onChange(listener: (change: VaultChange) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async externalEdit(path: string, content: string) {
    this.files.set(path, content);
    for (const listener of this.listeners) {
      listener({ relativePath: path, kind: "modified", origin: "external" });
    }
    await vi.runAllTimersAsync();
  }
  async externalAttachmentChange(path: string) {
    for (const listener of this.listeners) {
      listener({ relativePath: path, kind: "removed", origin: "external" });
    }
    await vi.runAllTimersAsync();
  }
}

describe("VaultWorkspaceController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads recovery state, restores Trash safely, and persists recovery settings", async () => {
    const port = new MemoryVaultPort();
    const controller = new VaultWorkspaceController(port);
    await controller.initialize();

    expect(controller.getSnapshot().recoverySettings.retentionDays).toBe(30);
    await controller.trashActiveNote();
    expect(controller.getSnapshot().trashItems).toHaveLength(1);

    const item = controller.getSnapshot().trashItems[0];
    port.files.set(item.originalPath, "# Occupied\n");
    await expect(controller.restoreTrash([item.id], "original")).rejects.toThrow("destination already exists");
    const restored = await controller.restoreTrash([item.id], "alternate");
    expect(restored[0].restoredPath).toContain("(restored)");
    expect(controller.getSnapshot().trashItems).toHaveLength(0);

    await controller.configureRecovery({
      snapshotIntervalMinutes: 30, retentionDays: 60, maxStorageBytes: 512_000_000,
      automaticCleanup: false, trashRetentionDays: 90,
    });
    expect(controller.getSnapshot().recoverySettings.snapshotIntervalMinutes).toBe(30);
    await controller.dispose();
  });

  it("previews, compares, and safely restores a note version", async () => {
    const port = new MemoryVaultPort();
    const oldContent = "# Welcome\n\nEarlier wording.\n";
    port.versions.set("version-1", {
      snapshot: { id: "version-1", notePath: "Notes/Welcome.md", createdMs: 1, sourceRevision: "rev:old", byteLength: oldContent.length, reason: "interval" },
      content: oldContent,
    });
    const controller = new VaultWorkspaceController(port);
    await controller.initialize();

    expect(await controller.loadVersionHistory()).toHaveLength(1);
    expect((await controller.previewVersion("version-1")).content).toContain("Earlier wording");
    expect((await controller.compareVersion("version-1")).removedLines).toBe(1);
    const restored = await controller.restoreVersion("version-1", "replaceCurrent");
    expect(restored.document.content).toBe(oldContent);
    expect(controller.getSnapshot().content).toBe(oldContent);
    await controller.dispose();
  });

  it("aborts destructive navigation when pending edits cannot be saved", async () => {
    const port = new MemoryVaultPort();
    const controller = new VaultWorkspaceController(port);
    await controller.initialize();
    controller.updateContent("# Unsaved and protected\n");
    port.saveError = new Error("synthetic disk is locked");

    await controller.trashActiveNote();
    expect(port.files.has("Notes/Welcome.md")).toBe(true);
    expect(controller.getSnapshot().content).toContain("Unsaved and protected");
    expect(controller.getSnapshot().saveState).toBe("error");
    await controller.dispose();
  });

  it("opens real port data, debounces saves, and supports immediate save", async () => {
    const port = new MemoryVaultPort();
    const controller = new VaultWorkspaceController(port, { debounceMs: 750 });
    await controller.initialize();

    expect(controller.getSnapshot().document?.content).toBe("# Welcome\n");
    controller.updateContent("# Edited\n");
    expect(controller.getSnapshot().saveState).toBe("unsaved");
    await vi.advanceTimersByTimeAsync(749);
    expect(port.files.get("Notes/Welcome.md")).toBe("# Welcome\n");
    await vi.advanceTimersByTimeAsync(1);
    expect(port.files.get("Notes/Welcome.md")).toBe("# Edited\n");
    expect(controller.getSnapshot().saveState).toBe("saved");

    controller.updateContent("# Forced\n");
    await controller.saveNow();
    expect(port.files.get("Notes/Welcome.md")).toBe("# Forced\n");
    expect(port.saveCalls).toBe(2);
    await controller.dispose();
  });

  it("reloads clean external edits and protects simultaneous edits with a conflict", async () => {
    const port = new MemoryVaultPort();
    const controller = new VaultWorkspaceController(port, { debounceMs: 750 });
    await controller.initialize();

    await port.externalEdit("Notes/Welcome.md", "# External clean\n");
    expect(controller.getSnapshot().content).toBe("# External clean\n");
    controller.updateContent("# Local draft\n");
    await port.externalEdit("Notes/Welcome.md", "# External conflict\n");

    const conflict = controller.getSnapshot().conflict;
    expect(conflict?.localContent).toBe("# Local draft\n");
    expect(conflict?.disk.content).toBe("# External conflict\n");
    expect(controller.getSnapshot().saveState).toBe("conflict");

    await controller.resolveConflict("keep-mine");
    expect(port.files.get("Notes/Welcome.md")).toBe("# Local draft\n");
    expect(port.forcedSaveCalls).toBe(1);
    expect(controller.getSnapshot().conflict).toBeNull();
    await controller.dispose();
  });

  it("keeps the conflicted session active when another tab attempts navigation", async () => {
    const port = new MemoryVaultPort();
    const controller = new VaultWorkspaceController(port, { debounceMs: 750 });
    await controller.initialize();
    controller.updateContent("# Local draft\n");
    await port.externalEdit("Notes/Welcome.md", "# External conflict\n");

    await controller.openNote("Daily/2026-08-23.md");

    expect(controller.getSnapshot().activePath).toBe("Notes/Welcome.md");
    expect(controller.getSnapshot().content).toBe("# Local draft\n");
    expect(controller.getSnapshot().saveState).toBe("conflict");
    await controller.dispose();
  });

  it("serializes Ctrl+S behind an in-flight autosave without creating a false conflict", async () => {
    const port = new MemoryVaultPort();
    const controller = new VaultWorkspaceController(port, { debounceMs: 750 });
    await controller.initialize();
    const originalSave = port.saveNote.bind(port);
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let call = 0;
    port.saveNote = async (...args) => {
      call += 1;
      if (call === 1) await firstGate;
      return originalSave(...args);
    };

    controller.updateContent("# First edit\n");
    const autosave = controller.saveNow();
    controller.updateContent("# Newer edit\n");
    const forcedSave = controller.saveNow();
    releaseFirst();
    await Promise.all([autosave, forcedSave]);

    expect(port.files.get("Notes/Welcome.md")).toBe("# Newer edit\n");
    expect(port.saveCalls).toBe(2);
    expect(controller.getSnapshot().saveState).toBe("saved");
    expect(controller.getSnapshot().conflict).toBeNull();
    await controller.dispose();
  });

  it("archives the local draft before Use Disk accepts the external version", async () => {
    const port = new MemoryVaultPort();
    const controller = new VaultWorkspaceController(port, { debounceMs: 750 });
    await controller.initialize();
    controller.updateContent("# Local branch\n");
    await port.externalEdit("Notes/Welcome.md", "# Disk branch\n");

    await controller.resolveConflict("use-disk");

    expect(controller.getSnapshot().content).toBe("# Disk branch\n");
    expect(port.files.get("Notes/Welcome (conflict).md")).toBe("# Local branch\n");
    expect(controller.getSnapshot().conflict).toBeNull();
    await controller.dispose();
  });

  it("refreshes state after create, move, trash, and restore operations", async () => {
    const port = new MemoryVaultPort();
    const controller = new VaultWorkspaceController(port, { debounceMs: 750 });
    await controller.initialize();

    await controller.createFolder("Projects");
    await controller.createNote("Projects/Plan.md");
    await controller.moveActiveEntry("Projects/Renamed.md");
    expect(controller.getSnapshot().activePath).toBe("Projects/Renamed.md");
    await controller.trashActiveNote();
    expect(port.files.has("Projects/Renamed.md")).toBe(false);
    expect(controller.getSnapshot().lastTrash?.originalPath).toBe("Projects/Renamed.md");
    await controller.restoreLastTrash();
    expect(port.files.has("Projects/Renamed.md")).toBe(true);
    await controller.dispose();
  });

  it("moves arbitrary entries and follows an active note when its parent folder moves", async () => {
    const port = new MemoryVaultPort();
    const controller = new VaultWorkspaceController(port, { debounceMs: 750 });
    await controller.initialize();

    await controller.moveEntry("Daily/2026-08-23.md", "Notes/2026-08-23.md");
    expect(controller.getSnapshot().activePath).toBe("Notes/Welcome.md");
    expect(port.files.has("Notes/2026-08-23.md")).toBe(true);

    await controller.moveEntry("Notes", "Archive/Notes");
    expect(controller.getSnapshot().activePath).toBe("Archive/Notes/Welcome.md");
    expect(controller.getSnapshot().document?.relativePath).toBe("Archive/Notes/Welcome.md");
    expect(port.files.has("Archive/Notes/Welcome.md")).toBe(true);
    await controller.dispose();
  });

  it("trashes a non-active entry without replacing the open document", async () => {
    const port = new MemoryVaultPort();
    const controller = new VaultWorkspaceController(port, { debounceMs: 750 });
    await controller.initialize();

    await controller.trashEntry("Daily/2026-08-23.md");

    expect(controller.getSnapshot().activePath).toBe("Notes/Welcome.md");
    expect(controller.getSnapshot().content).toBe("# Welcome\n");
    expect(port.files.has("Daily/2026-08-23.md")).toBe(false);
    await controller.dispose();
  });

  it("keeps edits typed during an in-flight rename and saves them only to the new path", async () => {
    const port = new MemoryVaultPort();
    const controller = new VaultWorkspaceController(port, { debounceMs: 750 });
    await controller.initialize();
    let releaseMove!: () => void;
    port.moveGate = new Promise<void>((resolve) => { releaseMove = resolve; });
    const originalSave = port.saveNote.bind(port);
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    let firstSave = true;
    port.saveNote = async (...args) => {
      if (firstSave) { firstSave = false; await saveGate; }
      return originalSave(...args);
    };

    controller.updateContent("# Before rename\n");
    const autosaving = controller.saveNow();
    const moving = controller.moveActiveEntry("Notes/Renamed.md");
    controller.updateContent("# Typed while autosaving\n");
    releaseSave();
    await vi.waitFor(() => expect(controller.getSnapshot().saveState).toBe("saved"));
    controller.updateContent("# Typed while renaming\n");
    releaseMove();
    await Promise.all([autosaving, moving]);
    await vi.advanceTimersByTimeAsync(750);

    expect(port.files.has("Notes/Welcome.md")).toBe(false);
    expect(port.files.get("Notes/Renamed.md")).toBe("# Typed while renaming\n");
    expect(controller.getSnapshot().activePath).toBe("Notes/Renamed.md");
    expect(controller.getSnapshot().saveState).toBe("saved");
    await controller.dispose();
  });

  it("keeps Trash recoverable when its original path is occupied", async () => {
    const port = new MemoryVaultPort();
    const controller = new VaultWorkspaceController(port, { debounceMs: 750 });
    await controller.initialize();
    await controller.trashActiveNote();
    const record = controller.getSnapshot().lastTrash!;
    port.files.set(record.originalPath, "# New occupant\n");

    await controller.restoreLastTrash();

    expect(port.files.get(record.originalPath)).toBe("# New occupant\n");
    expect(controller.getSnapshot().lastTrash).toEqual(record);
    expect(controller.getSnapshot().error).toContain("destination already exists");
    await controller.dispose();
  });

  it("imports attachments without changing Markdown until the editor inserts the returned link", async () => {
    const port = new MemoryVaultPort();
    const controller = new VaultWorkspaceController(port, { debounceMs: 750 });
    await controller.initialize();
    const before = controller.getSnapshot().content;

    const imported = await controller.importAttachmentBytes("pasted image.png", "image/png", [1, 2, 3]);

    expect(imported.markdown).toBe("![pasted image](../Attachments/pasted image.png)");
    expect(controller.getSnapshot().content).toBe(before);
    expect(controller.getSnapshot().attachmentActivity).toEqual({
      phase: "ready",
      message: "Attached pasted image.png",
    });
    expect(port.attachments.has("Attachments/pasted image.png")).toBe(true);
    await controller.dispose();
  });

  it("leaves the note untouched and reports a failed attachment write", async () => {
    const port = new MemoryVaultPort();
    port.importError = new Error("attachment destination is locked");
    const controller = new VaultWorkspaceController(port, { debounceMs: 750 });
    await controller.initialize();
    const before = controller.getSnapshot().content;

    await expect(controller.importAttachmentBytes("locked.png", "image/png", [1])).rejects.toThrow("locked");

    expect(controller.getSnapshot().content).toBe(before);
    expect(controller.getSnapshot().attachmentActivity.phase).toBe("error");
    expect(controller.getSnapshot().error).toContain("locked");
    await controller.dispose();
  });

  it("surfaces a repairable external attachment move and applies the safe repair", async () => {
    const port = new MemoryVaultPort();
    port.files.set("Notes/Welcome.md", "![scan](../Attachments/scan.png)\n");
    port.attachmentIssues = [{
      notePath: "Notes/Welcome.md",
      brokenTarget: "../Attachments/scan.png",
      suggestedPath: "../Attachments/renamed-scan.png",
    }];
    const controller = new VaultWorkspaceController(port, { debounceMs: 750 });
    await controller.initialize();

    await port.externalAttachmentChange("Attachments/scan.png");
    expect(controller.getSnapshot().attachmentIssues).toHaveLength(1);

    await controller.repairAttachmentIssue(port.attachmentIssues[0]);
    expect(controller.getSnapshot().content).toContain("renamed-scan.png");
    expect(controller.getSnapshot().attachmentIssues).toEqual([]);
    await controller.dispose();
  });
});

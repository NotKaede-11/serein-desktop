import type {
  AttachmentImport,
  CleanupSummary,
  FolderEntry,
  NoteDocument,
  PreservedSaveOutcome,
  RecoverySettings,
  SearchResult,
  SaveOutcome,
  SnapshotReason,
  TrashItem,
  TrashRecord,
  VersionPreview,
  VaultChange,
  VaultPort,
  VaultSnapshot,
} from "./vault";

const demoRoot = "Browser preview — memory only";

function revision(content: string) {
  let hash = 2166136261;
  for (const character of content) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `browser-${(hash >>> 0).toString(16)}`;
}

export interface BrowserDemoVaultPort extends VaultPort {
  simulateExternalEdit(relativePath: string, content: string): Promise<void>;
  simulateExternalAttachmentMove(from: string, to: string): Promise<void>;
  readDemoFile(relativePath: string): string | undefined;
  seedApplicationSettings(value: unknown, warning?: string | null): void;
}

export function createBrowserDemoVault(): BrowserDemoVaultPort {
  let applicationSettings: unknown | null = null;
  let applicationSettingsWarning: string | null = null;
  const vaultWorkspaceSessions = new Map<string, unknown>();
  const files = new Map<string, string>([
    [
      "Notes/Welcome.md",
      "# Welcome to Serein\n\n- [ ] Test the editor\n- [ ] Try Split view\n\nThis browser preview uses generated in-memory notes. The packaged Tauri app uses the native synthetic vault on disk.\n",
    ],
    ["Daily/2026-08-23.md", "# Sunday, August 23, 2026\n\nSynthetic daily note.\n"],
  ]);
  const folders = new Set(["Attachments", "Daily", "Notes"]);
  const trash = new Map<string, { item: TrashItem; content: string }>();
  const versions = new Map<string, VersionPreview>();
  const listeners = new Set<(change: VaultChange) => void>();
  const attachments = new Map<string, { bytes: number[]; mediaType: string }>();
  let attachmentIssues: Array<{ notePath: string; brokenTarget: string; suggestedPath: string | null }> = [];
  let attachmentDirectory = "Attachments";
  let recoverySettings: RecoverySettings = {
    snapshotIntervalMinutes: 15,
    retentionDays: 30,
    maxStorageBytes: 2 * 1024 * 1024 * 1024,
    automaticCleanup: true,
    trashRetentionDays: null,
  };

  const document = (relativePath: string): NoteDocument => {
    const content = files.get(relativePath);
    if (content === undefined) throw new Error("The preview note was not found.");
    return { relativePath, content, revision: revision(content), modifiedMs: Date.now() };
  };
  const snapshot = (): VaultSnapshot => ({
    root: demoRoot,
    notes: [...files.entries()].map(([relativePath, content]) => ({
      relativePath,
      fileName: relativePath.split("/").at(-1)!,
      byteLength: new TextEncoder().encode(content).length,
      modifiedMs: Date.now(),
    })),
    folders: [...folders].sort().map((relativePath) => ({
      relativePath,
      name: relativePath.split("/").at(-1)!,
    })),
  });
  const ensurePath = (path: string) => {
    if (!path || path.startsWith("/") || path.includes("..") || path.startsWith(".serein") || path.startsWith(".hushnote") || path.startsWith(".writ")) {
      throw new Error("Path must stay inside the synthetic preview vault.");
    }
  };
  const relativeAttachmentLink = (notePath: string, attachmentPath: string) => {
    const from = notePath.split("/").slice(0, -1);
    const to = attachmentPath.split("/");
    let common = 0;
    while (common < from.length && common < to.length && from[common] === to[common]) common += 1;
    return [...Array(from.length - common).fill(".."), ...to.slice(common)]
      .map((part) => encodeURIComponent(part))
      .join("/");
  };
  const sanitize = (name: string) => {
    const clean = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[ .]+$/g, "") || "attachment";
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(clean) ? `_${clean}` : clean;
  };
  const importBytes = (notePath: string, fileName: string, mediaType: string, bytes: number[]): AttachmentImport => {
    ensurePath(notePath);
    const safe = sanitize(fileName);
    const dot = safe.lastIndexOf(".");
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const extension = dot > 0 ? safe.slice(dot) : "";
    let attempt = 1;
    let relativePath = `${attachmentDirectory}/${safe}`;
    while (attachments.has(relativePath)) relativePath = `${attachmentDirectory}/${stem}-${++attempt}${extension}`;
    attachments.set(relativePath, { bytes: [...bytes], mediaType });
    const displayName = relativePath.split("/").at(-1)!.replace(/\.[^.]+$/, "");
    const target = relativeAttachmentLink(notePath, relativePath);
    return {
      relativePath,
      markdown: mediaType.startsWith("image/") ? `![${displayName}](${target})` : `[${displayName}](${target})`,
      displayName,
      created: true,
      rollbackToken: revision(String.fromCharCode(...bytes.slice(0, 10_000))),
    };
  };
  const captureVersion = (relativePath: string, reason: SnapshotReason, force: boolean) => {
    const disk = document(relativePath);
    const latest = [...versions.values()]
      .filter((version) => version.snapshot.notePath === relativePath)
      .sort((left, right) => right.snapshot.createdMs - left.snapshot.createdMs)[0];
    if (!force && latest?.snapshot.sourceRevision === disk.revision) return;
    if (!force && latest && Date.now() - latest.snapshot.createdMs < recoverySettings.snapshotIntervalMinutes * 60_000) return;
    const id = `${Date.now()}-${versions.size}`;
    versions.set(id, {
      snapshot: {
        id,
        notePath: relativePath,
        createdMs: Date.now(),
        sourceRevision: disk.revision,
        byteLength: new TextEncoder().encode(disk.content).length,
        reason,
      },
      content: disk.content,
    });
  };

  return {
    async loadApplicationSettings() {
      return { value: applicationSettings, warning: applicationSettingsWarning };
    },
    async saveApplicationSettings(value) {
      applicationSettings = structuredClone(value);
      applicationSettingsWarning = null;
    },
    async loadVaultWorkspaceSession(root) {
      return { value: structuredClone(vaultWorkspaceSessions.get(root) ?? null), warning: null };
    },
    async saveVaultWorkspaceSession(root, value) {
      vaultWorkspaceSessions.set(root, structuredClone(value));
    },
    async createTestVault() { return snapshot(); },
    async openTestVault(root) {
      if (root !== demoRoot) throw new Error("The previous vault is unavailable or has moved.");
      return snapshot();
    },
    async listNotes() { return snapshot().notes; },
    async readNote(_root, relativePath) { return document(relativePath); },
    async saveNote(_root, relativePath, content, expectedRevision): Promise<SaveOutcome> {
      const disk = document(relativePath);
      if (disk.revision !== expectedRevision) {
        return { status: "conflict", expectedRevision, disk };
      }
      captureVersion(relativePath, "interval", false);
      files.set(relativePath, content);
      return { status: "saved", previousRevision: expectedRevision, document: document(relativePath) };
    },
    async preserveAndSave(_root, relativePath, content, expectedDiskRevision): Promise<PreservedSaveOutcome> {
      const disk = document(relativePath);
      if (disk.revision !== expectedDiskRevision) {
        return {
          outcome: { status: "conflict", expectedRevision: expectedDiskRevision, disk },
          backupPath: "",
        };
      }
      captureVersion(relativePath, "beforeConflictOverwrite", true);
      files.set(relativePath, content);
      return {
        outcome: { status: "saved", previousRevision: disk.revision, document: document(relativePath) },
        backupPath: `.serein/backups/conflicts/browser/${relativePath}`,
      };
    },
    async saveConflictCopy(_root, relativePath, content) {
      const base = relativePath.replace(/\.md$/i, "");
      let attempt = 1;
      let copy = `${base} (conflict).md`;
      while (files.has(copy)) copy = `${base} (conflict ${++attempt}).md`;
      files.set(copy, content);
      return document(copy);
    },
    async createNote(_root, relativePath, content) {
      ensurePath(relativePath);
      if (!relativePath.toLowerCase().endsWith(".md")) throw new Error("Notes must use the .md extension.");
      if (files.has(relativePath)) throw new Error("A note already exists at that path.");
      files.set(relativePath, content);
      return document(relativePath);
    },
    async createFolder(_root, relativePath): Promise<FolderEntry> {
      ensurePath(relativePath);
      folders.add(relativePath);
      return { relativePath, name: relativePath.split("/").at(-1)! };
    },
    async moveEntry(_root, from, to) {
      ensurePath(from);
      ensurePath(to);
      const content = files.get(from);
      if (content === undefined) throw new Error("Only note moves are available in browser preview.");
      if (files.has(to)) throw new Error("The destination already exists.");
      files.delete(from);
      files.set(to, content);
    },
    async trashEntry(_root, relativePath): Promise<TrashItem> {
      const content = files.get(relativePath);
      if (content === undefined) throw new Error("The note was not found.");
      files.delete(relativePath);
      const id = `${Date.now()}-${trash.size}`;
      const item: TrashItem = {
        id,
        originalPath: relativePath,
        deletedMs: Date.now(),
        kind: "note",
        byteLength: new TextEncoder().encode(content).length,
      };
      trash.set(id, { item, content });
      return item;
    },
    async restoreEntry(_root, record) {
      const entry = trash.get(record.id);
      if (!entry) throw new Error("The trash item is unavailable.");
      if (files.has(record.originalPath)) throw new Error("A file already exists at the original path.");
      files.set(record.originalPath, entry.content);
      trash.delete(record.id);
    },
    async getRecoverySettings() { return { ...recoverySettings }; },
    async setRecoverySettings(_root, settings) {
      recoverySettings = { ...settings };
      return { ...recoverySettings };
    },
    async listNoteVersions(_root, relativePath) {
      return [...versions.values()]
        .map((version) => version.snapshot)
        .filter((version) => version.notePath === relativePath)
        .sort((left, right) => right.createdMs - left.createdMs);
    },
    async previewNoteVersion(_root, id) {
      const version = versions.get(id);
      if (!version) throw new Error("The version is unavailable.");
      return version;
    },
    async compareNoteVersion(_root, id) {
      const version = versions.get(id);
      if (!version) throw new Error("The version is unavailable.");
      const currentContent = document(version.snapshot.notePath).content;
      return {
        snapshot: version.snapshot,
        currentContent,
        snapshotContent: version.content,
        addedLines: currentContent === version.content ? 0 : 1,
        removedLines: currentContent === version.content ? 0 : 1,
      };
    },
    async restoreNoteVersion(_root, id, mode) {
      const version = versions.get(id);
      if (!version) throw new Error("The version is unavailable.");
      if (mode === "copy") {
        const base = version.snapshot.notePath.replace(/\.md$/i, "");
        let attempt = 1;
        let copy = `${base} (restored).md`;
        while (files.has(copy)) copy = `${base} (restored ${++attempt}).md`;
        files.set(copy, version.content);
        return { document: document(copy), preservedSnapshotId: null, restoredAsCopy: true };
      }
      captureVersion(version.snapshot.notePath, "beforeRestore", true);
      files.set(version.snapshot.notePath, version.content);
      const preservedSnapshotId = [...versions.keys()].at(-1) ?? null;
      return { document: document(version.snapshot.notePath), preservedSnapshotId, restoredAsCopy: false };
    },
    async listTrash() { return [...trash.values()].map((entry) => entry.item); },
    async restoreTrash(_root, ids, policy) {
      return ids.map((id) => {
        const entry = trash.get(id);
        if (!entry) throw new Error("The trash item is unavailable.");
        let restoredPath = entry.item.originalPath;
        if (files.has(restoredPath)) {
          if (policy === "original") throw new Error("A file already exists at the original path.");
          const base = restoredPath.replace(/\.md$/i, "");
          let attempt = 1;
          restoredPath = `${base} (restored).md`;
          while (files.has(restoredPath)) restoredPath = `${base} (restored ${++attempt}).md`;
        }
        files.set(restoredPath, entry.content);
        trash.delete(id);
        return { id, restoredPath };
      });
    },
    async deleteTrash(_root, ids) {
      ids.forEach((id) => trash.delete(id));
      return ids.length;
    },
    async emptyTrash() {
      const count = trash.size;
      trash.clear();
      return count;
    },
    async cleanupRecovery(): Promise<CleanupSummary> {
      return { removedVersions: 0, removedTrashItems: 0, reclaimedBytes: 0 };
    },
    async getAttachmentSettings() { return { directory: attachmentDirectory }; },
    async setAttachmentDirectory(_root, directory) {
      ensurePath(directory);
      attachmentDirectory = directory;
      folders.add(directory);
      return { directory };
    },
    async importAttachmentBytes(_root, notePath, fileName, mediaType, bytes) {
      return importBytes(notePath, fileName, mediaType, bytes);
    },
    async importAttachmentPath() {
      throw new Error("Native file-path drops are available in the packaged Tauri app.");
    },
    async rollbackAttachmentImport(_root, relativePath) {
      return attachments.delete(relativePath);
    },
    async moveAttachmentAndRepair(_root, from, to) {
      const attachment = attachments.get(from);
      if (!attachment) throw new Error("The preview attachment was not found.");
      if (attachments.has(to)) throw new Error("The destination already exists.");
      attachments.delete(from);
      attachments.set(to, attachment);
      const updatedNotes: NoteDocument[] = [];
      for (const [notePath, content] of files) {
        const oldTarget = relativeAttachmentLink(notePath, from);
        const nextTarget = relativeAttachmentLink(notePath, to);
        const updated = content.split(oldTarget).join(nextTarget);
        if (updated !== content) {
          files.set(notePath, updated);
          updatedNotes.push(document(notePath));
        }
      }
      return { relativePath: to, updatedNotes };
    },
    async scanAttachmentIssues() { return attachmentIssues; },
    async repairAttachmentIssue(_root, issue) {
      if (!issue.suggestedPath) throw new Error("No reliable repair is available.");
      const content = files.get(issue.notePath);
      if (content === undefined) throw new Error("The note was not found.");
      const repaired = content.replace(issue.brokenTarget, relativeAttachmentLink(issue.notePath, issue.suggestedPath));
      if (repaired === content) throw new Error("The attachment reference changed before repair.");
      files.set(issue.notePath, repaired);
      attachmentIssues = attachmentIssues.filter((candidate) => candidate !== issue);
      return document(issue.notePath);
    },
    async listAttachments() {
      return [...attachments].map(([relativePath, attachment]) => ({
        relativePath,
        byteLength: attachment.bytes.length,
        referenced: [...files.values()].some((content) => content.includes(relativePath.split("/").at(-1)!)),
      }));
    },
    async attachmentPreviewUrl(_root, relativePath) {
      const attachment = attachments.get(relativePath);
      if (!attachment) throw new Error("The preview attachment was not found.");
      const binary = String.fromCharCode(...attachment.bytes);
      return `data:${attachment.mediaType};base64,${btoa(binary)}`;
    },
    async syncSearchIndex() {
      return { indexedNotes: files.size, updatedNotes: files.size, removedNotes: 0, durationMs: 0 };
    },
    async rebuildSearchIndex() {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      return { indexedNotes: files.size, updatedNotes: files.size, removedNotes: 0, durationMs: 0 };
    },
    async updateSearchEntry() {},
    async search(_root, query, limit = 50): Promise<SearchResult[]> {
      const needle = query.trim().toLocaleLowerCase();
      if (!needle) return [];
      return [...files.entries()].flatMap(([relativePath, content]) => {
        const searchable = content.toLocaleLowerCase().includes(needle) ? content : relativePath;
        const index = searchable.toLocaleLowerCase().indexOf(needle);
        if (index < 0) return [];
        const before = searchable.slice(Math.max(0, index - 45), index);
        const match = searchable.slice(index, index + needle.length);
        const after = searchable.slice(index + needle.length, index + needle.length + 90);
        return [{
          relativePath,
          title: relativePath.split("/").at(-1)!.replace(/\.md$/i, ""),
          snippet: [
            ...(before ? [{ text: before, matched: false }] : []),
            { text: match, matched: true },
            ...(after ? [{ text: after, matched: false }] : []),
          ],
          rank: 0,
        }];
      }).slice(0, limit);
    },
    async searchStatus() {
      return { ready: true, indexedNotes: files.size, updatedMs: Date.now() };
    },
    async startWatch() { return "browser-preview"; },
    async stopWatch() { return true; },
    async onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async simulateExternalEdit(relativePath, content) {
      files.set(relativePath, content);
      for (const listener of listeners) {
        listener({ relativePath, kind: "modified", origin: "external" });
      }
    },
    async simulateExternalAttachmentMove(from, to) {
      const attachment = attachments.get(from);
      if (!attachment) throw new Error("The preview attachment was not found.");
      attachments.delete(from);
      attachments.set(to, attachment);
      attachmentIssues = [...files].flatMap(([notePath, content]) => {
        const brokenTarget = relativeAttachmentLink(notePath, from);
        return content.includes(brokenTarget) ? [{ notePath, brokenTarget, suggestedPath: to }] : [];
      });
      for (const listener of listeners) {
        listener({ relativePath: from, kind: "removed", origin: "external" });
        listener({ relativePath: to, kind: "created", origin: "external" });
      }
    },
    readDemoFile(relativePath) {
      return files.get(relativePath);
    },
    seedApplicationSettings(value, warning = null) {
      applicationSettings = structuredClone(value);
      applicationSettingsWarning = warning;
    },
  };
}

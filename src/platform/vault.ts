import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface NoteEntry {
  relativePath: string;
  fileName: string;
  byteLength: number;
  modifiedMs: number;
}

export interface NoteDocument {
  relativePath: string;
  content: string;
  revision: string;
  modifiedMs: number;
}

export interface VaultSnapshot {
  root: string;
  notes: NoteEntry[];
  folders: FolderEntry[];
}

export interface FolderEntry {
  relativePath: string;
  name: string;
}

export interface TrashRecord {
  id: string;
  originalPath: string;
  trashedPath: string;
  kind: "note" | "folder";
}

export interface RecoverySettings {
  snapshotIntervalMinutes: number;
  retentionDays: number;
  maxStorageBytes: number;
  automaticCleanup: boolean;
  trashRetentionDays: number | null;
}

export type SnapshotReason =
  | "interval"
  | "manual"
  | "beforeConflictOverwrite"
  | "beforeRestore"
  | "beforeReplacement";

export interface VersionSnapshot {
  id: string;
  notePath: string;
  createdMs: number;
  sourceRevision: string;
  byteLength: number;
  reason: SnapshotReason;
}

export interface VersionPreview {
  snapshot: VersionSnapshot;
  content: string;
}

export interface VersionComparison {
  snapshot: VersionSnapshot;
  currentContent: string;
  snapshotContent: string;
  addedLines: number;
  removedLines: number;
}

export type VersionRestoreMode = "replaceCurrent" | "copy";

export interface VersionRestore {
  document: NoteDocument;
  preservedSnapshotId: string | null;
  restoredAsCopy: boolean;
}

export interface TrashItem {
  id: string;
  originalPath: string;
  deletedMs: number;
  kind: "note" | "folder";
  byteLength: number;
}

export type TrashRestorePolicy = "original" | "alternate";

export interface TrashRestoreResult {
  id: string;
  restoredPath: string;
}

export interface CleanupSummary {
  removedVersions: number;
  removedTrashItems: number;
  reclaimedBytes: number;
}

export interface PreservedSaveOutcome {
  outcome: SaveOutcome;
  backupPath: string;
}

export type SaveOutcome =
  | {
      status: "saved";
      document: NoteDocument;
      previousRevision: string;
    }
  | {
      status: "conflict";
      expectedRevision: string;
      disk: NoteDocument;
    };

export interface VaultChange {
  relativePath: string;
  kind: "created" | "modified" | "removed" | "accessed" | "other";
  origin: "serein" | "external";
}

export interface SearchSpan {
  text: string;
  matched: boolean;
}

export interface SearchResult {
  relativePath: string;
  title: string;
  snippet: SearchSpan[];
  rank: number;
}

export interface IndexSummary {
  indexedNotes: number;
  updatedNotes: number;
  removedNotes: number;
  durationMs: number;
}

export interface IndexStatus {
  ready: boolean;
  indexedNotes: number;
  updatedMs: number;
}

export interface AttachmentSettings {
  directory: string;
}

export interface AttachmentImport {
  relativePath: string;
  markdown: string;
  displayName: string;
  created: boolean;
  rollbackToken: string | null;
}

export interface AttachmentMoveResult {
  relativePath: string;
  updatedNotes: NoteDocument[];
}

export interface AttachmentIssue {
  notePath: string;
  brokenTarget: string;
  suggestedPath: string | null;
}

export interface AttachmentInventoryEntry {
  relativePath: string;
  byteLength: number;
  referenced: boolean;
}

export interface StoredJsonDocument {
  value: unknown | null;
  warning: string | null;
}

export interface VaultPort {
  loadApplicationSettings(): Promise<StoredJsonDocument>;
  saveApplicationSettings(value: unknown): Promise<void>;
  loadVaultWorkspaceSession(root: string): Promise<StoredJsonDocument>;
  saveVaultWorkspaceSession(root: string, value: unknown): Promise<void>;
  createTestVault(): Promise<VaultSnapshot>;
  openTestVault(root: string): Promise<VaultSnapshot>;
  listNotes(root: string): Promise<NoteEntry[]>;
  readNote(root: string, relativePath: string): Promise<NoteDocument>;
  saveNote(root: string, relativePath: string, content: string, expectedRevision: string): Promise<SaveOutcome>;
  preserveAndSave(root: string, relativePath: string, content: string, expectedDiskRevision: string): Promise<PreservedSaveOutcome>;
  saveConflictCopy(root: string, relativePath: string, content: string): Promise<NoteDocument>;
  createNote(root: string, relativePath: string, content: string): Promise<NoteDocument>;
  createFolder(root: string, relativePath: string): Promise<FolderEntry>;
  moveEntry(root: string, from: string, to: string): Promise<void>;
  trashEntry(root: string, relativePath: string): Promise<TrashItem>;
  restoreEntry(root: string, record: TrashRecord): Promise<void>;
  getRecoverySettings(root: string): Promise<RecoverySettings>;
  setRecoverySettings(root: string, settings: RecoverySettings): Promise<RecoverySettings>;
  listNoteVersions(root: string, relativePath: string): Promise<VersionSnapshot[]>;
  previewNoteVersion(root: string, id: string): Promise<VersionPreview>;
  compareNoteVersion(root: string, id: string): Promise<VersionComparison>;
  restoreNoteVersion(root: string, id: string, mode: VersionRestoreMode): Promise<VersionRestore>;
  listTrash(root: string): Promise<TrashItem[]>;
  restoreTrash(root: string, ids: string[], policy: TrashRestorePolicy): Promise<TrashRestoreResult[]>;
  deleteTrash(root: string, ids: string[]): Promise<number>;
  emptyTrash(root: string): Promise<number>;
  cleanupRecovery(root: string): Promise<CleanupSummary>;
  getAttachmentSettings(root: string): Promise<AttachmentSettings>;
  setAttachmentDirectory(root: string, directory: string): Promise<AttachmentSettings>;
  importAttachmentBytes(root: string, notePath: string, fileName: string, mediaType: string, bytes: number[]): Promise<AttachmentImport>;
  importAttachmentPath(root: string, notePath: string, sourcePath: string): Promise<AttachmentImport>;
  rollbackAttachmentImport(root: string, relativePath: string, rollbackToken: string): Promise<boolean>;
  moveAttachmentAndRepair(root: string, from: string, to: string): Promise<AttachmentMoveResult>;
  scanAttachmentIssues(root: string): Promise<AttachmentIssue[]>;
  repairAttachmentIssue(root: string, issue: AttachmentIssue): Promise<NoteDocument>;
  listAttachments(root: string): Promise<AttachmentInventoryEntry[]>;
  attachmentPreviewUrl(root: string, relativePath: string): Promise<string>;
  syncSearchIndex(root: string): Promise<IndexSummary>;
  rebuildSearchIndex(root: string): Promise<IndexSummary>;
  updateSearchEntry(root: string, relativePath: string, kind: VaultChange["kind"]): Promise<void>;
  search(root: string, query: string, limit?: number): Promise<SearchResult[]>;
  searchStatus(root: string): Promise<IndexStatus>;
  startWatch(root: string): Promise<string>;
  stopWatch(watchId: string): Promise<boolean>;
  onChange(listener: (change: VaultChange) => void): Promise<UnlistenFn>;
}

export const nativeVault: VaultPort = {
  loadApplicationSettings: () => invoke<StoredJsonDocument>("load_application_settings"),
  saveApplicationSettings: (value) => invoke<void>("save_application_settings", { value }),
  loadVaultWorkspaceSession: (root) => invoke<StoredJsonDocument>("load_vault_workspace_session", { root }),
  saveVaultWorkspaceSession: (root, value) => invoke<void>("save_vault_workspace_session", { root, value }),
  createTestVault: () => invoke<VaultSnapshot>("create_test_vault"),
  openTestVault: (root: string) =>
    invoke<VaultSnapshot>("open_test_vault", { root }),
  listNotes: (root: string) =>
    invoke<NoteEntry[]>("list_vault_notes", { root }),
  readNote: (root: string, relativePath: string) =>
    invoke<NoteDocument>("read_vault_note", { root, relativePath }),
  saveNote: (
    root: string,
    relativePath: string,
    content: string,
    expectedRevision: string,
  ) =>
    invoke<SaveOutcome>("save_vault_note", {
      root,
      relativePath,
      content,
      expectedRevision,
    }),
  preserveAndSave: (root, relativePath, content, expectedDiskRevision) =>
    invoke<PreservedSaveOutcome>("preserve_and_save_vault_note", {
      root,
      relativePath,
      content,
      expectedDiskRevision,
    }),
  saveConflictCopy: (root, relativePath, content) =>
    invoke<NoteDocument>("save_vault_note_copy", { root, relativePath, content }),
  createNote: (root, relativePath, content) =>
    invoke<NoteDocument>("create_vault_note", { root, relativePath, content }),
  createFolder: (root, relativePath) =>
    invoke<FolderEntry>("create_vault_folder", { root, relativePath }),
  moveEntry: (root, from, to) =>
    invoke<void>("move_vault_entry", { root, from, to }),
  trashEntry: (root, relativePath) =>
    invoke<TrashItem>("trash_vault_entry", { root, relativePath }),
  restoreEntry: (root, record) =>
    invoke<void>("restore_vault_entry", { root, record }),
  getRecoverySettings: (root) =>
    invoke<RecoverySettings>("get_recovery_settings", { root }),
  setRecoverySettings: (root, settings) =>
    invoke<RecoverySettings>("set_recovery_settings", { root, settings }),
  listNoteVersions: (root, relativePath) =>
    invoke<VersionSnapshot[]>("list_note_versions", { root, relativePath }),
  previewNoteVersion: (root, id) =>
    invoke<VersionPreview>("preview_note_version", { root, id }),
  compareNoteVersion: (root, id) =>
    invoke<VersionComparison>("compare_note_version", { root, id }),
  restoreNoteVersion: (root, id, mode) =>
    invoke<VersionRestore>("restore_note_version", { root, id, mode }),
  listTrash: (root) =>
    invoke<TrashItem[]>("list_recovery_trash", { root }),
  restoreTrash: (root, ids, policy) =>
    invoke<TrashRestoreResult[]>("restore_recovery_trash", { root, ids, policy }),
  deleteTrash: (root, ids) =>
    invoke<number>("delete_recovery_trash", { root, ids }),
  emptyTrash: (root) =>
    invoke<number>("empty_recovery_trash", { root }),
  cleanupRecovery: (root) =>
    invoke<CleanupSummary>("cleanup_recovery", { root }),
  getAttachmentSettings: (root) =>
    invoke<AttachmentSettings>("get_attachment_settings", { root }),
  setAttachmentDirectory: (root, directory) =>
    invoke<AttachmentSettings>("set_attachment_directory", { root, directory }),
  importAttachmentBytes: (root, notePath, fileName, mediaType, bytes) =>
    invoke<AttachmentImport>("import_attachment_bytes", { root, notePath, fileName, mediaType, bytes }),
  importAttachmentPath: (root, notePath, sourcePath) =>
    invoke<AttachmentImport>("import_attachment_path", { root, notePath, sourcePath }),
  rollbackAttachmentImport: (root, relativePath, rollbackToken) =>
    invoke<boolean>("rollback_attachment_import", { root, relativePath, rollbackToken }),
  moveAttachmentAndRepair: (root, from, to) =>
    invoke<AttachmentMoveResult>("move_attachment_and_repair", { root, from, to }),
  scanAttachmentIssues: (root) =>
    invoke<AttachmentIssue[]>("scan_attachment_issues", { root }),
  repairAttachmentIssue: (root, issue) =>
    invoke<NoteDocument>("repair_attachment_issue", { root, issue }),
  listAttachments: (root) =>
    invoke<AttachmentInventoryEntry[]>("list_attachments", { root }),
  attachmentPreviewUrl: async (root, relativePath) =>
    convertFileSrc(await invoke<string>("attachment_preview_path", { root, relativePath })),
  syncSearchIndex: (root) =>
    invoke<IndexSummary>("sync_vault_search", { root }),
  rebuildSearchIndex: (root) =>
    invoke<IndexSummary>("rebuild_vault_search", { root }),
  updateSearchEntry: (root, relativePath, kind) =>
    invoke<void>("update_vault_search_entry", { root, relativePath, kind }),
  search: (root, query, limit = 50) =>
    invoke<SearchResult[]>("search_vault", { root, query, limit }),
  searchStatus: (root) =>
    invoke<IndexStatus>("vault_search_status", { root }),
  startWatch: (root: string) =>
    invoke<string>("start_vault_watch", { root }),
  stopWatch: (watchId: string) =>
    invoke<boolean>("stop_vault_watch", { watchId }),
  onChange: (listener) =>
    listen<VaultChange>("vault://filesystem-change", (event) => listener(event.payload)),
};

import {
  AlertTriangle, CalendarDays, CheckSquare, ChevronDown, ChevronRight, File, FileClock,
  ArchiveRestore, Copy, FilePlus2, FileText, Folder, FolderInput, FolderPlus, GitCompare, History,
  Maximize2, Minimize2, PanelRightClose, PanelRightOpen, Paperclip, Pencil, Pin, RefreshCw, RotateCcw, Search, Settings,
  Share2, ShieldCheck, Trash2, X,
} from "lucide-react";
import {
  type CSSProperties, type DragEvent, type FormEvent, type MouseEvent, useEffect, useMemo, useRef, useState,
} from "react";

import { CommandLauncher } from "./commands/CommandLauncher";
import {
  CommandRegistry, commandDefinitions, commandForShortcut, createDefaultShortcutBindings,
  eventToShortcut, type ShortcutBindings,
} from "./commands/commandRegistry";
import { EditorSessionCache, MarkdownEditor } from "./editor/MarkdownEditor";
import { createBrowserDemoVault } from "./platform/browserDemoVault";
import {
  nativeVault, type AttachmentInventoryEntry, type AttachmentIssue, type AttachmentSettings,
  type IndexSummary, type NoteEntry, type RecoverySettings, type SearchResult, type TrashItem,
  type TrashRestorePolicy, type VersionComparison, type VersionPreview, type VersionSnapshot, type VaultPort,
} from "./platform/vault";
import type { NoteConflict } from "./vault/VaultWorkspaceController";
import { useVaultWorkspace } from "./vault/useVaultWorkspace";
import { SettingsDialog } from "./settings/SettingsDialog";
import {
  createDefaultApplicationSettings, exportApplicationSettings, importApplicationSettings,
  migrateApplicationSettings, resetAppearance, type ApplicationSettings,
} from "./settings/applicationSettings";
import {
  createWorkspaceState, layoutPresets, switchLayout, switchLayoutPreset, updateLayoutPanel,
  type LayoutPreset, type LayoutPresetId, type PanelId, type WorkspaceSession,
} from "./workspace/layoutPresets";
import {
  activateTab, activeSessionPath, closeOtherTabs, closeTab, closeTabsToRight, createNoteSessions,
  moveTabToGroup, openTab, promoteTab, removeMissingSessions, reorderTab, reopenClosedTab,
  serializeNoteSessions, setPreviewTabsEnabled, updateEditorViewState, type EditorGroupId, type EditorMode,
} from "./workspace/noteSessions";
import { TabStrip } from "./workspace/TabStrip";
import { createVaultWorkspaceSession, restoreVaultWorkspaceSession } from "./workspace/workspacePersistence";

const emptySession: WorkspaceSession = {
  activeNoteId: null, openTabIds: [], cursorByNote: {}, scrollByNote: {},
  undoDepthByNote: {}, dirtyNoteIds: [],
};
const nativeRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const defaultPort = nativeRuntime ? nativeVault : createBrowserDemoVault();

type ResolvedTheme = "dark" | "light";

function readSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function useSystemTheme(): ResolvedTheme {
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(readSystemTheme);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setSystemTheme(query.matches ? "light" : "dark");
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener?.(update);
    return () => query.removeListener?.(update);
  }, []);

  return systemTheme;
}
type ExplorerAction = "note" | "folder" | "rename" | "move" | "trash";
type ExplorerEntry = { kind: "note" | "folder"; path: string };

function cx(...names: Array<string | false | undefined>) {
  return names.filter(Boolean).join(" ");
}
function noteTitle(path: string | null) {
  return path ? (path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path) : "No note open";
}
function parentPath(path: string | null) {
  return path?.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "Vault root";
}
function formatBytes(bytes: number) {
  return bytes < 1024 ? String(bytes) + " B" : (bytes / 1024).toFixed(1) + " KB";
}
function displayPath(path: string | null) {
  return path?.replace(/^\\\\\?\\/, "") ?? "Opening synthetic vault…";
}
function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function pathName(path: string) {
  return path.split("/").at(-1) ?? path;
}

function joinVaultPath(parent: string, name: string) {
  return parent ? `${parent}/${name}` : name;
}

function vaultParentPath(path: string) {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function Ribbon(props: {
  activeView: "notes" | "trash"; settingsOpen: boolean; searchOpen: boolean;
  hiddenItems: string[];
  onFiles: () => void; onTrash: () => void; onSettingsToggle: () => void; onSearchToggle: () => void;
}) {
  const actions = [
    ["files", FileText, "Files", false, props.onFiles, props.activeView === "notes" && !props.searchOpen],
    ["search", Search, "Search", false, props.onSearchToggle],
    ["trash", Trash2, "Open Trash", false, props.onTrash, props.activeView === "trash"],
    ["tasks", CheckSquare, "Tasks — Phase 2", true],
    ["calendar", CalendarDays, "Calendar — Phase 2", true],
    ["graph", Share2, "Graph — Phase 3", true],
  ] as const;
  return (
    <nav className="ribbon" aria-label="Primary tools">
      <div className="ribbon-actions">
        {actions.filter(([id]) => !props.hiddenItems.includes(id)).map(([, Icon, label, disabled, onClick, selected], index) => (
          <button className={cx("icon-button", (selected || index === 1 && props.searchOpen) && "is-active")} aria-label={label}
            aria-pressed={index === 1 ? props.searchOpen : undefined} disabled={disabled} onClick={onClick} title={label} key={label} type="button">
            <Icon aria-hidden="true" />
          </button>
        ))}
      </div>
      <button className={cx("icon-button", props.settingsOpen && "is-active")} aria-label="Settings"
        aria-pressed={props.settingsOpen} onClick={props.onSettingsToggle} title="Settings" type="button">
        <Settings aria-hidden="true" />
      </button>
    </nav>
  );
}

type SearchIndexState =
  | { phase: "waiting" | "indexing"; summary: null; error: null }
  | { phase: "ready"; summary: IndexSummary; error: null }
  | { phase: "error"; summary: null; error: string };

function SearchPanel(props: {
  indexState: SearchIndexState;
  onClose: () => void;
  onOpen: (path: string) => Promise<void>;
  onRebuild: () => Promise<void>;
  port: VaultPort;
  root: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]); setSearching(false); setError(null); return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      setSearching(true); setError(null);
      void props.port.search(props.root, trimmed, 75).then((matches) => {
        if (current) setResults(matches);
      }).catch((caught) => {
        if (current) setError(caught instanceof Error ? caught.message : String(caught));
      }).finally(() => { if (current) setSearching(false); });
    }, 140);
    return () => { current = false; window.clearTimeout(timer); };
  }, [props.indexState.phase, props.port, props.root, query]);

  async function openResult(path: string) {
    await props.onOpen(path);
  }

  const indexedCount = props.indexState.phase === "ready" ? props.indexState.summary.indexedNotes : 0;
  const panelError = error ?? (props.indexState.phase === "error" ? props.indexState.error : null);
  return (
    <aside className="search-panel" aria-label="Vault search">
      <header className="search-header">
        <div><h2>Search vault</h2><p>Find text, paths, headings, tags, tasks, and attachment names.</p></div>
        <div className="search-header-actions">
          <button className="icon-button" aria-label="Rebuild search index" disabled={props.indexState.phase === "indexing"}
            onClick={() => void props.onRebuild()} title="Rebuild disposable index" type="button"><RefreshCw /></button>
          <button className="icon-button" aria-label="Close search" onClick={props.onClose} type="button"><X /></button>
        </div>
      </header>
      <div className="search-field-wrap"><Search aria-hidden="true" />
        <input ref={inputRef} aria-label="Search vault" onChange={(event) => setQuery(event.target.value)}
          placeholder="Search all Markdown notes…" type="search" value={query} />
        <kbd>Ctrl Shift F</kbd>
      </div>
      <div className="search-status" aria-live="polite">
        <span>{props.indexState.phase === "indexing" ? "Updating search index in the background…" :
          props.indexState.phase === "error" ? "Search index needs attention" :
            `${indexedCount.toLocaleString()} ${indexedCount === 1 ? "note" : "notes"} indexed`}</span>
        {query.trim() && !panelError ? <span>{searching ? "Searching…" : `${results.length} ${results.length === 1 ? "result" : "results"}`}</span> : null}
      </div>
      <div className="search-results" aria-label="Search results">
        {panelError ? <div className="search-message search-error" role="alert">
          <strong>Search could not finish.</strong><span>{panelError}</span></div> : null}
        {!panelError && !query.trim() ? <div className="search-message"><Search aria-hidden="true" />
          <strong>Search the whole synthetic vault</strong><span>Your Markdown stays authoritative; this index can be deleted and rebuilt at any time.</span></div> : null}
        {!panelError && query.trim() && !searching && !results.length ? <div className="search-message">
          <strong>No matches</strong><span>Try a filename, phrase, tag, task, or attachment name.</span></div> : null}
        {!panelError ? results.map((result) => (
          <button className="search-result" aria-label={`${result.title} — ${result.relativePath}`}
            onClick={() => void openResult(result.relativePath)} key={result.relativePath} type="button">
            <span className="search-result-heading"><strong>{result.title}</strong><span>{result.relativePath}</span></span>
            <span className="search-result-snippet">{result.snippet.map((span, index) => span.matched
              ? <mark role="mark" key={index}>{span.text}</mark>
              : <span key={index}>{span.text}</span>)}</span>
          </button>
        )) : null}
      </div>
    </aside>
  );
}

/* Settings is implemented in src/settings/SettingsDialog.tsx so every category shares
   the same dense row, control, and navigation grammar. */
function NoteRow(props: {
  activePath: string | null; depth?: number; note: NoteEntry; onOpen: (path: string) => Promise<void>;
  onPromote?: (path: string) => void;
  onContext: (entry: ExplorerEntry, event: MouseEvent<HTMLElement>) => void;
  onDragStart: (entry: ExplorerEntry, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const entry: ExplorerEntry = { kind: "note", path: props.note.relativePath };
  return (
    <button className={cx("tree-row", "tree-note", props.note.relativePath === props.activePath && "is-selected")}
      draggable
      style={{ paddingInlineStart: String(30 + (props.depth ?? 0) * 18) + "px" }}
      onClick={() => void props.onOpen(props.note.relativePath)} onContextMenu={(event) => props.onContext(entry, event)}
      onDoubleClick={() => props.onPromote?.(props.note.relativePath)} onDragEnd={props.onDragEnd}
      onDragStart={(event) => props.onDragStart(entry, event)} title={props.note.relativePath} type="button">
      <File size={14} /><span className="tree-label">{noteTitle(props.note.relativePath)}</span>
    </button>
  );
}

function Explorer(props: {
  activePath: string | null; folders: Array<{ relativePath: string; name: string }>; notes: NoteEntry[];
  onCreateFolder: (path: string) => Promise<void>; onCreateNote: (path: string) => Promise<void>;
  onMove: (from: string, to: string) => Promise<void>; onOpen: (path: string) => Promise<void>;
  onPromote?: (path: string) => void; onTrash: (path: string) => Promise<void>;
}) {
  const [action, setAction] = useState<ExplorerAction | null>(null);
  const [actionTarget, setActionTarget] = useState<ExplorerEntry | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ entry: ExplorerEntry; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<ExplorerEntry | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);

  function beginCreate(next: "note" | "folder", parent = "") {
    setMenu(null); setAction(next); setActionTarget(null); setError(null);
    setValue(joinVaultPath(parent, next === "note" ? "Untitled.md" : "New Folder"));
  }
  function beginEntry(next: "rename" | "move" | "trash", entry: ExplorerEntry) {
    setMenu(null); setAction(next); setActionTarget(entry); setError(null);
    setValue(next === "rename"
      ? entry.kind === "note" ? pathName(entry.path).replace(/\.md$/i, "") : pathName(entry.path)
      : entry.path);
  }
  function openMenu(entry: ExplorerEntry, event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    setMenu({
      entry,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - 226)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - (entry.kind === "folder" ? 290 : 220))),
    });
  }
  function startDrag(entry: ExplorerEntry, event: DragEvent<HTMLElement>) {
    setDragging(entry); setError(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", entry.path);
  }
  async function dropInto(targetFolder: string) {
    const source = dragging;
    setDropTarget(null); setDragging(null);
    if (!source) return;
    if (source.kind === "folder" && (targetFolder === source.path || targetFolder.startsWith(source.path + "/"))) {
      setError("A folder cannot be moved into itself.");
      return;
    }
    const destination = joinVaultPath(targetFolder, pathName(source.path));
    if (destination === source.path) return;
    setBusy(true); setError(null);
    try { await props.onMove(source.path, destination); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }
  async function copyRelativePath(path: string) {
    setMenu(null); setError(null);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard access is unavailable in this window.");
      await navigator.clipboard.writeText(path);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!action) return; setBusy(true); setError(null);
    try {
      if (action === "note") await props.onCreateNote(value);
      if (action === "folder") await props.onCreateFolder(value);
      if (action === "move" && actionTarget) await props.onMove(actionTarget.path, value);
      if (action === "rename" && actionTarget) {
        const name = actionTarget.kind === "note" && !value.toLowerCase().endsWith(".md") ? `${value}.md` : value;
        await props.onMove(actionTarget.path, joinVaultPath(vaultParentPath(actionTarget.path), name));
      }
      if (action === "trash" && actionTarget) await props.onTrash(actionTarget.path);
      setAction(null); setActionTarget(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }
  const rootNotes = props.notes.filter((note) => !note.relativePath.includes("/"));
  const rowProps = {
    activePath: props.activePath, onOpen: props.onOpen, onPromote: props.onPromote,
    onContext: openMenu, onDragStart: startDrag, onDragEnd: () => { setDragging(null); setDropTarget(null); },
  };
  return (
    <section className="explorer-section" aria-label="Vault explorer">
      <div className={cx("section-heading", "vault-heading", dropTarget === "" && "is-drop-target")}
        onDragLeave={() => setDropTarget(null)} onDragOver={(event) => { if (dragging) { event.preventDefault(); setDropTarget(""); } }}
        onDrop={(event) => { event.preventDefault(); void dropInto(""); }}><span>Synthetic Vault</span><ChevronDown size={14} />
        <span className="explorer-heading-actions">
          <button className="plain-icon" aria-label="Create note" onClick={() => beginCreate("note", "Notes")} title="Create note" type="button"><FilePlus2 /></button>
          <button className="plain-icon" aria-label="Create folder" onClick={() => beginCreate("folder")} title="Create folder" type="button"><FolderPlus /></button>
        </span>
      </div>
      {action ? (
        <form className="explorer-action" onSubmit={submit}>
          <label htmlFor="explorer-path">{action === "trash" ? `Move ${pathName(actionTarget?.path ?? "this item")} to vault Trash?`
            : action === "rename" ? "New name" : action === "move" ? "New path" : action === "folder" ? "Folder path" : "Note path"}</label>
          {action !== "trash" ? <input id="explorer-path" autoFocus value={value} onChange={(event) => setValue(event.target.value)} /> : null}
          {error ? <p role="alert">{error}</p> : null}
          <div><button disabled={busy} type="submit">{busy ? "Working…" : action === "trash" ? "Move to Trash" : "Apply"}</button>
            <button disabled={busy} onClick={() => { setAction(null); setActionTarget(null); }} type="button">Cancel</button></div>
        </form>
      ) : null}
      {!action && error ? <p className="explorer-inline-error" role="alert">{error}</p> : null}
      <div className="folder-tree">
        {rootNotes.map((note) => <NoteRow {...rowProps} note={note} key={note.relativePath} />)}
        {props.folders.map((folder) => {
          const nested = props.notes.filter((note) => parentPath(note.relativePath) === folder.relativePath);
          const depth = folder.relativePath.split("/").length - 1;
          const entry: ExplorerEntry = { kind: "folder", path: folder.relativePath };
          return (
            <div className="tree-group" key={folder.relativePath}>
              <button className={cx("tree-row", "tree-folder", dropTarget === folder.relativePath && "is-drop-target")}
                draggable onContextMenu={(event) => openMenu(entry, event)} onDragEnd={rowProps.onDragEnd}
                onDragLeave={() => setDropTarget(null)} onDragOver={(event) => { if (dragging) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(folder.relativePath); } }}
                onDragStart={(event) => startDrag(entry, event)} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void dropInto(folder.relativePath); }}
                style={{ paddingInlineStart: String(12 + depth * 18) + "px" }} type="button">
                <ChevronDown size={12} /><Folder size={15} /><span className="tree-label">{folder.name}</span><span className="tree-count">{nested.length}</span>
              </button>
              {nested.map((note) => <NoteRow {...rowProps} depth={depth + 1} note={note} key={note.relativePath} />)}
            </div>
          );
        })}
        {!props.notes.length && !props.folders.length ? <p className="panel-empty">No Markdown notes yet.</p> : null}
      </div>
      {menu ? <div className="explorer-context-menu" onPointerDown={(event) => event.stopPropagation()} role="menu" style={{ left: menu.x, top: menu.y }}>
        {menu.entry.kind === "folder" ? <>
          <button onClick={() => beginCreate("note", menu.entry.path)} role="menuitem" type="button"><FilePlus2 />New note</button>
          <button onClick={() => beginCreate("folder", menu.entry.path)} role="menuitem" type="button"><FolderPlus />New folder</button>
          <span className="context-menu-separator" role="separator" />
        </> : null}
        <button onClick={() => beginEntry("rename", menu.entry)} role="menuitem" type="button"><Pencil />Rename…</button>
        <button onClick={() => beginEntry("move", menu.entry)} role="menuitem" type="button"><FolderInput />Move to…</button>
        <button onClick={() => void copyRelativePath(menu.entry.path)} role="menuitem" type="button"><Copy />Copy relative path</button>
        <span className="context-menu-separator" role="separator" />
        <button className="is-danger" onClick={() => beginEntry("trash", menu.entry)} role="menuitem" type="button"><Trash2 />Move to Trash</button>
      </div> : null}
    </section>
  );
}

function RecentNotes(props: { activePath: string | null; notes: NoteEntry[]; onOpen: (path: string) => Promise<void> }) {
  return (
    <section className="recent-section" aria-label="Recent notes"><div className="section-heading"><span>Recent Notes</span></div>
      <div className="recent-list">{[...props.notes].sort((a, b) => b.modifiedMs - a.modifiedMs).slice(0, 6).map((note) => (
        <button className={cx("recent-row", note.relativePath === props.activePath && "is-current")}
          onClick={() => void props.onOpen(note.relativePath)} key={note.relativePath} type="button">
          <File size={14} /><span>{noteTitle(note.relativePath)}</span><time>{formatBytes(note.byteLength)}</time>
        </button>
      ))}</div>
    </section>
  );
}

function NoteList(props: { activePath: string | null; notes: NoteEntry[]; onOpen: (path: string) => Promise<void> }) {
  return (
    <aside className="note-list-panel" aria-label="Note previews">
      <div className="note-list-toolbar"><strong>All Notes</strong><span>{props.notes.length}</span></div>
      <div className="note-card-list">{props.notes.map((note) => (
        <button className={cx("note-card", note.relativePath === props.activePath && "is-selected")}
          onClick={() => void props.onOpen(note.relativePath)} key={note.relativePath} type="button">
          <span className="note-card-title">{noteTitle(note.relativePath)}</span>
          <span className="note-card-snippet">{note.relativePath}</span>
          <span className="note-card-meta"><time>{formatBytes(note.byteLength)}</time><FileText size={13} /></span>
        </button>
      ))}{!props.notes.length ? <p className="panel-empty">Create a Markdown note to see it here.</p> : null}</div>
    </aside>
  );
}

function FileDetails(props: { activePath: string | null; note?: NoteEntry; root: string | null }) {
  return (
    <aside className="context-rail" aria-label="Note context">
      <section className="file-details"><div className="section-heading"><span>File details</span></div>
        <dl><div><dt>Name</dt><dd>{noteTitle(props.activePath)}</dd></div>
          <div><dt>Folder</dt><dd>{parentPath(props.activePath)}</dd></div>
          <div><dt>Size</dt><dd>{props.note ? formatBytes(props.note.byteLength) : "—"}</dd></div>
          <div><dt>Modified</dt><dd>{props.note ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(props.note.modifiedMs) : "—"}</dd></div>
        </dl><p className="vault-location" title={displayPath(props.root)}>{displayPath(props.root)}</p>
      </section>
      <section className="deferred-panel"><strong>Core milestone</strong>
        <p>Calendar, tasks, backlinks, and graph stay deferred while local editing is being proven.</p></section>
    </aside>
  );
}

function resolveVaultAttachment(notePath: string, target: string) {
  if (target.startsWith("#") || target.includes("://") || target.startsWith("data:")) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(target.replace(/^<|>$/g, "")); }
  catch { return null; }
  const stack = notePath.split("/").slice(0, -1);
  for (const part of decoded.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!stack.pop()) return null; }
    else stack.push(part);
  }
  return stack.join("/");
}

function LazyAttachmentImage(props: { alt: string; path: string; port: VaultPort; root: string }) {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    void props.port.attachmentPreviewUrl(props.root, props.path).then((url) => {
      if (current) setSource(url);
    }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [props.path, props.port, props.root]);
  if (failed) return <span className="attachment-preview-failed"><Paperclip />Preview unavailable · {props.path}</span>;
  if (!source) return <span className="attachment-preview-loading" role="status">Loading image preview…</span>;
  return <figure className="attachment-preview"><img alt={props.alt} decoding="async" loading="lazy" src={source} /><figcaption>{props.path}</figcaption></figure>;
}

function RenderedPreview({ markdown, notePath, port, root }: { markdown: string; notePath: string; port: VaultPort; root: string }) {
  return (
    <article className="rendered-preview" aria-label="Rendered preview">
      {markdown.split(/\r?\n/).map((line, index) => {
        if (!line.trim()) return <div className="preview-spacer" key={index} />;
        if (line.startsWith("# ")) return <h1 key={index}>{line.slice(2)}</h1>;
        if (line.startsWith("## ")) return <h2 key={index}>{line.slice(3)}</h2>;
        const image = line.match(/^!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)\)$/);
        if (image) {
          const path = resolveVaultAttachment(notePath, image[2]);
          return path ? <LazyAttachmentImage alt={image[1]} path={path} port={port} root={root} key={index} /> : <p key={index}>{line}</p>;
        }
        const attachment = line.match(/^\[([^\]]+)\]\((<[^>]+>|[^)\s]+)\)$/);
        if (attachment) return <span className="preview-file-link" key={index}><Paperclip /><span>{attachment[1]}</span><small>{attachment[2]}</small></span>;
        const task = line.match(/^\s*- \[([ xX])\]\s+(.*)$/);
        if (task) return <label className="preview-task" key={index}><input checked={task[1].toLowerCase() === "x"} readOnly type="checkbox" /><span>{task[2]}</span></label>;
        if (/^---+$/.test(line)) return <hr key={index} />;
        return <p key={index}>{line}</p>;
      })}
    </article>
  );
}

function ConflictDialog(props: {
  conflict: NoteConflict;
  onResolve: (action: "keep-mine" | "use-disk" | "save-both" | "merge", merged?: string) => Promise<void>;
}) {
  const [mergeOpen, setMergeOpen] = useState(false);
  const [merged, setMerged] = useState(props.conflict.localContent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function resolve(action: "keep-mine" | "use-disk" | "save-both" | "merge") {
    setBusy(true); setError(null);
    try { await props.onResolve(action, action === "merge" ? merged : undefined); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }
  return (
    <div className="conflict-backdrop"><section className="conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <header><h2 id="conflict-title">File changed outside Serein</h2>
        <p>Both versions are preserved until you choose what happens next.</p></header>
      <div className="conflict-columns">
        <label><span>Your Serein version</span><textarea readOnly value={props.conflict.localContent} /></label>
        <label><span>Disk version</span><textarea readOnly value={props.conflict.disk.content} /></label>
      </div>
      {mergeOpen ? <label className="merge-field"><span>Merged version</span><textarea autoFocus value={merged} onChange={(event) => setMerged(event.target.value)} /></label> : null}
      {error ? <p className="conflict-error" role="alert">{error}</p> : null}
      <footer>
        <button disabled={busy} onClick={() => void resolve("keep-mine")} type="button">Keep Mine</button>
        <button disabled={busy} onClick={() => void resolve("use-disk")} title="Open the disk version and archive your draft as a conflict copy" type="button">Use Disk</button>
        <button disabled={busy} onClick={() => void resolve("save-both")} type="button">Save Both</button>
        {mergeOpen ? <button className="primary-action" disabled={busy} onClick={() => void resolve("merge")} type="button">Save Merged</button>
          : <button className="primary-action" disabled={busy} onClick={() => setMergeOpen(true)} type="button">Compare &amp; Merge</button>}
      </footer>
    </section></div>
  );
}

function ConfirmationDialog(props: { title: string; detail: string; confirmLabel: string; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => Promise<void> }) {
  return <div className="confirmation-backdrop"><section className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-detail">
    <header><span className="destructive-mark"><Trash2 aria-hidden="true" /></span><div><h2 id="confirmation-title">{props.title}</h2><p id="confirmation-detail">{props.detail}</p></div></header>
    <p className="confirmation-warning">This cannot be undone by Serein.</p>
    {props.error ? <p className="confirmation-error" role="alert">{props.error}</p> : null}
    <footer><button disabled={props.busy} onClick={props.onCancel} type="button">Cancel</button>
      <button className="destructive-action" disabled={props.busy} onClick={() => void props.onConfirm()} type="button">{props.busy ? "Deleting…" : props.confirmLabel}</button></footer>
  </section></div>;
}

function TrashWorkspace(props: {
  items: TrashItem[]; activity: { phase: string; message: string };
  onDelete: (items: TrashItem[]) => void; onEmpty: () => void;
  onRefresh: () => Promise<TrashItem[]>; onRestore: (ids: string[], policy: TrashRestorePolicy) => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSelected((ids) => ids.filter((id) => props.items.some((item) => item.id === id))), [props.items]);
  const chosen = props.items.filter((item) => selected.includes(item.id));
  async function restore(policy: TrashRestorePolicy) {
    if (!selected.length) return;
    setBusy(true); setError(null);
    try { await props.onRestore(selected, policy); setSelected([]); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }
  return <section className="trash-workspace" aria-labelledby="trash-heading">
    <header className="trash-header"><div><h1 id="trash-heading">Trash</h1><p>Deleted notes and folders stay recoverable inside this vault.</p></div>
      <div className="trash-header-actions"><button aria-label="Refresh Trash" disabled={busy} onClick={() => void props.onRefresh()} type="button"><RefreshCw />Refresh</button>
        <button className="destructive-quiet" disabled={!props.items.length || busy} onClick={props.onEmpty} type="button">Empty Trash</button></div></header>
    <div className="trash-toolbar"><label><input checked={props.items.length > 0 && selected.length === props.items.length}
      onChange={(event) => setSelected(event.target.checked ? props.items.map((item) => item.id) : [])} type="checkbox" />Select all</label>
      <span>{selected.length ? `${selected.length} selected` : `${props.items.length} ${props.items.length === 1 ? "item" : "items"}`}</span>
      <div><button disabled={!selected.length || busy} onClick={() => void restore("original")} type="button"><ArchiveRestore />Restore</button>
        <button disabled={!selected.length || busy} onClick={() => void restore("alternate")} title="Use a collision-safe name if the original path is occupied" type="button">Restore safely elsewhere</button>
        <button className="destructive-quiet" disabled={!selected.length || busy} onClick={() => props.onDelete(chosen)} type="button"><Trash2 />Delete permanently</button></div></div>
    {error ? <div className="trash-error" role="alert"><strong>Trash operation could not finish.</strong><span>{error}</span></div> : null}
    <div className="trash-list" aria-label="Deleted items">
      {props.items.map((item) => <label className={cx("trash-row", selected.includes(item.id) && "is-selected")} key={item.id}>
        <input checked={selected.includes(item.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} type="checkbox" />
        <span className="trash-kind">{item.kind === "folder" ? <Folder /> : <FileText />}</span>
        <span className="trash-identity"><strong>{item.originalPath.split("/").at(-1)}</strong><small>{item.originalPath}</small></span>
        <span className="trash-meta"><time>{formatTimestamp(item.deletedMs)}</time><small>{item.kind} · {formatBytes(item.byteLength)}</small></span>
      </label>)}
      {!props.items.length ? <div className="trash-empty"><ArchiveRestore /><strong>Trash is empty</strong><span>Items deleted from Files will appear here and remain recoverable.</span></div> : null}
    </div>
    {props.activity.message ? <footer className={cx("trash-activity", "phase-" + props.activity.phase)} aria-live="polite"><ShieldCheck />{props.activity.message}</footer> : null}
  </section>;
}

function VersionHistoryPanel(props: {
  comparison: VersionComparison | null; preview: VersionPreview | null; versions: VersionSnapshot[];
  onClose: () => void; onCompare: (id: string) => Promise<unknown>; onPreview: (id: string) => Promise<unknown>;
  onRestore: (id: string, mode: "replaceCurrent" | "copy") => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<string | null>(props.versions[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!selected && props.versions[0]) setSelected(props.versions[0].id); }, [props.versions, selected]);
  async function act(operation: () => Promise<unknown>) { setBusy(true); setError(null); try { await operation(); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); } finally { setBusy(false); } }
  return <aside className="history-panel" aria-label="Version history">
    <header><div><h2>Version history</h2><p>Preview or restore an earlier Markdown snapshot.</p></div><button className="icon-button" aria-label="Close version history" onClick={props.onClose} type="button"><X /></button></header>
    <div className="history-list">
      {props.versions.map((version) => <button className={cx("history-row", selected === version.id && "is-selected")} onClick={() => { setSelected(version.id); void act(() => props.onPreview(version.id)); }} key={version.id} type="button">
        <History /><span><strong>{formatTimestamp(version.createdMs)}</strong><small>{version.reason.replace(/([A-Z])/g, " $1").toLowerCase()} · {formatBytes(version.byteLength)}</small></span></button>)}
      {!props.versions.length ? <div className="history-empty"><History /><strong>No versions yet</strong><span>Serein creates snapshots at sensible intervals and before risky replacements.</span></div> : null}
    </div>
    {selected ? <div className="history-actions"><button disabled={busy} onClick={() => void act(() => props.onPreview(selected))} type="button">Preview</button>
      <button disabled={busy} onClick={() => void act(() => props.onCompare(selected))} type="button"><GitCompare />Compare</button>
      <button disabled={busy} onClick={() => void act(() => props.onRestore(selected, "copy"))} type="button"><Copy />Restore as Copy</button>
      <button className="primary-action" disabled={busy} onClick={() => void act(() => props.onRestore(selected, "replaceCurrent"))} type="button"><ArchiveRestore />Restore</button></div> : null}
    {error ? <p className="history-error" role="alert">{error}</p> : null}
    <div className="history-preview">
      {props.comparison ? <><div className="comparison-summary"><span>+{props.comparison.addedLines} current</span><span>−{props.comparison.removedLines} from snapshot</span></div>
        <div className="comparison-columns"><label><span>Snapshot</span><textarea readOnly value={props.comparison.snapshotContent} /></label><label><span>Current</span><textarea readOnly value={props.comparison.currentContent} /></label></div></>
        : props.preview ? <><span>Snapshot preview</span><pre>{props.preview.content}</pre></> : <div className="history-preview-placeholder">Select a version to inspect its exact Markdown.</div>}
    </div>
  </aside>;
}

function InactiveEditorGroup(props: { groupId: EditorGroupId; path: string | null; content: string | null; onActivate: () => void }) {
  return <button className="inactive-editor-group" aria-label={`Activate ${props.groupId} editor group`}
    onClick={props.onActivate} type="button">
    <span><strong>{noteTitle(props.path)}</strong><small>{props.path ?? "No note open"}</small></span>
    {props.content ? <pre>{props.content}</pre> : <div className="inactive-editor-empty">Activate this group to load its editor.</div>}
    <em>Click to edit in this group</em>
  </button>;
}

export default function App({ vaultPort = defaultPort, runtimeLabel }: { vaultPort?: VaultPort; runtimeLabel?: string }) {
  const systemTheme = useSystemTheme();
  const [applicationSettings, setApplicationSettings] = useState(createDefaultApplicationSettings);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsWarning, setSettingsWarning] = useState<string | null>(null);
  const [startupOverride, setStartupOverride] = useState(false);
  const [workspace, setWorkspace] = useState(() => createWorkspaceState("quiet-focus", emptySession));
  const [contextOpen, setContextOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeView, setActiveView] = useState<"notes" | "trash">("notes");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<{ kind: "selected"; items: TrashItem[] } | { kind: "all" } | null>(null);
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [indexState, setIndexState] = useState<SearchIndexState>({ phase: "waiting", summary: null, error: null });
  const [noteSessions, setNoteSessions] = useState(() => createNoteSessions());
  const [groupSplitRatio, setGroupSplitRatio] = useState(0.5);
  const [recentNotes, setRecentNotes] = useState<string[]>([]);
  const [sessionReadyRoot, setSessionReadyRoot] = useState<string | null>(null);
  const [launcher, setLauncher] = useState<"quick" | "commands" | null>(null);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; groupId: EditorGroupId; path: string } | null>(null);
  const previousSearchFocus = useRef<HTMLElement | null>(null);
  const editorCache = useRef(new EditorSessionCache());
  const settingsWriteChain = useRef<Promise<void>>(Promise.resolve());
  const sessionWriteChain = useRef<Promise<void>>(Promise.resolve());
  const registry = useMemo(() => new CommandRegistry(commandDefinitions), []);
  const startupRoot = !settingsReady || applicationSettings.startup.behavior === "vault-chooser" && !startupOverride
    ? undefined
    : startupOverride ? null : applicationSettings.startup.lastVaultRoot;
  const { state, controller } = useVaultWorkspace(vaultPort, applicationSettings.editor.autosaveDebounceMs, startupRoot);
  const commandBindings = applicationSettings.shortcuts;
  const debounceMs = applicationSettings.editor.autosaveDebounceMs;

  useEffect(() => {
    let current = true;
    void vaultPort.loadApplicationSettings().then((stored) => {
      if (!current) return;
      const migrated = stored.value === null
        ? { settings: createDefaultApplicationSettings(), migrated: false, warning: stored.warning }
        : migrateApplicationSettings(stored.value);
      setApplicationSettings(migrated.settings);
      setSettingsWarning(stored.warning ?? migrated.warning);
      setSettingsReady(true);
      if (migrated.migrated) void vaultPort.saveApplicationSettings(migrated.settings);
    }).catch((error) => {
      if (!current) return;
      setSettingsWarning(error instanceof Error ? error.message : String(error));
      setSettingsReady(true);
    });
    return () => { current = false; };
  }, [vaultPort]);

  useEffect(() => {
    if (!settingsReady) return;
    const timer = window.setTimeout(() => {
      settingsWriteChain.current = settingsWriteChain.current
        .catch(() => undefined)
        .then(() => vaultPort.saveApplicationSettings(applicationSettings))
        .catch((error) => { setSettingsWarning(error instanceof Error ? error.message : String(error)); });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [applicationSettings, settingsReady, vaultPort]);

  useEffect(() => {
    if (!state.root || !settingsReady) return;
    setApplicationSettings((current) => current.startup.lastVaultRoot === state.root ? current : {
      ...current, startup: { ...current.startup, lastVaultRoot: state.root },
    });
  }, [settingsReady, state.root]);

  useEffect(() => {
    if (!state.root || !settingsReady || !state.notes.length || sessionReadyRoot === state.root) return;
    let current = true;
    const root = state.root;
    void vaultPort.loadVaultWorkspaceSession(root).then(async (stored) => {
      if (!current) return;
      setSettingsWarning((warning) => stored.warning ?? warning);
      const available = state.notes.map((note) => note.relativePath);
      let restored = stored.value
        ? restoreVaultWorkspaceSession(stored.value, available)
        : restoreVaultWorkspaceSession(null, available);
      if (!stored.value) {
        const preferred = applicationSettings.workspace.customLayouts.find((layout) => layout.id === applicationSettings.workspace.defaultLayoutId)
          ?? layoutPresets[applicationSettings.workspace.defaultLayoutId as LayoutPresetId]
          ?? layoutPresets["quiet-focus"];
        restored = {
          ...restored,
          workspace: switchLayout(restored.workspace, preferred),
          noteSessions: createNoteSessions(state.activePath),
        };
      }
      restored.noteSessions = setPreviewTabsEnabled(restored.noteSessions, applicationSettings.navigation.previewTabsEnabled);
      if (applicationSettings.startup.behavior === "pinned-tabs") {
        for (const groupId of ["primary", "secondary"] as const) {
          restored.noteSessions.groups[groupId].tabIds = restored.noteSessions.groups[groupId].tabIds
            .filter((path) => restored.noteSessions.sessions[path]?.pinned);
          restored.noteSessions.groups[groupId].activeTabId = restored.noteSessions.groups[groupId].tabIds[0] ?? null;
        }
      } else if (applicationSettings.startup.behavior === "home" || applicationSettings.startup.behavior === "blank") {
        restored.noteSessions = setPreviewTabsEnabled(createNoteSessions(), applicationSettings.navigation.previewTabsEnabled);
      }
      setWorkspace(restored.workspace);
      setNoteSessions(restored.noteSessions);
      setGroupSplitRatio(restored.groupSplitRatio);
      setRecentNotes(restored.recentNotes);
      setSessionReadyRoot(root);
      const active = activeSessionPath(restored.noteSessions);
      if (active && active !== state.activePath) await controller.openNote(active);
    }).catch((error) => {
      if (current) { setSettingsWarning(error instanceof Error ? error.message : String(error)); setSessionReadyRoot(root); }
    });
    return () => { current = false; };
  }, [applicationSettings.navigation.previewTabsEnabled, applicationSettings.startup.behavior, applicationSettings.workspace.customLayouts, applicationSettings.workspace.defaultLayoutId, controller, sessionReadyRoot, settingsReady, state.activePath, state.notes, state.root, vaultPort]);

  useEffect(() => {
    if (!state.root || sessionReadyRoot !== state.root) return;
    const persisted = createVaultWorkspaceSession({ workspace, noteSessions, groupSplitRatio, recentNotes });
    const root = state.root;
    const timer = window.setTimeout(() => {
      sessionWriteChain.current = sessionWriteChain.current
        .catch(() => undefined)
        .then(() => vaultPort.saveVaultWorkspaceSession(root, persisted))
        .catch((error) => { setSettingsWarning(error instanceof Error ? error.message : String(error)); });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [groupSplitRatio, noteSessions, recentNotes, sessionReadyRoot, state.root, vaultPort, workspace]);
  useEffect(() => {
    if (!state.root) return;
    let current = true;
    setIndexState({ phase: "indexing", summary: null, error: null });
    void vaultPort.syncSearchIndex(state.root).then((summary) => {
      if (current) setIndexState({ phase: "ready", summary, error: null });
    }).catch((caught) => {
      if (current) setIndexState({ phase: "error", summary: null, error: caught instanceof Error ? caught.message : String(caught) });
    });
    return () => { current = false; };
  }, [state.root, vaultPort]);
  useEffect(() => {
    setNoteSessions((current) => {
      let next = removeMissingSessions(current, state.notes.map((note) => note.relativePath));
      if (state.activePath && !next.sessions[state.activePath]) next = openTab(next, state.activePath);
      if (state.activePath && next.sessions[state.activePath]) {
        next = updateEditorViewState(next, state.activePath, { saveState: state.saveState });
      }
      return next;
    });
  }, [state.activePath, state.notes]);
  useEffect(() => {
    if (!state.activePath) return;
    setNoteSessions((current) => updateEditorViewState(current, state.activePath!, { saveState: state.saveState }));
  }, [state.activePath, state.saveState]);
  const activePreset = applicationSettings.workspace.customLayouts.find((layout) => layout.id === workspace.layout.activePresetId)
    ?? layoutPresets[workspace.layout.activePresetId as LayoutPresetId]
    ?? layoutPresets["quiet-focus"];
  const balanced = workspace.layout.panels.noteList.visible;
  const activeViewSession = state.activePath ? noteSessions.sessions[state.activePath] : null;
  const editorMode: EditorMode = activeViewSession?.mode ?? "editor";
  const showSource = editorMode === "editor" || editorMode === "split";
  const showPreview = editorMode === "preview" || editorMode === "split";
  const showContext = workspace.layout.panels.context.visible || contextOpen;
  const activeEntry = state.notes.find((note) => note.relativePath === state.activePath);
  const badge = runtimeLabel ?? (nativeRuntime ? "Native synthetic vault" : "Browser preview · memory only");
  const resolvedTheme = applicationSettings.appearance.theme === "system" ? systemTheme : applicationSettings.appearance.theme;
  const appearanceStyle = {
    "--accent": applicationSettings.appearance.accentColor,
    "--font-ui": applicationSettings.appearance.uiFont,
    "--font-editor": applicationSettings.appearance.editorFont,
    "--font-preview": applicationSettings.appearance.previewFont,
    "--ui-font-size": `${applicationSettings.appearance.uiFontSize * applicationSettings.appearance.uiScale}px`,
    "--editor-font-size": `${applicationSettings.appearance.editorFontSize}px`,
    "--preview-font-size": `${applicationSettings.appearance.previewFontSize}px`,
    "--editor-line-height": String(applicationSettings.appearance.lineHeight),
    "--icon-size": `${applicationSettings.appearance.iconSize * applicationSettings.appearance.uiScale}px`,
    "--editor-content-width": `${applicationSettings.appearance.editorContentWidth}px`,
    "--ribbon-width": `${44 * applicationSettings.appearance.uiScale}px`,
  } as CSSProperties;
  const workspaceColumns = activeView === "trash"
    ? [workspace.layout.panels.explorer.visible ? `${workspace.layout.panels.explorer.width ?? 240}px` : null, "minmax(0, 1fr)"].filter(Boolean).join(" ")
    : [
      workspace.layout.panels.explorer.visible ? `${workspace.layout.panels.explorer.width ?? 240}px` : null,
      workspace.layout.panels.noteList.visible ? `${workspace.layout.panels.noteList.width ?? 300}px` : null,
      "minmax(0, 1fr)",
      showContext ? `${workspace.layout.panels.context.width ?? 300}px` : null,
    ].filter(Boolean).join(" ");
  async function openWorkspaceNote(path: string, options: { preview?: boolean; groupId?: EditorGroupId; duplicateView?: boolean } = {}) {
    const wasOpen = Boolean(noteSessions.sessions[path]);
    await controller.openNote(path);
    if (controller.getSnapshot().activePath !== path) return;
    setNoteSessions((current) => {
      let next = openTab(current, path, options);
      if (!wasOpen && next.sessions[path]) {
        next = updateEditorViewState(next, path, { mode: applicationSettings.editor.defaultMode });
      }
      if (!wasOpen && options.preview && next.previewTabsEnabled && next.sessions[path] && !next.sessions[path].pinned) {
        next.sessions[path].preview = true;
      }
      return next;
    });
    setRecentNotes((current) => [path, ...current.filter((candidate) => candidate !== path)].slice(0, 30));
    setActiveView("notes");
  }
  async function activateWorkspaceTab(groupId: EditorGroupId, path: string) {
    await controller.openNote(path);
    if (controller.getSnapshot().activePath === path) setNoteSessions((current) => activateTab(current, groupId, path));
  }
  function promoteWorkspaceTab(path: string, pinned?: boolean) {
    setNoteSessions((current) => promoteTab(current, path, pinned));
  }
  function setEditorMode(mode: EditorMode) {
    if (!state.activePath) return;
    setNoteSessions((current) => updateEditorViewState(current, state.activePath!, { mode }));
  }
  async function safeCloseTab(groupId: EditorGroupId, path: string, forcePinned = false) {
    if (path === state.activePath && (state.saveState === "unsaved" || state.saveState === "saving")) await controller.saveNow();
    if (path === state.activePath && (controller.getSnapshot().saveState === "error" || controller.getSnapshot().conflict)) return false;
    const nextState = closeTab(noteSessions, groupId, path, { forcePinned });
    setNoteSessions(nextState);
    if (!nextState.sessions[path]) editorCache.current.delete(path);
    const nextPath = activeSessionPath(nextState);
    if (path === state.activePath && nextPath && nextPath !== path) await controller.openNote(nextPath);
    return true;
  }
  async function reopenLastClosedTab() {
    const nextState = reopenClosedTab(noteSessions);
    setNoteSessions(nextState);
    const path = activeSessionPath(nextState);
    if (path) await controller.openNote(path);
  }
  async function openNoteInSecondGroup(path: string) {
    await controller.openNote(path);
    if (controller.getSnapshot().activePath !== path) return;
    setNoteSessions((current) => moveTabToGroup(current, path, "secondary", { retainSourceView: true }));
  }
  function togglePreviewMode() {
    setEditorMode(editorMode === "preview" ? "editor" : "preview");
  }
  function selectLayout(presetId: string) {
    const preset = applicationSettings.workspace.customLayouts.find((layout) => layout.id === presetId)
      ?? layoutPresets[presetId as LayoutPresetId];
    if (preset) setWorkspace((current) => switchLayout(current, preset));
    setContextOpen(false);
  }
  function changeLayoutPanel(panelId: PanelId, patch: { visible?: boolean; width?: number }) {
    setWorkspace((current) => updateLayoutPanel(current, panelId, patch));
  }
  function saveLayoutAs(name: string) {
    const stem = name.toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "layout";
    const occupied = new Set([
      ...Object.keys(layoutPresets),
      ...applicationSettings.workspace.customLayouts.map((layout) => layout.id),
    ]);
    let id = `custom-${stem}`;
    let suffix = 2;
    while (occupied.has(id)) id = `custom-${stem}-${suffix++}`;
    const layout: LayoutPreset = {
      id,
      name,
      description: "A custom arrangement saved from this workspace.",
      panels: Object.fromEntries(Object.entries(workspace.layout.panels).map(([key, panel]) => [key, { ...panel }])) as LayoutPreset["panels"],
    };
    setApplicationSettings((current) => ({
      ...current,
      workspace: { ...current.workspace, customLayouts: [...current.workspace.customLayouts, layout] },
    }));
    setWorkspace((current) => switchLayout(current, layout));
  }
  function deleteLayout(layoutId: string) {
    setApplicationSettings((current) => ({
      ...current,
      workspace: {
        ...current.workspace,
        defaultLayoutId: current.workspace.defaultLayoutId === layoutId ? "quiet-focus" : current.workspace.defaultLayoutId,
        customLayouts: current.workspace.customLayouts.filter((layout) => layout.id !== layoutId),
      },
    }));
    if (workspace.layout.activePresetId === layoutId) setWorkspace((current) => switchLayoutPreset(current, "quiet-focus"));
  }
  function resetCurrentLayout() {
    const definition = applicationSettings.workspace.customLayouts.find((layout) => layout.id === workspace.layout.activePresetId)
      ?? layoutPresets[workspace.layout.activePresetId as LayoutPresetId]
      ?? layoutPresets["quiet-focus"];
    setWorkspace((current) => switchLayout(current, definition));
  }
  function resetAllLayouts() {
    setApplicationSettings((current) => ({ ...current, workspace: { defaultLayoutId: "quiet-focus", customLayouts: [] } }));
    setWorkspace((current) => switchLayoutPreset(current, "quiet-focus"));
    setGroupSplitRatio(0.5);
  }
  function openSearch() {
    if (!searchOpen && document.activeElement instanceof HTMLElement) {
      previousSearchFocus.current = document.activeElement;
    }
    setSearchOpen(true);
    setSettingsOpen(false);
  }
  function closeSearch(restoreFocus: boolean) {
    setSearchOpen(false);
    const target = previousSearchFocus.current;
    previousSearchFocus.current = null;
    if (restoreFocus) window.requestAnimationFrame(() => target?.focus());
  }
  async function openSearchResult(path: string) {
    await openWorkspaceNote(path);
    setActiveView("notes");
    closeSearch(false);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".cm-content[contenteditable='true']")?.focus();
    });
  }
  async function openHistory() {
    await controller.loadVersionHistory();
    setHistoryOpen(true);
    setSettingsOpen(false);
    closeSearch(false);
  }
  async function confirmDeletion() {
    if (!pendingDeletion) return;
    setDeletionBusy(true); setDeletionError(null);
    try {
      if (pendingDeletion.kind === "all") await controller.emptyTrash();
      else await controller.deleteTrash(pendingDeletion.items.map((item) => item.id));
      setPendingDeletion(null);
    } catch (caught) { setDeletionError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setDeletionBusy(false); }
  }
  async function rebuildSearch() {
    if (!state.root) return;
    setIndexState({ phase: "indexing", summary: null, error: null });
    try {
      const summary = await vaultPort.rebuildSearchIndex(state.root);
      setIndexState({ phase: "ready", summary, error: null });
    } catch (caught) {
      setIndexState({ phase: "error", summary: null, error: caught instanceof Error ? caught.message : String(caught) });
    }
  }
  function openTrashWorkspace() {
    setActiveView("trash"); setHistoryOpen(false); setSettingsOpen(false); setLauncher(null); closeSearch(false); void controller.refreshTrash();
  }
  async function createCommandNote() {
    const occupied = new Set(state.notes.map((note) => note.relativePath.toLocaleLowerCase()));
    let path = "Notes/Untitled.md";
    let suffix = 2;
    while (occupied.has(path.toLocaleLowerCase())) path = `Notes/Untitled ${suffix++}.md`;
    await controller.createNote(path);
    if (controller.getSnapshot().activePath === path) setNoteSessions((current) => openTab(current, path));
  }
  async function applyBatchClose(kind: "others" | "right", groupId: EditorGroupId, path: string) {
    const currentTabs = noteSessions.groups[groupId].tabIds;
    const removed = kind === "others" ? currentTabs.filter((candidate) => candidate !== path && !noteSessions.sessions[candidate]?.pinned)
      : currentTabs.slice(currentTabs.indexOf(path) + 1).filter((candidate) => !noteSessions.sessions[candidate]?.pinned);
    if (state.activePath && removed.includes(state.activePath) && (state.saveState === "unsaved" || state.saveState === "saving")) await controller.saveNow();
    if (state.activePath && removed.includes(state.activePath) && (controller.getSnapshot().saveState === "error" || controller.getSnapshot().conflict)) return;
    const next = kind === "others" ? closeOtherTabs(noteSessions, groupId, path) : closeTabsToRight(noteSessions, groupId, path);
    setNoteSessions(next);
    const nextPath = activeSessionPath(next);
    if (nextPath && nextPath !== state.activePath) await controller.openNote(nextPath);
  }

  registry
    .bind("note.new", { run: createCommandNote })
    .bind("note.close", { run: (invocation) => {
      const target = invocation.target as { groupId: EditorGroupId; path: string; forcePinned?: boolean } | undefined;
      const groupId = target?.groupId ?? noteSessions.activeGroupId;
      const path = target?.path ?? noteSessions.groups[groupId].activeTabId;
      if (path) void safeCloseTab(groupId, path, target?.forcePinned);
    }, enabled: () => Boolean(activeSessionPath(noteSessions)) })
    .bind("note.closeOthers", { run: (invocation) => {
      const target = invocation.target as { groupId: EditorGroupId; path: string } | undefined;
      const groupId = target?.groupId ?? noteSessions.activeGroupId;
      const path = target?.path ?? noteSessions.groups[groupId].activeTabId;
      if (path) void applyBatchClose("others", groupId, path);
    }, enabled: () => Boolean(activeSessionPath(noteSessions)) })
    .bind("note.closeRight", { run: (invocation) => {
      const target = invocation.target as { groupId: EditorGroupId; path: string } | undefined;
      const groupId = target?.groupId ?? noteSessions.activeGroupId;
      const path = target?.path ?? noteSessions.groups[groupId].activeTabId;
      if (path) void applyBatchClose("right", groupId, path);
    }, enabled: () => Boolean(activeSessionPath(noteSessions)) })
    .bind("note.reopenClosed", { run: reopenLastClosedTab, enabled: () => noteSessions.recentlyClosed.length > 0 })
    .bind("note.openSecondGroup", { run: (invocation) => {
      const path = (invocation.target as { path?: string } | undefined)?.path ?? state.activePath;
      if (path) return openNoteInSecondGroup(path);
    }, enabled: () => Boolean(state.activePath) })
    .bind("note.pin", { run: (invocation) => {
      const path = (invocation.target as { path?: string } | undefined)?.path ?? state.activePath;
      if (!path) return;
      const pinned = noteSessions.sessions[path]?.pinned ?? false;
      promoteWorkspaceTab(path, !pinned);
    }, enabled: () => Boolean(state.activePath) })
    .bind("editor.save", { run: () => controller.saveNow(), enabled: () => Boolean(state.document) })
    .bind("editor.togglePreview", { run: togglePreviewMode, enabled: () => Boolean(state.document) })
    .bind("workspace.toggleSidebar", { run: () => setContextOpen((open) => !open) })
    .bind("search.openVaultSearch", { run: openSearch })
    .bind("navigation.quickSwitcher", { run: () => { setLauncher("quick"); setSettingsOpen(false); closeSearch(false); } })
    .bind("navigation.commandPalette", { run: () => { setLauncher("commands"); setSettingsOpen(false); closeSearch(false); } })
    .bind("vault.switch", { run: () => {}, enabled: () => false })
    .bind("recovery.openTrash", { run: openTrashWorkspace })
    .bind("settings.open", { run: () => { setSettingsOpen(true); setLauncher(null); closeSearch(false); } });

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        if (launcher) { event.preventDefault(); setLauncher(null); return; }
        if (tabMenu) { event.preventDefault(); setTabMenu(null); return; }
        if (searchOpen) { event.preventDefault(); closeSearch(true); return; }
      }
      const shortcut = eventToShortcut(event);
      if (!shortcut) return;
      const commandId = commandForShortcut(commandBindings, shortcut);
      if (!commandId) return;
      event.preventDefault();
      void registry.execute(commandId, "shortcut");
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [commandBindings, launcher, registry, searchOpen, tabMenu]);
  return (
    <main className="app-shell" data-density={applicationSettings.appearance.density} data-reduced-motion={applicationSettings.appearance.reducedMotion}
      data-theme={resolvedTheme} style={appearanceStyle}>
      {!applicationSettings.advanced.safeMode && applicationSettings.advanced.customCss ? <style data-serein-custom-css>{applicationSettings.advanced.customCss}</style> : null}
      {settingsWarning ? <div className="settings-warning" role="alert"><AlertTriangle />{settingsWarning}<button aria-label="Dismiss settings warning" onClick={() => setSettingsWarning(null)} type="button"><X /></button></div> : null}
      {settingsReady && !state.root && (applicationSettings.startup.behavior === "vault-chooser" && !startupOverride || state.saveState === "error") ? <section className="startup-recovery" aria-label="Vault recovery">
        <FolderInput aria-hidden="true" /><h1>{state.saveState === "error" ? "Vault unavailable" : "Choose a vault"}</h1>
        <p>{state.saveState === "error" ? "Serein did not create a replacement. Select the vault again or open generated test data." : "Choose where Serein should begin. Real-vault access remains blocked during Phase 1 testing."}</p>
        {applicationSettings.startup.lastVaultRoot ? <code>{applicationSettings.startup.lastVaultRoot}</code> : null}
        {state.error ? <span role="status">{state.error}</span> : null}
        <button onClick={() => setStartupOverride(true)} type="button">Open generated test vault</button>
      </section> : null}
      <Ribbon activeView={activeView} settingsOpen={settingsOpen} searchOpen={searchOpen}
        hiddenItems={applicationSettings.navigation.hiddenRibbonItems}
        onFiles={() => { setActiveView("notes"); closeSearch(false); }}
        onTrash={() => void registry.execute("recovery.openTrash", "ribbon")}
        onSearchToggle={() => { if (searchOpen) closeSearch(true); else void registry.execute("search.openVaultSearch", "ribbon"); }}
        onSettingsToggle={() => { if (settingsOpen) setSettingsOpen(false); else void registry.execute("settings.open", "ribbon"); setHistoryOpen(false); }} />
      <section className={cx("workspace", activeView === "trash" && "trash-view", activeView === "notes" && showContext && "context-open")} data-testid="workspace"
        data-layout={workspace.layout.activePresetId} aria-label={activePreset.name + " workspace"} style={{ gridTemplateColumns: workspaceColumns }}>
        {workspace.layout.panels.explorer.visible ? <aside className="navigation-rail">
          <Explorer activePath={state.activePath} folders={state.folders} notes={state.notes}
            onCreateFolder={(path) => controller.createFolder(path)} onCreateNote={(path) => controller.createNote(path)}
            onMove={(from, to) => controller.moveEntry(from, to)} onOpen={(path) => openWorkspaceNote(path, { preview: true })}
            onPromote={promoteWorkspaceTab}
            onTrash={(path) => controller.trashEntry(path)} />
          {workspace.layout.panels.recentNotes.visible && !balanced ? <RecentNotes activePath={state.activePath} notes={state.notes} onOpen={(path) => openWorkspaceNote(path, { preview: true })} /> : null}
        </aside> : null}
        {workspace.layout.panels.noteList.visible && activeView === "notes" ? <NoteList activePath={state.activePath} notes={state.notes} onOpen={(path) => openWorkspaceNote(path, { preview: true })} /> : null}
        {activeView === "trash" ? <TrashWorkspace activity={state.recoveryActivity} items={state.trashItems}
          onDelete={(items) => setPendingDeletion({ kind: "selected", items })} onEmpty={() => setPendingDeletion({ kind: "all" })}
          onRefresh={() => controller.refreshTrash()} onRestore={(ids, policy) => controller.restoreTrash(ids, policy)} /> : <section className={cx("editor-workspace", !applicationSettings.editor.toolbarVisible && "toolbar-hidden")}>
          <header className="workspace-header"><div className="tab-groups">
            <TabStrip group={noteSessions.groups.primary} sessions={noteSessions.sessions} activePath={noteSessions.activeGroupId === "primary" ? state.activePath : null}
              onActivate={(groupId, path) => void activateWorkspaceTab(groupId, path)} onClose={(groupId, path) => void registry.execute("note.close", "menu", { groupId, path })}
              onContext={(event, groupId, path) => { event.preventDefault(); setTabMenu({ x: event.clientX, y: event.clientY, groupId, path }); }}
              onPromote={promoteWorkspaceTab} onReorder={(groupId, path, index) => setNoteSessions((current) => reorderTab(current, groupId, path, index))} />
            {noteSessions.groups.secondary.tabIds.length ? <TabStrip group={noteSessions.groups.secondary} sessions={noteSessions.sessions} activePath={noteSessions.activeGroupId === "secondary" ? state.activePath : null}
              onActivate={(groupId, path) => void activateWorkspaceTab(groupId, path)} onClose={(groupId, path) => void registry.execute("note.close", "menu", { groupId, path })}
              onContext={(event, groupId, path) => { event.preventDefault(); setTabMenu({ x: event.clientX, y: event.clientY, groupId, path }); }}
              onPromote={promoteWorkspaceTab} onReorder={(groupId, path, index) => setNoteSessions((current) => reorderTab(current, groupId, path, index))} /> : null}
          </div></header>
          {applicationSettings.editor.toolbarVisible ? <div className="editor-toolbar"><div className="breadcrumbs"><span>Synthetic Vault</span><ChevronRight />
            <span>{parentPath(state.activePath)}</span><ChevronRight /><strong>{noteTitle(state.activePath)}</strong></div>
            <div className="editor-actions"><span className="demo-badge">{badge}</span>
              <button className="history-trigger" disabled={!state.document} onClick={() => void openHistory()} type="button"><History />History</button>
              {balanced ? <button className="context-toggle" aria-label={contextOpen ? "Hide note context" : "Show note context"}
                aria-pressed={contextOpen} onClick={() => setContextOpen((open) => !open)} type="button">
                {contextOpen ? <PanelRightClose /> : <PanelRightOpen />}<span>Context</span></button> : null}
              <div className="mode-switcher" aria-label="Editor mode">{(["editor", "split", "preview"] as const).map((mode) => (
                <button className={editorMode === mode ? "is-active" : ""} onClick={() => setEditorMode(mode)}
                  aria-pressed={editorMode === mode} key={mode} type="button">{mode[0].toUpperCase() + mode.slice(1)}</button>
              ))}</div>
            </div>
          </div> : null}
          {state.error ? <div className="workspace-error" role="alert"><strong>Serein could not complete the file operation.</strong><span>{state.error}</span></div> : null}
          <div className={cx("editor-groups-stage", noteSessions.groups.secondary.tabIds.length > 0 && "has-secondary")}
            style={noteSessions.groups.secondary.tabIds.length ? { gridTemplateColumns: `minmax(0, ${groupSplitRatio}fr) minmax(0, ${1 - groupSplitRatio}fr)` } : undefined}>
          {noteSessions.groups.secondary.tabIds.length > 0 && noteSessions.activeGroupId === "secondary" ? <InactiveEditorGroup
            groupId="primary" path={noteSessions.groups.primary.activeTabId}
            content={noteSessions.groups.primary.activeTabId === state.activePath ? state.content : editorCache.current.content(noteSessions.groups.primary.activeTabId ?? "")}
            onActivate={() => { const path = noteSessions.groups.primary.activeTabId; if (path) void activateWorkspaceTab("primary", path); }} /> : null}
          <div className={cx("document-stage", "mode-" + editorMode)}>
            {state.saveState === "loading" ? <div className="workspace-loading" role="status">Opening generated synthetic vault…</div> : null}
            {!state.document && state.saveState !== "loading" ? <div className="workspace-loading">Create a Markdown note to begin.</div> : null}
            {state.document && showSource ? <section className="source-pane" aria-label="Editor pane">
              <MarkdownEditor sessionKey={state.activePath ?? "no-note"} sessionCache={editorCache.current} value={state.content}
                wordWrap={applicationSettings.editor.wordWrap} spellcheck={applicationSettings.editor.spellcheck}
                showLineNumbers={applicationSettings.editor.lineNumbers} tabWidth={applicationSettings.editor.tabWidth}
                onChange={(value) => { if (state.activePath) promoteWorkspaceTab(state.activePath); controller.updateContent(value); }}
                onViewStateChange={(viewState) => { if (state.activePath) setNoteSessions((current) => updateEditorViewState(current, state.activePath!, viewState)); }}
                onImportBytes={(name, type, bytes) => controller.importAttachmentBytes(name, type, bytes)}
                onImportPath={(path) => controller.importAttachmentPath(path)}
                onRollbackAttachment={(attachment) => controller.rollbackAttachment(attachment)}
                onAttachmentError={(message) => controller.reportAttachmentError(message)} /></section> : null}
            {state.document && showPreview && state.root && state.activePath ? <RenderedPreview markdown={state.content}
              notePath={state.activePath} port={vaultPort} root={state.root} /> : null}
          </div>
          {noteSessions.groups.secondary.tabIds.length > 0 && noteSessions.activeGroupId === "primary" ? <InactiveEditorGroup
            groupId="secondary" path={noteSessions.groups.secondary.activeTabId}
            content={noteSessions.groups.secondary.activeTabId === state.activePath ? state.content : editorCache.current.content(noteSessions.groups.secondary.activeTabId ?? "")}
            onActivate={() => { const path = noteSessions.groups.secondary.activeTabId; if (path) void activateWorkspaceTab("secondary", path); }} /> : null}
          </div>
          <div className="attachment-repair-region">
            {state.attachmentIssues.length ? <div className="attachment-repair-banner" role="status">
              <AlertTriangle /><span><strong>Attachment moved outside Serein</strong>
                <small>{state.attachmentIssues[0].brokenTarget}{state.attachmentIssues.length > 1 ? ` · ${state.attachmentIssues.length} links need attention` : ""}</small></span>
              {state.attachmentIssues[0].suggestedPath ? <button aria-label="Repair attachment link"
                onClick={() => void controller.repairAttachmentIssue(state.attachmentIssues[0])} type="button">Repair link</button> : <button onClick={() => setSettingsOpen(true)} type="button">Review</button>}
            </div> : null}
          </div>
          <footer className={cx("save-indicator", "state-" + state.saveState)} aria-live="polite"><FileClock />
            <span>{state.saveState === "loading" ? "Opening…" : state.saveState === "saving" ? "Saving…" :
              state.saveState === "unsaved" ? "Unsaved" : state.saveState === "conflict" ? "Conflict — your draft is protected" :
                state.saveState === "error" ? "File operation needs attention" : "Saved"}</span>
            {state.lastTrash ? <button onClick={() => void controller.restoreLastTrash()} type="button"><RotateCcw />Undo trash</button> : null}
            {state.attachmentActivity.phase !== "idle" ? <span className={cx("attachment-activity", "phase-" + state.attachmentActivity.phase)}>
              <Paperclip />{state.attachmentActivity.message}</span> : null}
          </footer>
        </section>}
        {activeView === "notes" && showContext ? <FileDetails activePath={state.activePath} note={activeEntry} root={state.root} /> : null}
      </section>
      {settingsOpen ? <SettingsDialog activePresetId={workspace.layout.activePresetId} applicationSettings={applicationSettings}
        attachmentIssues={state.attachmentIssues} attachmentSettings={state.attachmentSettings} attachments={state.attachments}
        debounceMs={debounceMs} previewTabsEnabled={noteSessions.previewTabsEnabled} commandBindings={commandBindings}
        groupSplitRatio={groupSplitRatio} layoutPanels={workspace.layout.panels}
        recoveryActivity={state.recoveryActivity} recoverySettings={state.recoverySettings} onClose={() => setSettingsOpen(false)}
        onConfigureAttachments={(directory) => controller.configureAttachmentDirectory(directory)}
        onConfigureRecovery={(settings) => controller.configureRecovery(settings)} onCleanupRecovery={() => controller.cleanupRecovery()}
        onDebounceChange={(value) => setApplicationSettings((current) => ({ ...current, editor: { ...current.editor, autosaveDebounceMs: value } }))}
        onPreviewTabsChange={(enabled) => { setNoteSessions((current) => setPreviewTabsEnabled(current, enabled)); setApplicationSettings((current) => ({ ...current, navigation: { ...current.navigation, previewTabsEnabled: enabled } })); }}
        onCommandBindingsChange={(shortcuts) => setApplicationSettings((current) => ({ ...current, shortcuts }))} onMoveAttachment={(from, to) => controller.moveAttachment(from, to)}
        onRefreshAttachments={() => controller.refreshAttachments()} onRepairAttachment={(issue) => controller.repairAttachmentIssue(issue)}
        onApplicationSettingsChange={setApplicationSettings} onDeleteLayout={deleteLayout} onGroupSplitChange={setGroupSplitRatio}
        onPanelChange={changeLayoutPanel} onResetAllLayouts={resetAllLayouts} onResetCurrentLayout={resetCurrentLayout}
        onSaveLayoutAs={saveLayoutAs} onSelectLayout={selectLayout} /> : null}
      {searchOpen && state.root ? <SearchPanel indexState={indexState} onClose={() => closeSearch(true)}
        onOpen={openSearchResult} onRebuild={rebuildSearch} port={vaultPort} root={state.root} /> : null}
      {historyOpen ? <VersionHistoryPanel comparison={state.versionComparison} preview={state.versionPreview} versions={state.versions}
        onClose={() => setHistoryOpen(false)} onCompare={(id) => controller.compareVersion(id)} onPreview={(id) => controller.previewVersion(id)}
        onRestore={(id, mode) => controller.restoreVersion(id, mode)} /> : null}
      {pendingDeletion ? <ConfirmationDialog busy={deletionBusy} error={deletionError} confirmLabel={pendingDeletion.kind === "all" ? `Delete ${state.trashItems.length} permanently` : `Delete ${pendingDeletion.items.length} permanently`}
        detail={pendingDeletion.kind === "all" ? `All ${state.trashItems.length} items will be removed from this vault's Trash.` : `${pendingDeletion.items.length} selected ${pendingDeletion.items.length === 1 ? "item" : "items"} will be removed from this vault's Trash.`}
        onCancel={() => { setPendingDeletion(null); setDeletionError(null); }} onConfirm={confirmDeletion}
        title={pendingDeletion.kind === "all" ? "Empty Trash permanently?" : "Delete selected items permanently?"} /> : null}
      {launcher ? <CommandLauncher mode={launcher} commands={commandDefinitions} bindings={commandBindings}
        notes={state.notes.map((note) => ({ relativePath: note.relativePath, title: noteTitle(note.relativePath) }))}
        isCommandEnabled={(commandId) => registry.isEnabled(commandId)} onClose={() => setLauncher(null)}
        onCommand={(commandId) => { setLauncher(null); void registry.execute(commandId, "palette"); }}
        onNote={(path) => { setLauncher(null); void openWorkspaceNote(path, { preview: true }); }} /> : null}
      {tabMenu ? <div className="tab-context-menu" role="menu" style={{ left: tabMenu.x, top: tabMenu.y }}>
        <button onClick={() => { void registry.execute("note.pin", "context", tabMenu); setTabMenu(null); }} role="menuitem" type="button">
          <Pin />{noteSessions.sessions[tabMenu.path]?.pinned ? "Unpin tab" : "Pin tab"}</button>
        <button onClick={() => { void registry.execute("note.openSecondGroup", "context", tabMenu); setTabMenu(null); }} role="menuitem" type="button">Open in second group</button>
        <button onClick={() => { void registry.execute("note.close", "context", { ...tabMenu, forcePinned: true }); setTabMenu(null); }} role="menuitem" type="button">Close</button>
        <button onClick={() => { void registry.execute("note.closeOthers", "context", tabMenu); setTabMenu(null); }} role="menuitem" type="button">Close Others</button>
        <button onClick={() => { void registry.execute("note.closeRight", "context", tabMenu); setTabMenu(null); }} role="menuitem" type="button">Close Tabs to Right</button>
      </div> : null}
      {state.conflict ? <ConflictDialog conflict={state.conflict} onResolve={(action, merged) => controller.resolveConflict(action, merged)} /> : null}
    </main>
  );
}

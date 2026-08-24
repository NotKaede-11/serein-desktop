import {
  AlertTriangle, Check, Compass, Info, Maximize2, Minimize2, Monitor, Paintbrush, Paperclip,
  Pencil, RefreshCw, Search, ShieldCheck, SlidersHorizontal, TextCursorInput, Trash2, X,
  type LucideIcon,
} from "lucide-react";
import {
  type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState,
} from "react";

import { commandDefinitions, createDefaultShortcutBindings, type ShortcutBindings } from "../commands/commandRegistry";
import {
  type AttachmentInventoryEntry, type AttachmentIssue, type AttachmentSettings,
  type RecoverySettings,
} from "../platform/vault";
import { createWorkspaceState, layoutPresets, type PanelId } from "../workspace/layoutPresets";
import type { EditorMode } from "../workspace/noteSessions";
import packageMetadata from "../../package.json";
import { ShortcutSettings } from "./ShortcutSettings";
import {
  createDefaultApplicationSettings, exportApplicationSettings, importApplicationSettings,
  resetAppearance, type ApplicationSettings,
} from "./applicationSettings";

type SettingsCategory = "workspace" | "appearance" | "editor" | "navigation" | "attachments" | "recovery" | "shortcuts" | "advanced" | "about";

type SettingsCategoryDefinition = {
  id: SettingsCategory;
  label: string;
  pageTitle?: string;
  group: "Workspace" | "Content" | "Files" | "System";
  icon: LucideIcon;
  description: string;
};

const categories: readonly SettingsCategoryDefinition[] = [
  { id: "workspace", label: "Workspace", group: "Workspace", icon: Monitor, description: "Layouts, panels, and startup" },
  { id: "appearance", label: "Appearance", group: "Workspace", icon: Paintbrush, description: "Theme, type, scale, and density" },
  { id: "editor", label: "Editor", group: "Content", icon: TextCursorInput, description: "Saving and Markdown behavior" },
  { id: "navigation", label: "Navigation", group: "Content", icon: Compass, description: "Preview tabs, recents, and ribbon" },
  { id: "attachments", label: "Attachments", group: "Files", icon: Paperclip, description: "Storage, repair, and inventory" },
  { id: "recovery", label: "Recovery", group: "Files", icon: ShieldCheck, description: "Snapshots, retention, and cleanup" },
  { id: "shortcuts", label: "Shortcuts", pageTitle: "Keyboard shortcuts", group: "System", icon: Check, description: "Keyboard command bindings" },
  { id: "advanced", label: "Advanced", group: "System", icon: SlidersHorizontal, description: "CSS, import, export, and safe mode" },
  { id: "about", label: "About", group: "System", icon: Info, description: "Product identity, version, and privacy" },
];

const settingsSearchIndex: ReadonlyArray<{ category: SettingsCategory; id: string; label: string; terms: string }> = [
  { category: "workspace", id: "workspace-layout-heading", label: "Workspace layout", terms: "quiet focus balanced vault preset custom layout" },
  { category: "workspace", id: "setting-explorer-width", label: "Explorer width", terms: "panel geometry size" },
  { category: "workspace", id: "setting-note-list-width", label: "Note list width", terms: "panel geometry size" },
  { category: "workspace", id: "setting-context-width", label: "Context width", terms: "panel geometry size" },
  { category: "workspace", id: "setting-editor-group-split", label: "Editor group split", terms: "two panes percentage" },
  { category: "workspace", id: "setting-startup-behavior", label: "Startup behavior", terms: "last session home vault chooser blank" },
  { category: "appearance", id: "setting-theme", label: "Theme", terms: "light dark system" },
  { category: "appearance", id: "setting-accent-color", label: "Accent color", terms: "violet purple swatch" },
  { category: "appearance", id: "setting-interface-density", label: "Interface density", terms: "compact comfortable spacious" },
  { category: "appearance", id: "setting-ui-font", label: "UI font", terms: "typeface interface" },
  { category: "appearance", id: "setting-editor-font", label: "Editor font", terms: "typeface markdown" },
  { category: "appearance", id: "setting-preview-font", label: "Preview font", terms: "typeface rendered" },
  { category: "appearance", id: "setting-ui-scale", label: "UI scale", terms: "zoom interface size" },
  { category: "editor", id: "setting-autosave-delay", label: "Autosave delay", terms: "saving debounce ctrl s" },
  { category: "editor", id: "setting-default-document-view", label: "Default document view", terms: "editor split preview mode" },
  { category: "editor", id: "setting-word-wrap", label: "Word wrap", terms: "long lines" },
  { category: "editor", id: "setting-spellcheck", label: "Spellcheck", terms: "spelling windows" },
  { category: "editor", id: "setting-line-numbers", label: "Line numbers", terms: "source editor" },
  { category: "navigation", id: "setting-preview-tabs", label: "Preview tabs", terms: "temporary single click" },
  { category: "navigation", id: "setting-recent-note-behavior", label: "Recent notes", terms: "opened modified order" },
  { category: "navigation", id: "ribbon-items-heading", label: "Ribbon items", terms: "files search trash tasks calendar graph visibility" },
  { category: "attachments", id: "setting-attachment-folder", label: "Attachment folder", terms: "directory imports files" },
  { category: "attachments", id: "attachment-manager-heading", label: "Attachment manager", terms: "broken reference orphan move repair inventory" },
  { category: "recovery", id: "setting-snapshot-interval", label: "Snapshot interval", terms: "backup versions" },
  { category: "recovery", id: "setting-version-retention", label: "Version retention", terms: "backup days" },
  { category: "recovery", id: "setting-maximum-backup-storage", label: "Maximum backup storage", terms: "limit gb mb" },
  { category: "recovery", id: "setting-trash-cleanup", label: "Trash cleanup", terms: "retention delete" },
  { category: "shortcuts", id: "shortcuts-heading", label: "Keyboard shortcuts", terms: "hotkeys commands bindings" },
  { category: "advanced", id: "setting-safe-mode", label: "Safe mode", terms: "disable custom css recovery" },
  { category: "advanced", id: "setting-local-css-snippet", label: "Local CSS snippet", terms: "custom style theme" },
  { category: "advanced", id: "setting-settings-json", label: "Settings JSON", terms: "import export backup portable" },
  { category: "about", id: "about-serein-heading", label: "About Serein", terms: "pronunciation version local first privacy offline" },
];

const fontChoices = [
  { label: "System UI", value: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif' },
  { label: "Segoe UI", value: '"Segoe UI", system-ui, sans-serif' },
  { label: "Arial", value: 'Arial, sans-serif' },
  { label: "Verdana", value: 'Verdana, sans-serif' },
  { label: "Georgia", value: 'Georgia, serif' },
  { label: "Cascadia Mono", value: '"Cascadia Mono", Consolas, monospace' },
  { label: "Consolas", value: 'Consolas, monospace' },
] as const;

const accentChoices = ["#a56cf5", "#7d8df5", "#d06ca8", "#4da38c", "#d18b47"] as const;

function cx(...names: Array<string | false | undefined>) {
  return names.filter(Boolean).join(" ");
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? String(bytes) + " B" : (bytes / 1024).toFixed(1) + " KB";
}

function settingId(label: string) {
  return "setting-" + label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function NumberSetting(props: {
  label: string; description?: string; min: number; max: number; step: number; value: number; unit?: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => setDraft(String(props.value)), [props.value]);
  function commit(raw: string) {
    const parsed = Number(raw);
    const next = Number.isFinite(parsed) ? Math.min(props.max, Math.max(props.min, parsed)) : props.value;
    setDraft(String(next));
    props.onChange(next);
  }
  return <div className="settings-row" id={settingId(props.label)}>
    <label className="settings-row-copy" htmlFor={settingId(props.label) + "-control"}>
      <strong>{props.label}</strong>{props.description ? <small>{props.description}</small> : null}
    </label>
    <span className="settings-number-control">
      <input id={settingId(props.label) + "-control"} aria-label={props.label} max={props.max} min={props.min} step={props.step}
        type="number" value={draft} onBlur={(event) => commit(event.target.value)} onChange={(event) => {
          setDraft(event.target.value);
          const next = Number(event.target.value);
          if (event.target.value && Number.isFinite(next) && next >= props.min && next <= props.max) props.onChange(next);
        }} />
      {props.unit ? <span aria-hidden="true">{props.unit}</span> : null}
    </span>
  </div>;
}

function SelectSetting(props: {
  label: string; description?: string; value: string | number; children: React.ReactNode;
  onChange: (value: string) => void;
}) {
  const id = settingId(props.label) + "-control";
  return <div className="settings-row" id={settingId(props.label)}>
    <label className="settings-row-copy" htmlFor={id}><strong>{props.label}</strong>{props.description ? <small>{props.description}</small> : null}</label>
    <select id={id} aria-label={props.label} value={props.value} onChange={(event) => props.onChange(event.target.value)}>{props.children}</select>
  </div>;
}

function ToggleSetting(props: {
  label: string; description?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void;
}) {
  const id = settingId(props.label) + "-control";
  return <label className="settings-row settings-toggle" id={settingId(props.label)} htmlFor={id}>
    <span className="settings-row-copy"><strong>{props.label}</strong>{props.description ? <small>{props.description}</small> : null}</span>
    <input id={id} aria-label={props.label} checked={props.checked} disabled={props.disabled} onChange={(event) => props.onChange(event.target.checked)} role="switch" type="checkbox" />
  </label>;
}

function FontSetting(props: { label: string; value: string; onChange: (value: string) => void }) {
  const known = fontChoices.some((choice) => choice.value === props.value);
  return <SelectSetting label={props.label} description="Choose a readable font by name." value={props.value} onChange={props.onChange}>
    {!known ? <option value={props.value}>Custom font</option> : null}
    {fontChoices.map((choice) => <option value={choice.value} key={choice.label}>{choice.label}</option>)}
  </SelectSetting>;
}

function SettingsSection(props: { title: string; description?: string; children: React.ReactNode; id?: string }) {
  return <section className="settings-section" aria-labelledby={props.id}>
    <header className="settings-section-heading"><h3 id={props.id}>{props.title}</h3>{props.description ? <p>{props.description}</p> : null}</header>
    <div className="settings-row-list">{props.children}</div>
  </section>;
}

export function SettingsDialog(props: {
  activePresetId: string; attachmentSettings: AttachmentSettings;
  applicationSettings: ApplicationSettings;
  attachments: AttachmentInventoryEntry[]; attachmentIssues: AttachmentIssue[];
  debounceMs: number; previewTabsEnabled: boolean; recoverySettings: RecoverySettings;
  commandBindings: ShortcutBindings;
  groupSplitRatio: number;
  layoutPanels: ReturnType<typeof createWorkspaceState>["layout"]["panels"];
  recoveryActivity: { phase: "idle" | "working" | "ready" | "error"; message: string };
  onClose: () => void;
  onConfigureAttachments: (directory: string) => Promise<AttachmentSettings>;
  onDebounceChange: (value: number) => void;
  onPreviewTabsChange: (enabled: boolean) => void;
  onCommandBindingsChange: (bindings: ShortcutBindings) => void;
  onMoveAttachment: (from: string, to: string) => Promise<unknown>;
  onRefreshAttachments: () => Promise<AttachmentInventoryEntry[]>;
  onRepairAttachment: (issue: AttachmentIssue) => Promise<unknown>;
  onConfigureRecovery: (settings: RecoverySettings) => Promise<RecoverySettings>;
  onCleanupRecovery: () => Promise<unknown>;
  onSelectLayout: (presetId: string) => void;
  onApplicationSettingsChange: (settings: ApplicationSettings) => void;
  onDeleteLayout: (layoutId: string) => void;
  onGroupSplitChange: (ratio: number) => void;
  onPanelChange: (panelId: PanelId, patch: { visible?: boolean; width?: number }) => void;
  onResetAllLayouts: () => void;
  onResetCurrentLayout: () => void;
  onSaveLayoutAs: (name: string) => void;
}) {
  const [category, setCategory] = useState<SettingsCategory>("workspace");
  const [searchQuery, setSearchQuery] = useState("");
  const [attachmentDirectory, setAttachmentDirectory] = useState(props.attachmentSettings.directory);
  const [moving, setMoving] = useState<string | null>(null);
  const [movePath, setMovePath] = useState("");
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [recoverySettings, setRecoverySettings] = useState(props.recoverySettings);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [layoutName, setLayoutName] = useState("");
  const [importText, setImportText] = useState("");
  const [advancedMessage, setAdvancedMessage] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [dialogSize, setDialogSize] = useState<{ width: number; height: number } | null>(() => {
    try {
      const saved = localStorage.getItem("serein.settings-window-size") ?? localStorage.getItem("hushnote.settings-window-size");
      if (!saved) return null;
      const parsed = JSON.parse(saved) as { width: number; height: number };
      return parsed.width >= 600 && parsed.height >= 420 ? parsed : null;
    } catch { return null; }
  });
  const dialogRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return settingsSearchIndex.filter((item) => `${item.label} ${item.terms} ${categories.find((candidate) => candidate.id === item.category)?.label ?? ""}`.toLocaleLowerCase().includes(query));
  }, [searchQuery]);

  useEffect(() => setAttachmentDirectory(props.attachmentSettings.directory), [props.attachmentSettings.directory]);
  useEffect(() => setRecoverySettings(props.recoverySettings), [props.recoverySettings]);
  useEffect(() => {
    if (category !== "attachments") return;
    void props.onRefreshAttachments().catch((caught) => setAttachmentError(caught instanceof Error ? caught.message : String(caught)));
  }, [category]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchRef.current?.focus();
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleDialogKeys);
    return () => { window.removeEventListener("keydown", handleDialogKeys); previousFocus?.focus(); };
  }, []);

  async function moveAttachment(event: FormEvent) {
    event.preventDefault(); if (!moving) return;
    setAttachmentBusy(true); setAttachmentError(null);
    try { await props.onMoveAttachment(moving, movePath); setMoving(null); }
    catch (caught) { setAttachmentError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setAttachmentBusy(false); }
  }
  useEffect(() => {
    if (attachmentDirectory === props.attachmentSettings.directory) return;
    const directory = attachmentDirectory.trim();
    if (!directory) { setAttachmentError("Enter a vault-relative attachment folder."); return; }
    const timeout = window.setTimeout(() => {
      setAttachmentBusy(true); setAttachmentError(null);
      void props.onConfigureAttachments(directory)
        .catch((caught) => setAttachmentError(caught instanceof Error ? caught.message : String(caught)))
        .finally(() => setAttachmentBusy(false));
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [attachmentDirectory, props.attachmentSettings.directory]);

  useEffect(() => {
    if (JSON.stringify(recoverySettings) === JSON.stringify(props.recoverySettings)) return;
    const timeout = window.setTimeout(() => {
      setRecoveryBusy(true); setRecoveryError(null);
      void props.onConfigureRecovery(recoverySettings)
        .catch((caught) => setRecoveryError(caught instanceof Error ? caught.message : String(caught)))
        .finally(() => setRecoveryBusy(false));
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [recoverySettings, props.recoverySettings]);

  function goToSearchResult(result: (typeof settingsSearchIndex)[number]) {
    setCategory(result.category);
    setSearchQuery("");
    requestAnimationFrame(() => {
      const target = document.getElementById(result.id);
      if (typeof target?.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
      target?.classList.add("is-search-target");
      window.setTimeout(() => target?.classList.remove("is-search-target"), 1200);
    });
  }

  function persistDialogSize() {
    if (maximized || !dialogRef.current) return;
    const rect = dialogRef.current.getBoundingClientRect();
    if (rect.width < 600 || rect.height < 420) return;
    const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
    setDialogSize(next);
    try { localStorage.setItem("serein.settings-window-size", JSON.stringify(next)); } catch { /* local storage is optional */ }
  }

  function resetCurrentSection() {
    const defaults = createDefaultApplicationSettings();
    if (category === "workspace") props.onResetCurrentLayout();
    else if (category === "appearance") props.onApplicationSettingsChange(resetAppearance(props.applicationSettings));
    else if (category === "editor") {
      props.onApplicationSettingsChange({ ...props.applicationSettings, editor: defaults.editor });
      props.onDebounceChange(defaults.editor.autosaveDebounceMs);
    } else if (category === "navigation") {
      props.onApplicationSettingsChange({ ...props.applicationSettings, navigation: defaults.navigation });
      props.onPreviewTabsChange(defaults.navigation.previewTabsEnabled);
    } else if (category === "shortcuts") props.onCommandBindingsChange(createDefaultShortcutBindings(commandDefinitions));
    else if (category === "advanced") props.onApplicationSettingsChange({ ...props.applicationSettings, advanced: defaults.advanced });
  }

  const canResetSection = !["attachments", "recovery", "about"].includes(category);
  const dialogStyle = !maximized && dialogSize ? { width: dialogSize.width, height: dialogSize.height } as CSSProperties : undefined;
  const activeCategory = categories.find((item) => item.id === category)!;
  const ActiveCategoryIcon = activeCategory.icon;

  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <section ref={dialogRef} style={dialogStyle} onPointerUp={persistDialogSize}
      className={cx("settings-dialog", maximized && "is-maximized")} aria-labelledby="settings-title" aria-modal="true" role="dialog">
      <header className="settings-header">
        <h2 id="settings-title">Settings</h2>
        <div className="settings-window-actions">
          <button className="icon-button" aria-label={maximized ? "Restore settings window" : "Maximize settings window"}
            onClick={() => setMaximized((current) => !current)} title={maximized ? "Restore" : "Maximize"} type="button">
            {maximized ? <Minimize2 /> : <Maximize2 />}
          </button>
          <button className="icon-button" aria-label="Close settings" onClick={props.onClose} type="button"><X /></button>
        </div>
      </header>

      <aside className="settings-rail">
        <label className="settings-search"><Search aria-hidden="true" /><input ref={searchRef} aria-label="Search settings"
          placeholder="Search settings…" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
          {searchQuery ? <button aria-label="Clear settings search" onClick={() => setSearchQuery("")} type="button"><X /></button> : null}
        </label>
        <nav className="settings-categories" aria-label="Settings categories">
          {searchQuery.trim() ? <div className="settings-search-results" aria-live="polite">
            <span>{searchResults.length} {searchResults.length === 1 ? "setting" : "settings"}</span>
            {searchResults.map((result) => <button key={`${result.category}:${result.id}`} onClick={() => goToSearchResult(result)} type="button">
              <strong>{result.label}</strong><small>{categories.find((item) => item.id === result.category)?.label}</small>
            </button>)}
            {!searchResults.length ? <p>No matching settings.</p> : null}
          </div> : (["Workspace", "Content", "Files", "System"] as const).map((group) => <div className="settings-category-group" key={group}>
            <span>{group}</span>
            {categories.filter((item) => item.group === group).map((item) => {
              const Icon = item.icon;
              return <button aria-label={item.label} className={category === item.id ? "is-active" : ""} onClick={() => setCategory(item.id)} type="button" key={item.id}>
                <Icon aria-hidden="true" /><strong>{item.label}</strong>
              </button>;
            })}
          </div>)}
        </nav>
      </aside>

      <section className="settings-content-scroll" aria-label={`${activeCategory.label} settings`}>
        <header className="settings-page-heading">
          <ActiveCategoryIcon aria-hidden="true" />
          <div><h2>{activeCategory.pageTitle ?? activeCategory.label}</h2><p>{activeCategory.description}.</p></div>
        </header>
        {category === "workspace" ? <div className="settings-content">
          <SettingsSection id="workspace-layout-heading" title="Workspace layout" description="Choose the panel arrangement Serein should remember for this vault.">
            {[...Object.values(layoutPresets), ...props.applicationSettings.workspace.customLayouts].map((preset) => <button
              className={cx("settings-row", "layout-preference", preset.id === props.activePresetId && "is-selected")}
              aria-label={preset.name + " layout"} aria-pressed={preset.id === props.activePresetId}
              onClick={() => props.onSelectLayout(preset.id)} key={preset.id} type="button">
              <span className="settings-row-copy"><strong>{preset.name}</strong><small>{preset.description}</small></span>
              <span className="layout-preference-indicator" aria-hidden="true">{preset.id === props.activePresetId ? <Check /> : null}</span>
            </button>)}
          </SettingsSection>
          <SettingsSection title="Panel geometry" description="Use exact values; drag-resizing in the workspace remains available too.">
            {(["explorer", "noteList", "context"] as const).map((panelId) => <NumberSetting key={panelId}
              label={panelId === "explorer" ? "Explorer width" : panelId === "noteList" ? "Note list width" : "Context width"}
              description="Remembered for this vault." min={180} max={520} step={2} unit="px" value={props.layoutPanels[panelId].width ?? 300}
              onChange={(value) => props.onPanelChange(panelId, { width: value })} />)}
            <NumberSetting label="Editor group split" description="Width of the primary editor when two groups are open." min={25} max={75} step={1} unit="%"
              value={Math.round(props.groupSplitRatio * 100)} onChange={(value) => props.onGroupSplitChange(value / 100)} />
          </SettingsSection>
          <SettingsSection title="Visible panels" description="Keep only the supporting panels you use.">
            {(["explorer", "recentNotes", "noteList", "preview", "context"] as const).map((panelId) => <ToggleSetting key={panelId}
              label={panelId === "recentNotes" ? "Recent notes panel" : panelId === "noteList" ? "Note list" : panelId[0].toUpperCase() + panelId.slice(1)}
              checked={props.layoutPanels[panelId].visible} onChange={(visible) => props.onPanelChange(panelId, { visible })} />)}
          </SettingsSection>
          <SettingsSection title="Startup & saved layouts">
            <SelectSetting label="Startup behavior" description="Choose what appears when Serein starts." value={props.applicationSettings.startup.behavior}
              onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, startup: { ...props.applicationSettings.startup, behavior: value as ApplicationSettings["startup"]["behavior"] } })}>
              <option value="last-session">Last Session</option><option value="pinned-tabs">Pinned Tabs</option><option value="home">Home</option>
              <option value="vault-chooser">Vault Chooser</option><option value="blank">Blank Workspace</option>
            </SelectSetting>
            <form className="settings-row layout-save-row" onSubmit={(event) => { event.preventDefault(); if (!layoutName.trim()) return; props.onSaveLayoutAs(layoutName.trim()); setLayoutName(""); }}>
              <label className="settings-row-copy" htmlFor="custom-layout-name"><strong>Save current arrangement</strong><small>Create a named layout from the current panels.</small></label>
              <span className="settings-inline-action"><input id="custom-layout-name" aria-label="Custom layout name" maxLength={60} placeholder="Layout name"
                value={layoutName} onChange={(event) => setLayoutName(event.target.value)} /><button className="settings-apply" disabled={!layoutName.trim()} type="submit">Save Layout As…</button></span>
            </form>
            {props.applicationSettings.workspace.customLayouts.map((layout) => <div className="settings-row" key={layout.id}>
              <span className="settings-row-copy"><strong>{layout.name}</strong><small>Custom layout</small></span>
              <button className="settings-icon-action" aria-label={`Delete ${layout.name} layout`} onClick={() => props.onDeleteLayout(layout.id)} type="button"><Trash2 /></button>
            </div>)}
            <div className="settings-row"><span className="settings-row-copy"><strong>All saved layouts</strong><small>Return every layout to its approved default.</small></span>
              <button onClick={props.onResetAllLayouts} type="button">Reset all</button></div>
          </SettingsSection>
          <p className="settings-note">Layout changes preserve open tabs, the current note, editor position, and unsaved work.</p>
        </div> : category === "appearance" ? <div className="settings-content">
          <SettingsSection id="appearance-heading" title="Theme & color" description="Theme changes apply immediately without restarting Serein.">
            <SelectSetting label="Theme" description="Follow Windows or choose a fixed theme." value={props.applicationSettings.appearance.theme}
              onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, appearance: { ...props.applicationSettings.appearance, theme: value as ApplicationSettings["appearance"]["theme"] } })}>
              <option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option>
            </SelectSetting>
            <div className="settings-row" id="setting-accent-color"><span className="settings-row-copy"><strong>Accent color</strong><small>Used for selection, focus, and active states.</small></span>
              <span className="accent-choice-list">{accentChoices.map((color) => <button aria-label={`Use ${color} accent`} aria-pressed={props.applicationSettings.appearance.accentColor === color}
                className={props.applicationSettings.appearance.accentColor === color ? "is-selected" : ""} key={color} onClick={() => props.onApplicationSettingsChange({ ...props.applicationSettings, appearance: { ...props.applicationSettings.appearance, accentColor: color } })}
                style={{ "--swatch-color": color } as CSSProperties} type="button" />)}
                <input aria-label="Accent color" type="color" value={props.applicationSettings.appearance.accentColor}
                  onChange={(event) => props.onApplicationSettingsChange({ ...props.applicationSettings, appearance: { ...props.applicationSettings.appearance, accentColor: event.target.value } })} />
              </span>
            </div>
            <SelectSetting label="Interface density" description="Adjust row height and workspace breathing room." value={props.applicationSettings.appearance.density}
              onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, appearance: { ...props.applicationSettings.appearance, density: value as ApplicationSettings["appearance"]["density"] } })}>
              <option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option>
            </SelectSetting>
            <ToggleSetting label="Reduced motion" description="Disable non-essential interface animation." checked={props.applicationSettings.appearance.reducedMotion}
              onChange={(checked) => props.onApplicationSettingsChange({ ...props.applicationSettings, appearance: { ...props.applicationSettings.appearance, reducedMotion: checked } })} />
          </SettingsSection>
          <SettingsSection title="Typography" description="Choose readable font names; Serein manages the underlying font stack.">
            <FontSetting label="UI font" value={props.applicationSettings.appearance.uiFont} onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, appearance: { ...props.applicationSettings.appearance, uiFont: value } })} />
            <FontSetting label="Editor font" value={props.applicationSettings.appearance.editorFont} onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, appearance: { ...props.applicationSettings.appearance, editorFont: value } })} />
            <FontSetting label="Preview font" value={props.applicationSettings.appearance.previewFont} onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, appearance: { ...props.applicationSettings.appearance, previewFont: value } })} />
            <NumberSetting label="UI font size" min={10} max={22} step={1} unit="px" value={props.applicationSettings.appearance.uiFontSize} onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, appearance: { ...props.applicationSettings.appearance, uiFontSize: value } })} />
            <NumberSetting label="Editor font size" min={11} max={32} step={1} unit="px" value={props.applicationSettings.appearance.editorFontSize} onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, appearance: { ...props.applicationSettings.appearance, editorFontSize: value } })} />
            <NumberSetting label="Preview font size" min={11} max={32} step={1} unit="px" value={props.applicationSettings.appearance.previewFontSize} onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, appearance: { ...props.applicationSettings.appearance, previewFontSize: value } })} />
          </SettingsSection>
          <SettingsSection title="Scale & reading">
            <NumberSetting label="UI scale" description="Scales chrome without blurring the application." min={0.8} max={1.5} step={0.05} unit="×" value={props.applicationSettings.appearance.uiScale} onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, appearance: { ...props.applicationSettings.appearance, uiScale: value } })} />
            <NumberSetting label="Line height" min={1.2} max={2.2} step={0.1} unit="×" value={props.applicationSettings.appearance.lineHeight} onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, appearance: { ...props.applicationSettings.appearance, lineHeight: value } })} />
            <NumberSetting label="Icon size" min={14} max={28} step={1} unit="px" value={props.applicationSettings.appearance.iconSize} onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, appearance: { ...props.applicationSettings.appearance, iconSize: value } })} />
            <NumberSetting label="Editor content width" min={480} max={1200} step={20} unit="px" value={props.applicationSettings.appearance.editorContentWidth} onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, appearance: { ...props.applicationSettings.appearance, editorContentWidth: value } })} />
          </SettingsSection>
        </div> : category === "editor" ? <div className="settings-content">
          <SettingsSection id="autosave-heading" title="Saving" description="Autosave waits briefly after typing. Ctrl+S always saves immediately.">
            <SelectSetting label="Autosave delay" description="Shorter delays save sooner; every save remains atomic." value={props.debounceMs} onChange={(value) => props.onDebounceChange(Number(value))}>
              <option value={500}>0.5 seconds</option><option value={750}>0.75 seconds</option><option value={1000}>1 second</option><option value={1500}>1.5 seconds</option>
            </SelectSetting>
          </SettingsSection>
          <SettingsSection title="Document presentation">
            <ToggleSetting label="Use preview tabs" description={props.previewTabsEnabled
              ? "Single-click temporarily opens one note; editing or double-clicking keeps it."
              : "Every opened note stays as a regular tab."} checked={props.previewTabsEnabled} onChange={props.onPreviewTabsChange} />
            <SelectSetting label="Default document view" description="Editor, source and preview, or rendered preview." value={props.applicationSettings.editor.defaultMode}
              onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, editor: { ...props.applicationSettings.editor, defaultMode: value as EditorMode } })}>
              <option value="editor">Editor</option><option value="split">Split</option><option value="preview">Preview</option>
            </SelectSetting>
            <SelectSetting label="Tab width" description="Number of spaces represented by Tab." value={props.applicationSettings.editor.tabWidth}
              onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, editor: { ...props.applicationSettings.editor, tabWidth: Number(value) } })}>
              <option value="2">2 spaces</option><option value="4">4 spaces</option><option value="8">8 spaces</option>
            </SelectSetting>
            {([
              ["Word wrap", "wordWrap", "Wrap long Markdown lines within the editor."],
              ["Spellcheck", "spellcheck", "Use the Windows webview spellchecker."],
              ["Line numbers", "lineNumbers", "Show source line numbers in Editor mode."],
              ["Code folding", "folding", "Remember folding for supported syntax."],
              ["Formatting toolbar", "toolbarVisible", "Show document presentation controls above the editor."],
              ["Indent with tabs", "indentWithTabs", "Insert tab characters instead of spaces."],
            ] as const).map(([label, key, help]) => <ToggleSetting key={key} label={label} description={help} checked={props.applicationSettings.editor[key] as boolean}
              onChange={(checked) => props.onApplicationSettingsChange({ ...props.applicationSettings, editor: { ...props.applicationSettings.editor, [key]: checked } })} />)}
          </SettingsSection>
          <p className="settings-note">Source mode always shows the real Markdown. Saving uses revision checks and atomic replacement.</p>
        </div> : category === "navigation" ? <div className="settings-content">
          <SettingsSection id="navigation-heading" title="Tabs & recents" description="Keep frequent destinations visible and temporary notes lightweight.">
            <ToggleSetting label="Navigation preview tabs" description="Single-click opens one temporary tab; editing promotes it." checked={props.previewTabsEnabled} onChange={props.onPreviewTabsChange} />
            <SelectSetting label="Recent note behavior" description="Choose how Recent Notes are ordered." value={props.applicationSettings.navigation.recentNoteBehavior}
              onChange={(value) => props.onApplicationSettingsChange({ ...props.applicationSettings, navigation: { ...props.applicationSettings.navigation, recentNoteBehavior: value as "opened" | "modified" } })}>
              <option value="opened">Recently opened</option><option value="modified">Recently modified</option>
            </SelectSetting>
          </SettingsSection>
          <SettingsSection id="ribbon-items-heading" title="Ribbon items" description="Show or hide workspace destinations without deleting their commands.">
            {["files", "search", "trash", "tasks", "calendar", "graph"].map((item) => {
              const hidden = props.applicationSettings.navigation.hiddenRibbonItems.includes(item);
              return <ToggleSetting key={item} label={item[0].toUpperCase() + item.slice(1)} checked={!hidden} onChange={(checked) => {
                const nextHidden = checked ? props.applicationSettings.navigation.hiddenRibbonItems.filter((candidate) => candidate !== item) : [...props.applicationSettings.navigation.hiddenRibbonItems, item];
                props.onApplicationSettingsChange({ ...props.applicationSettings, navigation: { ...props.applicationSettings.navigation, hiddenRibbonItems: nextHidden } });
              }} />;
            })}
          </SettingsSection>
        </div> : category === "shortcuts" ? <ShortcutSettings showHeading={false} definitions={commandDefinitions} bindings={props.commandBindings} onChange={props.onCommandBindingsChange} />
          : category === "advanced" ? <div className="settings-content">
            <SettingsSection id="advanced-heading" title="Safety & customization" description="Portable settings, local CSS, and safe recovery controls.">
              <ToggleSetting label="Safe mode" description="Ignore custom CSS so a broken snippet cannot block the interface." checked={props.applicationSettings.advanced.safeMode}
                onChange={(checked) => props.onApplicationSettingsChange({ ...props.applicationSettings, advanced: { ...props.applicationSettings.advanced, safeMode: checked } })} />
              <div className="settings-row settings-row-stacked" id="setting-local-css-snippet"><label className="settings-row-copy" htmlFor="local-css-snippet"><strong>Local CSS snippet</strong><small>Advanced visual overrides stored locally.</small></label>
                <textarea id="local-css-snippet" aria-label="Local CSS snippet" rows={8} value={props.applicationSettings.advanced.customCss}
                  onChange={(event) => props.onApplicationSettingsChange({ ...props.applicationSettings, advanced: { ...props.applicationSettings.advanced, customCss: event.target.value } })} /></div>
              <div className="settings-row settings-row-stacked" id="setting-settings-json"><label className="settings-row-copy" htmlFor="settings-json"><strong>Settings JSON</strong><small>Paste or copy a portable settings backup.</small></label>
                <textarea id="settings-json" aria-label="Settings JSON" rows={8} placeholder="Paste exported Serein settings here" value={importText} onChange={(event) => setImportText(event.target.value)} />
                <div className="settings-button-row"><button onClick={() => { setImportText(exportApplicationSettings(props.applicationSettings)); setAdvancedMessage("Settings exported below. Copy the JSON to keep a portable backup."); }} type="button">Export Settings</button>
                  <button disabled={!importText.trim()} onClick={() => { try { props.onApplicationSettingsChange(importApplicationSettings(importText)); setAdvancedMessage("Settings imported safely."); } catch (error) { setAdvancedMessage(error instanceof Error ? error.message : String(error)); } }} type="button">Import Settings</button></div>
              </div>
              <div className="settings-row"><span className="settings-row-copy"><strong>Reset every setting</strong><small>Vault files are never changed by this action.</small></span>
                <button className="destructive-quiet" onClick={() => { if (window.confirm("Reset every Serein setting? Vault files will not be changed.")) props.onApplicationSettingsChange(createDefaultApplicationSettings()); }} type="button">Reset Settings</button></div>
            </SettingsSection>
            {advancedMessage ? <p className="settings-note" role="status">{advancedMessage}</p> : null}
          </div> : category === "attachments" ? <div className="settings-content attachment-settings">
            <SettingsSection id="attachment-heading" title="Attachment storage" description="Imports are copied safely before Serein inserts a relative Markdown link.">
              <div className="settings-row" id="setting-attachment-folder">
                <label className="settings-row-copy" htmlFor="attachment-folder"><strong>Attachment folder</strong><small>Defaults to Attachments/ at the vault root.</small></label>
                <input id="attachment-folder" aria-label="Attachment folder" value={attachmentDirectory}
                  onChange={(event) => { setAttachmentDirectory(event.target.value); setAttachmentError(null); }} />
              </div>
            </SettingsSection>
            {attachmentError ? <p className="attachment-settings-error" role="alert">{attachmentError}</p> : null}
            {props.attachmentIssues.length ? <SettingsSection title="Broken references" description="Serein suggests repairs only when a match is reliable.">
              {props.attachmentIssues.map((issue) => <div className="settings-row attachment-issue-row" key={`${issue.notePath}:${issue.brokenTarget}`}>
                <AlertTriangle /><span className="settings-row-copy"><strong>{issue.brokenTarget}</strong><small>{issue.notePath}</small></span>
                {issue.suggestedPath ? <button disabled={attachmentBusy} onClick={() => void props.onRepairAttachment(issue)} type="button">Repair</button> : <small>Review manually</small>}
              </div>)}
            </SettingsSection> : null}
            <SettingsSection id="attachment-manager-heading" title="Attachment manager" description={`${props.attachments.length} ${props.attachments.length === 1 ? "file" : "files"}. Orphan detection is advisory.`}>
              <div className="settings-row"><span className="settings-row-copy"><strong>Refresh inventory</strong><small>Rescan attachment filenames and references.</small></span>
                <button disabled={attachmentBusy} onClick={() => void props.onRefreshAttachments()} type="button"><RefreshCw />Refresh</button></div>
              {props.attachments.map((attachment) => <div className="settings-row attachment-row" key={attachment.relativePath}>
                <Paperclip /><span className="settings-row-copy"><strong>{attachment.relativePath}</strong><small>{formatBytes(attachment.byteLength)} · {attachment.referenced ? "Referenced" : "Review as orphan"}</small></span>
                <button aria-label={`Move ${attachment.relativePath.split("/").at(-1)}`} onClick={() => { setMoving(attachment.relativePath); setMovePath(attachment.relativePath); setAttachmentError(null); }} type="button"><Pencil /></button>
              </div>)}
              {!props.attachments.length ? <p className="attachment-empty">Paste or drop a file into a note to see it here.</p> : null}
              {moving ? <form className="attachment-move-form" onSubmit={moveAttachment}><label><span>New attachment path</span><input autoFocus aria-label="New attachment path" value={movePath} onChange={(event) => setMovePath(event.target.value)} /></label>
                <div><button className="settings-apply" aria-label="Apply attachment move" disabled={attachmentBusy || !movePath.trim()} type="submit">Apply</button><button disabled={attachmentBusy} onClick={() => setMoving(null)} type="button">Cancel</button></div></form> : null}
            </SettingsSection>
            <p className="settings-note">Internal .serein files can never be selected. Serein never deletes attachments automatically.</p>
          </div> : category === "about" ? <div className="settings-content">
            <SettingsSection id="about-serein-heading" title="Serein" description="Pronounced seh-reen.">
              <div className="settings-row"><span className="settings-row-copy"><strong>Version</strong><small>Current local pre-release build.</small></span><span>{packageMetadata.version}</span></div>
              <div className="settings-row"><span className="settings-row-copy"><strong>Local-first by design</strong><small>Markdown files remain authoritative and core features work offline.</small></span><span>Offline capable</span></div>
              <div className="settings-row"><span className="settings-row-copy"><strong>Privacy</strong><small>No telemetry, analytics, advertising, or automatic crash uploads.</small></span><span>Zero telemetry</span></div>
            </SettingsSection>
            <p className="settings-note">Serein is a private Windows Markdown workspace. Public release information will be added only after local acceptance is complete.</p>
          </div> : <div className="settings-content recovery-settings">
            <SettingsSection id="recovery-heading" title="Recovery & retention" description="Autosave stays frequent while version snapshots remain intentional and storage-aware.">
              <div className="recovery-settings-form">
                <SelectSetting label="Snapshot interval" description="Minimum time between ordinary version snapshots." value={recoverySettings.snapshotIntervalMinutes} onChange={(value) => setRecoverySettings({ ...recoverySettings, snapshotIntervalMinutes: Number(value) })}>
                  <option value={5}>5 minutes</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option>
                </SelectSetting>
                <SelectSetting label="Version retention" description="Age limit for ordinary snapshots." value={recoverySettings.retentionDays} onChange={(value) => setRecoverySettings({ ...recoverySettings, retentionDays: Number(value) })}>
                  <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option>
                </SelectSetting>
                <SelectSetting label="Maximum backup storage" description="Storage cap applied during cleanup." value={recoverySettings.maxStorageBytes} onChange={(value) => setRecoverySettings({ ...recoverySettings, maxStorageBytes: Number(value) })}>
                  <option value={268435456}>256 MB</option><option value={536870912}>512 MB</option><option value={1073741824}>1 GB</option><option value={2147483648}>2 GB</option><option value={5368709120}>5 GB</option>
                </SelectSetting>
                <SelectSetting label="Trash cleanup" description="Keep recoverable items until this age." value={recoverySettings.trashRetentionDays ?? "off"} onChange={(value) => setRecoverySettings({ ...recoverySettings, trashRetentionDays: value === "off" ? null : Number(value) })}>
                  <option value="off">Off — keep until emptied</option><option value={30}>After 30 days</option><option value={90}>After 90 days</option><option value={365}>After 1 year</option>
                </SelectSetting>
                <ToggleSetting label="Automatic cleanup" description="Apply the age and storage limits in the background." checked={recoverySettings.automaticCleanup} onChange={(checked) => setRecoverySettings({ ...recoverySettings, automaticCleanup: checked })} />
                {recoveryError ? <p className="attachment-settings-error" role="alert">{recoveryError}</p> : null}
                <div className="settings-row"><span className="settings-row-copy"><strong>Cleanup now</strong><small>Apply the current retention limits immediately.</small></span>
                  <button disabled={recoveryBusy || props.recoveryActivity.phase === "working"} onClick={() => void props.onCleanupRecovery()} type="button"><RefreshCw />Run cleanup</button></div>
              </div>
            </SettingsSection>
            <p className="settings-note">Risky overwrites always create an immediate safety snapshot. Recovery data stays under .serein/ and never appears in normal search or Files.</p>
            {props.recoveryActivity.phase !== "idle" ? <p className={cx("recovery-settings-status", "phase-" + props.recoveryActivity.phase)} aria-live="polite"><ShieldCheck />{props.recoveryActivity.message}</p> : null}
          </div>}
      </section>

      <footer className="settings-footer">
        <button disabled={!canResetSection} onClick={resetCurrentSection} type="button">Reset section</button>
        <span><Check aria-hidden="true" />{attachmentBusy || recoveryBusy ? "Saving…" : "Saved automatically"}</span>
        <button className="settings-done" onClick={props.onClose} type="button">Done</button>
      </footer>
    </section>
  </div>;
}

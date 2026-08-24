import { commandDefinitions, createDefaultShortcutBindings, type ShortcutBindings } from "../commands/commandRegistry";
import type { EditorMode } from "../workspace/noteSessions";
import type { LayoutPreset } from "../workspace/layoutPresets";

export type ThemeMode = "system" | "dark" | "light";
export type InterfaceDensity = "compact" | "comfortable" | "spacious";
export type StartupBehavior = "last-session" | "pinned-tabs" | "home" | "vault-chooser" | "blank";

export interface ApplicationSettings {
  version: 2;
  appearance: {
    theme: ThemeMode;
    accentColor: string;
    uiFont: string;
    editorFont: string;
    previewFont: string;
    uiFontSize: number;
    editorFontSize: number;
    previewFontSize: number;
    lineHeight: number;
    uiScale: number;
    density: InterfaceDensity;
    iconSize: number;
    editorContentWidth: number;
    reducedMotion: boolean;
  };
  workspace: {
    defaultLayoutId: string;
    customLayouts: LayoutPreset[];
  };
  editor: {
    defaultMode: EditorMode;
    wordWrap: boolean;
    spellcheck: boolean;
    lineNumbers: boolean;
    folding: boolean;
    toolbarVisible: boolean;
    tabWidth: number;
    indentWithTabs: boolean;
    autosaveDebounceMs: number;
  };
  navigation: {
    ribbonOrder: string[];
    hiddenRibbonItems: string[];
    previewTabsEnabled: boolean;
    recentNoteBehavior: "opened" | "modified";
  };
  shortcuts: ShortcutBindings;
  startup: {
    behavior: StartupBehavior;
    lastVaultRoot: string | null;
  };
  advanced: {
    safeMode: boolean;
    customCss: string;
  };
}

export interface SettingsMigrationResult {
  settings: ApplicationSettings;
  migrated: boolean;
  warning: string | null;
}

const clamp = (value: unknown, fallback: number, min: number, max: number) =>
  Math.max(min, Math.min(max, typeof value === "number" && Number.isFinite(value) ? value : fallback));

export function createDefaultApplicationSettings(): ApplicationSettings {
  return {
    version: 2,
    appearance: {
      theme: "dark",
      accentColor: "#a56cf5",
      uiFont: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
      editorFont: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
      previewFont: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
      uiFontSize: 13,
      editorFontSize: 16,
      previewFontSize: 15,
      lineHeight: 1.7,
      uiScale: 1,
      density: "comfortable",
      iconSize: 19,
      editorContentWidth: 760,
      reducedMotion: false,
    },
    workspace: { defaultLayoutId: "quiet-focus", customLayouts: [] },
    editor: {
      defaultMode: "editor",
      wordWrap: true,
      spellcheck: true,
      lineNumbers: false,
      folding: false,
      toolbarVisible: true,
      tabWidth: 2,
      indentWithTabs: false,
      autosaveDebounceMs: 750,
    },
    navigation: {
      ribbonOrder: ["files", "search", "trash", "tasks", "calendar", "graph"],
      hiddenRibbonItems: [],
      previewTabsEnabled: true,
      recentNoteBehavior: "opened",
    },
    shortcuts: createDefaultShortcutBindings(commandDefinitions),
    startup: { behavior: "last-session", lastVaultRoot: null },
    advanced: { safeMode: false, customCss: "" },
  };
}

function validAccent(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function normalizeCurrent(value: Record<string, unknown>): ApplicationSettings {
  const defaults = createDefaultApplicationSettings();
  const appearance = value.appearance as Partial<ApplicationSettings["appearance"]>;
  const workspace = value.workspace as Partial<ApplicationSettings["workspace"]>;
  const editor = value.editor as Partial<ApplicationSettings["editor"]>;
  const navigation = value.navigation as Partial<ApplicationSettings["navigation"]>;
  const startup = value.startup as Partial<ApplicationSettings["startup"]>;
  const advanced = value.advanced as Partial<ApplicationSettings["advanced"]>;
  const themes: ThemeMode[] = ["system", "dark", "light"];
  const densities: InterfaceDensity[] = ["compact", "comfortable", "spacious"];
  const modes: EditorMode[] = ["editor", "split", "preview"];
  const startupBehaviors: StartupBehavior[] = ["last-session", "pinned-tabs", "home", "vault-chooser", "blank"];
  const customLayouts = Array.isArray(workspace.customLayouts)
    ? workspace.customLayouts.filter((layout): layout is LayoutPreset => Boolean(layout && typeof layout.id === "string" && typeof layout.name === "string" && layout.panels))
    : [];
  const shortcuts = value.shortcuts && typeof value.shortcuts === "object"
    ? { ...defaults.shortcuts, ...(value.shortcuts as ShortcutBindings) }
    : defaults.shortcuts;
  return {
    version: 2,
    appearance: {
      theme: themes.includes(appearance.theme as ThemeMode) ? appearance.theme! : defaults.appearance.theme,
      accentColor: validAccent(appearance.accentColor, defaults.appearance.accentColor),
      uiFont: typeof appearance.uiFont === "string" ? appearance.uiFont : defaults.appearance.uiFont,
      editorFont: typeof appearance.editorFont === "string" ? appearance.editorFont : defaults.appearance.editorFont,
      previewFont: typeof appearance.previewFont === "string" ? appearance.previewFont : defaults.appearance.previewFont,
      uiFontSize: clamp(appearance.uiFontSize, defaults.appearance.uiFontSize, 10, 22),
      editorFontSize: clamp(appearance.editorFontSize, defaults.appearance.editorFontSize, 11, 32),
      previewFontSize: clamp(appearance.previewFontSize, defaults.appearance.previewFontSize, 11, 32),
      lineHeight: clamp(appearance.lineHeight, defaults.appearance.lineHeight, 1.2, 2.2),
      uiScale: clamp(appearance.uiScale, defaults.appearance.uiScale, 0.8, 1.5),
      density: densities.includes(appearance.density as InterfaceDensity) ? appearance.density! : defaults.appearance.density,
      iconSize: clamp(appearance.iconSize, defaults.appearance.iconSize, 14, 28),
      editorContentWidth: clamp(appearance.editorContentWidth, defaults.appearance.editorContentWidth, 480, 1200),
      reducedMotion: typeof appearance.reducedMotion === "boolean" ? appearance.reducedMotion : defaults.appearance.reducedMotion,
    },
    workspace: {
      defaultLayoutId: typeof workspace.defaultLayoutId === "string" ? workspace.defaultLayoutId : defaults.workspace.defaultLayoutId,
      customLayouts,
    },
    editor: {
      defaultMode: modes.includes(editor.defaultMode as EditorMode) ? editor.defaultMode! : defaults.editor.defaultMode,
      wordWrap: typeof editor.wordWrap === "boolean" ? editor.wordWrap : defaults.editor.wordWrap,
      spellcheck: typeof editor.spellcheck === "boolean" ? editor.spellcheck : defaults.editor.spellcheck,
      lineNumbers: typeof editor.lineNumbers === "boolean" ? editor.lineNumbers : defaults.editor.lineNumbers,
      folding: typeof editor.folding === "boolean" ? editor.folding : defaults.editor.folding,
      toolbarVisible: typeof editor.toolbarVisible === "boolean" ? editor.toolbarVisible : defaults.editor.toolbarVisible,
      tabWidth: clamp(editor.tabWidth, defaults.editor.tabWidth, 1, 8),
      indentWithTabs: typeof editor.indentWithTabs === "boolean" ? editor.indentWithTabs : defaults.editor.indentWithTabs,
      autosaveDebounceMs: clamp(editor.autosaveDebounceMs, defaults.editor.autosaveDebounceMs, 250, 5000),
    },
    navigation: {
      ribbonOrder: Array.isArray(navigation.ribbonOrder) ? navigation.ribbonOrder.filter((item): item is string => typeof item === "string") : defaults.navigation.ribbonOrder,
      hiddenRibbonItems: Array.isArray(navigation.hiddenRibbonItems) ? navigation.hiddenRibbonItems.filter((item): item is string => typeof item === "string") : defaults.navigation.hiddenRibbonItems,
      previewTabsEnabled: typeof navigation.previewTabsEnabled === "boolean" ? navigation.previewTabsEnabled : defaults.navigation.previewTabsEnabled,
      recentNoteBehavior: navigation.recentNoteBehavior === "modified" ? "modified" : "opened",
    },
    shortcuts,
    startup: {
      behavior: startupBehaviors.includes(startup.behavior as StartupBehavior) ? startup.behavior! : defaults.startup.behavior,
      lastVaultRoot: typeof startup.lastVaultRoot === "string" ? startup.lastVaultRoot : null,
    },
    advanced: {
      safeMode: typeof advanced.safeMode === "boolean" ? advanced.safeMode : defaults.advanced.safeMode,
      customCss: typeof advanced.customCss === "string" ? advanced.customCss.slice(0, 100_000) : defaults.advanced.customCss,
    },
  };
}

export function migrateApplicationSettings(value: unknown): SettingsMigrationResult {
  const defaults = createDefaultApplicationSettings();
  if (!value || typeof value !== "object") return { settings: defaults, migrated: false, warning: "Settings could not be read. Serein started with safe defaults." };
  const source = value as Record<string, unknown>;
  if (source.version === 2) {
    if (!source.appearance || typeof source.appearance !== "object" || !source.editor || typeof source.editor !== "object") {
      return { settings: defaults, migrated: false, warning: "Settings could not be read. Serein started with safe defaults." };
    }
    return { settings: normalizeCurrent(source), migrated: false, warning: null };
  }
  if (source.version === 1) {
    const migrated: ApplicationSettings = {
      ...defaults,
      appearance: {
        ...defaults.appearance,
        theme: source.theme === "light" || source.theme === "system" ? source.theme : "dark",
        uiScale: clamp(source.uiScale, defaults.appearance.uiScale, 0.8, 1.5),
      },
      editor: { ...defaults.editor, autosaveDebounceMs: clamp(source.debounceMs, defaults.editor.autosaveDebounceMs, 250, 5000) },
      navigation: { ...defaults.navigation, previewTabsEnabled: typeof source.previewTabsEnabled === "boolean" ? source.previewTabsEnabled : true },
      shortcuts: source.commandBindings && typeof source.commandBindings === "object" ? { ...defaults.shortcuts, ...(source.commandBindings as ShortcutBindings) } : defaults.shortcuts,
      startup: { ...defaults.startup, lastVaultRoot: typeof source.lastVaultRoot === "string" ? source.lastVaultRoot : null },
    };
    return { settings: migrated, migrated: true, warning: null };
  }
  return { settings: defaults, migrated: false, warning: "Settings could not be read. Serein started with safe defaults." };
}

export function exportApplicationSettings(settings: ApplicationSettings) {
  return JSON.stringify(settings, null, 2);
}

export function importApplicationSettings(serialized: string) {
  const result = migrateApplicationSettings(JSON.parse(serialized) as unknown);
  if (result.warning) throw new Error(result.warning);
  return result.settings;
}

export function resetAppearance(settings: ApplicationSettings): ApplicationSettings {
  return { ...settings, appearance: createDefaultApplicationSettings().appearance };
}

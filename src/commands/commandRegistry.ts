export type CommandSource = "shortcut" | "palette" | "ribbon" | "menu" | "context" | "api";

export interface CommandDefinition {
  id: string;
  label: string;
  category: string;
  defaultShortcuts: string[];
  aliases?: string[];
  description?: string;
}

export interface CommandInvocation {
  commandId: string;
  source: CommandSource;
  target?: unknown;
}

export interface CommandBinding {
  run: (invocation: CommandInvocation) => void | Promise<void>;
  enabled?: () => boolean;
}

export type ShortcutBindings = Record<string, string[]>;

export interface ShortcutConflict {
  commandId: string;
  shortcut: string;
  slot: number;
}

const modifierOrder = ["Ctrl", "Alt", "Shift", "Meta"];

function canonicalKey(key: string) {
  const aliases: Record<string, string> = {
    " ": "Space",
    ",": ",",
    ".": ".",
    Escape: "Escape",
    Esc: "Escape",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Delete: "Delete",
    Backspace: "Backspace",
    Enter: "Enter",
    Tab: "Tab",
  };
  if (aliases[key]) return aliases[key];
  return key.length === 1 ? key.toUpperCase() : key;
}

export function normalizeShortcut(shortcut: string) {
  return shortcut
    .split(" ")
    .filter(Boolean)
    .map((stroke) => {
      const parts = stroke.split("+").filter(Boolean);
      const key = canonicalKey(parts.at(-1) ?? "");
      const modifiers = modifierOrder.filter((modifier) =>
        parts.some((part) => part.toLowerCase() === modifier.toLowerCase()),
      );
      return [...modifiers, key].filter(Boolean).join("+");
    })
    .join(" ");
}

export function eventToShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">) {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;
  const modifiers = [
    event.ctrlKey ? "Ctrl" : null,
    event.altKey ? "Alt" : null,
    event.shiftKey ? "Shift" : null,
    event.metaKey ? "Meta" : null,
  ].filter((value): value is string => Boolean(value));
  return [...modifiers, canonicalKey(event.key)].join("+");
}

export function createDefaultShortcutBindings(definitions: readonly CommandDefinition[]): ShortcutBindings {
  return Object.fromEntries(definitions.map((definition) => [
    definition.id,
    definition.defaultShortcuts.map(normalizeShortcut),
  ]));
}

export function findShortcutConflict(bindings: ShortcutBindings, commandId: string, shortcut: string) {
  const normalized = normalizeShortcut(shortcut);
  for (const [candidateId, shortcuts] of Object.entries(bindings)) {
    const slot = shortcuts.findIndex((candidate) => normalizeShortcut(candidate) === normalized);
    if (candidateId !== commandId && slot >= 0) return { commandId: candidateId, shortcut: normalized, slot };
  }
  return null;
}

export function rebindShortcut(
  bindings: ShortcutBindings,
  commandId: string,
  shortcut: string | null,
  slot: number,
  replaceConflict = false,
): { bindings: ShortcutBindings; conflict: ShortcutConflict | null } {
  const normalized = shortcut ? normalizeShortcut(shortcut) : null;
  const conflict = normalized ? findShortcutConflict(bindings, commandId, normalized) : null;
  if (conflict && !replaceConflict) return { bindings, conflict };

  const next = Object.fromEntries(Object.entries(bindings).map(([id, values]) => [id, [...values]]));
  if (conflict) next[conflict.commandId] = next[conflict.commandId].filter((_, index) => index !== conflict.slot);
  const values = [...(next[commandId] ?? [])];
  if (normalized) values[slot] = normalized;
  else values.splice(slot, 1);
  next[commandId] = values.filter(Boolean).slice(0, 2);
  return { bindings: next, conflict: null };
}

export function commandForShortcut(bindings: ShortcutBindings, shortcut: string) {
  const normalized = normalizeShortcut(shortcut);
  return Object.entries(bindings).find(([, shortcuts]) => shortcuts.some((candidate) => normalizeShortcut(candidate) === normalized))?.[0] ?? null;
}

export class CommandRegistry {
  private readonly definitions = new Map<string, CommandDefinition>();
  private readonly bindings = new Map<string, CommandBinding>();

  constructor(definitions: readonly CommandDefinition[]) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.id)) throw new Error(`Duplicate command id: ${definition.id}`);
      this.definitions.set(definition.id, { ...definition, defaultShortcuts: [...definition.defaultShortcuts] });
    }
  }

  bind(commandId: string, binding: CommandBinding) {
    if (!this.definitions.has(commandId)) throw new Error(`Unknown command: ${commandId}`);
    this.bindings.set(commandId, binding);
    return this;
  }

  list() {
    return [...this.definitions.values()];
  }

  get(commandId: string) {
    return this.definitions.get(commandId) ?? null;
  }

  isEnabled(commandId: string) {
    const binding = this.bindings.get(commandId);
    return Boolean(binding && (binding.enabled?.() ?? true));
  }

  async execute(commandId: string, source: CommandSource = "api", target?: unknown) {
    const binding = this.bindings.get(commandId);
    if (!binding || !(binding.enabled?.() ?? true)) return false;
    await binding.run({ commandId, source, target });
    return true;
  }
}

export const commandDefinitions: readonly CommandDefinition[] = [
  { id: "note.new", label: "New note", category: "Note", defaultShortcuts: ["Ctrl+N"], aliases: ["create file"] },
  { id: "note.close", label: "Close current tab", category: "Note", defaultShortcuts: ["Ctrl+W"], aliases: ["close note"] },
  { id: "note.closeOthers", label: "Close other tabs", category: "Note", defaultShortcuts: [] },
  { id: "note.closeRight", label: "Close tabs to the right", category: "Note", defaultShortcuts: [] },
  { id: "note.reopenClosed", label: "Reopen closed tab", category: "Note", defaultShortcuts: ["Ctrl+Shift+T"] },
  { id: "note.openSecondGroup", label: "Open in second group", category: "Note", defaultShortcuts: ["Ctrl+Alt+Enter"], aliases: ["split editor"] },
  { id: "note.pin", label: "Pin or unpin current tab", category: "Note", defaultShortcuts: [] },
  { id: "editor.save", label: "Save note", category: "Editor", defaultShortcuts: ["Ctrl+S"] },
  { id: "editor.togglePreview", label: "Toggle preview", category: "Editor", defaultShortcuts: ["Ctrl+E"], aliases: ["editor mode"] },
  { id: "workspace.toggleSidebar", label: "Toggle note context", category: "Workspace", defaultShortcuts: ["Ctrl+Shift+B"] },
  { id: "search.openVaultSearch", label: "Search vault", category: "Navigation", defaultShortcuts: ["Ctrl+Shift+F"], aliases: ["deep search"] },
  { id: "navigation.quickSwitcher", label: "Quick Switcher", category: "Navigation", defaultShortcuts: ["Ctrl+P"], aliases: ["open note"] },
  { id: "navigation.commandPalette", label: "Command Palette", category: "Navigation", defaultShortcuts: ["Ctrl+Shift+P"], aliases: ["commands"] },
  { id: "vault.switch", label: "Switch vault", category: "Vault", defaultShortcuts: [], aliases: ["open vault"] },
  { id: "recovery.openTrash", label: "Open Trash", category: "Recovery", defaultShortcuts: ["Ctrl+Shift+Delete"] },
  { id: "settings.open", label: "Open Settings", category: "Workspace", defaultShortcuts: ["Ctrl+,"], aliases: ["preferences"] },
];

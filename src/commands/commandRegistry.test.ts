import { describe, expect, it, vi } from "vitest";

import {
  CommandRegistry,
  createDefaultShortcutBindings,
  eventToShortcut,
  rebindShortcut,
} from "./commandRegistry";

describe("CommandRegistry", () => {
  it("invokes the same command handler from every surface", async () => {
    const run = vi.fn();
    const registry = new CommandRegistry([{ id: "editor.save", label: "Save", category: "Editor", defaultShortcuts: ["Ctrl+S"] }]);
    registry.bind("editor.save", { run, enabled: () => true });

    await registry.execute("editor.save", "shortcut");
    await registry.execute("editor.save", "palette");
    await registry.execute("editor.save", "ribbon");

    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls.map((call) => call[0].source)).toEqual(["shortcut", "palette", "ribbon"]);
  });

  it("blocks disabled commands without calling their handler", async () => {
    const run = vi.fn();
    const registry = new CommandRegistry([{ id: "note.close", label: "Close note", category: "Note", defaultShortcuts: ["Ctrl+W"] }]);
    registry.bind("note.close", { run, enabled: () => false });

    expect(await registry.execute("note.close", "palette")).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("normalizes keyboard events and detects shortcut conflicts when rebinding", () => {
    const definitions = [
      { id: "quick.open", label: "Quick Switcher", category: "Navigation", defaultShortcuts: ["Ctrl+P"] },
      { id: "palette.open", label: "Command Palette", category: "Navigation", defaultShortcuts: ["Ctrl+Shift+P"] },
    ];
    const bindings = createDefaultShortcutBindings(definitions);
    expect(eventToShortcut({ key: "p", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false })).toBe("Ctrl+Shift+P");

    const result = rebindShortcut(bindings, "quick.open", "Ctrl+Shift+P", 0);
    expect(result.conflict?.commandId).toBe("palette.open");
    expect(result.bindings).toEqual(bindings);

    const forced = rebindShortcut(bindings, "quick.open", "Ctrl+Shift+P", 0, true);
    expect(forced.conflict).toBeNull();
    expect(forced.bindings["quick.open"][0]).toBe("Ctrl+Shift+P");
    expect(forced.bindings["palette.open"]).toEqual([]);
  });
});

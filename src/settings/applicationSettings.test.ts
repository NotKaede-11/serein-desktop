import { describe, expect, it } from "vitest";

import {
  createDefaultApplicationSettings,
  exportApplicationSettings,
  importApplicationSettings,
  migrateApplicationSettings,
  resetAppearance,
} from "./applicationSettings";

describe("application settings", () => {
  it("migrates an older schema without resetting unrelated preferences", () => {
    const result = migrateApplicationSettings({
      version: 1,
      theme: "light",
      uiScale: 1.25,
      debounceMs: 1500,
      previewTabsEnabled: false,
      lastVaultRoot: "C:/Synthetic/Vault",
    });

    expect(result.migrated).toBe(true);
    expect(result.settings.appearance.theme).toBe("light");
    expect(result.settings.appearance.uiScale).toBe(1.25);
    expect(result.settings.editor.autosaveDebounceMs).toBe(1500);
    expect(result.settings.navigation.previewTabsEnabled).toBe(false);
    expect(result.settings.startup.lastVaultRoot).toBe("C:/Synthetic/Vault");
    expect(result.settings.workspace.defaultLayoutId).toBe("quiet-focus");
  });

  it("falls back safely when stored settings are malformed", () => {
    const result = migrateApplicationSettings({ version: 2, appearance: "broken" });

    expect(result.settings).toEqual(createDefaultApplicationSettings());
    expect(result.warning).toMatch(/could not be read/i);
  });

  it("round-trips exported settings and clamps unsafe scale values", () => {
    const settings = createDefaultApplicationSettings();
    settings.appearance.uiScale = 9;
    settings.appearance.accentColor = "#7c5cff";

    const imported = importApplicationSettings(exportApplicationSettings(settings));

    expect(imported.appearance.uiScale).toBe(1.5);
    expect(imported.appearance.accentColor).toBe("#7c5cff");
  });

  it("resets appearance without destroying shortcuts or layouts", () => {
    const settings = createDefaultApplicationSettings();
    settings.appearance.theme = "light";
    settings.shortcuts["editor.save"] = ["Alt+S"];
    settings.workspace.customLayouts.push({
      id: "custom-study",
      name: "Study",
      description: "A saved custom arrangement.",
      panels: {
        explorer: { visible: true, width: 280, placement: "left" },
        recentNotes: { visible: false, width: 240, placement: "left" },
        noteList: { visible: false, width: 300, placement: "left" },
        editor: { visible: true, placement: "center" },
        preview: { visible: true, placement: "right" },
        context: { visible: false, width: 300, placement: "right" },
      },
    });

    const reset = resetAppearance(settings);

    expect(reset.appearance).toEqual(createDefaultApplicationSettings().appearance);
    expect(reset.shortcuts["editor.save"]).toEqual(["Alt+S"]);
    expect(reset.workspace.customLayouts).toHaveLength(1);
  });
});

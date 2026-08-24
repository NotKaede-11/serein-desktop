import { describe, expect, it } from "vitest";

import {
  closeOtherTabs,
  closeTabsToRight,
  closeTab,
  createNoteSessions,
  moveTabToGroup,
  openTab,
  promoteTab,
  reopenClosedTab,
  reorderTab,
  setPreviewTabsEnabled,
  updateEditorViewState,
  restoreNoteSessions,
  serializeNoteSessions,
} from "./noteSessions";

describe("note sessions", () => {
  it("replaces a temporary preview and promotes it on edit", () => {
    let state = createNoteSessions("Notes/Welcome.md");
    state = openTab(state, "Notes/Alpha.md", { preview: true });
    state = openTab(state, "Notes/Beta.md", { preview: true });

    expect(state.groups.primary.tabIds).toEqual(["Notes/Welcome.md", "Notes/Beta.md"]);
    expect(state.sessions["Notes/Alpha.md"]).toBeUndefined();
    expect(state.sessions["Notes/Beta.md"].preview).toBe(true);

    state = promoteTab(state, "Notes/Beta.md");
    expect(state.sessions["Notes/Beta.md"].preview).toBe(false);
  });

  it("keeps every single-click tab when preview tabs are disabled", () => {
    let state = setPreviewTabsEnabled(createNoteSessions("Notes/Welcome.md"), false);
    state = openTab(state, "Notes/Alpha.md", { preview: true });
    state = openTab(state, "Notes/Beta.md", { preview: true });
    expect(state.groups.primary.tabIds).toEqual(["Notes/Welcome.md", "Notes/Alpha.md", "Notes/Beta.md"]);
  });

  it("reorders, pins, closes in batches, and reopens the last closed tab", () => {
    let state = createNoteSessions("Notes/A.md");
    state = openTab(state, "Notes/B.md");
    state = openTab(state, "Notes/C.md");
    state = reorderTab(state, "primary", "Notes/C.md", 0);
    expect(state.groups.primary.tabIds).toEqual(["Notes/C.md", "Notes/A.md", "Notes/B.md"]);

    state = closeTabsToRight(state, "primary", "Notes/A.md");
    expect(state.groups.primary.tabIds).toEqual(["Notes/C.md", "Notes/A.md"]);
    state = reopenClosedTab(state);
    expect(state.groups.primary.tabIds).toContain("Notes/B.md");
    state = closeOtherTabs(state, "primary", "Notes/A.md");
    expect(state.groups.primary.tabIds).toEqual(["Notes/A.md"]);
  });

  it("shares one note session across two editor groups", () => {
    let state = createNoteSessions("Notes/A.md");
    state = openTab(state, "Notes/B.md");
    state = moveTabToGroup(state, "Notes/B.md", "secondary", { retainSourceView: true });

    expect(state.groups.primary.tabIds).toContain("Notes/B.md");
    expect(state.groups.secondary.tabIds).toContain("Notes/B.md");
    expect(Object.keys(state.sessions).filter((path) => path === "Notes/B.md")).toHaveLength(1);
  });

  it("preserves cursor, selection, scroll, mode, conflict, and dirty state across navigation", () => {
    let state = createNoteSessions("Notes/A.md");
    state = updateEditorViewState(state, "Notes/A.md", {
      selection: { anchor: 8, head: 12 }, scrollTop: 320, mode: "split", saveState: "conflict",
    });
    state = openTab(state, "Notes/B.md");
    state = openTab(state, "Notes/A.md");

    expect(state.sessions["Notes/A.md"]).toMatchObject({
      selection: { anchor: 8, head: 12 }, scrollTop: 320, mode: "split", saveState: "conflict",
    });
  });

  it("never closes a pinned tab through bulk close and can close explicitly", () => {
    let state = createNoteSessions("Notes/A.md");
    state = openTab(state, "Notes/B.md");
    state = promoteTab(state, "Notes/A.md", true);
    state = closeOtherTabs(state, "primary", "Notes/B.md");
    expect(state.groups.primary.tabIds).toContain("Notes/A.md");
    state = closeTab(state, "primary", "Notes/A.md", { forcePinned: true });
    expect(state.groups.primary.tabIds).not.toContain("Notes/A.md");
  });

  it("serializes the per-vault tab, group, pin, mode, and startup foundation", () => {
    let state = createNoteSessions("Notes/A.md");
    state = openTab(state, "Notes/B.md");
    state = promoteTab(state, "Notes/A.md", true);
    state = updateEditorViewState(state, "Notes/B.md", { mode: "preview", scrollTop: 90 });
    state = moveTabToGroup(state, "Notes/B.md", "secondary");

    const persisted = serializeNoteSessions(state);
    const restored = restoreNoteSessions(persisted, ["Notes/A.md", "Notes/B.md"]);
    expect(restored.groups.secondary.activeTabId).toBe("Notes/B.md");
    expect(restored.sessions["Notes/A.md"].pinned).toBe(true);
    expect(restored.sessions["Notes/B.md"]).toMatchObject({ mode: "preview", scrollTop: 90, saveState: "saved" });
  });
});

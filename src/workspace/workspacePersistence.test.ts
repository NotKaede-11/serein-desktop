import { describe, expect, it } from "vitest";

import { createWorkspaceState, switchLayoutPreset } from "./layoutPresets";
import { createNoteSessions, moveTabToGroup, openTab, promoteTab, updateEditorViewState } from "./noteSessions";
import { createVaultWorkspaceSession, restoreVaultWorkspaceSession } from "./workspacePersistence";

const emptyWorkspaceSession = {
  activeNoteId: null,
  openTabIds: [],
  cursorByNote: {},
  scrollByNote: {},
  undoDepthByNote: {},
  dirtyNoteIds: [],
};

describe("vault workspace persistence", () => {
  it("restores tabs, groups, modes, layout geometry, split ratio, and recent notes", () => {
    let notes = createNoteSessions("Notes/Welcome.md");
    notes = promoteTab(notes, "Notes/Welcome.md", true);
    notes = openTab(notes, "Daily/2026-08-24.md", { groupId: "secondary", duplicateView: true });
    notes = moveTabToGroup(notes, "Notes/Welcome.md", "secondary", { retainSourceView: true });
    notes = updateEditorViewState(notes, "Notes/Welcome.md", {
      mode: "split",
      selection: { anchor: 12, head: 18 },
      scrollTop: 240,
    });
    let workspace = createWorkspaceState("quiet-focus", emptyWorkspaceSession);
    workspace = switchLayoutPreset(workspace, "balanced-vault");
    workspace.layout.panels.explorer.width = 278;

    const stored = createVaultWorkspaceSession({
      noteSessions: notes,
      workspace,
      groupSplitRatio: 0.62,
      recentNotes: ["Notes/Welcome.md", "Daily/2026-08-24.md"],
    });
    const restored = restoreVaultWorkspaceSession(stored, ["Notes/Welcome.md", "Daily/2026-08-24.md"]);

    expect(restored.noteSessions.groups.primary.tabIds).toEqual(["Notes/Welcome.md"]);
    expect(restored.noteSessions.groups.secondary.tabIds).toContain("Notes/Welcome.md");
    expect(restored.noteSessions.sessions["Notes/Welcome.md"].pinned).toBe(true);
    expect(restored.noteSessions.sessions["Notes/Welcome.md"].mode).toBe("split");
    expect(restored.workspace.layout.activePresetId).toBe("balanced-vault");
    expect(restored.workspace.layout.panels.explorer.width).toBe(278);
    expect(restored.groupSplitRatio).toBe(0.62);
    expect(restored.recentNotes).toEqual(["Notes/Welcome.md", "Daily/2026-08-24.md"]);
  });

  it("drops missing notes and clamps invalid geometry instead of preventing startup", () => {
    const workspace = createWorkspaceState("quiet-focus", emptyWorkspaceSession);
    const stored = createVaultWorkspaceSession({
      noteSessions: openTab(createNoteSessions(), "Missing.md"),
      workspace,
      groupSplitRatio: 3,
      recentNotes: ["Missing.md", "Notes/Welcome.md"],
    });

    const restored = restoreVaultWorkspaceSession(stored, ["Notes/Welcome.md"]);

    expect(restored.noteSessions.groups.primary.tabIds).toEqual([]);
    expect(restored.groupSplitRatio).toBe(0.75);
    expect(restored.recentNotes).toEqual(["Notes/Welcome.md"]);
  });
});

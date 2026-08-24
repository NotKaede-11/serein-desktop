import { describe, expect, it } from "vitest";

import {
  createWorkspaceState,
  layoutPresets,
  switchLayoutPreset,
  type WorkspaceSession,
} from "./layoutPresets";

describe("layout preset switching", () => {
  it("offers only Quiet Focus and Balanced Vault", () => {
    expect(Object.keys(layoutPresets)).toEqual([
      "quiet-focus",
      "balanced-vault",
    ]);
  });

  it("changes panel presentation while preserving the active editing session", () => {
    const session: WorkspaceSession = {
      activeNoteId: "notes/demo-workspace.md",
      openTabIds: ["notes/demo-workspace.md", "notes/example-reminder.md"],
      cursorByNote: { "notes/demo-workspace.md": { anchor: 184, head: 191 } },
      scrollByNote: { "notes/demo-workspace.md": 642 },
      undoDepthByNote: { "notes/demo-workspace.md": 7 },
      dirtyNoteIds: ["notes/demo-workspace.md"],
    };
    const state = createWorkspaceState("quiet-focus", session);

    const next = switchLayoutPreset(state, "balanced-vault");

    expect(next.layout.activePresetId).toBe("balanced-vault");
    expect(next.layout.panels.noteList.visible).toBe(true);
    expect(next.layout.panels.preview.visible).toBe(true);
    expect(next.session).toEqual(session);
    expect(next.session).toBe(state.session);
  });
});

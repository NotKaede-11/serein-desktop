import type { WorkspaceState } from "./layoutPresets";
import { createWorkspaceState } from "./layoutPresets";
import type { NoteSessionsState, PersistedNoteSessions } from "./noteSessions";
import { createNoteSessions, restoreNoteSessions, serializeNoteSessions } from "./noteSessions";

export interface VaultWorkspaceSession {
  version: 1;
  layout: WorkspaceState["layout"];
  noteSessions: PersistedNoteSessions;
  groupSplitRatio: number;
  recentNotes: string[];
}

export interface RestoredVaultWorkspaceSession {
  workspace: WorkspaceState;
  noteSessions: NoteSessionsState;
  groupSplitRatio: number;
  recentNotes: string[];
}

const emptyWorkspaceSession = {
  activeNoteId: null,
  openTabIds: [],
  cursorByNote: {},
  scrollByNote: {},
  undoDepthByNote: {},
  dirtyNoteIds: [],
};

export function createVaultWorkspaceSession(input: {
  workspace: WorkspaceState;
  noteSessions: NoteSessionsState;
  groupSplitRatio: number;
  recentNotes: string[];
}): VaultWorkspaceSession {
  return {
    version: 1,
    layout: {
      activePresetId: input.workspace.layout.activePresetId,
      panels: Object.fromEntries(Object.entries(input.workspace.layout.panels).map(([id, panel]) => [id, { ...panel }])),
    } as WorkspaceState["layout"],
    noteSessions: serializeNoteSessions(input.noteSessions),
    groupSplitRatio: Math.max(0.25, Math.min(0.75, input.groupSplitRatio)),
    recentNotes: [...new Set(input.recentNotes)].slice(0, 30),
  };
}

export function restoreVaultWorkspaceSession(value: unknown, availablePaths: readonly string[]): RestoredVaultWorkspaceSession {
  const available = new Set(availablePaths);
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) {
    return {
      workspace: createWorkspaceState("quiet-focus", emptyWorkspaceSession),
      noteSessions: createNoteSessions(),
      groupSplitRatio: 0.5,
      recentNotes: [],
    };
  }
  const stored = value as VaultWorkspaceSession;
  const fallback = createWorkspaceState("quiet-focus", emptyWorkspaceSession);
  const layout = stored.layout && stored.layout.panels && typeof stored.layout.activePresetId === "string"
    ? {
      activePresetId: stored.layout.activePresetId,
      panels: Object.fromEntries(Object.entries(fallback.layout.panels).map(([id, panel]) => {
        const candidate = stored.layout.panels[id as keyof typeof stored.layout.panels];
        const width = candidate?.width === undefined ? panel.width : Math.max(160, Math.min(640, candidate.width));
        return [id, { ...panel, ...candidate, width }];
      })) as typeof stored.layout.panels,
    }
    : fallback.layout;
  const noteSessions = stored.noteSessions
    ? restoreNoteSessions(stored.noteSessions, availablePaths)
    : createNoteSessions();
  return {
    workspace: { layout, session: emptyWorkspaceSession },
    noteSessions,
    groupSplitRatio: Math.max(0.25, Math.min(0.75, Number.isFinite(stored.groupSplitRatio) ? stored.groupSplitRatio : 0.5)),
    recentNotes: Array.isArray(stored.recentNotes)
      ? [...new Set(stored.recentNotes.filter((path): path is string => typeof path === "string" && available.has(path)))].slice(0, 30)
      : [],
  };
}

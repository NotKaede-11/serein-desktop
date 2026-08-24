export type LayoutPresetId = "quiet-focus" | "balanced-vault";

export type PanelId =
  | "explorer"
  | "recentNotes"
  | "noteList"
  | "editor"
  | "preview"
  | "context";

export interface PanelPresentation {
  visible: boolean;
  width?: number;
  placement: "left" | "center" | "right";
  variant?: "dedicated" | "filter" | "collapsible" | "toggle";
}

export interface LayoutPresentation {
  activePresetId: string;
  panels: Record<PanelId, PanelPresentation>;
}

export interface WorkspaceSession {
  activeNoteId: string | null;
  openTabIds: string[];
  cursorByNote: Record<string, { anchor: number; head: number }>;
  scrollByNote: Record<string, number>;
  undoDepthByNote: Record<string, number>;
  dirtyNoteIds: string[];
}

export interface WorkspaceState {
  layout: LayoutPresentation;
  session: WorkspaceSession;
}

export interface LayoutPreset {
  id: string;
  name: string;
  description: string;
  panels: Record<PanelId, PanelPresentation>;
}

export const layoutPresets: Record<LayoutPresetId, LayoutPreset> = {
  "quiet-focus": {
    id: "quiet-focus",
    name: "Quiet Focus",
    description: "Editor-first with recent notes and contextual detail nearby.",
    panels: {
      explorer: { visible: true, width: 260, placement: "left" },
      recentNotes: {
        visible: true,
        width: 260,
        placement: "left",
        variant: "dedicated",
      },
      noteList: { visible: false, width: 296, placement: "left" },
      editor: { visible: true, placement: "center" },
      preview: {
        visible: false,
        placement: "center",
        variant: "toggle",
      },
      context: { visible: true, width: 318, placement: "right" },
    },
  },
  "balanced-vault": {
    id: "balanced-vault",
    name: "Balanced Vault",
    description: "Explorer, note previews, source editor, and preview together.",
    panels: {
      explorer: { visible: true, width: 224, placement: "left" },
      recentNotes: {
        visible: true,
        placement: "left",
        variant: "filter",
      },
      noteList: { visible: true, width: 304, placement: "left" },
      editor: { visible: true, placement: "center" },
      preview: { visible: true, placement: "right" },
      context: {
        visible: false,
        width: 300,
        placement: "right",
        variant: "toggle",
      },
    },
  },
};

export function createLayoutPresentation(preset: LayoutPreset): LayoutPresentation {
  return {
    activePresetId: preset.id,
    panels: Object.fromEntries(
      Object.entries(preset.panels).map(([id, panel]) => [id, { ...panel }]),
    ) as Record<PanelId, PanelPresentation>,
  };
}

export function createWorkspaceState(
  presetId: LayoutPresetId,
  session: WorkspaceSession,
): WorkspaceState {
  return {
    layout: createLayoutPresentation(layoutPresets[presetId]),
    session,
  };
}

export function switchLayoutPreset(
  state: WorkspaceState,
  presetId: LayoutPresetId,
): WorkspaceState {
  if (state.layout.activePresetId === presetId) {
    return state;
  }

  return {
    layout: createLayoutPresentation(layoutPresets[presetId]),
    session: state.session,
  };
}

export function switchLayout(state: WorkspaceState, preset: LayoutPreset): WorkspaceState {
  return { layout: createLayoutPresentation(preset), session: state.session };
}

export function updateLayoutPanel(
  state: WorkspaceState,
  panelId: PanelId,
  patch: Partial<PanelPresentation>,
): WorkspaceState {
  return {
    ...state,
    layout: {
      ...state.layout,
      panels: { ...state.layout.panels, [panelId]: { ...state.layout.panels[panelId], ...patch } },
    },
  };
}

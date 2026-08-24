import type { SaveState } from "../vault/VaultWorkspaceController";

export type EditorMode = "editor" | "split" | "preview";
export type EditorGroupId = "primary" | "secondary";

export interface NoteViewSession {
  path: string;
  preview: boolean;
  pinned: boolean;
  mode: EditorMode;
  selection: { anchor: number; head: number };
  scrollTop: number;
  saveState: SaveState;
}

export interface EditorGroup {
  id: EditorGroupId;
  tabIds: string[];
  activeTabId: string | null;
}

export interface ClosedTab {
  path: string;
  groupId: EditorGroupId;
  index: number;
}

export interface NoteSessionsState {
  sessions: Record<string, NoteViewSession>;
  groups: Record<EditorGroupId, EditorGroup>;
  activeGroupId: EditorGroupId;
  recentlyClosed: ClosedTab[];
  previewTabsEnabled: boolean;
}

export interface PersistedNoteSessions {
  version: 1;
  activeGroupId: EditorGroupId;
  previewTabsEnabled: boolean;
  groups: Record<EditorGroupId, { tabIds: string[]; activeTabId: string | null }>;
  sessions: Record<string, Omit<NoteViewSession, "saveState">>;
  recentlyClosed: ClosedTab[];
}

const freshSession = (path: string, preview: boolean): NoteViewSession => ({
  path,
  preview,
  pinned: false,
  mode: "editor",
  selection: { anchor: 0, head: 0 },
  scrollTop: 0,
  saveState: "saved",
});

function clone(state: NoteSessionsState): NoteSessionsState {
  return {
    ...state,
    sessions: Object.fromEntries(Object.entries(state.sessions).map(([path, session]) => [path, { ...session, selection: { ...session.selection } }])),
    groups: {
      primary: { ...state.groups.primary, tabIds: [...state.groups.primary.tabIds] },
      secondary: { ...state.groups.secondary, tabIds: [...state.groups.secondary.tabIds] },
    },
    recentlyClosed: [...state.recentlyClosed],
  };
}

function referenced(state: NoteSessionsState, path: string) {
  return state.groups.primary.tabIds.includes(path) || state.groups.secondary.tabIds.includes(path);
}

function cleanUnreferenced(state: NoteSessionsState, path: string) {
  if (!referenced(state, path)) delete state.sessions[path];
}

export function createNoteSessions(initialPath: string | null = null): NoteSessionsState {
  return {
    sessions: initialPath ? { [initialPath]: freshSession(initialPath, false) } : {},
    groups: {
      primary: { id: "primary", tabIds: initialPath ? [initialPath] : [], activeTabId: initialPath },
      secondary: { id: "secondary", tabIds: [], activeTabId: null },
    },
    activeGroupId: "primary",
    recentlyClosed: [],
    previewTabsEnabled: true,
  };
}

export function openTab(
  state: NoteSessionsState,
  path: string,
  options: { groupId?: EditorGroupId; preview?: boolean; duplicateView?: boolean } = {},
) {
  const next = clone(state);
  const requestedGroup = options.groupId ?? next.activeGroupId;
  const existingGroup = (Object.keys(next.groups) as EditorGroupId[]).find((id) => next.groups[id].tabIds.includes(path));
  if (existingGroup && !options.duplicateView) {
    next.activeGroupId = existingGroup;
    next.groups[existingGroup].activeTabId = path;
    return next;
  }

  const group = next.groups[requestedGroup];
  const preview = Boolean(options.preview && next.previewTabsEnabled);
  if (preview) {
    const replace = group.tabIds.find((tabId) => next.sessions[tabId]?.preview && !next.sessions[tabId]?.pinned);
    if (replace && replace !== path) {
      const index = group.tabIds.indexOf(replace);
      group.tabIds.splice(index, 1, path);
      cleanUnreferenced(next, replace);
    } else if (!group.tabIds.includes(path)) {
      group.tabIds.push(path);
    }
  } else if (!group.tabIds.includes(path)) {
    group.tabIds.push(path);
  }
  next.sessions[path] ??= freshSession(path, preview);
  if (!preview) next.sessions[path].preview = false;
  group.activeTabId = path;
  next.activeGroupId = requestedGroup;
  return next;
}

export function promoteTab(state: NoteSessionsState, path: string, pinned?: boolean) {
  if (!state.sessions[path]) return state;
  const next = clone(state);
  next.sessions[path].preview = false;
  if (pinned !== undefined) next.sessions[path].pinned = pinned;
  return next;
}

export function setPreviewTabsEnabled(state: NoteSessionsState, enabled: boolean) {
  const next = clone(state);
  next.previewTabsEnabled = enabled;
  if (!enabled) for (const session of Object.values(next.sessions)) session.preview = false;
  return next;
}

export function activateTab(state: NoteSessionsState, groupId: EditorGroupId, path: string) {
  if (!state.groups[groupId].tabIds.includes(path)) return state;
  const next = clone(state);
  next.activeGroupId = groupId;
  next.groups[groupId].activeTabId = path;
  return next;
}

export function closeTab(
  state: NoteSessionsState,
  groupId: EditorGroupId,
  path: string,
  options: { forcePinned?: boolean; record?: boolean } = {},
) {
  const session = state.sessions[path];
  const index = state.groups[groupId].tabIds.indexOf(path);
  if (index < 0 || (session?.pinned && !options.forcePinned)) return state;
  const next = clone(state);
  const group = next.groups[groupId];
  group.tabIds.splice(index, 1);
  if (options.record !== false) next.recentlyClosed = [{ path, groupId, index }, ...next.recentlyClosed.filter((item) => item.path !== path)].slice(0, 20);
  if (group.activeTabId === path) group.activeTabId = group.tabIds[Math.min(index, group.tabIds.length - 1)] ?? null;
  cleanUnreferenced(next, path);
  if (!next.groups[next.activeGroupId].activeTabId) {
    next.activeGroupId = next.groups.primary.activeTabId ? "primary" : "secondary";
  }
  return next;
}

export function closeOtherTabs(state: NoteSessionsState, groupId: EditorGroupId, keepPath: string) {
  let next = state;
  for (const path of [...state.groups[groupId].tabIds]) {
    if (path !== keepPath && !state.sessions[path]?.pinned) next = closeTab(next, groupId, path);
  }
  return activateTab(next, groupId, keepPath);
}

export function closeTabsToRight(state: NoteSessionsState, groupId: EditorGroupId, path: string) {
  const index = state.groups[groupId].tabIds.indexOf(path);
  if (index < 0) return state;
  let next = state;
  for (const candidate of state.groups[groupId].tabIds.slice(index + 1)) {
    if (!state.sessions[candidate]?.pinned) next = closeTab(next, groupId, candidate);
  }
  return next;
}

export function reopenClosedTab(state: NoteSessionsState) {
  const [closed, ...remaining] = state.recentlyClosed;
  if (!closed) return state;
  let next = openTab({ ...state, recentlyClosed: remaining }, closed.path, { groupId: closed.groupId });
  const group = next.groups[closed.groupId];
  group.tabIds = group.tabIds.filter((path) => path !== closed.path);
  group.tabIds.splice(Math.min(closed.index, group.tabIds.length), 0, closed.path);
  return next;
}

export function reorderTab(state: NoteSessionsState, groupId: EditorGroupId, path: string, targetIndex: number) {
  const sourceIndex = state.groups[groupId].tabIds.indexOf(path);
  if (sourceIndex < 0) return state;
  const next = clone(state);
  const tabs = next.groups[groupId].tabIds;
  tabs.splice(sourceIndex, 1);
  tabs.splice(Math.max(0, Math.min(targetIndex, tabs.length)), 0, path);
  return next;
}

export function moveTabToGroup(
  state: NoteSessionsState,
  path: string,
  destination: EditorGroupId,
  options: { retainSourceView?: boolean } = {},
) {
  if (!state.sessions[path]) return state;
  const source = (Object.keys(state.groups) as EditorGroupId[]).find((id) => state.groups[id].tabIds.includes(path));
  let next = clone(state);
  if (!options.retainSourceView && source && source !== destination) {
    next = closeTab(next, source, path, { forcePinned: true, record: false });
    next.sessions[path] ??= { ...state.sessions[path], selection: { ...state.sessions[path].selection } };
  }
  if (!next.groups[destination].tabIds.includes(path)) next.groups[destination].tabIds.push(path);
  next.groups[destination].activeTabId = path;
  next.activeGroupId = destination;
  return next;
}

export function updateEditorViewState(
  state: NoteSessionsState,
  path: string,
  patch: Partial<Pick<NoteViewSession, "selection" | "scrollTop" | "mode" | "saveState">>,
) {
  if (!state.sessions[path]) return state;
  const next = clone(state);
  next.sessions[path] = { ...next.sessions[path], ...patch };
  return next;
}

export function removeMissingSessions(state: NoteSessionsState, availablePaths: readonly string[]) {
  const available = new Set(availablePaths);
  let next = state;
  for (const groupId of ["primary", "secondary"] as const) {
    for (const path of state.groups[groupId].tabIds) {
      if (!available.has(path)) next = closeTab(next, groupId, path, { forcePinned: true, record: false });
    }
  }
  return next;
}

export function activeSessionPath(state: NoteSessionsState) {
  return state.groups[state.activeGroupId].activeTabId;
}

export function serializeNoteSessions(state: NoteSessionsState): PersistedNoteSessions {
  return {
    version: 1,
    activeGroupId: state.activeGroupId,
    previewTabsEnabled: state.previewTabsEnabled,
    groups: {
      primary: { tabIds: [...state.groups.primary.tabIds], activeTabId: state.groups.primary.activeTabId },
      secondary: { tabIds: [...state.groups.secondary.tabIds], activeTabId: state.groups.secondary.activeTabId },
    },
    sessions: Object.fromEntries(Object.entries(state.sessions).map(([path, session]) => {
      const { saveState: _saveState, ...presentation } = session;
      return [path, { ...presentation, selection: { ...presentation.selection } }];
    })),
    recentlyClosed: state.recentlyClosed.map((item) => ({ ...item })),
  };
}

export function restoreNoteSessions(persisted: PersistedNoteSessions, availablePaths: readonly string[]) {
  const available = new Set(availablePaths);
  const restoreGroup = (id: EditorGroupId): EditorGroup => {
    const tabIds = [...new Set(persisted.groups[id].tabIds.filter((path) => available.has(path)))];
    const requested = persisted.groups[id].activeTabId;
    return { id, tabIds, activeTabId: requested && tabIds.includes(requested) ? requested : (tabIds[0] ?? null) };
  };
  const groups = { primary: restoreGroup("primary"), secondary: restoreGroup("secondary") };
  const referencedPaths = new Set([...groups.primary.tabIds, ...groups.secondary.tabIds]);
  const sessions = Object.fromEntries([...referencedPaths].map((path) => {
    const saved = persisted.sessions[path];
    return [path, saved ? { ...saved, path, selection: { ...saved.selection }, saveState: "saved" as const } : freshSession(path, false)];
  }));
  const activeGroupId = groups[persisted.activeGroupId].activeTabId
    ? persisted.activeGroupId
    : groups.primary.activeTabId ? "primary" : "secondary";
  return {
    sessions,
    groups,
    activeGroupId,
    recentlyClosed: persisted.recentlyClosed.filter((item) => available.has(item.path)).map((item) => ({ ...item })),
    previewTabsEnabled: persisted.previewTabsEnabled,
  } satisfies NoteSessionsState;
}

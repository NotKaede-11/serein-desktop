import { Circle, File, Pin, X } from "lucide-react";
import type { DragEvent, MouseEvent } from "react";

import type { EditorGroup, EditorGroupId, NoteViewSession } from "./noteSessions";

function title(path: string) { return path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path; }

export function TabStrip(props: {
  group: EditorGroup;
  sessions: Record<string, NoteViewSession>;
  activePath: string | null;
  onActivate: (groupId: EditorGroupId, path: string) => void;
  onClose: (groupId: EditorGroupId, path: string) => void;
  onContext: (event: MouseEvent, groupId: EditorGroupId, path: string) => void;
  onPromote: (path: string) => void;
  onReorder: (groupId: EditorGroupId, path: string, index: number) => void;
}) {
  const groupLabel = props.group.id === "primary" ? "Primary editor group" : "Secondary editor group";
  const drop = (event: DragEvent, index: number) => {
    event.preventDefault();
    const path = event.dataTransfer.getData("application/x-serein-tab");
    if (path) props.onReorder(props.group.id, path, index);
  };
  return <div className="tab-group" data-group={props.group.id}>
    {props.group.id === "secondary" ? <span className="tab-group-label">Group 2</span> : null}
    <div className="tabs" role="tablist" aria-label={groupLabel} onDragOver={(event) => event.preventDefault()}>
      {props.group.tabIds.map((path, index) => {
        const session = props.sessions[path];
        if (!session) return null;
        const label = `${title(path)}${session.preview ? " (Preview)" : ""}`;
        return <div className={`note-tab-shell${path === props.activePath ? " is-active" : ""}${session.preview ? " is-preview" : ""}`}
          draggable onDragStart={(event) => event.dataTransfer.setData("application/x-serein-tab", path)}
          onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, index)} key={path}>
          <button className="note-tab" role="tab" aria-selected={path === props.activePath} aria-label={label}
            onClick={() => props.onActivate(props.group.id, path)} onContextMenu={(event) => props.onContext(event, props.group.id, path)}
            onDoubleClick={() => props.onPromote(path)} type="button">
            {session.pinned ? <Pin className="tab-pin" /> : <File />}<span>{title(path)}</span>
            <Circle className={`tab-state state-${session.saveState}`} aria-label={session.saveState} />
          </button>
          <button className="tab-close" aria-label={`Close ${title(path)} in ${props.group.id} group`}
            onClick={() => props.onClose(props.group.id, path)} type="button"><X /></button>
        </div>;
      })}
    </div>
  </div>;
}

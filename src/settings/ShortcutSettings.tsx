import { RotateCcw, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import {
  createDefaultShortcutBindings,
  eventToShortcut,
  rebindShortcut,
  type CommandDefinition,
  type ShortcutBindings,
  type ShortcutConflict,
} from "../commands/commandRegistry";

export function ShortcutSettings(props: {
  definitions: readonly CommandDefinition[];
  bindings: ShortcutBindings;
  onChange: (bindings: ShortcutBindings) => void;
  showHeading?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [capture, setCapture] = useState<{ commandId: string; slot: number } | null>(null);
  const [pending, setPending] = useState<{ commandId: string; slot: number; shortcut: string; conflict: ShortcutConflict } | null>(null);
  const commands = useMemo(() => props.definitions.filter((command) =>
    `${command.label} ${command.category} ${(command.aliases ?? []).join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [props.definitions, query]);
  const apply = (commandId: string, shortcut: string | null, slot: number, force = false) => {
    const result = rebindShortcut(props.bindings, commandId, shortcut, slot, force);
    if (result.conflict && shortcut) setPending({ commandId, shortcut, slot, conflict: result.conflict });
    else { props.onChange(result.bindings); setPending(null); }
    setCapture(null);
  };
  return <section className="settings-content shortcut-settings" aria-labelledby={props.showHeading === false ? undefined : "shortcuts-heading"}>
    {props.showHeading === false ? null : <div className="settings-section-heading"><h3 id="shortcuts-heading">Keyboard shortcuts</h3>
      <p>Every surface calls the same command. Bind up to two shortcuts per command.</p></div>}
    <div className="shortcut-toolbar"><label><Search /><input aria-label="Filter shortcuts" placeholder="Filter commands…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <button aria-label="Reset all shortcuts" onClick={() => props.onChange(createDefaultShortcutBindings(props.definitions))} type="button"><RotateCcw />Reset all</button></div>
    {pending ? <div className="shortcut-conflict" role="alert"><span><strong>{pending.shortcut} is already assigned.</strong>
      <small>Replace the shortcut on {props.definitions.find((item) => item.id === pending.conflict.commandId)?.label}?</small></span>
      <button onClick={() => apply(pending.commandId, pending.shortcut, pending.slot, true)} type="button">Replace</button>
      <button aria-label="Cancel shortcut replacement" onClick={() => setPending(null)} type="button"><X /></button></div> : null}
    <div className="shortcut-list">{commands.map((command) => {
      const values = props.bindings[command.id] ?? [];
      return <div className="shortcut-row" key={command.id}><span><strong>{command.label}</strong><small>{command.category}</small></span>
        <div>{[0, 1].map((slot) => capture?.commandId === command.id && capture.slot === slot
          ? <button autoFocus className="shortcut-capture" key={slot} onBlur={() => setCapture(null)} onKeyDown={(event) => {
            event.preventDefault(); event.stopPropagation();
            if (event.key === "Escape") setCapture(null);
            else { const shortcut = eventToShortcut(event.nativeEvent); if (shortcut) apply(command.id, shortcut, slot); }
          }} type="button">Press keys…</button>
          : <button aria-label={`${values[slot] ? "Rebind" : "Add"} ${command.label} ${slot === 0 ? "primary" : "secondary"} shortcut`}
            className="shortcut-binding" key={slot} onClick={() => setCapture({ commandId: command.id, slot })} type="button">
            {values[slot] ? <kbd>{values[slot]}</kbd> : <span>Not set</span>}</button>)}</div>
        <button aria-label={`Clear shortcuts for ${command.label}`} className="shortcut-clear" disabled={!values.length}
          onClick={() => props.onChange({ ...props.bindings, [command.id]: [] })} type="button"><X /></button>
        <button aria-label={`Reset shortcuts for ${command.label}`} className="shortcut-reset"
          onClick={() => props.onChange({ ...props.bindings, [command.id]: [...command.defaultShortcuts] })} type="button"><RotateCcw /></button>
      </div>;
    })}</div>
  </section>;
}

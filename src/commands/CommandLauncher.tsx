import { Command, FileText, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CommandDefinition, ShortcutBindings } from "./commandRegistry";

function fuzzyScore(query: string, value: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return 1;
  const haystack = value.toLocaleLowerCase();
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return 10_000 - direct * 10 - haystack.length;
  let cursor = 0;
  let score = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found < 0) return -1;
    score += found === cursor ? 8 : 2;
    cursor = found + 1;
  }
  return score - haystack.length * 0.01;
}

interface LauncherItem {
  id: string;
  label: string;
  detail: string;
  searchText: string;
  shortcut?: string;
}

export function CommandLauncher(props: {
  mode: "quick" | "commands";
  commands: readonly CommandDefinition[];
  bindings: ShortcutBindings;
  notes: Array<{ relativePath: string; title: string }>;
  isCommandEnabled: (commandId: string) => boolean;
  onClose: () => void;
  onCommand: (commandId: string) => void;
  onNote: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const items = useMemo<LauncherItem[]>(() => {
    const source = props.mode === "quick"
      ? props.notes.map((note) => ({ id: note.relativePath, label: note.title, detail: note.relativePath, searchText: `${note.title} ${note.relativePath}` }))
      : props.commands.filter((command) => props.isCommandEnabled(command.id)).map((command) => ({
        id: command.id,
        label: command.label,
        detail: command.category,
        searchText: [command.label, command.category, ...(command.aliases ?? [])].join(" "),
        shortcut: props.bindings[command.id]?.[0],
      }));
    return source
      .map((item) => ({ item, score: fuzzyScore(query, item.searchText) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
      .slice(0, 75)
      .map((entry) => entry.item);
  }, [props.bindings, props.commands, props.isCommandEnabled, props.mode, props.notes, query]);
  useEffect(() => setActiveIndex(0), [query, props.mode]);
  const choose = (item: LauncherItem | undefined) => {
    if (!item) return;
    if (props.mode === "quick") props.onNote(item.id);
    else props.onCommand(item.id);
  };
  const title = props.mode === "quick" ? "Quick Switcher" : "Command Palette";
  return <div className="launcher-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <section className="command-launcher" aria-label={title} aria-modal="true" role="dialog">
      <header><span className="launcher-icon">{props.mode === "quick" ? <Search /> : <Command />}</span>
        <input ref={inputRef} aria-activedescendant={items[activeIndex] ? `launcher-${items[activeIndex].id}` : undefined}
          aria-controls="launcher-results" aria-expanded="true" aria-label={title} placeholder={props.mode === "quick" ? "Open a note by name or path…" : "Run a command…"}
          role="combobox" value={query} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, items.length - 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
            else if (event.key === "Enter") { event.preventDefault(); choose(items[activeIndex]); }
            else if (event.key === "Escape") { event.preventDefault(); props.onClose(); }
          }} />
        <button aria-label={`Close ${title}`} onClick={props.onClose} type="button"><X /></button>
      </header>
      <div className="launcher-results" id="launcher-results" role="listbox">
        {items.map((item, index) => <button id={`launcher-${item.id}`} className={index === activeIndex ? "is-active" : ""}
          aria-label={`${item.label} — ${item.detail}`} aria-selected={index === activeIndex} key={item.id}
          onClick={() => choose(item)} onMouseEnter={() => setActiveIndex(index)} role="option" type="button">
          {props.mode === "quick" ? <FileText /> : <Command />}<span><strong>{item.label}</strong><small>{item.detail}</small></span>
          {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
        </button>)}
        {!items.length ? <div className="launcher-empty"><strong>No matches</strong><span>Try another name, path, or command.</span></div> : null}
      </div>
      <footer><span><kbd>↑↓</kbd> Navigate</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span></footer>
    </section>
  </div>;
}

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

import type { AttachmentImport } from "../platform/vault";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  sessionKey?: string;
  sessionCache?: EditorSessionCache;
  onViewStateChange?: (state: { selection: { anchor: number; head: number }; scrollTop: number }) => void;
  onImportBytes?: (fileName: string, mediaType: string, bytes: number[]) => Promise<AttachmentImport>;
  onImportPath?: (sourcePath: string) => Promise<AttachmentImport>;
  onRollbackAttachment?: (imported: AttachmentImport) => Promise<boolean>;
  onAttachmentError?: (message: string) => void;
  wordWrap?: boolean;
  spellcheck?: boolean;
  showLineNumbers?: boolean;
  tabWidth?: number;
}

interface CachedEditorSession {
  state: EditorState;
  scrollTop: number;
}

export class EditorSessionCache {
  private readonly sessions = new Map<string, CachedEditorSession>();

  get(key: string) { return this.sessions.get(key) ?? null; }
  content(key: string) { return this.sessions.get(key)?.state.doc.toString() ?? null; }
  set(key: string, state: EditorState, scrollTop: number) { this.sessions.set(key, { state, scrollTop }); }
  delete(key: string) { this.sessions.delete(key); }
  clear() { this.sessions.clear(); }
}

const writTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: "var(--text-primary)",
      backgroundColor: "transparent",
      fontSize: "var(--editor-font-size)",
    },
    ".cm-content": {
      caretColor: "var(--accent)",
      fontFamily: "var(--font-editor)",
      lineHeight: "var(--editor-line-height)",
      padding: "10px 0 44px",
    },
    ".cm-line": { padding: "0" },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--accent)",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--selection) !important",
    },
    ".cm-gutters": { display: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-editor)",
      overflow: "auto",
    },
    "&.cm-focused": { outline: "none" },
  },
  { dark: true },
);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function insertMarkdown(view: EditorView, markdown: string) {
  const selection = view.state.selection.main;
  const before = selection.from > 0 ? view.state.doc.sliceString(selection.from - 1, selection.from) : "\n";
  const after = selection.to < view.state.doc.length ? view.state.doc.sliceString(selection.to, selection.to + 1) : "\n";
  const prefix = before === "\n" ? "" : "\n";
  const suffix = after === "\n" ? "" : "\n";
  const insert = `${prefix}${markdown}${suffix}`;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: { anchor: selection.from + insert.length },
    scrollIntoView: true,
  });
  view.focus();
}

export function MarkdownEditor({
  value,
  onChange,
  sessionKey = "active-note",
  sessionCache,
  onViewStateChange,
  onImportBytes,
  onImportPath,
  onRollbackAttachment,
  onAttachmentError,
  wordWrap = true,
  spellcheck = true,
  showLineNumbers = false,
  tabWidth = 2,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onViewStateChangeRef = useRef(onViewStateChange);
  const sessionKeyRef = useRef(sessionKey);
  const importBytesRef = useRef(onImportBytes);
  const importPathRef = useRef(onImportPath);
  const rollbackRef = useRef(onRollbackAttachment);
  const attachmentErrorRef = useRef(onAttachmentError);
  const insertionErrorRef = useRef<unknown>(null);
  const wrapping = useRef(new Compartment());
  const spellchecking = useRef(new Compartment());
  const gutters = useRef(new Compartment());
  const indentation = useRef(new Compartment());

  useEffect(() => {
    onChangeRef.current = onChange;
    onViewStateChangeRef.current = onViewStateChange;
    importBytesRef.current = onImportBytes;
    importPathRef.current = onImportPath;
    rollbackRef.current = onRollbackAttachment;
    attachmentErrorRef.current = onAttachmentError;
  }, [onAttachmentError, onChange, onImportBytes, onImportPath, onRollbackAttachment, onViewStateChange]);

  async function finishImport(imported: AttachmentImport, view: EditorView) {
    try {
      insertionErrorRef.current = null;
      insertMarkdown(view, imported.markdown);
      if (insertionErrorRef.current) throw insertionErrorRef.current;
    } catch (error) {
      if (imported.created && imported.rollbackToken) {
        await rollbackRef.current?.(imported);
      }
      attachmentErrorRef.current?.(`The attachment was copied but its Markdown link could not be inserted: ${errorMessage(error)}`);
    }
  }

  async function importFiles(files: File[], view: EditorView) {
    if (!importBytesRef.current) return;
    for (const file of files) {
      try {
        const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
        const imported = await importBytesRef.current(
          file.name || (file.type.startsWith("image/") ? "pasted-image.png" : "attachment"),
          file.type || "application/octet-stream",
          bytes,
        );
        await finishImport(imported, view);
      } catch (error) {
        attachmentErrorRef.current?.(`Attachment import failed: ${errorMessage(error)}`);
      }
    }
  }

  async function importPaths(paths: string[], view: EditorView) {
    if (!importPathRef.current) return;
    for (const path of paths) {
      try {
        const imported = await importPathRef.current(path);
        await finishImport(imported, view);
      } catch (error) {
        attachmentErrorRef.current?.(`Attachment import failed: ${errorMessage(error)}`);
      }
    }
  }

  useEffect(() => {
    if (!hostRef.current) return;

    const createState = (doc: string) => EditorState.create({
      doc,
      extensions: [
        history(),
        markdown(),
        wrapping.current.of(wordWrap ? EditorView.lineWrapping : []),
        spellchecking.current.of(EditorView.contentAttributes.of({ spellcheck: spellcheck ? "true" : "false" })),
        gutters.current.of(showLineNumbers ? lineNumbers() : []),
        indentation.current.of(EditorState.tabSize.of(tabWidth)),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            try {
              onChangeRef.current(update.state.doc.toString());
            } catch (error) {
              insertionErrorRef.current = error;
            }
          }
          if (update.selectionSet || update.docChanged) {
            const range = update.state.selection.main;
            onViewStateChangeRef.current?.({
              selection: { anchor: range.anchor, head: range.head },
              scrollTop: update.view.scrollDOM.scrollTop,
            });
          }
        }),
        EditorView.domEventHandlers({
          paste(event, view) {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (!files.length || !importBytesRef.current) return false;
            event.preventDefault();
            void importFiles(files, view);
            return true;
          },
          drop(event, view) {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (!files.length || !importBytesRef.current) return false;
            event.preventDefault();
            void importFiles(files, view);
            return true;
          },
        }),
        writTheme,
      ],
    });

    const cached = sessionCache?.get(sessionKeyRef.current);
    const view = new EditorView({ state: cached?.state ?? createState(value), parent: hostRef.current });
    viewRef.current = view;
    if (cached) view.scrollDOM.scrollTop = cached.scrollTop;
    const handleScroll = () => {
      const range = view.state.selection.main;
      onViewStateChangeRef.current?.({
        selection: { anchor: range.anchor, head: range.head },
        scrollTop: view.scrollDOM.scrollTop,
      });
    };
    view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      sessionCache?.set(sessionKeyRef.current, view.state, view.scrollDOM.scrollTop);
      view.scrollDOM.removeEventListener("scroll", handleScroll);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        wrapping.current.reconfigure(wordWrap ? EditorView.lineWrapping : []),
        spellchecking.current.reconfigure(EditorView.contentAttributes.of({ spellcheck: spellcheck ? "true" : "false" })),
        gutters.current.reconfigure(showLineNumbers ? lineNumbers() : []),
        indentation.current.reconfigure(EditorState.tabSize.of(tabWidth)),
      ],
    });
  }, [showLineNumbers, spellcheck, tabWidth, wordWrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || sessionKeyRef.current === sessionKey) return;
    sessionCache?.set(sessionKeyRef.current, view.state, view.scrollDOM.scrollTop);
    sessionKeyRef.current = sessionKey;
    const cached = sessionCache?.get(sessionKey);
    if (cached) {
      view.setState(cached.state);
      window.requestAnimationFrame(() => { view.scrollDOM.scrollTop = cached.scrollTop; });
    } else {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
      view.dispatch({ selection: { anchor: 0 } });
      view.scrollDOM.scrollTop = 0;
    }
  }, [sessionCache, sessionKey]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let current = true;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
      if (!current) return;
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const view = viewRef.current;
        const host = hostRef.current;
        if (!view || !host) return;
        const scale = window.devicePixelRatio || 1;
        const x = event.payload.position.x / scale;
        const y = event.payload.position.y / scale;
        const bounds = host.getBoundingClientRect();
        if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return;
        void importPaths(event.payload.paths, view);
      });
    }).catch((error) => {
      attachmentErrorRef.current?.(`Native file drop is unavailable: ${errorMessage(error)}`);
    });
    return () => {
      current = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return <div ref={hostRef} className="markdown-editor" aria-label="Markdown editor" />;
}

# Product

<!-- impeccable:product-schema 1 -->

## Platform

Windows desktop

## Stack

Tauri 2 desktop application for Windows with a React and TypeScript interface and native Rust/Tauri commands. The final application must not run a localhost server. Windows delivery includes a per-user Setup `.exe` and a portable build.

## Users

Serein is primarily for one experienced Windows user managing personal, school, research, and project notes. The user works heavily from the keyboard, keeps notes in ordinary folders, may edit the same files in other applications, and expects the app to remain fast with approximately 10,000 Markdown notes and many gigabytes of attachments.

## Product Purpose

Serein is a fast, private, local-first Markdown workspace that combines safe folder-based note editing with daily notes, tasks, calendar views, backlinks, and a knowledge graph. Success means the user can open an existing vault, navigate, search, edit, and organize it immediately without import, lock-in, internet access, or fear of losing work.

## Positioning

Serein combines the transparency of a direct local Markdown vault with a polished, configurable Windows desktop workspace. Markdown, attachments, templates, and local iCalendar data remain authoritative portable files; Serein's databases are disposable indexes and caches rather than content stores.

## Operating Context

- Multiple local vaults are a product goal. The 0.1.0 preview accepts only generated test vaults carrying Serein's synthetic-vault marker.
- Existing files may be created, edited, moved, renamed, or deleted by Serein, Windows Explorer, editors, and other Markdown applications.
- The application restores the last vault and session by default while completing indexing, backlinks, graph, thumbnail, and watcher work incrementally in the background.
- The application is fully functional offline. Network access is limited to explicitly enabled update checking and later Google Calendar synchronization.
- Real-vault write testing is forbidden until synthetic and copied-vault safety testing passes and the user explicitly approves access.

## Capabilities and Constraints

### Files and safety

- Markdown files are the source of truth; no import or vault conversion is permitted.
- Autosave uses configurable debounce plus atomic safe writes; `Ctrl+S` forces an immediate save.
- External changes reload automatically when no local edits exist. Concurrent changes open a preserve-both diff/conflict workflow with Keep Mine, Use Disk, Merge, and Save Both.
- Serein-originated atomic filesystem events must not trigger false external-conflict warnings.
- Recoverable vault trash and smart version snapshots live under `.serein/`, with retention, storage, cleanup, and restore controls. Snapshots are interval/operation based rather than created for every autosave.
- `.serein/` is hidden from normal exploration. Search, graph, backlinks, and thumbnail indexes are completely rebuildable.
- Existing vaults are never reorganized automatically. Creating `.serein/` requires explanation and confirmation; disposable caches may optionally live outside the vault.
- External symlinks and junctions require explicit per-link permission, are visibly marked, and are excluded from ordinary backup/trash behavior unless separately approved.

### Workspace and editing

- Slim Obsidian-style left ribbon with Settings at the bottom and no permanent Serein name/logo block.
- Controlled flexible layout: resizable, collapsible, hideable, and reorderable supported panels; named layouts; per-vault restoration; global defaults; Reset Layout; at most two editor groups in v1.
- Ship two factory Layout Presets: Quiet Focus (default) and Balanced Vault. Layout selection belongs in Settings rather than persistent note-tab chrome. Presets change only panel visibility, size, and placement; switching presets must preserve open tabs, the selected note, cursor/selection, scroll positions, undo history, and unsaved work.
- Layout Presets must not gate capabilities. Recent Notes, Calendar, Backlinks, Preview, Tasks, and other workspace features remain available across presets through presentation appropriate to each layout. Users may customize any preset and save it as a new named layout.
- Persistent tabs with optional preview-tab behavior, pinning, reorder, reopen closed, overflow handling, and configurable session restoration.
- CodeMirror 6 source editor with Editor, Split, and Preview modes. Source mode always shows the actual Markdown.
- CommonMark/GFM plus optional portable frontmatter, footnotes, math, wikilinks, aliases, tags, embeds, callouts, tables, and task syntax. Unknown syntax must be preserved unless intentionally edited.
- Configurable vault-level `Attachments/` folder for pasted or dropped images and general files, using relative links, readable collision-safe filenames, link repair, previews, and confirmation-only orphan cleanup.

### Navigation and retrieval

- The real filesystem tree remains authoritative. Virtual views such as All Notes, Recent, Pinned, Tags, Daily Notes, Tasks, and Trash act on original files and never create copies.
- Explorer behavior includes drag/move, multi-select, create/rename/delete, context menus, keyboard operations, copy path, and Reveal in Windows Explorer.
- Switchable Poznote-inspired preview cards and compact lists, with configurable metadata, snippet length, density, and size.
- Incremental indexed search covers filenames, paths, note contents, headings, tags, frontmatter, wikilinks, tasks, and attachment filenames. `Ctrl+F` searches the current note; `Ctrl+Shift+F` searches the vault.
- `Ctrl+P` opens a fuzzy note/path Quick Switcher. `Ctrl+Shift+P` opens a separate Command Palette.
- One central command registry is the single source of truth for ribbon actions, menus, context menus, shortcuts, and Command Palette entries. Shortcuts are fully configurable with conflicts, reset, import/export, alternate bindings, and optional chords.

### Daily productivity and PKM

- Daily notes default to `Daily/YYYY-MM-DD.md`, with configurable folder, filename format, and ordinary Markdown templates under `Templates/`.
- Creation-time template values may expand; events and due tasks use live placeholders by default rather than stale duplicated snapshots.
- Compact resizable sidebar calendar plus full month, week, and agenda workspace views. Today, selection, daily notes, tasks, and events have distinct non-color-only indicators.
- Local events use portable `.ics` data under a configurable `Calendar/` folder. Google events remain authoritative in Google and only use `.serein/` as offline cache.
- Markdown-native tasks use optional readable inline metadata for due dates, priority, recurrence, tags, and status. Plain `- [ ] Task` remains valid.
- Task views include Inbox, Today, Upcoming, Overdue, No Date, Completed, and optional Kanban. Dashboard edits modify and navigate to the exact source task.
- Recurring tasks preserve history and generate the next occurrence exactly once on an intentional unchecked-to-checked transition; recurrence advancement is one undoable operation where practical.
- Wikilinks resolve through filename/title with safe path disambiguation and support explicit paths, display aliases, headings, and frontmatter aliases. Internal renames offer previewable link updates; external renames produce repair suggestions.
- A hidden-by-default contextual links panel contains backlinks, outgoing links, unlinked mentions, and broken links with source context.
- Global and local graph views provide restrained Obsidian-like interaction, filters, groups, saved presets, configurable physics, progressive rendering, cancellation, and large-vault limits. Explicit Markdown links create primary edges; tags mainly group/filter.

### Calendar integration

- Google Calendar is Phase 4, after local note safety and productivity features are stable.
- Start with one Google account and selectable calendars, one writable default destination, explicit local-versus-Google event destination, secure OS credential storage, offline queueing, and preserve-both conflict handling.
- Tasks remain local unless explicitly added to a calendar. Deleting a daily note never deletes tasks or calendar events.

### Delivery, updates, and privacy

- Primary distribution is a per-user NSIS Setup `.exe`, with a portable build and optional true offline WebView2 packaging strategy. No MSI is required for v1.
- Updates are securely signed, show release notes, and require approval. Checks may be automatic, manual, or disabled. Installation is blocked by unsaved work, unresolved conflicts, or unsafe pending operations.
- Zero telemetry by default: no analytics, advertising, tracking, usage reporting, or automatic crash uploads.
- Diagnostics stay local, avoid note contents, and are exported only through an explicit redacted diagnostic-report command. Credentials and tokens must never appear.
- No AI/chat, Canvas, Drawings, custom encryption, interface-only password lock, OCR, third-party plugin ecosystem, or Google sync in the core phase.

## Brand Commitments

- Product name: Serein (pronounced “seh-reen”).
- Visual direction: a purposeful hybrid using Obsidian as reference for compact ribbon, navigation, tabs, density, and graph interaction; Poznote as reference for readable note previews, understated controls, and checkboxes; and the supplied compact calendar reference for the sidebar calendar.
- Default identity is charcoal with restrained violet used for focus, selection, and interactive accents rather than dominant backgrounds.
- Prioritize information density, clear hierarchy, and editor space. Avoid excessive padding, oversized headings, rounded-card overload, gradients, glow, glass effects, and decorative branding.
- The product name appears only where useful, such as the window title, installer, About screen, and application metadata.

## Product Principles

1. User files are authoritative; indexes are disposable.
2. Never trade data safety for convenience or visual polish.
3. The editor stays immediately responsive while heavy work happens incrementally in the background.
4. Customization is extensive but controlled, recoverable, and understandable.
5. Additional productivity and PKM features deepen the note workflow rather than replacing it.

## Accessibility & Inclusion

Serein targets complete keyboard navigation, visible focus, screen-reader semantics, WCAG AA contrast, Windows High Contrast, reduced motion, non-color-only states, and independent interface/editor/preview/sidebar/icon scaling that remains correct under Windows DPI scaling.

## Delivery Phases

1. Core vault safety, editing, explorer, previews, search, attachments, tabs, layouts, customization, recovery, automated tests, and Windows packages.
2. Daily notes, local calendar, Markdown-native tasks, recurrence, and Kanban.
3. Wikilinks, backlinks, tags, and performant global/local graph.
4. Optional Google Calendar integration.

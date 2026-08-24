---
name: Serein Desktop Workspace
description: A compact charcoal desktop workspace that keeps writing central and uses violet as a precise state signal.
colors:
  charcoal-ground: "#121418"
  charcoal-panel: "#171a1f"
  charcoal-raised: "#1c2025"
  charcoal-control: "#23272d"
  charcoal-hover: "#292d34"
  graphite-rule: "#30343b"
  graphite-rule-soft: "#272b31"
  ink-primary: "#e8e9ec"
  ink-secondary: "#b5b9c1"
  ink-muted: "#858b96"
  signal-violet: "#a56cf5"
  signal-violet-bright: "#ba84ff"
  signal-violet-surface: "#33264b"
  violet-selection: "rgba(165, 108, 245, 0.28)"
  light-ground: "#f4f5f7"
  light-panel: "#ffffff"
  light-raised: "#f0f1f4"
  light-control: "#e5e7eb"
  light-hover: "#e9e8ef"
  light-rule: "#cfd2d8"
  light-rule-soft: "#dfe1e6"
  light-ink-primary: "#202229"
  light-ink-secondary: "#4e535d"
  light-ink-muted: "#646a75"
  light-signal-violet-strong: "#6d3fa3"
  light-violet-surface: "#ebe3f8"
  light-violet-selection: "rgba(125, 78, 192, 0.24)"
  caution-ground: "#28231c"
  caution-control: "#352d22"
  caution-rule: "#6d5436"
  caution-control-rule: "#745f42"
  caution-ink: "#eed8b6"
  caution-ink-muted: "#c8af88"
  danger-ground: "#2b2023"
  danger-control: "#3a2428"
  danger-rule: "#73494e"
  danger-control-rule: "#7a454a"
  danger-ink: "#e8b9bd"
  danger-ink-strong: "#f0d6d8"
  danger-ink-muted: "#d7aeb2"
typography:
  headline:
    fontFamily: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif'
    fontSize: "clamp(26px, 2.1vw, 32px)"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  section-title:
    fontFamily: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif'
    fontSize: "25px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  editor:
    fontFamily: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
  body:
    fontFamily: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.72
  ui:
    fontFamily: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.3
  label:
    fontFamily: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.3
  monospace:
    fontFamily: 'ui-monospace, "Cascadia Code", "Cascadia Mono", Consolas, monospace'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  checkbox: "3px"
  control: "6px"
  row: "7px"
  segmented: "8px"
  icon: "9px"
  card: "10px"
  preview-card: "11px"
spacing:
  compact: "4px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "32px"
components:
  ribbon-icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.icon}"
    height: "34px"
    width: "34px"
  note-tab-active:
    backgroundColor: "{colors.charcoal-raised}"
    textColor: "{colors.signal-violet-bright}"
    padding: "0 12px"
    height: "46px"
  segmented-control-active:
    backgroundColor: "{colors.charcoal-control}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  explorer-row-selected:
    backgroundColor: "{colors.signal-violet-surface}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.ui}"
    rounded: "{rounded.row}"
    height: "30px"
  note-preview-card:
    backgroundColor: "{colors.charcoal-control}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.preview-card}"
    padding: "13px"
  checkbox:
    backgroundColor: "{colors.charcoal-panel}"
    rounded: "{rounded.checkbox}"
    height: "17px"
    width: "17px"
  calendar-day-today:
    backgroundColor: "{colors.signal-violet-surface}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "31px"
  mention-card:
    backgroundColor: "{colors.charcoal-control}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.card}"
    padding: "14px"
  status-badge:
    backgroundColor: "{colors.signal-violet-surface}"
    textColor: "{colors.signal-violet-bright}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "4px 7px"
  settings-category-active:
    backgroundColor: "{colors.signal-violet-surface}"
    textColor: "{colors.signal-violet-bright}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "34px"
  settings-preference-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink-primary}"
    typography: "{typography.label}"
    padding: "9px 3px"
    height: "54px"
  settings-switch-on:
    backgroundColor: "restrained semantic violet track"
    textColor: "near-white neutral thumb"
    rounded: "10px"
    height: "20px"
    width: "34px"
  settings-done-button:
    backgroundColor: "{colors.signal-violet}"
    textColor: "{colors.charcoal-panel}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
    height: "32px"
---

# Design System: Serein Desktop Workspace

## Overview

**Creative North Star: "The Quiet Workbench"**

Serein is designed as a focused Windows work surface, not a branded destination. Charcoal planes, quiet separators, compact controls, and a dominant document area make the interface recede until navigation or context is needed. The result is dense without feeling crowded: every persistent region earns its width by helping the user find, edit, or understand a note.

The visual system treats violet as an operational signal rather than decoration. It marks focus, selection, the active tab, the current date, and paths worth following; it does not wash whole surfaces or compete with the document. The two workspace presets rearrange the same panel grammar around the writing surface, from editor-first Quiet Focus to preview-rich Balanced Vault. Layout selection is progressively disclosed in Settings rather than occupying the note-tab bar.

Settings follows the approved `settings-concept-a-dense` direction as a compact preference ledger. Concept A is adopted whole: a searchable category rail, flat divided rows, a stable control column, and a fixed save-status footer make every current category quick to scan without introducing a second visual world.

**Key Characteristics:**

- Charcoal work surfaces separated by fine graphite rules
- Restrained violet reserved for active, selected, focused, and current states
- Compact Windows-native controls and persistent tabs
- Interchangeable panel grammar around a dominant editor or preview
- Flat tonal depth, readable cards, and strong keyboard focus treatment
- Dense Concept A Settings ledger with persistent explanations and exact controls

## Colors

The palette is a cool charcoal ladder with pale neutral text and one deliberately scarce violet signal family.

### Primary

- **Signal Violet:** The default interactive accent for focus rings, carets, selection rails, checked controls, and current or active states.
- **Bright Signal Violet:** The higher-contrast violet used for active-tab text, selected paths, and compact status emphasis.
- **Violet Signal Surface:** A subdued violet-tinted fill for selected rows and the current calendar date.

### Neutral

- **Charcoal Ground:** The deepest canvas behind the application shell and segmented controls.
- **Charcoal Panel:** The standard navigation, context, and input surface.
- **Charcoal Raised:** A small tonal step for active tabs and subtly separated workspace chrome.
- **Charcoal Control:** The fill for selected segmented controls, badges, and cards.
- **Charcoal Hover:** The shared hover response for rows, icon buttons, and calendar cells.
- **Graphite Rule / Soft Graphite Rule:** Structural and internal separators; use the softer rule inside the document workspace.
- **Primary Ink:** Main headings, active labels, note titles, and editor content.
- **Secondary Ink:** Navigation labels, body-supporting UI, and inactive controls.
- **Muted Ink:** Metadata, timestamps, counts, breadcrumbs, and low-priority status text.
- **Caution / Danger:** A small semantic family reserved for broken attachment references, failed writes, and other states that need attention without looking selected.
- **Light Theme Mapping:** Light, Dark, and System modes use the same semantic surface, rule, text, accent, caution, and danger roles. Light mode uses the strengthened muted-ink and accent-strong roles recorded in the frontmatter, changes values rather than hierarchy, and System follows the Windows preference live.

### Named Rules

**The Signal Violet Rule.** Violet communicates state or affordance; it never becomes a dominant background or decorative atmosphere.

**The Charcoal Ladder Rule.** Separate adjacent regions with one tonal step and a fine rule before reaching for shadow.

**The Theme Parity Rule.** Components consume semantic roles rather than dark-only literals so every supported theme preserves the same hierarchy, state meaning, and focus treatment.

## Typography

**Display Font:** Segoe UI Variable (with Segoe UI, system UI, and sans-serif fallbacks)
**Body Font:** Segoe UI Variable (with Segoe UI, system UI, and sans-serif fallbacks)
**Editor Font:** Segoe UI Variable; source and preview share the same humanist sans-serif voice in the shipped workspace shell.
**Monospace / Diff Font:** The native `ui-monospace` stack, preferring Cascadia Code or Cascadia Mono on Windows, is reserved for version comparisons, conflict content, code/CSS snippets, and other character-aligned technical text.

**Character:** The typography is native, quiet, and highly legible at desktop density. Hierarchy comes from weight, size, and spacing rather than a decorative display face; numerals remain easy to scan in counts, timestamps, and calendar grids.

### Hierarchy

- **Headline:** The note title, responsive within the documented headline token and set with tight tracking.
- **Section Title:** Major document subsections such as rendered Markdown headings.
- **Editor:** Source text with generous line height, a violet caret, wrapped lines, and no visible gutter in the shipped shell.
- **Body:** Rendered note copy with a maximum readable measure of 72 characters.
- **UI:** Tree rows, tabs, card titles, and section headings; stronger emphasis uses weight 650 without increasing size.
- **Label:** Modes, filters, timestamps, badges, calendar headings, counts, and status text.
- **Monospace:** Character-aligned source, comparison, and technical snippets at a compact 12px/1.6 rhythm; do not use it as decorative workspace chrome.

### Named Rules

**The Content Leads Rule.** Document headings and prose own the strongest scale and contrast; workspace chrome stays at compact UI and label sizes.

**The Native Voice Rule.** Use the Segoe UI stack across the workspace shell. Use the single documented monospace role only for character-aligned source, comparison, and technical content; the main Markdown editor remains independently configurable.

## Layout

The desktop shell begins with a fixed 44px tool ribbon and a grid-based workspace. Quiet Focus uses a 260px navigation rail, a flexible document column with a 500px minimum, and a 318px context rail. Balanced Vault uses 224px navigation, a 304px note-preview column, and a flexible editor/preview region with a 520px minimum; opening context adds a 300px rail.

Workspace chrome is intentionally shallow: tabs occupy 46px, breadcrumbs and editor actions 42px, and status 28px. Document padding expands with viewport width through `clamp()` while source and rendered panes divide evenly in split and Balanced Vault arrangements. The implemented desktop adaptation begins at 1180px, narrowing rails and preview lists. No mobile or touch-first composition is established by the shipped artifact.

Settings is a centered desktop dialog rather than a docked workspace rail. It opens up to 1000×760px within a 52px viewport margin, can be resized from its window edge, and provides an explicit maximize/restore control for a near-full-window view. A fixed 210px searchable rail groups every current category under Workspace, Content, Files, and System; its single-line entries are 34px tall. The selected page scrolls independently while the full-width footer remains fixed. The dimmed workspace remains visible as context but cannot compete with the dialog.

The spatial rhythm is compact in chrome and calmer in the document. Rows are generally 30–34px high; panel padding clusters around 8–14px, while editor and preview padding starts around 32–42px. The finished workspace-shell review was accepted at 1672×941; this documents that desktop system, not an unverified responsive product.

**The Writing Holds Center Rule.** Presets may reveal, hide, dock, or split supporting panels, but the editor or rendered note remains the largest and highest-contrast region.

**The Panel Grammar Rule.** Navigation rails, note lists, context rails, and document panes share the same tonal ladder and separators so they can move without becoming new visual worlds.

**The Preference Ledger Rule.** Settings uses one searchable category rail, one independently scrolling page, flat divided rows, and one fixed footer; no permanent preview rail competes with the controls.

## Elevation & Depth

The system is flat by default and uses no ambient card or panel shadows. Depth comes from charcoal tonal layering, one-pixel separators, inset state strokes, and occasional bordered selection. The keyboard focus treatment communicates interaction state rather than physical elevation. Focused overlays—Settings, context menus, launchers, conflicts, and destructive confirmations—may use one restrained shadow to separate them from the dimmed workspace.

### Shadow Vocabulary

- **Keyboard focus** (`0 0 0 2px #121418, 0 0 0 4px #a56cf5`): A two-stage ring that stays distinct against every charcoal surface.
- **Active tab rail** (`inset 0 2px #a56cf5`): A thin violet line that anchors the selected document tab.
- **Current-date stroke** (`inset 0 0 0 1px #a56cf5`): A precise boundary around the violet calendar surface.

### Named Rules

**The Flat-by-Default Rule.** Use tonal contrast and rules for structure; reserve shadows for focus and selected-state strokes.

## Shapes

Forms are compact and gently curved, with radius proportional to the target. Checkboxes use the smallest corners, segmented controls and calendar cells use compact corners, icon buttons are slightly softer, and information cards are the roundest repeated shape. Borders are thin and low-contrast; selected note cards may add a violet border, while rows usually use a narrow violet leading rail instead.

**The Compact Curve Rule.** Radius supports scanability and target recognition; it never turns every panel into a floating rounded card.

## Components

### Buttons

- **Icon buttons:** Square 34px ribbon targets with transparent resting surfaces, secondary ink, a soft icon radius, and a charcoal hover fill. The active tool uses a slightly raised charcoal surface, not a violet block.
- **Text and ghost buttons:** Transparent by default with muted or secondary ink; hover and pressed states use the shared control or hover surface.
- **Focus:** Every button uses the global double focus ring and moves above neighboring chrome so the ring is not clipped.

### Chips

- **Status badge:** A compact violet-tinted badge for synthetic/demo state, with a thin violet-family border and label-sized type.
- **Segmented controls:** Modes, note-list filters, and layout choices sit on a charcoal ground. Only the chosen segment gains the control surface and primary ink; layout choices additionally expose `aria-pressed` state.

### Cards / Containers

- **Note preview cards:** Tonal charcoal cards with 13px internal padding, a concise title/snippet/meta stack, and an 11px corner radius. Selection adds a violet-tinted surface and border.
- **Mention cards:** Slightly tighter 10px corners with title, date, snippet, and violet path arranged as a compact two-column information card.
- **Panels:** Flat rectangular regions with one-pixel rules. Do not apply the card treatment to entire rails or document panes.

### Inputs / Fields

- **Checkboxes:** Native appearance is replaced by a 17px square with a graphite border, compact 3px corners, and charcoal fill. Checked state uses Signal Violet with an inset charcoal center, preserving a non-color shape change.
- **Editor field:** CodeMirror is borderless within the source pane, inherits the workspace type system, hides gutters, wraps lines, and uses violet for caret and selection.
- **Settings values:** Continuous sliders are not used for exact layout, scale, typography, or sizing preferences. Those values use compact number inputs with visible units and bounded steps; discrete choices use selects and binary choices use toggles or checkboxes.
- **Settings switches:** Boolean preferences use one 34 × 20px desktop switch with a 14px thumb and 2px inset. OFF uses a neutral track and muted light thumb; ON uses a restrained violet track and near-white thumb. The 14px horizontal thumb travel, not color alone, distinguishes the states. Selection checkboxes remain square controls and do not inherit switch styling.
- **Settings type choices:** UI, editor, and preview fonts are selected by readable family name. Raw CSS stacks remain an advanced implementation detail rather than preference copy.
- **Focus / forced colors:** The shared double ring is required. In Windows forced-colors mode, selected rows, cards, and the current date also receive a 2px Highlight outline.

### Navigation

- **Ribbon:** A fixed 44px column with five primary tool icons at the top and Settings anchored to the bottom. Labels remain available through accessible names and titles rather than permanent text.
- **Tabs:** Persistent 46px tabs use fine vertical separators. The active tab combines Bright Signal Violet text, a subtly raised fill, and a violet top rail; inactive tabs remain secondary.
- **Explorer and recent rows:** Compact 30px rows use indentation, icons, ellipsis, tabular counts, hover fill, and a leading violet rail for the selected/current item. Explorer rows are draggable filesystem targets; a violet surface plus inset outline marks the current valid drop destination.
- **Explorer context menu:** File and folder operations are progressively disclosed on right-click. The menu exposes only implemented, vault-safe actions—create inside folders, rename, move, copy relative path, and recoverable Trash—and uses separators to isolate the destructive action. No persistent rename/Trash action tray occupies Explorer space.
- **Settings dialog:** A centered, resizable, maximizable modal built from the complete `settings-concept-a-dense` contract. The fixed 210px rail groups Workspace and Appearance; Editor and Navigation; Attachments; Recovery, Shortcuts, Advanced, and About. Search temporarily replaces categories with direct results, then opens and highlights the owning row. The content column scrolls independently; the footer spans both columns and stays fixed.
- **Preference rows:** Rows are flat, at least 54px tall, and separated by fine rules. A concise title and persistent consequence sentence occupy the flexible left column; one compact control sits in a stable 144–210px right column. Switches represent booleans, selects finite values, number fields exact bounded values with visible units, and swatches accent choices.
- **Settings save state:** Ordinary preference changes apply locally and autosave. Attachment-folder and recovery changes validate and debounce for 500ms; the footer alone reports Saving or Saved automatically. Manual cleanup remains an explicit Run cleanup action because it performs work rather than editing a preference.

### Calendar

Calendar cells use tabular numerals in a seven-column grid. Adjacent-month dates are muted; hover adds the shared hover surface; today combines a violet-tinted fill, a violet inset stroke, high-contrast text, and `aria-current="date"`. The expanded calendar pairs this with a separate labeled Today rail so the state is not color-only.

### Motion and State

The shipped shell does not depend on animation. Hover, pressed, selected, focus, current, hidden, and expanded states resolve immediately; the reduced-motion media query disables transitions, animations, and smooth scrolling globally.

**The State Pairing Rule.** Important states combine at least two cues—fill plus rail, text plus top rule, or fill plus outline—so violet is never the only carrier of meaning.

## Do's and Don'ts

### Do:

- **Do** keep editor or preview content visually dominant while chrome stays compact.
- **Do** use the charcoal surface ladder and one-pixel graphite rules to define panel boundaries.
- **Do** reserve Signal Violet for focus, selection, active tabs, current dates, checked controls, and meaningful paths.
- **Do** pair important color changes with a rail, border, label, icon, or `aria` state.
- **Do** preserve strong keyboard focus, reduced-motion behavior, forced-colors outlines, ellipsis, and tabular numerals when extending components.
- **Do** reuse the same panel, row, card, calendar, and segmented-control grammar across layout presets.
- **Do** keep filesystem actions close to the selected file through right-click and drag-and-drop while preserving the same native safety path.
- **Do** use number fields with visible units for exact settings and selects for finite choices.
- **Do** preserve all nine current Settings categories and their Workspace, Content, Files, and System grouping.
- **Do** keep Settings booleans as switches, finite choices as dropdowns, named fonts as selectors, and accent choices as compact semantic swatches.
- **Do** keep attachment and recovery autosave validated and debounced at 500ms while leaving manual cleanup explicit.

### Don't:

- **Don't** turn violet into a large decorative background, gradient, glow, or brand wash.
- **Don't** add ambient drop shadows, glass effects, or floating-card treatment to structural workspace panels.
- **Don't** inflate headings, padding, or corner radii until the interface loses desktop information density.
- **Don't** add a permanent Serein logo block to the ribbon or navigation rail.
- **Don't** reserve permanent Explorer height for rename, move, or Trash buttons.
- **Don't** use a docked Settings drawer or imprecise sliders for values the user may need to enter exactly.
- **Don't** add a permanent Settings preview rail. A temporary or collapsible preview remains an unresolved future option only when a setting genuinely needs it.
- **Don't** expose raw CSS font stacks in normal Settings or add page-level Save buttons that contradict the fixed footer state.
- **Don't** defer any current Settings category to a later phase; the approved production contract contains all nine categories and no Phase 2.
- **Don't** imply mobile behavior or future vault, persistence, backend, calendar-sync, or task behavior from this desktop workspace-shell visual system.

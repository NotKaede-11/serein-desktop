# Main Workspace Surface Brief

## Scope and mode

- Surface: Serein main desktop workspace.
- Visitor mode: Operate.
- Purpose: let the user move between navigation, retrieval, editing, preview, calendar, tasks, and note context without disturbing their active work.

## Audience, job, and constraints

- Primary user: a keyboard-heavy Windows user working in an ordinary local Markdown vault.
- Core job: reopen or find a note quickly, edit safely, and keep useful context close without shrinking the writing surface unnecessarily.
- Layout changes are presentation-only. Switching presets must preserve open tabs, selected note, cursor/selection, scroll positions, undo history, and unsaved work.
- Features are workspace capabilities, not preset-exclusive features. A preset controls where a capability appears, not whether it exists.
- Supported panels may be resized, collapsed, hidden, and reordered. Customized arrangements can be saved as new named layouts.

## Approved direction

Quiet Focus is the factory default visual direction. Two concepts are retained as built-in **Layout Presets**:

| Preset | Role | Composition contract |
| --- | --- | --- |
| Quiet Focus | Factory default | Editor-first workspace; Explorer and dedicated Recent Notes at left; contextual Calendar and Backlinks rail at right; large central writing/reading surface. |
| Balanced Vault | Built-in | Explorer/calendar sidebar; Poznote-style note-list column with All, Recent, Pinned, and Current Folder views; editor plus rendered preview visible together. |

These comps define topology, density, hierarchy, and panel relationships. Their text, exact note data, and incidental icon details are illustrative rather than literal product content.

## Cross-preset capability mapping

| Capability | Quiet Focus | Balanced Vault |
| --- | --- | --- |
| Recent Notes | Dedicated panel | Note-list filter/view |
| Calendar | Context rail | Sidebar calendar |
| Backlinks | Context rail | Toggleable contextual panel |
| Note preview list | Optional | Visible by default |
| Rendered preview | Toggleable | Visible by default |
| Explorer | Visible | Visible |

Apply the same presentation-not-availability rule to Tasks, Search, Tags, Graph, and future workspace capabilities.

## Layout commands and persistence

- Present presets under `View → Layout` and in the Command Palette as `Switch Layout`.
- Provide `Save Current Layout As…`, `Manage Layouts…`, and `Reset Current Layout`.
- Preset-switch shortcuts are configurable; suggested defaults are `Alt+1` and `Alt+2`.
- Remember the selected layout and user-adjusted panel geometry per vault, with an explicit global default available in Settings.

## Unresolved implementation details

- Final responsive behavior at unusually narrow desktop window sizes.
- Whether the right contextual rail uses stacked sections, tabs, or both when several capabilities are simultaneously enabled.
- Exact default shortcut assignments remain changeable during keyboard-conflict testing.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import App from "./App";
import { createBrowserDemoVault } from "./platform/browserDemoVault";
import { createDefaultApplicationSettings } from "./settings/applicationSettings";

function attachmentFile(name: string, type: string, bytes = [1, 2, 3]) {
  const file = new File([Uint8Array.from(bytes)], name, { type });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => Uint8Array.from(bytes).buffer,
  });
  return file;
}

describe("native-shaped workspace flow", () => {
  it("finishes opening after the Strict Mode setup-cleanup-remount cycle", async () => {
    render(<StrictMode><App vaultPort={createBrowserDemoVault()} /></StrictMode>);
    expect(await screen.findByRole("tab", { name: "Welcome" })).toBeVisible();
    expect(screen.queryByText("Opening generated synthetic vault…")).not.toBeInTheDocument();
  });

  it("shows generated vault data and keeps layout choices in Settings", async () => {
    const user = userEvent.setup();
    render(<App vaultPort={createBrowserDemoVault()} runtimeLabel="Test synthetic vault" />);

    expect(screen.getByTestId("workspace")).toHaveAttribute("data-layout", "quiet-focus");
    expect(await screen.findByRole("tab", { name: "Welcome" })).toBeVisible();
    expect(screen.getByTitle("Notes/Welcome.md")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Compact Navigator layout" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByRole("heading", { name: "Welcome to Serein" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Balanced Vault layout" }));

    expect(screen.getByTestId("workspace")).toHaveAttribute("data-layout", "balanced-vault");
    expect(screen.getByLabelText("Note previews")).toBeVisible();
    expect(screen.queryByLabelText("Recent notes")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Calendar — Phase 2" })).toBeDisabled();
  });

  it("keeps real file context available on demand in Balanced Vault", async () => {
    const user = userEvent.setup();
    render(<App vaultPort={createBrowserDemoVault()} />);
    await screen.findByRole("tab", { name: "Welcome" });

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Balanced Vault layout" }));
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByLabelText("Note context")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show note context" }));
    expect(screen.getByLabelText("Note context")).toHaveTextContent("Notes");
    expect(screen.getByLabelText("Note context")).toHaveTextContent("Welcome");
  });

  it("creates, renames, trashes, and restores a note through visible controls", async () => {
    const user = userEvent.setup();
    render(<App vaultPort={createBrowserDemoVault()} />);
    await screen.findByRole("tab", { name: "Welcome" });

    await user.click(screen.getByRole("button", { name: "Create note" }));
    const createPath = screen.getByLabelText("Note path");
    await user.clear(createPath);
    await user.type(createPath, "Notes/Plan.md");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByRole("tab", { name: "Plan" })).toBeVisible();
    expect(screen.getByTitle("Notes/Plan.md")).toBeVisible();

    expect(screen.queryByRole("button", { name: "Move / rename" })).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTitle("Notes/Plan.md"));
    await user.click(screen.getByRole("menuitem", { name: "Rename…" }));
    const movePath = screen.getByLabelText("New name");
    await user.clear(movePath);
    await user.type(movePath, "Renamed");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByRole("tab", { name: "Renamed" })).toBeVisible();
    expect(screen.getByTitle("Notes/Renamed.md")).toBeVisible();

    fireEvent.contextMenu(screen.getByTitle("Notes/Renamed.md"));
    await user.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    await user.click(screen.getByRole("button", { name: "Move to Trash" }));
    await waitFor(() => expect(screen.queryByTitle("Notes/Renamed.md")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Undo trash" }));
    expect(await screen.findByTitle("Notes/Renamed.md")).toBeVisible();
    expect(screen.queryByText(".serein")).not.toBeInTheDocument();
  });

  it("moves a note by dragging it onto a real folder", async () => {
    render(<App vaultPort={createBrowserDemoVault()} />);
    await screen.findByRole("tab", { name: "Welcome" });
    const explorer = screen.getByRole("region", { name: "Vault explorer" });
    const welcome = screen.getByTitle("Notes/Welcome.md");
    const daily = within(explorer).getByRole("button", { name: /^Daily/ });
    const dataTransfer = {
      effectAllowed: "none", dropEffect: "none", setData: vi.fn(), getData: vi.fn(() => "Notes/Welcome.md"),
    };

    fireEvent.dragStart(welcome, { dataTransfer });
    fireEvent.dragOver(daily, { dataTransfer });
    fireEvent.drop(daily, { dataTransfer });

    expect(await screen.findByTitle("Daily/Welcome.md")).toBeVisible();
    expect(screen.queryByTitle("Notes/Welcome.md")).not.toBeInTheDocument();
  });

  it("opens Settings as a resizable modal with exact value controls", async () => {
    const user = userEvent.setup();
    render(<App vaultPort={createBrowserDemoVault()} />);
    await screen.findByRole("tab", { name: "Welcome" });
    await user.click(screen.getByRole("button", { name: "Settings" }));

    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog).toHaveClass("settings-dialog");
    expect(within(dialog).queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Explorer width")).toHaveAttribute("type", "number");
    await user.click(screen.getByRole("button", { name: "Maximize settings window" }));
    expect(dialog).toHaveClass("is-maximized");
    await user.click(screen.getByRole("button", { name: "Restore settings window" }));
    expect(dialog).not.toHaveClass("is-maximized");
  });

  it("keeps a searchable category rail and routes search results to the matching setting", async () => {
    const user = userEvent.setup();
    render(<App vaultPort={createBrowserDemoVault()} />);
    await screen.findByRole("tab", { name: "Welcome" });
    await user.click(screen.getByRole("button", { name: "Settings" }));

    const search = screen.getByRole("searchbox", { name: "Search settings" });
    expect(search).toHaveFocus();
    await user.type(search, "snapshot");
    await user.click(screen.getByRole("button", { name: /Snapshot interval/i }));

    expect(screen.getByRole("region", { name: "Recovery settings" })).toBeVisible();
    expect(screen.getByLabelText("Snapshot interval")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("marks edits unsaved and Ctrl+S forces the typed bridge save immediately", async () => {
    const user = userEvent.setup();
    const port = createBrowserDemoVault();
    const save = vi.spyOn(port, "saveNote");
    render(<App vaultPort={port} />);
    await screen.findByRole("tab", { name: "Welcome" });

    const editor = await screen.findByRole("textbox");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control} immediate");
    expect(screen.getByText("Unsaved")).toBeVisible();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("shows both versions for an external conflict and preserves the disk copy before Keep Mine", async () => {
    const user = userEvent.setup();
    const port = createBrowserDemoVault();
    render(<App vaultPort={port} />);
    await screen.findByRole("tab", { name: "Welcome" });

    const editor = await screen.findByRole("textbox");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control} local draft");
    expect(await screen.findByText("Unsaved")).toBeVisible();
    await port.simulateExternalEdit("Notes/Welcome.md", "# Changed on disk\n");

    expect(await screen.findByRole("dialog", { name: "File changed outside Serein" })).toBeVisible();
    expect((screen.getByLabelText("Your Serein version") as HTMLTextAreaElement).value).toContain("local draft");
    expect(screen.getByLabelText("Disk version")).toHaveValue("# Changed on disk\n");
    await user.click(screen.getByRole("button", { name: "Keep Mine" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(port.readDemoFile("Notes/Welcome.md")).toContain("local draft");
  });

  it("opens deep search from the ribbon and Ctrl+Shift+F, highlights context, and navigates to a result", async () => {
    const user = userEvent.setup();
    render(<App vaultPort={createBrowserDemoVault()} />);
    await screen.findByRole("tab", { name: "Welcome" });

    await user.click(screen.getByRole("button", { name: "Search" }));
    const input = screen.getByRole("searchbox", { name: "Search vault" });
    await user.type(input, "Synthetic daily");
    expect(await screen.findByRole("mark")).toHaveTextContent(/Synthetic daily/i);
    await user.click(screen.getByRole("button", { name: /2026-08-23.*Daily\/2026-08-23\.md/i }));
    expect(await screen.findByRole("tab", { name: "2026-08-23" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("searchbox", { name: "Search vault" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveFocus());

    fireEvent.keyDown(window, { key: "f", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("searchbox", { name: "Search vault" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveFocus());
  });

  it("shows an index error without contradictory empty-search guidance", async () => {
    const user = userEvent.setup();
    const port = createBrowserDemoVault();
    port.syncSearchIndex = vi.fn().mockRejectedValue(new Error("Synthetic index unavailable"));
    render(<App vaultPort={port} />);
    await screen.findByRole("tab", { name: "Welcome" });
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic index unavailable");
    expect(screen.queryByText("Search the whole synthetic vault")).not.toBeInTheDocument();
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });

  it("pastes an image transactionally and shows a lazy rendered preview", async () => {
    const user = userEvent.setup();
    const port = createBrowserDemoVault();
    render(<App vaultPort={port} />);
    await screen.findByRole("tab", { name: "Welcome" });

    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: { files: [attachmentFile("clinical image.png", "image/png")] },
    });
    await waitFor(async () => expect(await port.listAttachments("preview")).toHaveLength(1));
    expect(await screen.findByText("Attached clinical image.png")).toBeVisible();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(port.readDemoFile("Notes/Welcome.md")).toContain("clinical%20image.png"));

    await user.click(screen.getByRole("button", { name: "Preview" }));
    const image = await screen.findByRole("img", { name: "clinical image" });
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
  });

  it("configures the per-vault attachment folder and safely moves an attachment from Settings", async () => {
    const user = userEvent.setup();
    const port = createBrowserDemoVault();
    render(<App vaultPort={port} />);
    await screen.findByRole("tab", { name: "Welcome" });
    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: { files: [attachmentFile("scan.png", "image/png")] },
    });
    await waitFor(async () => expect(await port.listAttachments("preview")).toHaveLength(1));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(port.readDemoFile("Notes/Welcome.md")).toContain("scan.png"));

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Attachments" }));
    expect(await screen.findByText("Attachments/scan.png")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Move scan.png" }));
    const path = screen.getByLabelText("New attachment path");
    await user.clear(path);
    await user.type(path, "Attachments/Imaging/renamed scan.png");
    await user.click(screen.getByRole("button", { name: "Apply attachment move" }));
    await waitFor(() => expect(port.readDemoFile("Notes/Welcome.md")).toContain("renamed%20scan.png"));

    const directory = screen.getByLabelText("Attachment folder");
    await user.clear(directory);
    await user.type(directory, "Media");
    await waitFor(async () => expect(await port.getAttachmentSettings("preview")).toEqual({ directory: "Media" }));
    expect(screen.queryByRole("button", { name: /delete attachment/i })).not.toBeInTheDocument();
  });

  it("offers a verified repair after an attachment is moved externally", async () => {
    const user = userEvent.setup();
    const port = createBrowserDemoVault();
    render(<App vaultPort={port} />);
    await screen.findByRole("tab", { name: "Welcome" });
    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: { files: [attachmentFile("diagram.png", "image/png")] },
    });
    await waitFor(async () => expect(await port.listAttachments("preview")).toHaveLength(1));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(port.readDemoFile("Notes/Welcome.md")).toContain("diagram.png"));

    await port.simulateExternalAttachmentMove("Attachments/diagram.png", "Attachments/renamed diagram.png");
    expect(await screen.findByText("Attachment moved outside Serein")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Repair attachment link" }));

    await waitFor(() => expect(port.readDemoFile("Notes/Welcome.md")).toContain("renamed%20diagram.png"));
    expect(screen.queryByText("Attachment moved outside Serein")).not.toBeInTheDocument();
  });

  it("browses Trash, restores selected items, and confirms permanent deletion", async () => {
    const user = userEvent.setup();
    render(<App vaultPort={createBrowserDemoVault()} />);
    await screen.findByRole("tab", { name: "Welcome" });

    fireEvent.contextMenu(screen.getByTitle("Notes/Welcome.md"));
    await user.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    await user.click(screen.getByRole("button", { name: "Move to Trash" }));
    await user.click(screen.getByRole("button", { name: "Open Trash" }));
    expect(screen.getByRole("heading", { name: "Trash" })).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: /Welcome/ }));
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Trash is empty")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Files" }));
    await user.click(screen.getByTitle("Notes/Welcome.md"));
    fireEvent.contextMenu(screen.getByTitle("Notes/Welcome.md"));
    await user.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    await user.click(screen.getByRole("button", { name: "Move to Trash" }));
    await user.click(screen.getByRole("button", { name: "Open Trash" }));
    await user.click(screen.getByRole("button", { name: "Empty Trash" }));
    const dialog = screen.getByRole("alertdialog", { name: "Empty Trash permanently?" });
    expect(dialog).toHaveTextContent("cannot be undone");
    await user.click(screen.getByRole("button", { name: /Delete 1 permanently/ }));
    expect(await screen.findByText("Trash is empty")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.queryByRole("button", { name: "Undo trash" })).not.toBeInTheDocument();
  });

  it("previews, compares, and restores a version as a copy", async () => {
    const user = userEvent.setup();
    const port = createBrowserDemoVault();
    render(<App vaultPort={port} />);
    await screen.findByRole("tab", { name: "Welcome" });
    const editor = screen.getByRole("textbox");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control} newer text");
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await screen.findByText("Saved");

    await user.click(screen.getByRole("button", { name: "History" }));
    const history = screen.getByRole("complementary", { name: "Version history" });
    expect(history).toBeVisible();
    await user.click(within(history).getByRole("button", { name: "Preview" }));
    expect(await within(history).findByText(/browser preview uses generated/i)).toBeVisible();
    await user.click(within(history).getByRole("button", { name: "Compare" }));
    expect(screen.getByLabelText("Snapshot")).toBeVisible();
    expect((screen.getByLabelText("Current") as HTMLTextAreaElement).value).toContain("newer text");
    await user.click(within(history).getByRole("button", { name: "Restore as Copy" }));
    expect(await screen.findByRole("tab", { name: "Welcome (restored)" })).toHaveAttribute("aria-selected", "true");
  });

  it("persists Recovery settings and exposes manual cleanup", async () => {
    const user = userEvent.setup();
    const port = createBrowserDemoVault();
    render(<App vaultPort={port} />);
    await screen.findByRole("tab", { name: "Welcome" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Recovery" }));
    await user.selectOptions(screen.getByLabelText("Snapshot interval"), "30");
    await user.selectOptions(screen.getByLabelText("Trash cleanup"), "90");
    await waitFor(async () => expect((await port.getRecoverySettings("preview")).snapshotIntervalMinutes).toBe(30));
    expect(await screen.findByText("Recovery settings saved")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Run cleanup" }));
    expect(await screen.findByText("Recovery storage is already tidy")).toBeVisible();
  });

  it("uses preview tabs for single-click navigation and promotes them on double-click", async () => {
    const user = userEvent.setup();
    render(<App vaultPort={createBrowserDemoVault()} />);
    await screen.findByRole("tab", { name: "Welcome" });

    await user.click(screen.getByTitle("Daily/2026-08-23.md"));
    expect(await screen.findByRole("tab", { name: "2026-08-23 (Preview)" })).toBeVisible();
    await user.dblClick(screen.getByTitle("Daily/2026-08-23.md"));
    expect(await screen.findByRole("tab", { name: "2026-08-23" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "2026-08-23 (Preview)" })).not.toBeInTheDocument();
  });

  it("opens the Quick Switcher and Command Palette from their default shortcuts", async () => {
    const user = userEvent.setup();
    render(<App vaultPort={createBrowserDemoVault()} />);
    await screen.findByRole("tab", { name: "Welcome" });

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const switcher = await screen.findByRole("dialog", { name: "Quick Switcher" });
    await user.type(within(switcher).getByRole("combobox"), "2026");
    await user.click(within(switcher).getByRole("option", { name: /2026-08-23.*Daily/i }));
    expect(await screen.findByRole("tab", { name: "2026-08-23 (Preview)" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(window, { key: "p", ctrlKey: true, shiftKey: true });
    const palette = await screen.findByRole("dialog", { name: "Command Palette" });
    await user.type(within(palette).getByRole("combobox"), "trash");
    await user.click(within(palette).getByRole("option", { name: /Open Trash/ }));
    expect(await screen.findByRole("heading", { name: "Trash" })).toBeVisible();
  });

  it("reopens safely closed tabs and opens a shared note view in the second group", async () => {
    const user = userEvent.setup();
    render(<App vaultPort={createBrowserDemoVault()} />);
    const welcome = await screen.findByRole("tab", { name: "Welcome" });
    fireEvent.contextMenu(welcome);
    await user.click(screen.getByRole("menuitem", { name: "Open in second group" }));
    expect(screen.getByRole("tablist", { name: "Secondary editor group" })).toBeVisible();
    expect(within(screen.getByRole("tablist", { name: "Secondary editor group" })).getByRole("tab", { name: "Welcome" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close Welcome in primary group" }));
    expect(within(screen.getByRole("tablist", { name: "Primary editor group" })).queryByRole("tab", { name: "Welcome" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "t", ctrlKey: true, shiftKey: true });
    expect(await within(screen.getByRole("tablist", { name: "Primary editor group" })).findByRole("tab", { name: "Welcome" })).toBeVisible();
  });

  it("allows preview tabs and shortcuts to be configured in Settings", async () => {
    const user = userEvent.setup();
    render(<App vaultPort={createBrowserDemoVault()} />);
    await screen.findByRole("tab", { name: "Welcome" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(within(screen.getByRole("navigation", { name: "Settings categories" })).getByRole("button", { name: "Editor" }));
    const previewTabs = screen.getByRole("switch", { name: "Use preview tabs" });
    expect(previewTabs).toHaveAttribute("type", "checkbox");
    expect(previewTabs.closest("label")).toHaveClass("settings-toggle");
    expect(screen.queryByRole("checkbox", { name: "Use preview tabs" })).not.toBeInTheDocument();
    await user.click(previewTabs);
    expect(screen.getByText("Every opened note stays as a regular tab.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Shortcuts" }));
    expect(screen.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
    expect(screen.getByText("Ctrl+P")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reset all shortcuts" })).toBeVisible();
  });

  it("keeps an unsaved tab open when its safety save fails", async () => {
    const user = userEvent.setup();
    const port = createBrowserDemoVault();
    port.saveNote = vi.fn().mockRejectedValue(new Error("synthetic disk is locked"));
    render(<App vaultPort={port} />);
    await screen.findByRole("tab", { name: "Welcome" });
    await user.click(screen.getByRole("textbox"));
    await user.keyboard("x");
    await user.click(screen.getByRole("button", { name: "Close Welcome in primary group" }));

    expect(await screen.findByRole("tab", { name: "Welcome" })).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent("synthetic disk is locked");
  });

  it("restores application settings after a restart", async () => {
    const user = userEvent.setup();
    const port = createBrowserDemoVault();
    const saveSettings = vi.spyOn(port, "saveApplicationSettings");
    const first = render(<App vaultPort={port} />);
    await screen.findByRole("tab", { name: "Welcome" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Appearance" }));
    await user.selectOptions(screen.getByLabelText("Theme"), "light");
    fireEvent.change(screen.getByLabelText("UI scale"), { target: { value: "1.25" } });
    await waitFor(() => expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      appearance: expect.objectContaining({ theme: "light", uiScale: 1.25 }),
    })));
    first.unmount();

    render(<App vaultPort={port} />);
    await screen.findByRole("tab", { name: "Welcome" });
    expect(screen.getByRole("main")).toHaveAttribute("data-theme", "light");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.getByLabelText("UI scale")).toHaveValue(1.25);
  });

  it("switches Light, Dark, and System themes live and follows system changes", async () => {
    let matches = false;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mediaQuery = {
      get matches() { return matches; },
      media: "(prefers-color-scheme: light)",
      onchange: null,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener as (event: MediaQueryListEvent) => void),
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener as (event: MediaQueryListEvent) => void),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } as unknown as MediaQueryList;
    vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));

    try {
      const user = userEvent.setup();
      const port = createBrowserDemoVault();
      const settings = createDefaultApplicationSettings();
      settings.appearance.theme = "system";
      port.seedApplicationSettings(settings);
      render(<App vaultPort={port} />);

      await screen.findByRole("tab", { name: "Welcome" });
      expect(screen.getByRole("main")).toHaveAttribute("data-theme", "dark");

      act(() => {
        matches = true;
        listeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));
      });
      expect(screen.getByRole("main")).toHaveAttribute("data-theme", "light");

      await user.click(screen.getByRole("button", { name: "Settings" }));
      await user.click(screen.getByRole("button", { name: "Appearance" }));
      await user.selectOptions(screen.getByLabelText("Theme"), "dark");
      expect(screen.getByRole("main")).toHaveAttribute("data-theme", "dark");
      await user.selectOptions(screen.getByLabelText("Theme"), "light");
      expect(screen.getByRole("main")).toHaveAttribute("data-theme", "light");
      await user.selectOptions(screen.getByLabelText("Theme"), "system");
      expect(screen.getByRole("main")).toHaveAttribute("data-theme", "light");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("restores the exact per-vault layout, tabs, and two editor groups", async () => {
    const user = userEvent.setup();
    const port = createBrowserDemoVault();
    const saveSession = vi.spyOn(port, "saveVaultWorkspaceSession");
    const first = render(<App vaultPort={port} />);
    const welcome = await screen.findByRole("tab", { name: "Welcome" });
    fireEvent.contextMenu(welcome);
    await user.click(screen.getByRole("menuitem", { name: "Open in second group" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Balanced Vault layout" }));
    fireEvent.change(screen.getByLabelText("Explorer width"), { target: { value: "280" } });
    await waitFor(() => expect(saveSession).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
      layout: expect.objectContaining({
        activePresetId: "balanced-vault",
        panels: expect.objectContaining({ explorer: expect.objectContaining({ width: 280 }) }),
      }),
      noteSessions: expect.objectContaining({ groups: expect.objectContaining({
        secondary: expect.objectContaining({ tabIds: ["Notes/Welcome.md"] }),
      }) }),
    })));
    first.unmount();

    render(<App vaultPort={port} />);
    await screen.findByRole("tab", { name: "Welcome" });
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-layout", "balanced-vault");
    expect(screen.getByRole("tablist", { name: "Secondary editor group" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Explorer width")).toHaveValue(280);
  });

  it("creates and deletes a named layout without changing the immutable built-ins", async () => {
    const user = userEvent.setup();
    render(<App vaultPort={createBrowserDemoVault()} />);
    await screen.findByRole("tab", { name: "Welcome" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Appearance" }));
    await user.selectOptions(screen.getByLabelText("Theme"), "light");
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    fireEvent.change(screen.getByLabelText("Explorer width"), { target: { value: "286" } });
    await user.type(screen.getByLabelText("Custom layout name"), "Study Desk");
    await user.click(screen.getByRole("button", { name: "Save Layout As…" }));

    expect(screen.getByRole("button", { name: "Study Desk layout" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Quiet Focus layout" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Balanced Vault layout" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Delete Study Desk layout" }));

    expect(screen.queryByRole("button", { name: "Study Desk layout" })).not.toBeInTheDocument();
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-layout", "quiet-focus");
    expect(screen.getByLabelText("Explorer width")).toHaveValue(260);
    expect(screen.getByRole("main")).toHaveAttribute("data-theme", "light");
  });

  it("applies UI scale through component variables and safe mode suppresses custom CSS", async () => {
    const user = userEvent.setup();
    render(<App vaultPort={createBrowserDemoVault()} />);
    await screen.findByRole("tab", { name: "Welcome" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.change(screen.getByLabelText("UI scale"), { target: { value: "1.5" } });
    expect(screen.getByRole("main")).toHaveStyle({ "--ui-font-size": "19.5px", "--ribbon-width": "66px" });
    expect(screen.getByRole("main").style.transform).toBe("");

    await user.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.change(screen.getByLabelText("Local CSS snippet"), { target: { value: ".workspace { color: red; }" } });
    expect(document.querySelector("style[data-serein-custom-css]")).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Safe mode" }));
    expect(document.querySelector("style[data-serein-custom-css]")).not.toBeInTheDocument();
  });

  it("requires explicit confirmation before resetting every setting", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App vaultPort={createBrowserDemoVault()} />);
    await screen.findByRole("tab", { name: "Welcome" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Appearance" }));
    await user.selectOptions(screen.getByLabelText("Theme"), "light");
    await user.click(screen.getByRole("button", { name: "Advanced" }));
    await user.click(screen.getByRole("button", { name: "Reset Settings" }));

    expect(confirm).toHaveBeenCalledWith("Reset every Serein setting? Vault files will not be changed.");
    expect(screen.getByRole("main")).toHaveAttribute("data-theme", "light");
    confirm.mockRestore();
  });

  it("shows the final local product identity and privacy promises in About", async () => {
    const user = userEvent.setup();
    render(<App vaultPort={createBrowserDemoVault()} />);
    await screen.findByRole("tab", { name: "Welcome" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "About" }));

    expect(screen.getByRole("heading", { name: "Serein" })).toBeVisible();
    expect(screen.getByText("Pronounced seh-reen.")).toBeVisible();
    expect(screen.getByText("0.1.0")).toBeVisible();
    expect(screen.getByText("Offline capable")).toBeVisible();
    expect(screen.getByText("Zero telemetry")).toBeVisible();
  });

  it("shows recovery choices when the previous vault is unavailable", async () => {
    const port = createBrowserDemoVault();
    const settings = createDefaultApplicationSettings();
    settings.startup.lastVaultRoot = "C:/Unavailable/SyntheticVault";
    port.seedApplicationSettings(settings);

    render(<App vaultPort={port} />);

    expect(await screen.findByRole("heading", { name: "Vault unavailable" })).toBeVisible();
    expect(screen.getByText("C:/Unavailable/SyntheticVault")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open generated test vault" })).toBeVisible();
  });

  it("reports malformed settings and starts with safe defaults", async () => {
    const port = createBrowserDemoVault();
    port.seedApplicationSettings(null, "Settings could not be read. Serein started with safe defaults.");

    render(<App vaultPort={port} />);

    await screen.findByRole("tab", { name: "Welcome" });
    expect(screen.getByRole("alert")).toHaveTextContent("safe defaults");
    expect(screen.getByRole("main")).toHaveAttribute("data-theme", "dark");
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { commandDefinitions, createDefaultShortcutBindings } from "../commands/commandRegistry";
import { ShortcutSettings } from "./ShortcutSettings";

describe("ShortcutSettings", () => {
  it("detects a conflict and can explicitly replace the previous binding", async () => {
    const user = userEvent.setup();
    const bindings = createDefaultShortcutBindings(commandDefinitions);
    const onChange = vi.fn();
    render(<ShortcutSettings definitions={commandDefinitions} bindings={bindings} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Rebind Quick Switcher primary shortcut" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Press keys…" }), { key: "p", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("alert")).toHaveTextContent("already assigned");
    await user.click(screen.getByRole("button", { name: "Replace" }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      "navigation.quickSwitcher": ["Ctrl+Shift+P"],
      "navigation.commandPalette": [],
    }));
  });
});

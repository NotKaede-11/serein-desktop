import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AttachmentImport } from "../platform/vault";
import { EditorSessionCache, MarkdownEditor } from "./MarkdownEditor";

function imported(markdown: string, fileName = "image.png"): AttachmentImport {
  return {
    relativePath: `Attachments/${fileName}`,
    markdown,
    displayName: fileName.replace(/\.[^.]+$/, ""),
    created: true,
    rollbackToken: "rollback-token",
  };
}

function testFile(name: string, type: string, bytes: number[]) {
  return {
    name,
    type,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  } as File;
}

describe("MarkdownEditor attachment insertion", () => {
  it.each([
    ["clipboard.png", "image/png"],
    ["clipboard.jpeg", "image/jpeg"],
  ])("pastes %s only after the attachment import succeeds", async (name, type) => {
    const onChange = vi.fn();
    const onImportBytes = vi.fn().mockResolvedValue(imported(`![clipboard](../Attachments/${name})`, name));
    render(<MarkdownEditor value="# Note\n" onChange={onChange} onImportBytes={onImportBytes}
      onImportPath={vi.fn()} onRollbackAttachment={vi.fn()} onAttachmentError={vi.fn()} />);

    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: { files: [testFile(name, type, [1, 2, 3])] },
    });

    await waitFor(() => expect(onImportBytes).toHaveBeenCalledWith(name, type, [1, 2, 3]));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining(`../Attachments/${name}`)));
  });

  it.each([
    ["scan.png", "image/png", "![scan](../Attachments/scan.png)"],
    ["lecture.pdf", "application/pdf", "[lecture](../Attachments/lecture.pdf)"],
    ["recording.m4a", "audio/mp4", "[recording](../Attachments/recording.m4a)"],
  ])("drops %s as the correct Markdown link", async (name, type, markdown) => {
    const onChange = vi.fn();
    const onImportBytes = vi.fn().mockResolvedValue(imported(markdown, name));
    render(<MarkdownEditor value="# Drop\n" onChange={onChange} onImportBytes={onImportBytes}
      onImportPath={vi.fn()} onRollbackAttachment={vi.fn()} onAttachmentError={vi.fn()} />);

    fireEvent.drop(screen.getByRole("textbox"), {
      dataTransfer: { files: [testFile(name, type, [4, 5, 6])] },
    });

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining(markdown)));
  });

  it("rolls back the copied file if inserting the Markdown transaction fails", async () => {
    const attachment = imported("![image](../Attachments/image.png)");
    const onRollbackAttachment = vi.fn().mockResolvedValue(true);
    const onAttachmentError = vi.fn();
    render(<MarkdownEditor value="# Note\n" onChange={() => { throw new Error("editor rejected change"); }}
      onImportBytes={vi.fn().mockResolvedValue(attachment)} onImportPath={vi.fn()}
      onRollbackAttachment={onRollbackAttachment} onAttachmentError={onAttachmentError} />);

    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: { files: [testFile("image.png", "image/png", [1])] },
    });

    await waitFor(() => expect(onRollbackAttachment).toHaveBeenCalledWith(attachment));
    expect(onAttachmentError).toHaveBeenCalledWith(expect.stringContaining("editor rejected change"));
  });

  it("keeps the editor usable while a large asynchronous import is running", async () => {
    const user = userEvent.setup();
    let finishImport!: (value: AttachmentImport) => void;
    const pending = new Promise<AttachmentImport>((resolve) => { finishImport = resolve; });
    const onChange = vi.fn();
    render(<MarkdownEditor value="# Large\n" onChange={onChange} onImportBytes={() => pending}
      onImportPath={vi.fn()} onRollbackAttachment={vi.fn()} onAttachmentError={vi.fn()} />);
    const editor = screen.getByRole("textbox");

    fireEvent.drop(editor, {
      dataTransfer: { files: [testFile("large-video.mp4", "video/mp4", [1, 2, 3])] },
    });
    await user.click(editor);
    await user.keyboard("still typing");

    expect(onChange).toHaveBeenCalledWith(expect.stringContaining("still typing"));
    finishImport(imported("[large-video](../Attachments/large-video.mp4)", "large-video.mp4"));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining("large-video.mp4")));
  });
});

describe("MarkdownEditor note sessions", () => {
  it("preserves independent CodeMirror history when switching between note tabs", async () => {
    const user = userEvent.setup();
    const cache = new EditorSessionCache();
    function Harness() {
      const [active, setActive] = useState<"A" | "B">("A");
      const [values, setValues] = useState({ A: "# A\n", B: "# B\n" });
      return <>
        <button onClick={() => setActive("A")}>Open A</button>
        <button onClick={() => setActive("B")}>Open B</button>
        <MarkdownEditor sessionKey={active} sessionCache={cache} value={values[active]}
          onChange={(value) => setValues((current) => ({ ...current, [active]: value }))} />
      </>;
    }
    render(<Harness />);
    const editor = screen.getByRole("textbox");
    await user.click(editor);
    await user.keyboard("x");
    await user.click(screen.getByRole("button", { name: "Open B" }));
    await user.click(editor);
    await user.keyboard("y");
    await user.click(screen.getByRole("button", { name: "Open A" }));
    expect(editor).toHaveTextContent("x");
    expect(editor).not.toHaveTextContent("y");

    await user.click(editor);
    await user.keyboard("{Control>}z{/Control}");
    expect(editor).not.toHaveTextContent("x");
    await user.click(screen.getByRole("button", { name: "Open B" }));
    expect(editor).toHaveTextContent("y");
  });
});

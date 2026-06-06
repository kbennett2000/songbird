import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NoteEditor } from "@/components/NoteEditor";

describe("NoteEditor", () => {
  it("renders the initial Markdown and emits Markdown on Save", async () => {
    const onSave = vi.fn();
    render(
      <NoteEditor initialMarkdown="**bold** and a word" onSave={onSave} onCancel={() => {}} />,
    );

    // The editor mounts and renders the note text.
    expect(await screen.findByText(/bold/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const emitted = onSave.mock.calls[0]?.[0] as string;
    expect(typeof emitted).toBe("string");
    expect(emitted).toContain("bold");
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SermonNoteForm, type SermonNoteFormValues } from "@/components/SermonNoteForm";

const EMPTY: SermonNoteFormValues = {
  title: "",
  sermon_url: "",
  reference: "",
  event_date: null,
};

describe("SermonNoteForm", () => {
  it("disables Save until title, URL, and reference are all present", async () => {
    const user = userEvent.setup();
    render(
      <SermonNoteForm initial={EMPTY} onSave={vi.fn()} onCancel={vi.fn()} />,
    );

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("Title"), "T");
    await user.type(screen.getByLabelText("Sermon URL"), "https://x.test");
    expect(save).toBeDisabled(); // reference still empty
    await user.type(screen.getByLabelText("Reference"), "John 3:16");
    expect(save).toBeEnabled();
  });

  it("trims values and emits null for an empty date", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <SermonNoteForm
        initial={{ ...EMPTY, reference: "John 3:16" }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Title"), "  Grace  ");
    await user.type(screen.getByLabelText("Sermon URL"), "  https://x.test  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({
      title: "Grace",
      sermon_url: "https://x.test",
      reference: "John 3:16",
      event_date: null,
    });
  });

  it("shows Delete only when onDelete is provided", () => {
    const { rerender } = render(
      <SermonNoteForm initial={EMPTY} onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

    rerender(
      <SermonNoteForm initial={EMPTY} onSave={vi.fn()} onCancel={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});

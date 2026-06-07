import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SermonNotesPopover } from "@/components/SermonNotesPopover";
import type { SermonNote } from "@/schemas";

function note(id: number, overrides: Partial<SermonNote> = {}): SermonNote {
  return {
    id,
    title: `Sermon ${id}`,
    sermon_url: `https://youtu.be/vid${id}`,
    reference: "Acts 2:42-47",
    book_usfm: "ACT",
    book_order_index: 44,
    start_chapter: 2,
    start_verse: 42,
    end_chapter: 2,
    end_verse: 47,
    event_date: "2026-01-05",
    tags: [`tag${id}`],
    author_id: 1,
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    ...overrides,
  };
}

function renderPopover(notes: SermonNote[], onClose = vi.fn()) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  render(<SermonNotesPopover notes={notes} anchor={anchor} onClose={onClose} />);
  return { onClose, anchor };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SermonNotesPopover", () => {
  it("lists EVERY sermon on the verse so none is hidden (2 notes)", () => {
    renderPopover([note(1), note(2)]);
    expect(screen.getByText("Sermons · 2")).toBeInTheDocument();
    expect(screen.getByText("Sermon 1")).toBeInTheDocument();
    expect(screen.getByText("Sermon 2")).toBeInTheDocument();
  });

  it("handles the worst-case count (4 notes) — all titles + links present", () => {
    const notes = [note(1), note(2), note(3), note(4)];
    renderPopover(notes);
    expect(screen.getByText("Sermons · 4")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /Watch the sermon/ });
    expect(links).toHaveLength(4);
    for (const n of notes) {
      expect(screen.getByText(`Sermon ${n.id}`)).toBeInTheDocument();
    }
  });

  it("renders each sermon URL as a safe external link", () => {
    renderPopover([note(1), note(2)]);
    const link = screen.getAllByRole("link", { name: /Watch the sermon/ })[0]!;
    expect(link).toHaveAttribute("href", "https://youtu.be/vid1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("closes on Escape (shared Popover shell)", async () => {
    const { onClose } = renderPopover([note(1), note(2)]);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

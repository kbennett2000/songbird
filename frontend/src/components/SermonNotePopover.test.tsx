import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SermonNotePopover } from "@/components/SermonNotePopover";
import type { SermonNote } from "@/schemas";

function note(overrides: Partial<SermonNote> = {}): SermonNote {
  return {
    id: 1,
    title: "Devoted to the Apostles' Teaching",
    sermon_url: "https://youtu.be/abc123",
    reference: "Acts 2:42-47",
    book_usfm: "ACT",
    book_order_index: 44,
    start_chapter: 2,
    start_verse: 42,
    end_chapter: 2,
    end_verse: 47,
    event_date: "2026-01-05",
    tags: ["acts", "church"],
    author_id: 1,
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    ...overrides,
  };
}

function renderPopover(n: SermonNote, onClose = vi.fn()) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  render(<SermonNotePopover note={n} anchor={anchor} onClose={onClose} />);
  return { onClose, anchor };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SermonNotePopover", () => {
  it("shows the title, reference, formatted date, and tags", () => {
    renderPopover(note());
    expect(screen.getByText("Devoted to the Apostles' Teaching")).toBeInTheDocument();
    expect(screen.getByText(/Acts 2:42-47/)).toBeInTheDocument();
    expect(screen.getByText(/Jan 5, 2026/)).toBeInTheDocument();
    expect(screen.getByText("acts")).toBeInTheDocument();
    expect(screen.getByText("church")).toBeInTheDocument();
  });

  it("renders the sermon URL as a safe external link (new tab, noopener)", () => {
    renderPopover(note());
    const link = screen.getByRole("link", { name: /Watch the sermon/ });
    expect(link).toHaveAttribute("href", "https://youtu.be/abc123");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("omits the date when there is none", () => {
    renderPopover(note({ event_date: null }));
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const { onClose } = renderPopover(note());
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

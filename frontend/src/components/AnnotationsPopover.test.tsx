import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnnotationsPopover } from "@/components/AnnotationsPopover";
import type { ReadAnnotation } from "@/schemas";

function ann(id: number, overrides: Partial<ReadAnnotation> = {}): ReadAnnotation {
  return {
    id,
    book_usfm: "JOS",
    start_chapter: 1,
    start_verse: 1,
    end_chapter: 1,
    end_verse: 1,
    note_markdown: `Note ${id}`,
    color: null,
    scope_type: "all",
    scope_translations: [],
    tags: [`tag${id}`],
    in_scope: true,
    author_id: 1,
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    ...overrides,
  };
}

function renderPopover(
  annotations: ReadAnnotation[],
  props: { onClose?: () => void; onOpen?: (a: ReadAnnotation) => void } = {},
) {
  const onClose = props.onClose ?? vi.fn();
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  render(
    <MemoryRouter>
      <AnnotationsPopover
        annotations={annotations}
        anchor={anchor}
        onClose={onClose}
        onOpen={props.onOpen}
      />
    </MemoryRouter>,
  );
  return { onClose, anchor };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AnnotationsPopover", () => {
  it("lists EVERY annotation on the verse so none is hidden behind [0] (#114)", () => {
    renderPopover([ann(1), ann(2)]);
    expect(screen.getByText("Notes · 2")).toBeInTheDocument();
    expect(screen.getByText("Note 1")).toBeInTheDocument();
    expect(screen.getByText("Note 2")).toBeInTheDocument();
  });

  it("sorts newest first (created_at DESC)", () => {
    renderPopover([
      ann(1, { created_at: "2026-01-01T00:00:00Z" }), // older
      ann(2, { created_at: "2026-06-01T00:00:00Z" }), // newer → first
    ]);
    const order = screen.getAllByText(/^Note \d$/).map((p) => p.textContent);
    expect(order).toEqual(["Note 2", "Note 1"]);
  });

  it("renders the out-of-scope line and tags verbatim", () => {
    renderPopover([
      ann(1, { in_scope: false, scope_translations: ["KJV", "NKJV"], tags: ["grace"] }),
    ]);
    expect(screen.getByText("Written for KJV, NKJV")).toBeInTheDocument();
    expect(screen.getByText("grace")).toBeInTheDocument();
  });

  it("calls onOpen with the clicked card's annotation (reader case)", async () => {
    const onOpen = vi.fn();
    renderPopover([ann(1), ann(2)], { onOpen });
    // The whole card is the button; its accessible name carries the note's preview.
    await userEvent.click(screen.getByRole("button", { name: "Open note: Note 2" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]![0]).toMatchObject({ id: 2 });
  });

  it("makes each card a reader deep-link when onOpen is absent (compare case)", () => {
    renderPopover([ann(1), ann(2)]);
    expect(screen.queryByRole("button", { name: /Open note/ })).not.toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /Open note in reader/ });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/read?book=JOS&chapter=1&verse=1");
  });

  it("shows a stripped, truncated preview — never a wall of raw Markdown (#116)", () => {
    const long = `# Big Heading\n\n- bullet\n\n${"x".repeat(200)}`;
    renderPopover([ann(1, { note_markdown: long })]);
    const preview = screen.getByText(/^Big Heading/);
    expect(preview.textContent).not.toContain("#");
    expect(preview.textContent).not.toContain("- bullet"); // the "-" Markdown noise is stripped
    expect(preview.textContent!.endsWith("…")).toBe(true);
    expect(preview.textContent!.length).toBeLessThanOrEqual(121); // notePreview caps at 120 + "…"
    expect(screen.queryByText(long)).not.toBeInTheDocument(); // the raw note is NOT dumped verbatim
  });

  it("labels an empty note rather than rendering a blank card", () => {
    renderPopover([ann(1, { note_markdown: "   " })], { onOpen: vi.fn() });
    expect(screen.getByRole("button", { name: "Open note: (empty note)" })).toBeInTheDocument();
  });

  it("closes on Escape (shared Popover shell)", async () => {
    const { onClose } = renderPopover([ann(1), ann(2)]);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

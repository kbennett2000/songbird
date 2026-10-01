import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NoteMarkdown } from "@/components/NoteMarkdown";

// Made-up note text only — never a real study Bible's notes.
function renderMd(text: string, onJump = vi.fn()) {
  const { container } = render(<NoteMarkdown text={text} onJump={onJump} />);
  return { container, onJump };
}

describe("NoteMarkdown", () => {
  it("renders paragraphs, emphasis and strong text", () => {
    const { container } = renderMd(
      "A *made-up* note with **strong** words.\n\nA second paragraph.",
    );
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(screen.getByText("made-up").tagName).toBe("EM");
    expect(screen.getByText("strong").tagName).toBe("STRONG");
  });

  it("renders bullet and numbered lists", () => {
    const { container } = renderMd("- one\n- two\n\n3. three\n4. four");
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    const ol = container.querySelector("ol");
    expect(ol?.querySelectorAll("li")).toHaveLength(2);
    expect(ol?.getAttribute("start")).toBe("3"); // a list that starts at 3 keeps its numbering
    expect(screen.getByText("one").tagName).toBe("LI"); // a tight list has no <p> inside items
  });

  it("renders a block quote", () => {
    const { container } = renderMd("> A quoted made-up line.");
    expect(container.querySelector("blockquote")).toHaveTextContent("A quoted made-up line.");
  });

  it("turns a ref: link into a button that jumps to the passage's start", async () => {
    const { onJump } = renderMd("See [the next verses](ref:JHN.3.16-18) for more.");
    await userEvent.setup().click(screen.getByRole("button", { name: "the next verses" }));
    expect(onJump).toHaveBeenCalledWith("JHN", 3, 16);
  });

  it("jumps to a chapter's top for a chapter link", async () => {
    const { onJump } = renderMd("See [chapter 20](ref:GEN.20).");
    await userEvent.setup().click(screen.getByRole("button", { name: "chapter 20" }));
    expect(onJump).toHaveBeenCalledWith("GEN", 20, null);
  });

  it("shows any other link as its words only — nothing clickable", () => {
    const { container } = renderMd(
      "A [web link](https://example.com), a [bad ref](ref:John.3), and <https://example.org>.",
    );
    expect(container.querySelector("a")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container).toHaveTextContent("A web link, a bad ref, and https://example.org.");
  });

  it("never renders raw HTML — it stays visible text", () => {
    const { container } = renderMd(
      "Made-up <b>bold</b> and <script>alert(1)</script>.\n\n<div>block</div>",
    );
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.firstElementChild!.querySelector("div")).toBeNull(); // no injected element
    expect(container).toHaveTextContent("Made-up <b>bold</b> and <script>alert(1)</script>.");
    expect(container).toHaveTextContent("<div>block</div>");
  });

  it("shows an image as its alt text", () => {
    const { container } = renderMd("Before ![a made-up chart](chart.png) after.");
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("Before a made-up chart after.");
  });

  it("renders headings as bold lines and keeps code as text", () => {
    const { container } = renderMd("## A made-up heading\n\nSome `inline` code.");
    expect(screen.getByText("A made-up heading")).toHaveClass("font-semibold");
    expect(container.querySelector("h2")).toBeNull();
    expect(screen.getByText("inline").tagName).toBe("CODE");
  });
});

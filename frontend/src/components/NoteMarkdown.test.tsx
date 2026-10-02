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

  it("gives ## and ### each their own look, apart from bold opening words", () => {
    renderMd(
      "## A made-up section\n\n### A made-up subsection\n\n**Bold opening words.** Then the rest.",
    );
    const section = screen.getByText("A made-up section");
    const subsection = screen.getByText("A made-up subsection");
    const bold = screen.getByText("Bold opening words.");
    expect(section).toHaveAttribute("data-md-heading", "2");
    expect(subsection).toHaveAttribute("data-md-heading", "3");
    // ##: a little larger, with a rule under it. ###: small capitals, muted.
    expect(section).toHaveClass("text-[1.07em]", "border-b");
    expect(section).not.toHaveClass("uppercase");
    expect(subsection).toHaveClass("text-[0.85em]", "uppercase", "tracking-wider");
    expect(subsection).not.toHaveClass("border-b");
    // Bold opening words stay inline in their paragraph, at the text's own size.
    expect(bold.tagName).toBe("STRONG");
    expect(bold.parentElement!.tagName).toBe("P");
    expect(bold.parentElement).not.toHaveAttribute("data-md-heading");
  });
});

describe("NoteMarkdown — poetry", () => {
  const lines = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("[data-poetry-line]"));

  it("puts each line of a poem on its own hanging-indented line, its reference too", () => {
    const { container } = renderMd(
      "A made-up first line,\\\nand a second, much longer one,\\\na third.\\\n([Made-up 1:2](ref:GEN.1.2))",
    );
    const found = lines(container);
    expect(found.map((l) => l.textContent)).toEqual([
      "A made-up first line,",
      "and a second, much longer one,",
      "a third.",
      "(Made-up 1:2)",
    ]);
    // Flush left, and a wrapped part indented: a hanging indent on every line.
    for (const l of found) expect(l).toHaveClass("block", "pl-[1.5em]", "-indent-[1.5em]");
    expect(container.querySelector("br")).toBeNull();
    expect(screen.getByRole("button", { name: "Made-up 1:2" })).toBeInTheDocument();
  });

  it("indents poetry inside a quote, and a timeline entry's date and event", () => {
    const { container } = renderMd(
      "> A made-up line\\\n> and its answer.\n\n- 1000 B.C.\\\n  **A MADE-UP EVENT**",
    );
    const found = lines(container);
    expect(found).toHaveLength(4);
    expect(found[0]!.closest("blockquote")).not.toBeNull();
    expect(found[2]!.closest("li")).toHaveTextContent("1000 B.C.A MADE-UP EVENT");
  });

  it("leaves a one-line quotation and its reference as they were", () => {
    const { container } = renderMd(
      "A made-up quotation that runs on as prose for a while.\\\n([Made-up 3:4](ref:EXO.3.4))",
    );
    expect(lines(container)).toHaveLength(0);
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  it("leaves paragraphs without hard breaks alone", () => {
    const { container } = renderMd("A made-up paragraph.\nIts second source line.\n\nAnother.");
    expect(lines(container)).toHaveLength(0);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("counts a last line with other words beside its link as a line of the poem", () => {
    const { container } = renderMd("A made-up line\\\nsee [this](ref:GEN.1.2) too");
    expect(lines(container)).toHaveLength(2);
  });
});

describe("NoteMarkdown — in a page of its own", () => {
  it("renders headings as real headings from headingBase, one level deeper for ###", () => {
    render(
      <NoteMarkdown
        text={"## A MADE-UP SECTION\n\n### A made-up subsection\n\nWords."}
        onJump={vi.fn()}
        headingBase={3}
      />,
    );
    const section = screen.getByRole("heading", { name: "A MADE-UP SECTION", level: 3 });
    const subsection = screen.getByRole("heading", { name: "A made-up subsection", level: 4 });
    // The same looks as in a note box.
    expect(section).toHaveClass("border-b");
    expect(subsection).toHaveClass("uppercase");
  });

  it("places an asset: picture that stands alone, as a block of its own", () => {
    const renderImage = vi.fn((name: string, alt: string) => (
      <figure data-testid="figure">
        {name} / {alt}
      </figure>
    ));
    const { container } = render(
      <NoteMarkdown
        text={"Before.\n\n![A made-up caption](asset:made-up.jpg)\n\nAfter ![inline](asset:x.png)."}
        onJump={vi.fn()}
        renderImage={renderImage}
      />,
    );
    expect(renderImage).toHaveBeenCalledWith("made-up.jpg", "A made-up caption");
    expect(screen.getByTestId("figure")).toHaveTextContent("made-up.jpg / A made-up caption");
    expect(screen.getByTestId("figure").closest("p")).toBeNull(); // never inside a paragraph
    // A picture in the middle of words, or any other image, is still its alt text.
    expect(container).toHaveTextContent("After inline.");
    expect(renderImage).toHaveBeenCalledTimes(1);
  });

  it("shows an asset: picture's alt text where nothing places pictures (a note box)", () => {
    const { container } = renderMd("![A made-up caption](asset:made-up.jpg)");
    expect(container.querySelector("figure, img")).toBeNull();
    expect(container).toHaveTextContent("A made-up caption");
  });
});

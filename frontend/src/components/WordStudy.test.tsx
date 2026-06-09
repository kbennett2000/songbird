import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { WordStudy } from "@/components/WordStudy";
import { server } from "@/test/msw/server";

function token(overrides: Record<string, unknown> = {}) {
  return {
    position: 1,
    surface_form: "λόγος",
    strongs_id: "G3056",
    morph_code: "N-NSM",
    lemma: "λόγος",
    transliteration: "logos",
    gloss: "word",
    ...overrides,
  };
}

function strongsVerse(book: string, chapter: number, verse: number, text: string | null = null) {
  return { book, chapter, verse, reference: `${book} ${chapter}:${verse}`, text };
}

function renderPanel(onJump = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WordStudy book="JHN" chapter={1} verse={1} translation="WEB" onJump={onJump} />
    </QueryClientProvider>,
  );
  return onJump;
}

describe("WordStudy", () => {
  it("lists a verse's tokens and drills a tagged word to its Strong's detail + concordance", async () => {
    server.use(
      http.get("/api/v1/verse-words/:book/:chapter/:verse", () =>
        HttpResponse.json({
          reference: "John 1:1",
          text_id: "SBLGNT",
          tokens: [
            token(),
            token({
              position: 2,
              surface_form: ".",
              strongs_id: null,
              morph_code: null,
              lemma: null,
              transliteration: null,
              gloss: null,
            }),
          ],
        }),
      ),
      http.get("/api/v1/strongs/:id", () =>
        HttpResponse.json({
          strongs_id: "G3056",
          language: "greek",
          lemma: "λόγος",
          transliteration: "logos",
          gloss: "word",
          definition: "a word, speech, account…",
          source: "Strong's Greek",
        }),
      ),
      http.get("/api/v1/strongs/:id/verses", () =>
        HttpResponse.json([strongsVerse("JHN", 1, 14, "And the Word became flesh…")]),
      ),
    );
    const user = userEvent.setup();
    renderPanel();

    // Level 1: the strip shows the token (surface form + gloss).
    expect(await screen.findByText("λόγος")).toBeInTheDocument();
    expect(screen.getByText(/logos · word/)).toBeInTheDocument();

    // Drill into the tagged token → Strong's definition + concordance.
    await user.click(screen.getByRole("button", { name: /λόγος/ }));
    expect(await screen.findByText(/a word, speech/)).toBeInTheDocument();
    expect(await screen.findByText("JHN 1:14")).toBeInTheDocument();
  });

  it("renders a Hebrew verse strip right-to-left (dir=rtl)", async () => {
    server.use(
      http.get("/api/v1/verse-words/:book/:chapter/:verse", () =>
        HttpResponse.json({
          reference: "Genesis 1:1",
          text_id: "OSHB",
          tokens: [token({ surface_form: "בְּרֵאשִׁית", strongs_id: "H7225", lemma: "רֵאשִׁית" })],
        }),
      ),
    );
    renderPanel();

    const surface = await screen.findByText("בְּרֵאשִׁית");
    // The strip container carries dir="rtl" (detected from the H… strongs_id prefix).
    expect(surface.closest("[dir]")).toHaveAttribute("dir", "rtl");
  });

  it("does not make an untagged token tappable", async () => {
    server.use(
      http.get("/api/v1/verse-words/:book/:chapter/:verse", () =>
        HttpResponse.json({
          reference: "John 1:1",
          text_id: "SBLGNT",
          tokens: [
            token({ position: 1, surface_form: ".", strongs_id: null, lemma: null, gloss: null }),
          ],
        }),
      ),
    );
    renderPanel();

    expect(await screen.findByText(".")).toBeInTheDocument();
    // No tappable token → no buttons in the strip.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the 'no original-language data' message (not an error) for a verse with no tokens", async () => {
    server.use(
      http.get("/api/v1/verse-words/:book/:chapter/:verse", () =>
        HttpResponse.json({ reference: "Tobit 1:1", text_id: "LXX", tokens: [] }),
      ),
    );
    renderPanel();
    expect(await screen.findByText(/No original-language data for this verse/)).toBeInTheDocument();
  });

  it("shows an inline error when verse-words fails", async () => {
    server.use(
      http.get("/api/v1/verse-words/:book/:chapter/:verse", () =>
        HttpResponse.json({ detail: { code: "CONCORD_UNREACHABLE" } }, { status: 502 }),
      ),
    );
    renderPanel();
    expect(await screen.findByText(/Couldn.t load \(is Concord reachable/)).toBeInTheDocument();
  });

  it("jumps the reader from a concordance verse and returns via '← Words'", async () => {
    server.use(
      http.get("/api/v1/verse-words/:book/:chapter/:verse", () =>
        HttpResponse.json({ reference: "John 1:1", text_id: "SBLGNT", tokens: [token()] }),
      ),
      http.get("/api/v1/strongs/:id", () =>
        HttpResponse.json({
          strongs_id: "G3056",
          language: "greek",
          lemma: "λόγος",
          transliteration: "logos",
          gloss: "word",
          definition: "a word…",
          source: "Strong's Greek",
        }),
      ),
      http.get("/api/v1/strongs/:id/verses", () =>
        HttpResponse.json([strongsVerse("JHN", 1, 14, "And the Word…")]),
      ),
    );
    const user = userEvent.setup();
    const onJump = renderPanel();

    await user.click(await screen.findByRole("button", { name: /λόγος/ }));
    await user.click(await screen.findByText("JHN 1:14"));
    expect(onJump).toHaveBeenCalledWith("JHN", 1, 14);

    // "← Words" returns to the strip.
    await user.click(screen.getByRole("button", { name: /← Words/ }));
    expect(await screen.findByText(/logos · word/)).toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// The reader (for the Settings → Reader test) mounts the map component; MapLibre needs WebGL,
// which happy-dom lacks. Nothing here opens the map, so a bare stand-in is enough.
vi.mock("maplibre-gl", () => ({
  default: {
    Map: class {},
    Marker: class {},
    NavigationControl: class {},
    addProtocol() {},
  },
}));
vi.mock("pmtiles", () => ({
  Protocol: class {
    tile() {}
  },
}));

import { ReaderView } from "@/routes/ReaderView";
import { SettingsView } from "@/routes/SettingsView";
import { server } from "@/test/msw/server";

// Made-up Bibles. Concord v8 reports note_count; a Bible with 0 isn't a notes source.
function translation(id: string, name: string, note_count?: number) {
  return { id, name, language: "en", versification: "standard", attribution: null, note_count };
}
const V8 = [
  translation("EMB", "A Study Bible", 2),
  translation("ESV", "A Bible Without Notes", 0),
  translation("KJV", "A Bible With Its Own Notes", 1),
  translation("NET", "A Bible Full of Notes", 3),
];

/** A stateful signed-in user, so a PATCH shows in later reads; `patches` records each body. */
function useWorld({
  translations = V8,
  showNotesFrom = [] as string[],
  theme = null as string | null,
  failPatch = false,
} = {}) {
  let me = {
    id: 1,
    username: "tester",
    is_admin: true,
    last_translation: "KJV",
    last_book: "JHN",
    last_chapter: 3,
    theme,
    show_notes_from: showNotesFrom,
    created_at: "2026-01-01T00:00:00Z",
  };
  const patches: Record<string, unknown>[] = [];
  server.use(
    http.get("/api/v1/auth/me", () => HttpResponse.json({ user: me })),
    http.patch("/api/v1/auth/me", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      if (failPatch) return HttpResponse.json({ detail: "nope" }, { status: 500 });
      me = { ...me, ...body };
      return HttpResponse.json({ user: me });
    }),
    http.get("/api/v1/translations", () => HttpResponse.json({ translations })),
  );
  return patches;
}

let client: QueryClient;
afterEach(() => {
  client.clear();
  document.documentElement.classList.remove("dark");
});

function openAt(path: string) {
  client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } },
  });
  const router = createMemoryRouter(
    [
      { path: "/settings", element: <SettingsView /> },
      { path: "/read", element: <ReaderView /> },
      { path: "/status", element: <p>the Status page</p> },
      { path: "/sermon-sources", element: <p>the Sermon sources page</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** The notes section's rows, as "CODE Name", in order (the decorative look swatch left out). */
async function sourceRows() {
  const section = (await screen.findByRole("heading", { name: "Notes from other Bibles" }))
    .parentElement!;
  await within(section).findAllByRole("checkbox");
  return within(section)
    .getAllByRole("checkbox")
    .map((c) => {
      const row = c.closest("label")!.cloneNode(true) as HTMLElement;
      row.querySelectorAll("[aria-hidden]").forEach((n) => n.remove());
      return row.textContent;
    });
}

describe("SettingsView", () => {
  describe("notes from other Bibles", () => {
    it("lists every notes source with its name, in Concord's order, whatever is being read", async () => {
      useWorld(); // reading KJV — listed anyway: Settings isn't tied to a translation
      openAt("/settings");
      expect(await sourceRows()).toEqual([
        "EMBA Study Bible",
        "KJVA Bible With Its Own Notes",
        "NETA Bible Full of Notes",
      ]);
      expect(
        screen.getByText(/^Tick a Bible to show its notes while you read other translations\./),
      ).toHaveTextContent("The mark beside each name is how its notes look in the text.");
      // The key: each row shows its Bible's look. NET and EMB are pinned; KJV, a third notes
      // Bible here, takes the first spare look.
      expect(
        screen
          .getAllByRole("checkbox")
          .map((c) => c.closest("label")!.querySelector("[data-note-look]")?.getAttribute("data-note-look")),
      ).toEqual(["rose-square", "teal-circle", "violet"]);
    });

    it("against a Concord without note_count, offers NET alone", async () => {
      useWorld({
        translations: [translation("KJV", "A Bible"), translation("NET", "A Bible Full of Notes")],
      });
      openAt("/settings");
      expect(await sourceRows()).toEqual(["NETA Bible Full of Notes"]);
    });

    it("shows the profile's ticks, and a tick saves the whole list", async () => {
      const patches = useWorld({ showNotesFrom: ["NET"] });
      const user = userEvent.setup();
      openAt("/settings");

      const emb = await screen.findByRole("checkbox", { name: /^EMB/ });
      expect(emb).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: /^NET/ })).toBeChecked();

      await user.click(emb);
      await waitFor(() => expect(emb).toBeChecked());
      await waitFor(() => expect(patches).toContainEqual({ show_notes_from: ["NET", "EMB"] }));

      await user.click(screen.getByRole("checkbox", { name: /^NET/ }));
      await waitFor(() => expect(patches).toContainEqual({ show_notes_from: ["EMB"] }));
    });

    it("puts the tick back when the save fails", async () => {
      useWorld({ failPatch: true });
      const user = userEvent.setup();
      openAt("/settings");

      const emb = await screen.findByRole("checkbox", { name: /^EMB/ });
      await user.click(emb);
      await waitFor(() => expect(emb).not.toBeChecked());
    });

    it("says so when Concord can't be reached, rather than listing nothing", async () => {
      useWorld();
      server.use(
        http.get("/api/v1/translations", () =>
          HttpResponse.json({ detail: { code: "CONCORD_UNREACHABLE" } }, { status: 502 }),
        ),
      );
      openAt("/settings");
      expect(
        await screen.findByText(/Couldn.t load the Bibles from Concord/),
      ).toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("says so when no Bible has notes", async () => {
      useWorld({ translations: [translation("KJV", "A Bible"), translation("WEB", "Another")] });
      openAt("/settings");
      expect(
        await screen.findByText("None of the Bibles in this Concord has notes."),
      ).toBeInTheDocument();
    });
  });

  describe("appearance", () => {
    it("starts on 'Match this device' for a profile that never chose", async () => {
      useWorld();
      openAt("/settings");
      expect(await screen.findByRole("radio", { name: "Match this device" })).toBeChecked();
    });

    it("shows the profile's choice, and a new one applies at once and is saved", async () => {
      const patches = useWorld({ theme: "dark" });
      const user = userEvent.setup();
      openAt("/settings");

      const dark = await screen.findByRole("radio", { name: "Dark" });
      await waitFor(() => expect(dark).toBeChecked());
      expect(document.documentElement.classList.contains("dark")).toBe(false); // no useApplyTheme here

      await user.click(screen.getByRole("radio", { name: "Light" }));
      expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
      await waitFor(() => expect(patches).toContainEqual({ theme: "light" }));

      await user.click(screen.getByRole("radio", { name: "Dark" }));
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      await waitFor(() => expect(patches).toContainEqual({ theme: "dark" }));
    });
  });

  it("links to Sermon sources", async () => {
    useWorld();
    const user = userEvent.setup();
    openAt("/settings");

    await user.click(await screen.findByRole("link", { name: /^Sermon sources ›/ }));
    expect(await screen.findByText("the Sermon sources page")).toBeInTheDocument();
  });

  it("links to Status", async () => {
    useWorld();
    const user = userEvent.setup();
    openAt("/settings");

    await user.click(await screen.findByRole("link", { name: /^Status ›/ }));
    expect(await screen.findByText("the Status page")).toBeInTheDocument();
  });

  describe("about these Bibles", () => {
    // Made-up documents: EMB has front matter and a reading plan; NET only book introductions.
    const WITH_DOCUMENTS = V8.map((t) => ({
      ...t,
      document_count: t.id === "EMB" ? 3 : t.id === "NET" ? 1 : 0,
    }));
    type Summary = { slug: string; kind: string; title: string; book: string | null };
    const LISTS: Record<string, Summary[]> = {
      EMB: [
        { slug: "front-matter-1", kind: "front-matter", title: "Made-up team", book: null },
        { slug: "reading-plan-1", kind: "reading-plan", title: "Made-up plan", book: null },
        { slug: "introduction-jhn", kind: "book-introduction", title: "Made-up John", book: "JHN" },
      ],
      NET: [{ slug: "introduction-jhn", kind: "book-introduction", title: "Made-up", book: "JHN" }],
    };

    function useDocuments() {
      const asked: string[] = [];
      server.use(
        http.get("/api/v1/translations/:translation/documents", ({ params }) => {
          const code = String(params.translation);
          asked.push(code);
          const documents = (LISTS[code] ?? []).map((d, i) => ({ ...d, ordinal: i + 1 }));
          return HttpResponse.json({ translation: code, total: documents.length, documents });
        }),
        http.get("/api/v1/translations/:translation/documents/:slug", ({ params }) =>
          HttpResponse.json({
            translation: String(params.translation),
            slug: String(params.slug),
            kind: "reading-plan",
            title: "Made-up plan",
            book: null,
            ordinal: 1,
            text: "## January 1\n\n- [Made-up 4:1-10](ref:JHN.4.1-10)",
            images: [],
          }),
        ),
      );
      return asked;
    }

    it("lists each Bible with an About page, and what's in it", async () => {
      useWorld({ translations: WITH_DOCUMENTS });
      useDocuments();
      openAt("/settings");
      const section = (await screen.findByRole("heading", { name: "About these Bibles" }))
        .parentElement!;
      const row = await within(section).findByRole("button", { name: /^About EMB ›/ });
      expect(row).toHaveTextContent("A Study Bible · Front matter · Reading plan");
      // NET's documents are all book introductions.
      await waitFor(() =>
        expect(
          within(section).queryByRole("button", { name: /^About NET/ }),
        ).not.toBeInTheDocument(),
      );
    });

    it("isn't there against an older Concord, which is asked nothing", async () => {
      useWorld();
      const asked = useDocuments();
      openAt("/settings");
      await screen.findAllByRole("checkbox"); // the Bibles have loaded
      expect(screen.queryByRole("heading", { name: "About these Bibles" })).not.toBeInTheDocument();
      expect(asked).toEqual([]);
    });

    it("opens over Settings, and a reading opens the reader there", async () => {
      useWorld({ translations: WITH_DOCUMENTS });
      useDocuments();
      const user = userEvent.setup();
      const router = openAt("/settings");
      await user.click(await screen.findByRole("button", { name: /^About EMB ›/ }));
      const view = await screen.findByRole("dialog", { name: "A Study Bible" });
      expect(
        within(view).getByRole("button", { name: "← Back to Settings" }),
      ).toBeInTheDocument();

      await user.click(await within(view).findByRole("button", { name: /Made-up plan/ }));
      await user.click(await screen.findByRole("button", { name: "Made-up 4:1-10" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/read"));
      expect(router.state.location.search).toBe("?book=JHN&chapter=4&verse=1");
    });

    it("closes back to Settings, with focus on its row", async () => {
      useWorld({ translations: WITH_DOCUMENTS });
      useDocuments();
      const user = userEvent.setup();
      openAt("/settings");
      await user.click(await screen.findByRole("button", { name: /^About EMB ›/ }));
      const view = await screen.findByRole("dialog", { name: "A Study Bible" });
      await user.click(within(view).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: /^About EMB ›/ }),
        ),
      );
    });
  });
});

describe("a notes choice made on Settings shows in the Reader", () => {
  it("tick EMB on Settings → EMB's note is on the KJV chapter", async () => {
    const patches = useWorld();
    server.use(
      http.get("/api/v1/notes/:translation/:book/:chapter", ({ params }) =>
        HttpResponse.json(
          String(params.translation) === "EMB"
            ? [
                {
                  book: "JHN",
                  chapter: 3,
                  verse: 16,
                  reference: "John 3:16",
                  type: "sn",
                  label: "Study Note",
                  text: "A made-up study note.",
                  char_offset: 0,
                  marker: "a",
                  ordinal: 0,
                  cross_references: [],
                },
              ]
            : [],
        ),
      ),
    );
    const user = userEvent.setup();
    const router = openAt("/settings");

    await user.click(await screen.findByRole("checkbox", { name: /^EMB/ }));
    await waitFor(() => expect(patches).toContainEqual({ show_notes_from: ["EMB"] }));

    await act(() => router.navigate("/read"));
    expect(
      await screen.findByRole("button", { name: "Study Note 1 (from EMB)" }),
    ).toBeInTheDocument();
  });
});

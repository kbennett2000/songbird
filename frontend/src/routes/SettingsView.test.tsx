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

/** The notes section's rows, as "CODE Name", in order. */
async function sourceRows() {
  const section = (await screen.findByRole("heading", { name: "Notes from other Bibles" }))
    .parentElement!;
  await within(section).findAllByRole("checkbox");
  return within(section)
    .getAllByRole("checkbox")
    .map((c) => c.closest("label")!.textContent);
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
        screen.getByText("Tick a Bible to show its notes while you read other translations."),
      ).toBeInTheDocument();
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

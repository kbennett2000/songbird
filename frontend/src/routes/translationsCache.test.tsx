import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The reader mounts the map component; MapLibre needs WebGL, which happy-dom lacks. Nothing here
// opens the map, so a bare stand-in is enough.
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

import { CompareView } from "@/routes/CompareView";
import { ReaderView } from "@/routes/ReaderView";
import { SearchView } from "@/routes/SearchView";
import { StatusView } from "@/routes/StatusView";
import { server } from "@/test/msw/server";

/**
 * Four pages read the translation list under one cache key, `["translations"]`. They used to
 * disagree about what that key holds: Status cached Concord's whole response, the others the bare
 * list. Whichever page loaded first, the next one to read the cache crashed ("Unexpected
 * Application Error!"). These tests move between the real pages on ONE shared client, the way a
 * person clicking around the app does, in both directions.
 */

// Concord v8 reports note_count, so NET is a notes source and the reader offers its checkbox.
const TRANSLATIONS = [
  { id: "KJV", name: "King James Version", note_count: 0 },
  { id: "NET", name: "New English Translation", note_count: 3 },
  { id: "WEB", name: "World English Bible", note_count: 0 },
].map((t) => ({ ...t, language: "en", versification: "standard", attribution: null }));

const ROUTES = [
  { path: "/read", element: <ReaderView /> },
  { path: "/compare", element: <CompareView /> },
  { path: "/search", element: <SearchView /> },
  { path: "/status", element: <StatusView /> },
];

let client: QueryClient;

beforeEach(() => {
  // The app's own cache settings (lib/queryClient.ts): a list fetched by one page is still fresh
  // when the next page mounts, so that page renders straight from the cache.
  client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } },
  });
  server.use(
    http.get("/api/v1/translations", () => HttpResponse.json({ translations: TRANSLATIONS })),
  );
});

afterEach(() => client.clear());

function openAt(path: string) {
  const router = createMemoryRouter(ROUTES, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function translationsCached() {
  await waitFor(() => expect(client.getQueryState(["translations"])?.status).toBe("success"));
}

async function go(router: ReturnType<typeof createMemoryRouter>, path: string) {
  await act(() => router.navigate(path));
}

function expectNoCrash() {
  expect(screen.queryByText(/Unexpected Application Error/)).not.toBeInTheDocument();
}

/** Status's list of translations, by full name. */
async function expectStatusList() {
  const heading = await screen.findByRole("heading", { name: "Translations this Concord serves" });
  const section = heading.closest("section")!;
  expect(await within(section).findByText("New English Translation")).toBeInTheDocument();
  expect(within(section).getByText("King James Version")).toBeInTheDocument();
}

/** The reader's Translation menu and its Notes menu (other Bibles' notes), both built from the
 * cached list. */
async function expectReaderControls() {
  expect(await screen.findByRole("option", { name: "NET" })).toBeInTheDocument();
  expect(
    await screen.findByRole("button", { name: "Notes from other Bibles" }),
  ).toBeInTheDocument();
}

describe("the translation list, shared between pages", () => {
  it("Reader → Status", async () => {
    const router = openAt("/read");
    await expectReaderControls();
    await go(router, "/status");
    await expectStatusList();
    expectNoCrash();
  });

  it("Status → Reader", async () => {
    const router = openAt("/status");
    await expectStatusList();
    await go(router, "/read");
    await expectReaderControls();
    expectNoCrash();
  });

  it("Compare → Status → Compare", async () => {
    const router = openAt("/compare");
    expect(await screen.findAllByRole("option", { name: "NET" })).not.toHaveLength(0);
    await go(router, "/status");
    await expectStatusList();
    await go(router, "/compare");
    expect(await screen.findAllByRole("option", { name: "NET" })).not.toHaveLength(0);
    expectNoCrash();
  });

  it("Search → Status → Search", async () => {
    const router = openAt("/search");
    await translationsCached();
    await go(router, "/status");
    await expectStatusList();
    await go(router, "/search");
    expect(await screen.findByLabelText("Search query")).toBeInTheDocument();
    expectNoCrash();
  });

  it("Status → Search", async () => {
    const router = openAt("/status");
    await expectStatusList();
    await go(router, "/search");
    expect(await screen.findByLabelText("Search query")).toBeInTheDocument();
    expectNoCrash();
  });
});

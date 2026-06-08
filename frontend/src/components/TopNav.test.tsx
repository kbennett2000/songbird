import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { TopNav } from "@/components/TopNav";
import { server } from "@/test/msw/server";

function user(theme: string | null) {
  return {
    id: 1,
    username: "tester",
    is_admin: true,
    last_translation: null,
    last_book: null,
    last_chapter: null,
    theme,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function renderNav(path = "/search", props: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <TopNav {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TopNav", () => {
  it("renders the brand, the standard nav cluster, and the signed-in user + logout", async () => {
    renderNav();
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("link", { name: "songbird" })).toHaveAttribute("href", "/");
    for (const [name, href] of [
      ["Reader", "/read"],
      ["Browse notes", "/browse"],
      ["Search", "/search"],
      ["Places", "/places"],
      ["Compare", "/compare"],
    ] as const) {
      expect(within(banner).getByRole("link", { name })).toHaveAttribute("href", href);
    }
    // Default MSW user is signed in → username + Log out are present.
    expect(await within(banner).findByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("emphasizes the current page's link", () => {
    renderNav("/places");
    expect(screen.getByRole("link", { name: "Places" })).toHaveClass("font-semibold");
    expect(screen.getByRole("link", { name: "Search" })).not.toHaveClass("font-semibold");
  });

  it("honors a passage-seeded compareHref and page actions", () => {
    renderNav("/read", {
      compareHref: "/compare?translation=KJV&book=JHN&chapter=3",
      actions: <button type="button">Export</button>,
    });
    expect(screen.getByRole("link", { name: "Compare" })).toHaveAttribute(
      "href",
      "/compare?translation=KJV&book=JHN&chapter=3",
    );
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("omits the user chrome when signed out", async () => {
    server.use(http.get("/api/v1/auth/me", () => new HttpResponse(null, { status: 401 })));
    renderNav();
    // The nav still renders; there's just no Log out button.
    expect(await screen.findByRole("link", { name: "Search" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
  });

  describe("theme toggle (#60)", () => {
    afterEach(() => document.documentElement.classList.remove("dark"));

    it("reflects the profile's dark theme", async () => {
      server.use(http.get("/api/v1/auth/me", () => HttpResponse.json({ user: user("dark") })));
      renderNav();
      // A dark-themed profile → the toggle offers switching back to light.
      expect(
        await screen.findByRole("button", { name: "Switch to light mode" }),
      ).toBeInTheDocument();
    });

    it("toggles dark mode and persists the choice to the profile", async () => {
      let patched: string | null = null;
      server.use(
        http.get("/api/v1/auth/me", () => HttpResponse.json({ user: user(null) })),
        http.patch("/api/v1/auth/me", async ({ request }) => {
          patched = ((await request.json()) as { theme?: string }).theme ?? null;
          return HttpResponse.json({ user: user(patched) });
        }),
      );
      const u = userEvent.setup();
      renderNav();

      await u.click(await screen.findByRole("button", { name: "Switch to dark mode" }));
      // Applied to the root immediately (optimistic) and saved to the profile.
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      await waitFor(() => expect(patched).toBe("dark"));
    });
  });
});

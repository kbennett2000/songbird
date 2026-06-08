import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { TopNav } from "@/components/TopNav";
import { server } from "@/test/msw/server";

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
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { StatusView } from "@/routes/StatusView";
import { server } from "@/test/msw/server";

function renderStatus() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/status"]}>
        <StatusView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function healthz(concord: Record<string, unknown>) {
  return http.get("/healthz", () =>
    HttpResponse.json({ status: "ok", version: "1.7.0", concord }),
  );
}

describe("StatusView", () => {
  it("names the Concord address and how many translations it serves", async () => {
    renderStatus();
    // The address is the load-bearing fact — it decides everything else on the page.
    expect(await screen.findByText("http://localhost:8000")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText(/2 available here/)).toBeInTheDocument();
  });

  it("lists every translation that Concord actually serves", async () => {
    renderStatus();
    expect(await screen.findByText("King James Version")).toBeInTheDocument();
    expect(screen.getByText("World English Bible")).toBeInTheDocument();
    expect(screen.getByText("KJV")).toBeInTheDocument();
    expect(screen.getByText("WEB")).toBeInTheDocument();
  });

  it("makes a wrong-but-healthy Concord legible", async () => {
    // The regression this page exists for. Pointed at the bundled public-domain image instead of
    // a Concord carrying licensed texts, songbird reports a perfectly healthy connection — the
    // corpus is the only thing that differs, so the address and the list must be readable side
    // by side, and the page must not imply anything is broken.
    server.use(
      healthz({
        base_url: "http://concord:8000",
        reachable: true,
        status: "ok",
        translation_count: 2,
        translation_ids: ["KJV", "WEB"],
        error: null,
      }),
    );
    renderStatus();

    expect(await screen.findByText("http://concord:8000")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    // Says where to look, without claiming songbird lost anything.
    expect(screen.getByText(/isn.t in the Concord above/i)).toBeInTheDocument();
    expect(screen.queryByText("ESV")).not.toBeInTheDocument();
  });

  it("reports an unreachable Concord with its error, and stays on the page", async () => {
    server.use(
      healthz({
        base_url: "http://192.168.1.62:8000",
        reachable: false,
        status: null,
        translation_count: null,
        translation_ids: null,
        error: "could not reach Concord at http://192.168.1.62:8000",
      }),
      http.get("/api/v1/translations", () => new HttpResponse(null, { status: 502 })),
    );
    renderStatus();

    expect(await screen.findByText("http://192.168.1.62:8000")).toBeInTheDocument();
    expect(screen.getByText(/Not reachable/)).toBeInTheDocument();
    expect(screen.getByText(/could not reach Concord/)).toBeInTheDocument();
    // Concord being down is an error state (invariant 3), not a mode — but the status page
    // itself still has to render, or there's nowhere left to diagnose it from.
    expect(await screen.findByText(/Failed to load translations/)).toBeInTheDocument();
  });

  it("survives a backend that doesn't send the translation ids yet", async () => {
    server.use(
      healthz({
        base_url: "http://localhost:8000",
        reachable: true,
        status: "ok",
        translation_count: 2,
        error: null,
      }),
    );
    renderStatus();
    expect(await screen.findByText("http://localhost:8000")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });
});

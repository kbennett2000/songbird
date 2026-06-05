import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { StatusView } from "@/routes/StatusView";
import { server } from "@/test/msw/server";

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StatusView />
    </QueryClientProvider>,
  );
}

describe("StatusView", () => {
  it("renders the translations fetched via songbird", async () => {
    renderView();
    expect(await screen.findByText(/King James Version/)).toBeInTheDocument();
    expect(await screen.findByText(/World English Bible/)).toBeInTheDocument();
  });

  it("reports Concord reachability from /healthz", async () => {
    renderView();
    expect(await screen.findByText(/Reachable at/)).toBeInTheDocument();
  });

  it("shows an error state when translations fail", async () => {
    server.use(http.get("/api/v1/translations", () => new HttpResponse(null, { status: 502 })));
    renderView();
    expect(await screen.findByText(/Failed to load translations/)).toBeInTheDocument();
  });
});

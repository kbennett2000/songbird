import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { LoginPage } from "@/routes/LoginPage";
import { server } from "@/test/msw/server";

function renderLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>reader home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  it("logs in and navigates home", async () => {
    server.use(
      http.get("/api/v1/auth/me", () =>
        HttpResponse.json({ detail: { code: "NOT_AUTHENTICATED", message: "no" } }, { status: 401 }),
      ),
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json({ user: { id: 1, username: "kris", is_admin: true, last_translation: null, created_at: "x" } }),
      ),
    );
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "kris");
    await user.type(screen.getByLabelText("Password"), "supersecret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("reader home")).toBeInTheDocument();
  });

  it("surfaces the API error message on bad credentials", async () => {
    server.use(
      http.get("/api/v1/auth/me", () =>
        HttpResponse.json({ detail: { code: "NOT_AUTHENTICATED", message: "no" } }, { status: 401 }),
      ),
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json(
          { detail: { code: "INVALID_CREDENTIALS", message: "Invalid username or password" } },
          { status: 401 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "kris");
    await user.type(screen.getByLabelText("Password"), "wrongpass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid username or password")).toBeInTheDocument();
    expect(screen.queryByText("reader home")).not.toBeInTheDocument();
  });

  it("can switch to register mode", async () => {
    server.use(
      http.get("/api/v1/auth/me", () =>
        HttpResponse.json({ detail: { code: "NOT_AUTHENTICATED", message: "no" } }, { status: 401 }),
      ),
      http.post("/api/v1/auth/register", () =>
        HttpResponse.json(
          { user: { id: 1, username: "kris", is_admin: true, last_translation: null, created_at: "x" } },
          { status: 201 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole("button", { name: "Need an account? Register" }));
    await user.type(screen.getByLabelText("Username"), "kris");
    await user.type(screen.getByLabelText("Password"), "supersecret");
    await user.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByText("reader home")).toBeInTheDocument();
  });
});

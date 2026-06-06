import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";

interface LocationState {
  from?: { pathname?: string };
}

/**
 * Login + registration on one screen (a personal/small-group tool — registration stays open;
 * the first account claims the seeded default user and becomes admin). Surfaces the API's
 * error message verbatim, then sends the user back to where they were headed.
 */
export function LoginPage(): JSX.Element {
  const { isAuthenticated, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const from = (location.state as LocationState | null)?.from?.pathname ?? "/";

  // Already signed in (e.g. navigated to /login directly) → go home.
  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (mode === "register") {
        await register({ username, password });
      } else {
        await login({ username, password });
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Something went wrong. Is the server reachable?",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-2xl font-bold tracking-tight">songbird</h1>
        <p className="mb-6 text-sm text-gray-500">
          {mode === "login" ? "Sign in to your notes." : "Create an account."}
        </p>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-600">Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              aria-label="Username"
              className="rounded border border-gray-300 px-3 py-2"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-600">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              aria-label="Password"
              className="rounded border border-gray-300 px-3 py-2"
              required
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? "…" : mode === "login" ? "Sign in" : "Register"}
          </button>
        </form>

        <button
          type="button"
          className="mt-4 text-sm text-blue-700 hover:underline"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

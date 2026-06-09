import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { useAuth } from "@/hooks/useAuth";
import { useThemeControl } from "@/hooks/useTheme";

interface TopNavProps {
  /** Tailwind max-width for the centered row (match the page body). Defaults to `max-w-3xl`. */
  maxWidth?: string;
  /** Override the Compare link target (the reader seeds it with the current passage). */
  compareHref?: string;
  /** Right-aligned actions in the nav row (e.g. Browse's Export/Import). */
  actions?: ReactNode;
  /** A second row inside the header (e.g. the reader's book/chapter/translation controls). */
  children?: ReactNode;
}

const LINKS = [
  { to: "/read", label: "Reader" },
  { to: "/browse", label: "Browse notes" },
  { to: "/search", label: "Search" },
  { to: "/topics", label: "Topics" },
  { to: "/places", label: "Places" },
] as const;

/**
 * The one shared top nav (issue #62) — every content page used to inline its own divergent header.
 * Renders the `songbird` home link, the standard nav cluster, and the signed-in user + log out;
 * the current page's link is emphasized. `actions` adds page controls to the nav row; `children`
 * renders a second row beneath it (the reader / compare context bars).
 */
export function TopNav({
  maxWidth = "max-w-3xl",
  compareHref = "/compare",
  actions,
  children,
}: TopNavProps): JSX.Element {
  const { user, logout } = useAuth();
  const { isDark, setTheme } = useThemeControl();
  const { pathname } = useLocation();
  const links = [...LINKS, { to: compareHref, label: "Compare" }];

  return (
    <header className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className={`mx-auto flex flex-col gap-3 p-4 ${maxWidth}`}>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/" className="text-2xl font-bold tracking-tight hover:opacity-80">
            songbird
          </Link>
          {links.map((l) => {
            // Match on pathname only (ignore query, e.g. Compare's seeded passage).
            const base = l.to.split("?")[0] ?? l.to;
            const active = pathname === base || pathname.startsWith(`${base}/`);
            return (
              <Link
                key={l.label}
                to={l.to}
                className={`text-sm hover:underline ${
                  active
                    ? "font-semibold text-blue-800 dark:text-blue-300"
                    : "text-blue-700 dark:text-blue-400"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            {actions}
            <button
              type="button"
              onClick={() => setTheme(isDark ? "light" : "dark")}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className="rounded px-1 text-base leading-none hover:opacity-80"
            >
              {isDark ? "☀️" : "🌙"}
            </button>
            {user && (
              <span className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <span title={user.is_admin ? "Admin" : undefined}>{user.username}</span>
                <button
                  type="button"
                  className="text-blue-700 dark:text-blue-400 hover:underline"
                  onClick={() => void logout()}
                >
                  Log out
                </button>
              </span>
            )}
          </div>
        </div>
        {children}
      </div>
    </header>
  );
}

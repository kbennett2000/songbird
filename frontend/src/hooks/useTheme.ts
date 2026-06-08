import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useAuth } from "@/hooks/useAuth";
import { saveTheme } from "@/lib/auth";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "songbird-theme";
const ME_KEY = ["auth", "me"];

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** The effective dark/light, resolving "system" against the OS preference. */
function resolveDark(theme: Theme): boolean {
  return theme === "dark" || (theme === "system" && systemPrefersDark());
}

function apply(theme: Theme): void {
  document.documentElement.classList.toggle("dark", resolveDark(theme));
  try {
    // Mirror to localStorage so the inline boot script in index.html applies it before paint.
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode / disabled storage — non-fatal */
  }
}

/** The profile's theme preference (defaults to "system" until the user picks). */
function preference(theme: string | null | undefined): Theme {
  return theme === "light" || theme === "dark" || theme === "system" ? theme : "system";
}

/**
 * Side-effect hook: keep the `<html>` `dark` class in sync with the profile's theme (#60).
 * Default is to follow the OS, so it also re-applies when the system preference flips while
 * "system" is in effect. Mount once, app-wide (in `App`).
 */
export function useApplyTheme(): void {
  const { user } = useAuth();
  const theme = preference(user?.theme);

  useEffect(() => {
    apply(theme);
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
}

interface ThemeControl {
  /** The stored preference ("system" until chosen). */
  theme: Theme;
  /** The resolved appearance right now. */
  isDark: boolean;
  /** Persist a choice to the profile (optimistically applied immediately). */
  setTheme: (theme: Theme) => void;
}

/** For the toggle UI: the current appearance + a persisting setter. */
export function useThemeControl(): ThemeControl {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const theme = preference(user?.theme);

  const setTheme = (next: Theme): void => {
    apply(next); // optimistic — no flash waiting on the round-trip
    void saveTheme(next)
      .then((updated) => queryClient.setQueryData(ME_KEY, updated))
      .catch(() => {
        /* a preference write failing shouldn't surface an error; the class is already applied */
      });
  };

  return { theme, isDark: resolveDark(theme), setTheme };
}

import { useQueryClient } from "@tanstack/react-query";

import { ME_KEY, useAuth } from "@/hooks/useAuth";
import { saveShowNotesFrom } from "@/lib/auth";
import type { User } from "@/schemas";

interface ShowNotesFrom {
  /** The Bibles whose notes the reader shows on other translations (the profile's list). */
  showNotesFrom: string[];
  /** Tick or untick one source; saved to the profile. */
  setShowNotesFrom: (code: string, on: boolean) => void;
}

/**
 * The profile's `show_notes_from` (ADR 0005), shared by the Settings page and the reader's notes
 * menu. A tick applies to the cached user at once, so markers appear or clear immediately, then the
 * whole list is saved; a failed save puts the previous list back.
 */
export function useShowNotesFrom(): ShowNotesFrom {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const setShowNotesFrom = (code: string, on: boolean) => {
    const previous = queryClient.getQueryData<User | null>(ME_KEY)?.show_notes_from ?? [];
    const next = on
      ? [...previous.filter((c) => c !== code), code]
      : previous.filter((c) => c !== code);
    const put = (value: string[]) =>
      queryClient.setQueryData<User | null>(ME_KEY, (u) =>
        u ? { ...u, show_notes_from: value } : u,
      );
    put(next);
    void saveShowNotesFrom(next)
      .then((updated) => queryClient.setQueryData(ME_KEY, updated))
      .catch(() => put(previous));
  };

  return { showNotesFrom: user?.show_notes_from ?? [], setShowNotesFrom };
}

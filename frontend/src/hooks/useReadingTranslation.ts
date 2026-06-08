import { useAuth } from "@/hooks/useAuth";

/** The fallback display translation when the profile hasn't chosen one yet. */
export const DEFAULT_TRANSLATION = "KJV";

/**
 * The translation to display Scripture in when one isn't otherwise picked: the profile's
 * last-read translation, falling back to {@link DEFAULT_TRANSLATION}. Established in Slice 1 (it
 * moved semantic search off a hardcoded KJV); shared so search and the verse-of-the-day card agree
 * rather than each resolving it on their own.
 */
export function useReadingTranslation(): string {
  const { user } = useAuth();
  return user?.last_translation ?? DEFAULT_TRANSLATION;
}

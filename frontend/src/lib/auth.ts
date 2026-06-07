import { apiRequest } from "@/lib/api";
import { type User, authEnvelopeSchema } from "@/schemas";

export interface Credentials {
  username: string;
  password: string;
}

/** The current user, or null when signed out (the API answers 401 without a session). */
export async function fetchMe(): Promise<User> {
  const data = await apiRequest<unknown>("GET", "/auth/me");
  return authEnvelopeSchema.parse(data).user;
}

export async function login(creds: Credentials): Promise<User> {
  const data = await apiRequest<unknown>("POST", "/auth/login", creds);
  return authEnvelopeSchema.parse(data).user;
}

export async function register(creds: Credentials): Promise<User> {
  const data = await apiRequest<unknown>("POST", "/auth/register", creds);
  return authEnvelopeSchema.parse(data).user;
}

export async function logout(): Promise<void> {
  await apiRequest<void>("POST", "/auth/logout");
}

/** The reader's last position — translation + book + chapter — saved per-profile so the reader
 * reopens where the user left off. */
export interface ReadingPosition {
  translation: string;
  book: string;
  chapter: number;
}

/** Remember the reader's position on the user's profile. Returns the updated user so the auth
 * cache can be refreshed. */
export async function saveReadingPosition(pos: ReadingPosition): Promise<User> {
  const data = await apiRequest<unknown>("PATCH", "/auth/me", {
    last_translation: pos.translation,
    last_book: pos.book,
    last_chapter: pos.chapter,
  });
  return authEnvelopeSchema.parse(data).user;
}

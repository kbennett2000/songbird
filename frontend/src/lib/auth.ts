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

/** Remember the reader's translation on the user's profile (per-profile default). Returns the
 * updated user so the auth cache can be refreshed. */
export async function updateLastTranslation(code: string): Promise<User> {
  const data = await apiRequest<unknown>("PATCH", "/auth/me", { last_translation: code });
  return authEnvelopeSchema.parse(data).user;
}

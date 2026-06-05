const API_PREFIX = "/api/v1";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface ApiErrorDetail {
  code: string;
  message: string;
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function isApiErrorDetail(value: unknown): value is ApiErrorDetail {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

async function readError(response: Response): Promise<ApiError> {
  let detail: ApiErrorDetail | undefined;
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (isApiErrorDetail(body.detail)) {
      detail = body.detail;
    }
  } catch {
    // Body wasn't JSON; fall back to status text below.
  }
  const code = detail?.code ?? `HTTP_${response.status}`;
  const message = detail?.message ?? response.statusText ?? "Request failed";
  return new ApiError(response.status, code, message);
}

/**
 * Typed `fetch` wrapper for songbird's own API.
 *
 * - Prefixes paths with /api/v1.
 * - Throws ApiError on non-2xx (status, code, message from the backend's `detail`).
 * - Network failures throw ApiError(0, "NETWORK_ERROR", ...).
 * - Callers Zod-parse the returned JSON when they need runtime validation.
 */
export async function apiRequest<TResponse>(method: Method, path: string): Promise<TResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method,
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    throw new ApiError(0, "NETWORK_ERROR", (err as Error).message || "Network error");
  }

  if (!response.ok) {
    throw await readError(response);
  }
  return (await response.json()) as TResponse;
}

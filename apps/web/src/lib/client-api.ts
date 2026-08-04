export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiServiceUrl(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5500";
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

export function jsonRequest(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body: unknown,
  additionalHeaders: Record<string, string> = {},
): RequestInit {
  return {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...additionalHeaders },
    body: JSON.stringify(body),
  };
}

export function createIdempotencyKey() {
  return globalThis.crypto.randomUUID();
}

let refreshInFlight: Promise<boolean> | undefined;
let csrfState: { token: string; refreshAt: number } | undefined;

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function isApiServiceRequest(url: string) {
  return url.startsWith(apiServiceUrl("/"));
}

async function csrfToken() {
  if (csrfState && csrfState.refreshAt > Date.now()) return csrfState.token;
  const response = await fetch(apiServiceUrl("/auth/csrf"), { credentials: "include" });
  if (!response.ok) throw new ApiError("Could not initialize request protection", response.status);
  const payload = (await response.json()) as { token?: string };
  if (!payload.token) throw new ApiError("Request protection token is missing", 500);
  csrfState = { token: payload.token, refreshAt: Date.now() + 7 * 60 * 60 * 1_000 };
  return payload.token;
}

async function requestInit(url: string, init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  const request: RequestInit = { credentials: "include", ...init };
  if (typeof window !== "undefined" && MUTATING_METHODS.has(method) && isApiServiceRequest(url)) {
    const headers = new Headers(init?.headers);
    headers.set("x-csrf-token", await csrfToken());
    request.headers = headers;
  }
  return request;
}

function canRefresh(url: string) {
  return !["/auth/login", "/auth/register", "/auth/refresh"].some((path) => url.includes(path));
}

async function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = requestInit(apiServiceUrl("/auth/refresh"), { method: "POST" })
      .then((request) => fetch(apiServiceUrl("/auth/refresh"), request))
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = undefined;
      });
  }
  return refreshInFlight;
}

async function authenticatedFetch(url: string, init?: RequestInit) {
  const request = await requestInit(url, init);
  let response: Response;
  try {
    response = await fetch(url, request);
  } catch (error) {
    throw new ApiError(`تعذّر الاتصال بالخادم (${apiServiceUrl("/")}). تأكد من أن خادم الـ API يعمل.`, 0, {
      originalError: error instanceof Error ? error.message : String(error),
    });
  }
  if (response.status === 401 && canRefresh(url) && (await refreshSession())) {
    response = await fetch(url, request);
  }
  return response;
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(url, init);
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Request failed with status ${response.status}: ${url}`;
    throw new ApiError(message, response.status, payload);
  }
  return payload as T;
}

export async function request(url: string, init?: RequestInit): Promise<void> {
  const response = await authenticatedFetch(url, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Request failed with status ${response.status}: ${url}`;
    throw new ApiError(message, response.status, payload);
  }
}

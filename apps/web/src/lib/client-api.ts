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

function usesArabic() {
  return typeof document !== "undefined" && document.documentElement.lang === "ar";
}

function statusMessage(status: number) {
  const ar = usesArabic();
  if (status === 400)
    return ar
      ? "تعذر تنفيذ الطلب. راجع البيانات المدخلة وحاول مجدداً."
      : "The request could not be completed. Check the entered data and try again.";
  if (status === 401)
    return ar ? "انتهت جلسة تسجيل الدخول. سجّل الدخول للمتابعة." : "Your session has expired. Sign in to continue.";
  if (status === 403)
    return ar ? "ليست لديك صلاحية لتنفيذ هذا الإجراء." : "You do not have permission to perform this action.";
  if (status === 404)
    return ar
      ? "تعذر العثور على العنصر المطلوب، وربما تم حذفه."
      : "The requested item could not be found and may have been removed.";
  if (status === 409)
    return ar
      ? "تعارضت العملية مع تغيير أحدث. حدّث الصفحة وحاول مجدداً."
      : "This action conflicts with a newer change. Refresh and try again.";
  if (status === 413)
    return ar ? "حجم البيانات المرسلة أكبر من الحد المسموح." : "The submitted data exceeds the allowed size.";
  if (status === 422)
    return ar
      ? "بعض البيانات غير صالحة. راجع الحقول وحاول مجدداً."
      : "Some data is invalid. Review the fields and try again.";
  if (status === 429)
    return ar
      ? "تم إرسال طلبات كثيرة. انتظر قليلاً ثم حاول مجدداً."
      : "Too many requests were sent. Wait a moment and try again.";
  if (status >= 500)
    return ar
      ? "حدث خطأ في الخادم. لم تُفقد بياناتك؛ حاول مجدداً بعد قليل."
      : "A server error occurred. Your data was not lost; try again shortly.";
  return ar ? "تعذر إكمال الطلب. حاول مجدداً." : "The request could not be completed. Try again.";
}

function payloadMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const value = "message" in payload ? payload.message : "error" in payload ? payload.error : null;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const messages = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
    if (messages.length) return messages.join(" • ");
  }
  return null;
}

function localizedResponseMessage(payload: unknown, status: number) {
  const message = payloadMessage(payload);
  if (!message) return statusMessage(status);
  // API validation and framework errors are often emitted in English. Do not leak
  // those implementation messages into an Arabic interface.
  if (usesArabic() && !/[\u0600-\u06ff]/u.test(message)) return statusMessage(status);
  return message;
}

export function readableError(error: unknown, fallback?: string) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback ?? statusMessage(0);
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
  if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
  const payload = (await response.json()) as { token?: string };
  if (!payload.token) throw new ApiError(statusMessage(500), 500);
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
      .then((request) => networkFetch(apiServiceUrl("/auth/refresh"), request))
      .then((response) => response.ok)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 0) throw error;
        return false;
      })
      .finally(() => {
        refreshInFlight = undefined;
      });
  }
  return refreshInFlight;
}

async function networkFetch(url: string, request: RequestInit) {
  try {
    return await fetch(url, request);
  } catch (error) {
    throw new ApiError(
      usesArabic()
        ? "تعذر الاتصال بالخادم. تحقق من اتصال الشبكة وتأكد من تشغيل خدمة API، ثم حاول مجدداً."
        : "Could not connect to the server. Check your network and make sure the API service is running, then try again.",
      0,
      { originalError: error instanceof Error ? error.message : String(error) },
    );
  }
}

async function authenticatedFetch(url: string, init?: RequestInit) {
  const request = await requestInit(url, init);
  let response = await networkFetch(url, request);
  if (response.status === 401 && canRefresh(url) && (await refreshSession())) {
    response = await networkFetch(url, request);
  }
  return response;
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(url, init);
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throw new ApiError(localizedResponseMessage(payload, response.status), response.status, payload);
  return payload as T;
}

export async function request(url: string, init?: RequestInit): Promise<void> {
  const response = await authenticatedFetch(url, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    throw new ApiError(localizedResponseMessage(payload, response.status), response.status, payload);
  }
}

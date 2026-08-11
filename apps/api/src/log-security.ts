type LoggedRequest = {
  id?: unknown;
  method?: unknown;
  url?: unknown;
  remoteAddress?: unknown;
};

type LoggedResponse = { statusCode?: unknown };

export function serializeLogRequest(request: LoggedRequest) {
  const rawUrl = typeof request.url === "string" ? request.url : "";
  return {
    id: request.id,
    method: request.method,
    url: rawUrl.split("?", 1)[0],
    remoteAddress: request.remoteAddress,
  };
}

export function serializeLogResponse(response: LoggedResponse) {
  return { statusCode: response.statusCode };
}

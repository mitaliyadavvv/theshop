/** Responses with per-user data must never be stored by browsers, proxies or CDNs. */
export const NO_STORE = { "cache-control": "private, no-store" } as const;

export function privateJson(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, { ...init, headers: { ...NO_STORE, ...(init.headers as Record<string, string> | undefined) } });
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Link: '</api/openapi.json>; rel="service-desc"',
      ...headers,
    },
  });
}

export function error(status: number, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return json({ error: message, documentation: "/api/openapi.json", ...extra }, status, headers);
}

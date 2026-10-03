import { corpusSessionCookie } from "./accessPolicy";

/** Clearing a local cookie requires same-origin POST, but must also work for an expired session. */
export function corpusLogoutResponse(request: Request): Response {
  const headers = { "Cache-Control": "private, no-store", Vary: "Origin, Cookie" };
  if (request.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...headers, Allow: "POST" },
    });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return new Response("Forbidden", { status: 403, headers });
  return new Response(null, {
    status: 204,
    headers: { ...headers, "Set-Cookie": corpusSessionCookie(request, null) },
  });
}

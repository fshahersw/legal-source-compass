/**
 * Whose agent workspace a request belongs to. A signed-in user owns their workspace by user id; with sign-in off, the
 * browser holds a random 256-bit workspace key (sent as x-agent-owner) and owns the workspace for that key. Either is
 * hashed before it is stored, so the database never holds the key itself. Server-only.
 */
const enc = new TextEncoder();

async function sha256(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const OWNER_HEADER = "x-agent-owner";

export async function ownerFor(
  request: Request,
  userId: string | null | undefined,
): Promise<string | null> {
  // with sign-in off every request is the shared "open-access" identity: fall back to the browser's own key
  if (userId && userId !== "open-access") return await sha256(`user|${userId}`);
  const key = request.headers.get(OWNER_HEADER)?.trim() ?? "";
  if (!/^[a-f0-9]{64}$/.test(key)) return null;
  return await sha256(`device|${key}`);
}

/** Resolve the owner after the corpus access check; null when the request carries neither identity. */
export async function requireOwner(request: Request): Promise<{ owner: string } | Response> {
  const { requireCorpusAccess, corpusAccessErrorResponse } =
    await import("@/lib/auth/access.server");
  let userId: string | null = null;
  try {
    userId = (await requireCorpusAccess(request)).userId;
  } catch (error) {
    return corpusAccessErrorResponse(error);
  }
  const owner = await ownerFor(request, userId);
  if (!owner) return Response.json({ error: "No agent workspace key was sent." }, { status: 400 });
  return { owner };
}

let registered: string | null = null;

/**
 * Remember the site's public address so scheduled runs can reach it (pg_cron posts to <site_url>/api/agent/tick).
 * Only real https hosts register; local, preview and editor hosts never do. Best effort, once per address.
 */
export async function registerSiteUrl(request: Request): Promise<void> {
  try {
    const url = new URL(request.url);
    const fwd = request.headers.get("x-forwarded-host");
    const host = (fwd ?? url.host).toLowerCase();
    if (url.protocol !== "https:" && request.headers.get("x-forwarded-proto") !== "https") return;
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host)) return;
    if (/(lovable(project)?\.(app|dev|com)|preview|webcontainer|ngrok|trycloudflare)/.test(host))
      return;
    const origin = `https://${host}`;
    if (registered === origin) return;
    const { rpcPost } = await import("@/lib/external/rest.server");
    await rpcPost("agent_settings_set", { p_key: "site_url", p_value: origin });
    registered = origin;
  } catch {
    // scheduling still works once a later request registers
  }
}

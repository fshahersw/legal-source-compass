export type VerifiedCorpusUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  is_anonymous?: boolean;
};

/** Name of the ONE server-side switch for corpus account enforcement. Never exposed to the browser. */
export const CORPUS_REQUIRE_AUTH_ENV = "CORPUS_REQUIRE_AUTH";

/**
 * Account enforcement is OFF unless the server environment sets CORPUS_REQUIRE_AUTH to "1" or "true".
 * Off: every page, server function, snapshot bundle and artifact route works without a session.
 * On: the verified-account checks (access.server / access.middleware) apply unchanged.
 */
export function corpusAuthRequired(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): boolean {
  const value = env[CORPUS_REQUIRE_AUTH_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/** The auth provider must verify this account; browser profile metadata cannot confirm its email. */
export function isAllowedCorpusUser(user: VerifiedCorpusUser): boolean {
  return Boolean(
    user.id && user.email?.trim() && user.email_confirmed_at && user.is_anonymous !== true,
  );
}

function isLocalHttp(request: Request): boolean {
  const url = new URL(request.url);
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export function corpusSessionCookieName(request: Request): string {
  return isLocalHttp(request) ? "corpus-session-local" : "__Host-corpus-session";
}

/** Explicit bearer credentials take precedence; a bad header must never fall back to a cookie. */
export function corpusRequestToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const match = /^Bearer ([^\s,]{1,8192})$/.exec(authorization);
    return match?.[1] ?? null;
  }
  const cookieName = corpusSessionCookieName(request);
  const cookies = (request.headers.get("cookie") ?? "").split(";");
  const matches = cookies
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${cookieName}=`));
  if (matches.length !== 1) return null;
  try {
    const token = decodeURIComponent(matches[0]!.slice(cookieName.length + 1));
    return /^[^\s,;]{1,8192}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function corpusSessionCookie(request: Request, token: string | null): string {
  const secure = !isLocalHttp(request);
  return `${corpusSessionCookieName(request)}=${token ? encodeURIComponent(token) : ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? 300 : 0}${secure ? "; Secure" : ""}`;
}

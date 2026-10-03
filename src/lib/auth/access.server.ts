import { createClient } from "@supabase/supabase-js";
import { corpusAuthRequired, corpusRequestToken, isAllowedCorpusUser } from "./accessPolicy";

export type CorpusIdentity = { userId: string; email: string | null };

/** Identity reported while account enforcement is off (CORPUS_REQUIRE_AUTH unset): no account is implied. */
export const OPEN_ACCESS_IDENTITY: CorpusIdentity = { userId: "open-access", email: null };

export class CorpusAccessError extends Error {
  constructor(public readonly statusCode: 401 | 403 | 503) {
    super(
      statusCode === 401
        ? "Sign in to access this workspace."
        : statusCode === 403
          ? "This account needs a confirmed email to access this workspace."
          : "Workspace access is temporarily unavailable.",
    );
    this.name = "CorpusAccessError";
  }
}

const requestChecks = new WeakMap<Request, Promise<CorpusIdentity>>();

async function verifyAccess(request: Request): Promise<CorpusIdentity> {
  const token = corpusRequestToken(request);
  if (!token) throw new CorpusAccessError(401);
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  try {
    const parsedUrl = new URL(url ?? "");
    if (
      !key ||
      !(
        parsedUrl.protocol === "https:" ||
        (parsedUrl.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname))
      )
    )
      throw new Error("Invalid auth configuration");
  } catch {
    throw new CorpusAccessError(503);
  }

  let result;
  try {
    const supabase = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
      },
    });
    result = await supabase.auth.getUser(token);
  } catch {
    throw new CorpusAccessError(503);
  }
  if (result.error || !result.data.user) {
    const status = result.error?.status ?? 401;
    throw new CorpusAccessError(status === 429 || status >= 500 ? 503 : 401);
  }
  const user = result.data.user;
  if (!isAllowedCorpusUser(user)) throw new CorpusAccessError(403);
  return { userId: user.id, email: user.email ?? null };
}

/**
 * Admit verified, non-anonymous accounts with confirmed email. Never decode-and-trust a JWT.
 * When CORPUS_REQUIRE_AUTH is not enabled the check is skipped entirely: no provider client is created,
 * no credential is read and the open-access identity is returned.
 */
export function requireCorpusAccess(request: Request): Promise<CorpusIdentity> {
  if (!corpusAuthRequired()) return Promise.resolve(OPEN_ACCESS_IDENTITY);
  let check = requestChecks.get(request);
  if (!check) {
    check = verifyAccess(request);
    requestChecks.set(request, check);
  }
  return check;
}

export function corpusAccessErrorResponse(error: unknown): Response {
  const known = error instanceof CorpusAccessError ? error : new CorpusAccessError(503);
  return new Response(JSON.stringify({ error: known.message }), {
    status: known.statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      Vary: "Authorization, Cookie",
      "X-Content-Type-Options": "nosniff",
      ...(known.statusCode === 401 ? { "WWW-Authenticate": 'Bearer realm="corpus"' } : {}),
    },
  });
}

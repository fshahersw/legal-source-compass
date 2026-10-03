import { supabase } from "@/integrations/supabase/client";

/**
 * Best-effort clear of the short-lived HttpOnly corpus session cookie. Harmless when enforcement is off:
 * the cookie is never set then, and every protected request revalidates its credential with the auth provider.
 */
export async function clearCorpusSessionCookie(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    // The browser session is still ended below; an unreachable endpoint must not trap the user signed in.
  }
}

/** End the browser session and the server cookie. Callers clear cached query data themselves. */
export async function signOutEverywhere(): Promise<{ error: Error | null }> {
  await clearCorpusSessionCookie();
  const { error } = await supabase.auth.signOut();
  return { error: error ?? null };
}

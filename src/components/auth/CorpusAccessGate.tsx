import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getCorpusSession } from "@/lib/auth/access.functions";
import {
  probeFromSession,
  resolveAccess,
  type AccessState,
  type GateProbe,
} from "@/lib/auth/gateState";
import { signOutEverywhere } from "@/lib/auth/session";
import { AuthCard } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/button";

/** "open": the server does not require an account (CORPUS_REQUIRE_AUTH unset). "enforced": it does. */
export type CorpusAccessMode = "unknown" | "open" | "enforced";
const ModeContext = createContext<CorpusAccessMode>("unknown");
export const useCorpusAccessMode = () => useContext(ModeContext);

/**
 * A presentation gate only: the server independently validates every corpus request when enforcement is on.
 * With CORPUS_REQUIRE_AUTH unset the server reports `required: false` and this component renders its children
 * as soon as that one probe returns; sign-in stays optional (see AccountBox and /auth).
 */
export function CorpusAccessGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<AccessState>({ state: "checking" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allowedId = useRef<string | null>(null);
  const enforced = useRef(false);
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    let live = true;
    let generation = 0;
    const check = async () => {
      const attempt = ++generation;
      let probe: GateProbe;
      try {
        probe = probeFromSession(await getCorpusSession());
      } catch {
        probe = { kind: "rejected" };
      }
      if (!live || generation !== attempt) return;
      if (probe.kind === "open") {
        enforced.current = false;
        setAccess({ state: "open" });
        return;
      }
      enforced.current = true;
      let session = { present: false, email: null as string | null };
      try {
        const { data } = await supabase.auth.getSession();
        session = { present: !!data.session, email: data.session?.user.email ?? null };
      } catch {
        // Treated as "no browser session"; the server decision above still stands.
      }
      if (!live || generation !== attempt) return;
      const next = resolveAccess(probe, session);
      const nextId = probe.kind === "allowed" ? probe.userId : null;
      const changed = allowedId.current !== nextId;
      allowedId.current = nextId;
      if (changed) queryClient.clear();
      setAccess(next);
      if (next.state === "allowed") {
        setNotice(null);
        if (changed) void router.invalidate();
      }
    };
    void check();
    let unsubscribe: (() => void) | undefined;
    try {
      const { data } = supabase.auth.onAuthStateChange(() => {
        // Leave the auth callback before requesting another session through function middleware.
        window.setTimeout(() => {
          if (live && enforced.current) void check();
        }, 0);
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      // No auth client available: the probe above already decided.
    }
    return () => {
      live = false;
      generation++;
      unsubscribe?.();
    };
  }, [queryClient, router]);

  const signOut = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await signOutEverywhere();
      if (error) throw error;
      allowedId.current = null;
      queryClient.clear();
      setAccess({ state: "signed-out" });
    } catch {
      setNotice("Sign out could not complete. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (access.state === "open" || access.state === "allowed")
    return (
      <ModeContext.Provider value={access.state === "open" ? "open" : "enforced"}>
        {children}
      </ModeContext.Provider>
    );

  if (access.state === "signed-out")
    return (
      <ModeContext.Provider value="enforced">
        <main className="flex min-h-screen items-center justify-center bg-background px-4">
          <AuthCard notice="Sign in or create an account to open the private research workspace." />
        </main>
      </ModeContext.Provider>
    );

  return (
    <ModeContext.Provider value={access.state === "checking" ? "unknown" : "enforced"}>
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <section className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-surface p-7">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Private research workspace
            </p>
            <h1 className="mt-2 text-2xl font-semibold">Legal Source Atlas</h1>
          </div>
          {access.state === "checking" ? (
            <p role="status" className="text-sm text-muted-foreground">
              Checking workspace access…
            </p>
          ) : (
            <>
              <p role="status" className="text-sm text-muted-foreground">
                {access.email
                  ? `Confirm the email for ${access.email}, then sign in again to open the workspace.`
                  : "Workspace access is not available. Ask the workspace owner to check the sign-in configuration."}
              </p>
              {access.email && (
                <Button variant="outline" disabled={busy} onClick={() => void signOut()}>
                  Use another account
                </Button>
              )}
              <Button variant="outline" onClick={() => window.location.reload()}>
                Check again
              </Button>
            </>
          )}
          {notice && (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          )}
        </section>
      </main>
    </ModeContext.Provider>
  );
}

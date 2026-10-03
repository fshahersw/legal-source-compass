import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getCorpusSession } from "@/lib/auth/access.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Access = { state: "checking" | "signed-out" | "allowed" | "denied"; email: string | null };

/** A presentation gate only: the server independently validates every corpus request. */
export function CorpusAccessGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access>({ state: "checking", email: null });
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allowedId = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    let live = true;
    let generation = 0;
    const check = async (session: Session | null) => {
      const attempt = ++generation;
      if (!session) {
        allowedId.current = null;
        if (live) {
          queryClient.clear();
          setAccess({ state: "signed-out", email: null });
        }
        return;
      }
      try {
        const identity = await getCorpusSession();
        if (!live || generation !== attempt) return;
        const changed = allowedId.current !== identity.userId;
        allowedId.current = identity.userId;
        if (changed) queryClient.clear();
        setAccess({ state: "allowed", email: identity.email });
        setNotice(null);
        if (changed) void router.invalidate();
      } catch {
        if (!live || generation !== attempt) return;
        allowedId.current = null;
        queryClient.clear();
        setAccess({ state: "denied", email: session.user.email ?? null });
      }
    };
    let unsubscribe: (() => void) | undefined;
    try {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        // Leave the auth callback before requesting another session through function middleware.
        window.setTimeout(() => {
          if (live) void check(session);
        }, 0);
      });
      unsubscribe = () => data.subscription.unsubscribe();
      void supabase.auth
        .getSession()
        .then(({ data: sessionData }) => check(sessionData.session))
        .catch(() => {
          if (live) setAccess({ state: "denied", email: null });
        });
    } catch {
      setAccess({ state: "denied", email: null });
    }
    return () => {
      live = false;
      generation++;
      unsubscribe?.();
    };
  }, [queryClient, router]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setNotice("Check your email for a sign-in link. New accounts can use the same link.");
    } catch {
      setNotice("The sign-in link could not be requested. Check your email and try again.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Session could not be cleared");
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      allowedId.current = null;
      queryClient.clear();
      setAccess({ state: "signed-out", email: null });
    } catch {
      setNotice("Sign out could not complete. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (access.state === "allowed")
    return (
      <>
        <div
          className="flex items-center justify-end gap-3 border-b border-border bg-background px-4 py-1 text-xs text-muted-foreground"
          aria-label="Workspace account"
        >
          <span>{access.email ?? "Signed-in account"}</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void signOut()}>
            Sign out
          </Button>
          {notice && <span role="status">{notice}</span>}
        </div>
        {children}
      </>
    );

  return (
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
        ) : access.state === "denied" ? (
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
        ) : (
          <form onSubmit={(event) => void signIn(event)} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sign in or create an account with your email to open the research corpus.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="corpus-sign-in-email">
                Email
              </label>
              <Input
                id="corpus-sign-in-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={busy}
              />
            </div>
            <Button className="w-full" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send sign-in link"}
            </Button>
          </form>
        )}
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
      </section>
    </main>
  );
}

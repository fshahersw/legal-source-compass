import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionUser } from "@/lib/auth/useSession";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Legal Source Atlas" },
      { name: "description", content: "Sign in or create an account for Legal Source Atlas." },
      { property: "og:title", content: "Sign in — Legal Source Atlas" },
      { property: "og:description", content: "Sign in or create an account for Legal Source Atlas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const { user } = useSessionUser();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (user) navigate({ to: "/", replace: true });
  }, [user, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Signed in");
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setMessage("Check your email to confirm your account, then sign in.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setMessage("If that email has an account, a reset link is on its way.");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Reset password";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <Link to="/" className="eyebrow">Legal Source Atlas</Link>
        <h1 className="mt-1 font-display text-2xl text-foreground">{title}</h1>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <Input type="email" required placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {mode !== "forgot" ? (
            <Input type="password" required minLength={6} placeholder="Password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          ) : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Please wait…" : title}
          </Button>
        </form>
        {message ? <p className="mt-3 text-[13px] text-muted-foreground">{message}</p> : null}
        <div className="mt-4 flex flex-col gap-1 text-[12px] text-muted-foreground">
          {mode !== "signin" ? (
            <button type="button" className="text-left hover:underline" onClick={() => setMode("signin")}>Have an account? Sign in</button>
          ) : (
            <>
              <button type="button" className="text-left hover:underline" onClick={() => setMode("signup")}>No account? Create one</button>
              <button type="button" className="text-left hover:underline" onClick={() => setMode("forgot")}>Forgot password?</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

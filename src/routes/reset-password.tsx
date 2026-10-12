import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkspaceBrand } from "@/components/auth/WorkspaceBrand";
import { PRODUCT_NAME } from "@/lib/branding";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — Seeger Weiss Research" },
      {
        name: "description",
        content: "Choose a new password for your Seeger Weiss Research account.",
      },
      { property: "og:title", content: "Set a new password — Seeger Weiss Research" },
      {
        property: "og:description",
        content: "Choose a new password for your Seeger Weiss Research account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated");
    navigate({ to: "/", replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <Link to="/" className="block" aria-label={`${PRODUCT_NAME} — home`}>
          <WorkspaceBrand />
        </Link>
        <h1 className="mt-4 font-display text-2xl text-foreground">Set a new password</h1>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <Input
            type="password"
            required
            minLength={6}
            placeholder="New password"
            aria-label="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Saving…" : "Update password"}
          </Button>
        </form>
      </div>
    </div>
  );
}

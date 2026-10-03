import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { AuthCard } from "@/components/auth/AuthCard";
import { safeRedirectPath } from "@/lib/auth/gateState";
import { useSessionUser } from "@/lib/auth/useSession";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const redirect = safeRedirectPath(search["redirect"]);
    return redirect ? { redirect } : {};
  },
  head: () => ({
    meta: [
      { title: "Sign in — Legal Source Atlas" },
      { name: "description", content: "Sign in or create an account for Legal Source Atlas." },
      { property: "og:title", content: "Sign in — Legal Source Atlas" },
      {
        property: "og:description",
        content: "Sign in or create an account for Legal Source Atlas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();
  const { redirect } = Route.useSearch();
  const { user } = useSessionUser();

  useEffect(() => {
    if (user) router.history.replace(redirect ?? "/");
  }, [user, redirect, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <AuthCard />
    </div>
  );
}

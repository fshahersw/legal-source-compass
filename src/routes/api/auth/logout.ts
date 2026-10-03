import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { corpusLogoutResponse } = await import("@/lib/auth/logout.server");
        return corpusLogoutResponse(request);
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/files")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const route = new URL(request.url).searchParams.get("route") ?? "";
        if (!route.startsWith("/") || route.length > 500) return new Response("Bad file route", { status: 400 });
        const { fetchArtifact } = await import("@/lib/external/rest.server");
        return fetchArtifact(route);
      },
    },
  },
});

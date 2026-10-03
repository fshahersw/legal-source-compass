import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/files")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireCorpusAccess, corpusAccessErrorResponse } = await import("@/lib/auth/access.server");
        try { await requireCorpusAccess(request); }
        catch (error) { return corpusAccessErrorResponse(error); }
        const route = new URL(request.url).searchParams.get("route") ?? "";
        if (!route.startsWith("/") || route.length > 500) return new Response("Bad file route", { status: 400 });
        const { fetchArtifact } = await import("@/lib/external/rest.server");
        const response = await fetchArtifact(route);
        response.headers.set("Cache-Control", "private, no-store");
        response.headers.set("Vary", "Authorization, Cookie");
        return response;
      },
    },
  },
});

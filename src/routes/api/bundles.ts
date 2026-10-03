import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bundles")({
  server: { handlers: { GET: async ({ request }) => {
    const { requireCorpusAccess, corpusAccessErrorResponse } = await import("@/lib/auth/access.server");
    try { await requireCorpusAccess(request); } catch (error) { return corpusAccessErrorResponse(error); }
    try {
      const { serveSnapshotPage } = await import("@/lib/private-data/snapshot.server");
      return await serveSnapshotPage(request);
    } catch {
      return new Response("Private snapshot is temporarily unavailable.", { status: 503, headers: { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" } });
    }
  } } },
});

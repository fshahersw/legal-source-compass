import { createFileRoute } from "@tanstack/react-router";

/** Relays a public file: shown inline for PDFs, images and plain text, otherwise downloaded. HTML is never served inline. */
export const Route = createFileRoute("/api/source-file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireCorpusAccess, corpusAccessErrorResponse } =
          await import("@/lib/auth/access.server");
        try {
          await requireCorpusAccess(request);
        } catch (error) {
          return corpusAccessErrorResponse(error);
        }
        const { allow, clientKey, crossSiteRequest } =
          await import("@/lib/assistant/limits.server");
        if (crossSiteRequest(request)) return new Response("Not available.", { status: 403 });
        if (!allow(`source-file:${clientKey(request)}`, 120, 10 * 60 * 1000))
          return new Response("Too many requests.", { status: 429 });
        const params = new URL(request.url).searchParams;
        const target = params.get("url") ?? "";
        if (!target || target.length > 2000) return new Response("Bad address.", { status: 400 });
        const { relayFile } = await import("@/lib/sourceViewer/remote.server");
        try {
          return await relayFile(target, params.get("inline") === "1");
        } catch (error) {
          return new Response(
            error instanceof Error ? error.message : "The file could not be fetched.",
            { status: 422 },
          );
        }
      },
    },
  },
});

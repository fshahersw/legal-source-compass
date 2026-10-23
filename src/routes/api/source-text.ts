import { createFileRoute } from "@tanstack/react-router";

/** The readable text of a public page or document, for the source panel's text view. */
export const Route = createFileRoute("/api/source-text")({
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
        if (crossSiteRequest(request))
          return Response.json({ error: "Not available." }, { status: 403 });
        if (!allow(`source-text:${clientKey(request)}`, 40, 10 * 60 * 1000))
          return Response.json(
            { error: "Too many requests. Wait a few minutes." },
            { status: 429 },
          );
        const params = new URL(request.url).searchParams;
        const target = params.get("url") ?? "";
        if (!target || target.length > 2000)
          return Response.json({ error: "Bad address." }, { status: 400 });
        const { readSourceTextCached, serverTiming } =
          await import("@/lib/sourceViewer/remote.server");
        const started = Date.now();
        try {
          // A page read a moment ago is served from memory (and a read already under way is shared); `fresh=1` reads again.
          const text = await readSourceTextCached(target, { fresh: params.get("fresh") === "1" });
          return Response.json(text, {
            headers: {
              "cache-control": "private, max-age=600",
              "server-timing": serverTiming([{ name: "text", dur: Date.now() - started }]),
            },
          });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "The page text could not be read." },
            { status: 422 },
          );
        }
      },
    },
  },
});

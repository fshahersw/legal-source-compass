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
        const target = new URL(request.url).searchParams.get("url") ?? "";
        if (!target || target.length > 2000)
          return Response.json({ error: "Bad address." }, { status: 400 });
        const { readSourceText } = await import("@/lib/sourceViewer/remote.server");
        try {
          return Response.json(await readSourceText(target), {
            headers: { "cache-control": "private, max-age=600" },
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

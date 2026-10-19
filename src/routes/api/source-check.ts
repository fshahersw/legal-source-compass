import { createFileRoute } from "@tanstack/react-router";

/** Whether an outside address can be shown inside the source panel, and what kind of content it is. */
export const Route = createFileRoute("/api/source-check")({
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
        if (!allow(`source-check:${clientKey(request)}`, 240, 10 * 60 * 1000))
          return Response.json({ error: "Too many requests." }, { status: 429 });
        const requestUrl = new URL(request.url);
        const target = requestUrl.searchParams.get("url") ?? "";
        if (target.length > 2000)
          return Response.json({ error: "Address too long." }, { status: 400 });
        const { checkSource, readerConfigured, remoteBrowserConfigured } =
          await import("@/lib/sourceViewer/remote.server");
        const options = { remoteBrowser: remoteBrowserConfigured(), reader: readerConfigured() };
        const { publicUrl } = await import("@/lib/net/publicUrl");
        if (!publicUrl(target))
          return Response.json(
            {
              error: "Only public web addresses can be opened here.",
              code: "not_public",
              ...options,
            },
            { status: 400 },
          );
        try {
          const result = await checkSource(target, requestUrl.origin);
          return Response.json(
            { ...result, ...options },
            { headers: { "cache-control": "private, max-age=300" } },
          );
        } catch (error) {
          return Response.json(
            {
              error: error instanceof Error ? error.message : "The address could not be checked.",
              code: "unreachable",
              ...options,
            },
            { status: 422 },
          );
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

/** Starts (POST) and stops (DELETE) a disposable hosted browser for the source panel. */
export const Route = createFileRoute("/api/source-browser")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
        if (!allow(`source-browser:${clientKey(request)}`, 12, 10 * 60 * 1000))
          return Response.json(
            { error: "Too many browsers opened in a short time. Wait a few minutes." },
            { status: 429 },
          );
        let body: { url?: unknown; width?: unknown; height?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Bad request." }, { status: 400 });
        }
        if (typeof body.url !== "string" || body.url.length > 2000)
          return Response.json({ error: "Bad address." }, { status: 400 });
        const { startRemoteBrowser } = await import("@/lib/sourceViewer/remote.server");
        try {
          const session = await startRemoteBrowser(
            body.url,
            typeof body.width === "number" ? body.width : 1200,
            typeof body.height === "number" ? body.height : 900,
          );
          return Response.json(session, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : "The in-page browser could not start.",
            },
            { status: 502 },
          );
        }
      },
      DELETE: async ({ request }) => {
        const { requireCorpusAccess, corpusAccessErrorResponse } =
          await import("@/lib/auth/access.server");
        try {
          await requireCorpusAccess(request);
        } catch (error) {
          return corpusAccessErrorResponse(error);
        }
        const id = new URL(request.url).searchParams.get("id") ?? "";
        const { stopRemoteBrowser } = await import("@/lib/sourceViewer/remote.server");
        await stopRemoteBrowser(id).catch(() => null);
        return new Response(null, { status: 204 });
      },
    },
  },
});

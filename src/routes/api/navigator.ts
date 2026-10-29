import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY = 3 * 1024 * 1024;

/**
 * The navigator endpoint: starts a task or resumes one with the browser's tool results, and streams the agent's
 * steps, text, saved files and either the next browser calls or the final answer as server-sent events. The agent's
 * workspace (memory, folder, schedules) belongs to the signed-in user or, with sign-in off, to the browser's key.
 */
export const Route = createFileRoute("/api/navigator")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireCorpusAccess, corpusAccessErrorResponse } =
          await import("@/lib/auth/access.server");
        let userId: string | null = null;
        try {
          userId = (await requireCorpusAccess(request)).userId;
        } catch (error) {
          return corpusAccessErrorResponse(error);
        }
        const { allow, clientKey, crossSiteRequest } =
          await import("@/lib/assistant/limits.server");
        if (crossSiteRequest(request))
          return Response.json(
            { error: "Requests from other sites are not accepted." },
            { status: 403 },
          );
        // every resume is a request: a task of 30 rounds is up to 30 requests
        if (!allow(`navigator:${clientKey(request)}`, 160, 10 * 60 * 1000))
          return Response.json(
            { error: "Too many steps in a short time. Wait a few minutes." },
            { status: 429 },
          );
        const length = Number(request.headers.get("content-length") ?? "0");
        if (length > MAX_BODY)
          return Response.json({ error: "The request is too large." }, { status: 413 });
        let raw: unknown;
        try {
          const text = await request.text();
          if (text.length > MAX_BODY)
            return Response.json({ error: "The request is too large." }, { status: 413 });
          raw = JSON.parse(text);
        } catch {
          return Response.json({ error: "The request could not be read." }, { status: 400 });
        }
        const { navigatorRequestSchema, encodeNavigatorEvent } =
          await import("@/lib/navigator/protocol");
        const parsed = navigatorRequestSchema.safeParse(raw);
        if (!parsed.success)
          return Response.json({ error: "The request was not valid." }, { status: 400 });
        const { runNavigator, NavigatorRejected } = await import("@/lib/navigator/agent.server");
        const { ownerFor, registerSiteUrl } = await import("@/lib/agent/owner.server");
        const owner = await ownerFor(request, userId);
        void registerSiteUrl(request);
        const { AssistantUnavailable } = await import("@/lib/assistant/agent.server");
        const abort = new AbortController();
        request.signal?.addEventListener("abort", () => abort.abort());
        const today = new Date().toISOString().slice(0, 10);
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const encoder = new TextEncoder();
            const emit = (event: Parameters<typeof encodeNavigatorEvent>[0]) => {
              if (!abort.signal.aborted)
                controller.enqueue(encoder.encode(encodeNavigatorEvent(event)));
            };
            try {
              await runNavigator(parsed.data, emit, abort.signal, today, {
                owner,
                mode: "interactive",
              });
            } catch (error) {
              const known =
                error instanceof AssistantUnavailable || error instanceof NavigatorRejected;
              if (!abort.signal.aborted)
                emit({
                  type: "error",
                  message: known
                    ? (error as Error).message
                    : "The navigator could not continue right now.",
                });
              if (!known) console.error("navigator", error);
            } finally {
              try {
                controller.close();
              } catch {
                // already closed
              }
            }
          },
          cancel() {
            abort.abort();
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            "x-accel-buffering": "no",
          },
        });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY = 26 * 1024 * 1024;

export const Route = createFileRoute("/api/assistant")({
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
        const { allow, clientKey } = await import("@/lib/assistant/limits.server");
        if (!allow(`assistant:${clientKey(request)}`, 30, 10 * 60 * 1000))
          return Response.json(
            { error: "Too many questions in a short time. Wait a few minutes." },
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
        const { assistantRequestSchema, encodeEvent, MAX_ATTACHMENT_BYTES } =
          await import("@/lib/assistant/protocol");
        const parsed = assistantRequestSchema.safeParse(raw);
        if (!parsed.success)
          return Response.json({ error: "The request was not valid." }, { status: 400 });
        const total = parsed.data.attachments.reduce(
          (s, a) => s + Math.floor((a.data.length * 3) / 4),
          0,
        );
        if (total > MAX_ATTACHMENT_BYTES * 2)
          return Response.json({ error: "Attachments are too large." }, { status: 413 });
        const { runAssistant, AssistantUnavailable } = await import("@/lib/assistant/agent.server");
        const abort = new AbortController();
        request.signal?.addEventListener("abort", () => abort.abort());
        const today = new Date().toISOString().slice(0, 10);
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const encoder = new TextEncoder();
            const emit = (event: Parameters<typeof encodeEvent>[0]) => {
              if (!abort.signal.aborted) controller.enqueue(encoder.encode(encodeEvent(event)));
            };
            try {
              await runAssistant(parsed.data, emit, abort.signal, today);
            } catch (error) {
              if (!abort.signal.aborted)
                emit({
                  type: "error",
                  message:
                    error instanceof AssistantUnavailable
                      ? error.message
                      : "The assistant could not answer right now.",
                });
              if (!(error instanceof AssistantUnavailable)) console.error("assistant", error);
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

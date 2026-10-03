import { createFileRoute } from "@tanstack/react-router";

/**
 * Streams one verified PDF from the private `corpus-originals` bucket.
 *
 * GET /api/matter-pdf?source=<registry source>&doc=<native document id>[&download=1]
 *
 * - Account enforcement follows CORPUS_REQUIRE_AUTH (requireCorpusAccess).
 * - The storage key is never taken from the request: it is resolved server-side from the verified registry and must
 *   equal the content-addressed path of the registered SHA-256.
 * - Held (unconfirmed, sealed or restricted) documents are refused with 403 and no bytes.
 * - Range requests are forwarded so large PDFs can be paged by the viewer.
 */
const NO_STORE = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization, Cookie",
  "X-Content-Type-Options": "nosniff",
};
const text = (message: string, status: number, extra: Record<string, string> = {}) =>
  new Response(message, {
    status,
    headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8", ...extra },
  });

export const Route = createFileRoute("/api/matter-pdf")({
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
        const { parsePdfRequest } = await import("@/lib/matters/documents");
        const wanted = parsePdfRequest(new URL(request.url).searchParams);
        if (!wanted) return text("Bad document request", 400);
        const { lookupRegistryObject, fetchStoredPdf } =
          await import("@/lib/matters/source.server");
        let found;
        try {
          found = await lookupRegistryObject(wanted.source, wanted.doc);
        } catch {
          return text("The verified PDF registry is not available.", 503);
        }
        if (!found) return text("Document not found in the verified registry", 404);
        if (found.availability !== "open")
          return text(
            "This document is held: its seal or availability status is not confirmed.",
            403,
            { "X-Matter-Pdf": "held" },
          );
        let upstream: Response;
        try {
          upstream = await fetchStoredPdf(found.storageKey, request.headers.get("range"));
        } catch {
          return text("Stored PDF could not be read.", 502);
        }
        if (!(upstream.status === 200 || upstream.status === 206) || !upstream.body)
          return text("Stored PDF is not available.", 404);
        const headers = new Headers({
          ...NO_STORE,
          "Content-Type": "application/pdf",
          "Content-Disposition": `${wanted.download ? "attachment" : "inline"}; filename="matter-${found.sha256.slice(0, 12)}.pdf"`,
          "Accept-Ranges": "bytes",
          "X-Matter-Pdf-Sha256": found.sha256,
        });
        for (const name of ["content-length", "content-range"]) {
          const value = upstream.headers.get(name);
          if (value) headers.set(name, value);
        }
        return new Response(upstream.body, { status: upstream.status, headers });
      },
    },
  },
});

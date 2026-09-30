import { createFileRoute } from "@tanstack/react-router";
import { json, optionsResponse, requireApiKey } from "@/lib/external/apiAuth.server";

/**
 * GET /api/public/corpus/capabilities
 * Reports what the corpus backend supports: keyword search, metadata filters,
 * record detail, and whether vector/semantic search columns are detected.
 * The semantic probe is read-only: it tries selecting common embedding
 * columns and reports honestly when none are found.
 */
export const Route = createFileRoute("/api/public/corpus/capabilities")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request }) => {
        const denied = requireApiKey(request);
        if (denied) return denied;
        const { restGet } = await import("@/lib/external/rest.server");

        let semantic: { available: boolean; detail: string } = { available: false, detail: "No embedding column detected on corpus_records." };
        for (const col of ["embedding", "embedding_vector", "title_embedding"]) {
          try {
            await restGet(`corpus_records?select=${col}&limit=1`);
            semantic = { available: true, detail: `Embedding column "${col}" exists on corpus_records.` };
            break;
          } catch {
            // column absent — try the next candidate
          }
        }

        let datasets: number | null = null;
        try {
          const r = await restGet<unknown[]>("corpus_datasets?select=id", { count: true });
          datasets = r.total;
        } catch {
          datasets = null;
        }

        return json({
          keywordSearch: { available: true, endpoint: "/api/public/corpus/search" },
          metadataFilters: { available: true, note: "Pass filter.<key>=value; discover keys via /api/public/corpus/datasets." },
          recordDetail: { available: true, endpoint: "/api/public/corpus/record/{id}" },
          semanticSearch: semantic,
          datasets,
        });
      },
    },
  },
});

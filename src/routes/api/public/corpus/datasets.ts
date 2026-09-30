import { createFileRoute } from "@tanstack/react-router";
import { json, optionsResponse, requireApiKey } from "@/lib/external/apiAuth.server";

/**
 * GET /api/public/corpus/datasets
 * Catalogue of every dataset: label, record count, listing columns, filter
 * facets (with option counts), qualification text and aliases.
 */
export const Route = createFileRoute("/api/public/corpus/datasets")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request }) => {
        const denied = requireApiKey(request);
        if (denied) return denied;
        const { restGet } = await import("@/lib/external/rest.server");
        type Raw = { id: string; label: string | null; imported_records: number | null; metadata: Record<string, any> | null };
        const r = await restGet<Raw[]>(
          "corpus_datasets?select=id,label,imported_records,listing:metadata->listing,aliases:metadata->aliases,qualification:metadata->qualification&order=id.asc",
        );
        const datasets = (r.rows as any[]).map((d) => {
          const listing = d.listing ?? {};
          return {
            id: d.id,
            label: d.label ?? d.id,
            records: typeof d.imported_records === "number" ? d.imported_records : null,
            columns: Array.isArray(listing.columns) ? listing.columns : [],
            filters: Array.isArray(listing.filters) ? listing.filters : [],
            qualification: listing.qualification ?? (typeof d.qualification === "string" ? d.qualification : null),
            aliases: Array.isArray(d.aliases) ? d.aliases : [],
          };
        });
        return json({ datasets, total: datasets.length });
      },
    },
  },
});

import { createServerFn } from "@tanstack/react-start";
import { restGet } from "./rest.server";
import { enrichmentSchema, type EnrichmentSnapshot } from "./enrichmentSchema";

/** Ready-gated aggregate checkpoint; never reads the private ingestion schema. */
export const getEnrichmentSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<EnrichmentSnapshot | null> => {
    const response = await restGet<{ data: unknown }[]>(
      "corpus_context?select=data&ready=eq.true&key=eq.enrichment_20261002&limit=1",
    );
    const row = response.rows[0];
    if (!row) return null;
    const parsed = enrichmentSchema.safeParse(row.data);
    if (!parsed.success)
      throw new Error(
        "The published enrichment checkpoint does not match its declared aggregate schema.",
      );
    return parsed.data;
  },
);

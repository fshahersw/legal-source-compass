/**
 * Server functions of the semantic index (find legal text by meaning; related records). Read only.
 *
 *  - semanticSearch: embeds the query on the server (the key never reaches the browser) and returns the closest records;
 *  - semanticRelated: records whose passages are closest in meaning to a statute section, regulation, case, report or bill;
 *  - getSemanticCoverage: which datasets the index holds.
 *
 * Results say how they were found: a semantic match is a retrieval aid, not a citation. When the index is not set up the
 * outcome is "not_configured" or "not_loaded", never an exception.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MAX_QUERY_CHARS, SEMANTIC_DATASET_IDS } from "./semantic";
import type { RelatedOutcome, SearchOutcome, StatusOutcome } from "./semantic";
import { relatedSemantic, searchSemantic, semanticCoverage } from "./semantic.server";

const searchInput = z.object({
  query: z.string().min(2).max(MAX_QUERY_CHARS),
  datasets: z.array(z.enum(SEMANTIC_DATASET_IDS)).max(8).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const relatedInput = z.object({
  dataset: z.enum(SEMANTIC_DATASET_IDS),
  recordId: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(20).optional(),
  datasets: z.array(z.enum(SEMANTIC_DATASET_IDS)).max(8).optional(),
});

export const semanticSearch = createServerFn({ method: "POST" })
  .inputValidator((d) => searchInput.parse(d))
  .handler(
    async ({ data }): Promise<SearchOutcome> =>
      await searchSemantic(data.query, data.datasets ?? null, data.limit),
  );

export const semanticRelated = createServerFn({ method: "POST" })
  .inputValidator((d) => relatedInput.parse(d))
  .handler(
    async ({ data }): Promise<RelatedOutcome> =>
      await relatedSemantic(data.dataset, data.recordId, data.limit, data.datasets ?? null),
  );

export const getSemanticCoverage = createServerFn({ method: "GET" }).handler(
  async (): Promise<StatusOutcome> => await semanticCoverage(),
);

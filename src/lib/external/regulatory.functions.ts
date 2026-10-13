/** Read-only source evidence. Investigations, notes and briefs are stored only in this browser. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { rpcPost } from "./rest.server";
import {
  regulatoryDetailSchema,
  regulatoryEntityQuerySchema,
  regulatoryQuerySchema,
  regulatoryTrendSchema,
} from "@/lib/regulatory/validation";
import type {
  RegulatoryEntityPage,
  RegulatoryEventPage,
  RegulatoryOverview,
  RegulatoryRecordDetail,
  RegulatoryTrend,
  RegulatoryEvidenceSnapshot,
} from "@/lib/regulatory/types";

export const getRegulatoryOverview = createServerFn({ method: "GET" }).handler(
  (): Promise<RegulatoryOverview> => rpcPost("corpus_regulatory_overview_v1", {}),
);
export const queryRegulatoryEvents = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => regulatoryQuerySchema.parse(input))
  .handler(({ data }): Promise<RegulatoryEventPage> =>
    rpcPost("corpus_regulatory_query_v1", { p_query: data }),
  );
export const getRegulatoryRecord = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => regulatoryDetailSchema.parse(input))
  .handler(({ data }): Promise<RegulatoryRecordDetail> =>
    rpcPost("corpus_regulatory_detail_v1", { p_source: data.source, p_native_id: data.nativeId }),
  );
export const queryRegulatoryEntities = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => regulatoryEntityQuerySchema.parse(input))
  .handler(({ data }): Promise<RegulatoryEntityPage> =>
    rpcPost("corpus_regulatory_entities_v1", { p_query: data }),
  );
export const getRegulatoryTrends = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => regulatoryTrendSchema.parse(input))
  .handler(({ data }): Promise<RegulatoryTrend> =>
    rpcPost("corpus_regulatory_trends_v1", { p_query: data }),
  );

export const getRegulatoryEvidenceSnapshot = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        eventIds: z
          .array(z.string().regex(/^[a-f0-9]{64}$/))
          .min(1)
          .max(50)
          .refine((ids) => new Set(ids).size === ids.length),
        query: regulatoryQuerySchema,
      })
      .strict()
      .parse(input),
  )
  .handler(({ data }): Promise<RegulatoryEvidenceSnapshot> =>
    rpcPost("corpus_regulatory_evidence_v1", { p_event_ids: data.eventIds, p_query: data.query }),
  );

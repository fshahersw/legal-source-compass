import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet, rpcPost } from "./rest.server";
import { parseAgencyOptions } from "./agencyTree";

export type Agency = { id: string; name: string; count: number | null };
const DS = "federal_register_history";

/** Agencies exactly as the Federal Register listing metadata names them, with the listing's own counts. */
export const listAgencies = createServerFn({ method: "GET" }).handler(
  async (): Promise<Agency[]> => {
    const { rows } = await restGet<
      {
        filters: { name: string; options?: { value: string; label: string; count?: number }[] }[];
      }[]
    >(`corpus_datasets?id=eq.${DS}&select=filters:metadata->listing->filters`);
    const f = rows[0]?.filters?.find((x) => x.name === "agency");
    return parseAgencyOptions(f?.options ?? []);
  },
);

export type AgencyCounts = Record<string, number | null>;
export const AGENCY_TYPES = ["Rule", "Proposed Rule", "Notice"] as const;

/** Exact per-type counts via the corpus's bounded query; a timeout becomes null ("too large to count"). */
export const getAgencyCounts = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(/^\d{1,6}$/) }).parse(d))
  .handler(async ({ data }): Promise<AgencyCounts> => {
    const out: AgencyCounts = {};
    await Promise.all(
      AGENCY_TYPES.map(async (t) => {
        try {
          const r = await rpcPost<{ total: number | null; total_capped: boolean }>(
            "corpus_query_bounded",
            {
              p_q: null,
              p_dataset: DS,
              p_filters: { agency: data.id, type: t },
              p_limit: 1,
              p_offset: 0,
              p_count_cap: 1_000_000,
            },
          );
          out[t] = r.total_capped ? null : r.total;
        } catch {
          out[t] = null;
        }
      }),
    );
    return out;
  });

export type AgencyDoc = {
  id: string;
  title: string;
  type: string;
  published: string;
  citation: string;
  cfr: string;
  url: string | null;
};

export const listAgencyDocs = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({ id: z.string().regex(/^\d{1,6}$/), type: z.string().max(40).optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<AgencyDoc[]> => {
    const filters: Record<string, string> = { agency: data.id };
    if (data.type) filters["type"] = data.type;
    const r = await rpcPost<{
      items: {
        id: string;
        title: string;
        cells?: Record<string, string>;
        links?: { url: string }[];
      }[];
    }>("corpus_query_bounded", {
      p_q: null,
      p_dataset: DS,
      p_filters: filters,
      p_limit: 12,
      p_offset: 0,
      p_count_cap: 12,
    });
    return (r.items ?? []).map((i) => ({
      id: String(i.id),
      title: i.title,
      type: i.cells?.["type"] ?? "",
      published: i.cells?.["published"] ?? "",
      citation: i.cells?.["citation"] ?? "",
      cfr: i.cells?.["cfr"] ?? "",
      url: i.links?.find((l) => /^https:\/\//.test(l.url))?.url ?? null,
    }));
  });

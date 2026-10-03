import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet, rpcPost } from "./rest.server";
import { queryPublishedDataset, searchPublishedCorpus } from "./catalog.reads.server";
import { RECORD_ID_MAX_LENGTH } from "./recordIdentity";

export type DatasetFilter = {
  name: string;
  type: string;
  label: string;
  placeholder?: string;
  options?: { value: string; label: string; count?: number }[];
};
export type DatasetInfo = {
  id: string;
  label: string;
  records: number | null;
  ready: boolean | null;
  columns: { key: string; label: string }[];
  filters: DatasetFilter[];
  qualification: string | null;
  aliases: string[];
};

type RawDataset = {
  id: string;
  label: string | null;
  imported_records: number | null;
  metadata: Record<string, any> | null;
};

/** All datasets with their own listing metadata (columns, filters, qualification). */
export const listDatasets = createServerFn({ method: "GET" }).handler(
  async (): Promise<DatasetInfo[]> => {
    const r = await restGet<RawDataset[]>(
      "corpus_datasets?select=id,label,ready,imported_records,listing:metadata->listing,aliases:metadata->aliases,qualification:metadata->qualification&order=id.asc",
    );
    return (r.rows as any[]).map((d) => {
      const listing = d.listing ?? {};
      return {
        id: d.id,
        label: d.label ?? d.id,
        records: typeof d.imported_records === "number" ? d.imported_records : null,
        ready: typeof d.ready === "boolean" ? d.ready : null,
        columns: Array.isArray(listing.columns) ? listing.columns : [],
        filters: Array.isArray(listing.filters)
          ? listing.filters.filter((f: DatasetFilter) => f.type === "select" && f.options?.length)
          : [],
        qualification:
          listing.qualification ?? (typeof d.qualification === "string" ? d.qualification : null),
        aliases: Array.isArray(d.aliases) ? d.aliases : [],
      };
    });
  },
);

const PAGE = 50;
const queryInput = z.object({
  dataset: z.string().regex(/^[a-z0-9_]{1,80}$/),
  q: z.string().max(200).default(""),
  filters: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), z.string().max(200)).default({}),
  offset: z.number().int().min(0).max(1_000_000).default(0),
});

export type QueryResult = {
  items: Record<string, any>[];
  total: number | null;
  capped: boolean;
  pageSize: number;
  mode: "listing" | "raw";
};

/** One page using the corpus's publication and search rules, including valid empty results. */
export const queryDataset = createServerFn({ method: "GET" })
  .inputValidator((d) => queryInput.parse(d))
  .handler(async ({ data }): Promise<QueryResult> => {
    return queryPublishedDataset(data, PAGE);
  });

export type RecordDetail = {
  id: string;
  title: string | null;
  subtitle: string | null;
  qualification: string | null;
  facts: [string, string][];
  links: { url: string; label: string }[];
  sections: { title: string | null; items: Record<string, any>[] }[];
  text: string | null;
  textTruncated: boolean;
  photo: string | null;
};

/** Full record detail from the corpus's own detail function. */
export const getRecordDetail = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        id: z.string().min(1).max(RECORD_ID_MAX_LENGTH),
        dataset: z
          .string()
          .regex(/^[a-z0-9_]{1,80}$/)
          .nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<RecordDetail | null> => {
    const d = await rpcPost<any>("corpus_detail", {
      p_id: data.id,
      p_datasets: data.dataset ? [data.dataset] : null,
      p_full: false,
    });
    if (!d) return null;
    const facts: [string, string][] = Array.isArray(d.facts)
      ? d.facts
          .filter((f: unknown) => Array.isArray(f) && f.length >= 2)
          .map((f: unknown[]) => [
            String(f[0]),
            typeof f[1] === "string" ? f[1] : JSON.stringify(f[1]),
          ])
      : [];
    const sections = Array.isArray(d.sections)
      ? d.sections.map((s: any) => ({
          title: s?.title ?? s?.label ?? s?.heading ?? null,
          items: Array.isArray(s?.items) ? s.items : [],
        }))
      : [];
    return {
      id: String(d.id ?? data.id),
      title: d.title ?? d.name ?? null,
      subtitle: d.subtitle ?? null,
      qualification: d.qualification ?? null,
      facts,
      links: Array.isArray(d.links) ? d.links.filter((l: any) => typeof l?.url === "string") : [],
      sections,
      text: typeof d.text === "string" ? d.text : null,
      textTruncated: !!d.text_truncated,
      photo: typeof d.photo_url === "string" ? d.photo_url : null,
    };
  });

export type SearchHit = {
  id: string;
  dataset: string;
  title: string;
  state: string | null;
  county: string | null;
  source_url: string | null;
  kind: string | null;
  stateBasis: "exact_court_location" | "recorded_state" | null;
  sourceFileLabel: string | null;
  alsoIndexedAs: { dataset: string; id: string }[];
};

/** Cross-dataset search using the corpus's own query function. */
export const searchCorpus = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        q: z.string().max(200).trim().min(2),
        offset: z.number().int().min(0).max(10000).default(0),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const r = await searchPublishedCorpus(data.q, data.offset, PAGE);
    const hits: SearchHit[] = r.matches.map(({ item: i, record, displayTitle, sourceFileLabel, alsoIndexedAs, state, stateBasis }) => ({
      id: record.id,
      dataset: record.dataset,
      title: displayTitle,
      state,
      stateBasis,
      county: typeof i["county"] === "string" ? i["county"] : null,
      source_url: record.source_url,
      kind: typeof i["kind"] === "string" ? i["kind"] : record.category,
      sourceFileLabel,
      alsoIndexedAs,
    }));
    const { matches: _matches, ...coverage } = r;
    return { ...coverage, hits, pageSize: PAGE };
  });

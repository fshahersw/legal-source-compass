import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

const key = z.string().min(1).max(200).regex(/^[\w:.-]+$/);

export type DocketLink = { docket_number: string; court_id: string; mdl: string; event_date: string | null; date_basis: string | null; evidence_url: string | null; source_dataset: string };
const linkCols = "docket_number,court_id,mdl,event_date,date_basis,evidence_url,source_dataset";

/** Docket-links rows by exact court id or exact MDL number (first 50 by newest date + exact total). */
export const getDocketLinks = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ by: z.enum(["court", "mdl"]), id: key, offset: z.number().int().min(0).max(1_000_000).default(0) }).parse(d))
  .handler(async ({ data }) => {
    const col = data.by === "court" ? "court_id" : "mdl";
    const r = await restGet<DocketLink[]>(`corpus_workspace_docket_links?select=${linkCols}&${col}=eq.${encodeURIComponent(data.id)}&order=event_date.desc.nullslast`, { count: true, range: [data.offset, data.offset + 49] });
    return { rows: r.rows, total: r.total };
  });

/** Court-map row (exact court id). */
export const getCourtMap = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: key }).parse(d))
  .handler(async ({ data }) => {
    const r = await restGet<{ state: string | null; facts: [string, string][] | null }[]>(`corpus_workspace_court_map?select=state,facts&court_id=eq.${encodeURIComponent(data.id)}&limit=1`);
    return r.rows[0] ?? null;
  });

export type CountyItem = { url: string; title: string; kind_label: string | null; publisher: string | null; as_of: string | null };

/** County profile from corpus_context (key county-filing:county:<fips>) plus same-county document groups. */
export const getCountyProfile = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ fips: z.string().regex(/^\d{5}$/), county: z.string().max(80).optional(), state: z.string().max(40).optional() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await restGet<{ data: { groups?: { items?: CountyItem[] }[] } }[]>(`corpus_context?select=data&ready=eq.true&key=eq.county-filing:county:${data.fips}&limit=1`);
    const items: CountyItem[] = [];
    for (const g of ctx.rows[0]?.data.groups ?? []) for (const it of g.items ?? []) items.push({ url: it.url, title: it.title, kind_label: it.kind_label ?? null, publisher: it.publisher ?? null, as_of: it.as_of ?? null });
    let groups: { id: string; title: string; source_count: number }[] = [];
    if (data.county && data.state) {
      const g = await restGet<{ id: string; metadata: { title?: string; source_count?: number } }[]>(`corpus_display_groups?select=id,metadata&metadata->>county=eq.${encodeURIComponent(data.county)}&metadata->>state=eq.${encodeURIComponent(data.state)}&limit=50`);
      groups = g.rows.map((r) => ({ id: r.id, title: r.metadata.title ?? r.id, source_count: r.metadata.source_count ?? 1 }));
    }
    return { found: ctx.rows.length > 0, items, groups };
  });

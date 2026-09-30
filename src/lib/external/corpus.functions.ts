import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ilikeTerm, restGet, rpcPost } from "./rest.server";

const DIRECTORY_DATASET = "counties";
const ROW_CAP = 5000;

export type CountyRecord = { id: string; dataset: string; category: string | null; title: string | null; source_url: string | null; county_geoids: string[] };
export type StateCountyData = { counts: Record<string, number>; records: CountyRecord[]; truncated: boolean; directoryCounties: number };

/** County-tagged records for one state, counted per county FIPS from the records' own county_geoids. */
export const getStateCountyRecords = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ stateName: z.string().min(2).max(40) }).parse(d))
  .handler(async ({ data }): Promise<StateCountyData> => {
    const dir = await restGet<{ county_geoids: string[] }[]>(
      `corpus_records?select=county_geoids&dataset=eq.${DIRECTORY_DATASET}&state=eq.${encodeURIComponent(data.stateName)}&limit=1000`,
    );
    const geoids = [...new Set(dir.rows.flatMap((r) => r.county_geoids ?? []))].filter((g) => /^\d{5}$/.test(g));
    if (geoids.length === 0) return { counts: {}, records: [], truncated: false, directoryCounties: 0 };
    const res = await restGet<CountyRecord[]>(
      `corpus_records?select=id,dataset,category,title,source_url,county_geoids&county_geoids=ov.%7B${geoids.join(",")}%7D&dataset=neq.${DIRECTORY_DATASET}&limit=${ROW_CAP}`,
    );
    const inState = new Set(geoids);
    const counts: Record<string, number> = {};
    for (const r of res.rows) for (const g of new Set(r.county_geoids)) if (inState.has(g)) counts[g] = (counts[g] ?? 0) + 1;
    const records = res.rows.map((r) => ({ ...r, title: r.title?.replace(/\s+/g, " ").trim() ?? null }));
    return { counts, records, truncated: res.rows.length >= ROW_CAP, directoryCounties: geoids.length };
  });

const listInput = z.object({ q: z.string().max(120).default(""), state: z.string().max(40).default(""), offset: z.number().int().min(0).max(100000).default(0) });
const PAGE = 50;

export type JudgeRow = { id: string; title: string; state: string | null; source_url: string | null; role: string | null; system: string | null; courts: string[] | null; mdl_total: number | null };
export const listJudges = createServerFn({ method: "GET" })
  .inputValidator((d) => listInput.parse(d))
  .handler(async ({ data }) => {
    let p = `corpus_records?select=id,title,state,source_url,role:detail->>role,system:detail->>system,courts:detail->courts,mdl_total:detail->mdls->total&dataset=eq.judges&order=title.asc`;
    if (data.q.trim()) p += `&title=ilike.${ilikeTerm(data.q)}`;
    if (data.state) p += `&state=eq.${encodeURIComponent(data.state)}`;
    const r = await restGet<JudgeRow[]>(p, { count: true, range: [data.offset, data.offset + PAGE - 1] });
    return { rows: r.rows, total: r.total, pageSize: PAGE };
  });

export type MdlRow = { id: string; title: string; status: string | null; total_actions: number | null; actions_pending: number | null; court_name: string | null; transferee_judge: string | null };
export const listMdls = createServerFn({ method: "GET" })
  .inputValidator((d) => listInput.parse(d))
  .handler(async ({ data }) => {
    let p = `corpus_records?select=id,title,status:detail->>status,total_actions:detail->total_actions,actions_pending:detail->actions_pending,court_name:detail->>court_name,transferee_judge:detail->transferee_judge->>name_as_printed&dataset=eq.mdls&order=id.desc`;
    if (data.q.trim()) p += `&or=(title.ilike.${ilikeTerm(data.q)},id.ilike.${ilikeTerm(data.q)})`;
    const r = await restGet<MdlRow[]>(p, { count: true, range: [data.offset, data.offset + PAGE - 1] });
    return { rows: r.rows, total: r.total, pageSize: PAGE };
  });

export type LawCollection = { state: string; kind: string; provisions: number; headings: number };
export const listLawCollections = createServerFn({ method: "GET" }).handler(async () => {
  const r = await restGet<LawCollection[]>(`corpus_law_collections?select=state,kind,provisions,headings&order=state.asc,kind.asc&limit=1000`);
  return r.rows;
});

export type LawNode = { id: number; label: string; total: number; has_children: boolean };
export const listLawNodes = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ state: z.string().regex(/^[A-Za-z0-9_]{2,40}$/), kind: z.string().regex(/^[A-Za-z0-9_]{2,60}$/), parent: z.number().int().min(0) }).parse(d))
  .handler(async ({ data }) => {
    const r = await restGet<LawNode[]>(
      `corpus_law_nodes?select=id,label,total,has_children&state=eq.${encodeURIComponent(data.state)}&kind=eq.${encodeURIComponent(data.kind)}&parent=eq.${data.parent}&order=position.asc&limit=500`,
    );
    return r.rows;
  });

export type LawProvisionRow = { id: string; title: string | null; citation: string | null; status: string | null };
/** Provisions under one lowest-level outline heading, 50 per page, from the corpus's own ordered list. */
export const listLawProvisions = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ node: z.number().int().min(1), offset: z.number().int().min(0).max(1_000_000).default(0), limit: z.number().int().min(1).max(50).default(50) }).parse(d))
  .handler(async ({ data }) => {
    const rows = await rpcPost<LawProvisionRow[]>("corpus_law_provision_rows", { p_node: data.node, p_offset: data.offset, p_limit: data.limit });
    return rows ?? [];
  });

export type LawProvision = { id: string; dataset: string; title: string | null; state: string | null; kind: string | null; citation: string | null; status: string | null; quality: string | null; sourceUrl: string | null; text: string | null; file: { id?: string; bytes?: number; sha256?: string } | null };
/** One provision: stored text and the publisher's own http(s) link. Internal file paths are not exposed. */
export const getLawProvision = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().min(1).max(300) }).parse(d))
  .handler(async ({ data }): Promise<LawProvision | null> => {
    const r = await restGet<{ id: string; dataset: string; title: string | null; state: string | null; source_url: string | null; text: string | null; detail: any }[]>(
      `corpus_records?select=id,dataset,title,state,source_url,text,detail&id=eq.${encodeURIComponent(data.id)}&limit=1`,
    );
    const row = r.rows[0];
    if (!row) return null;
    const d = row.detail ?? {};
    const md = d.metadata ?? {};
    const src = typeof row.source_url === "string" && /^https?:\/\//i.test(row.source_url) ? row.source_url : null;
    return {
      id: row.id, dataset: row.dataset, title: row.title ?? d.title ?? null, state: row.state ?? d.state ?? null, kind: d.kind ?? null,
      citation: md.citation ?? null, status: md.status ?? null, quality: d.quality ?? null, sourceUrl: src,
      text: row.text && row.text.trim() ? row.text : null, file: md.file ?? null,
    };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ilikeTerm, restGet } from "./rest.server";
import { PROVISION_DATASETS } from "./lawTree";
import { cleanText, decodeEntities } from "./entities";
import { externalHref } from "./href";
import { RECORD_ID_MAX_LENGTH } from "./recordIdentity";
import { stateQueryValue } from "./stateMatch";

const DIRECTORY_DATASET = "counties";
const ROW_CAP = 5000;

export type CountyRecord = {
  id: string;
  dataset: string;
  category: string | null;
  title: string | null;
  source_url: string | null;
  county_geoids: string[];
};
export type StateCountyData = {
  counts: Record<string, number>;
  records: CountyRecord[];
  truncated: boolean;
  directoryCounties: number;
};

/** County-tagged records for one state, counted per county FIPS from the records' own county_geoids. */
export const getStateCountyRecords = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ stateName: z.string().min(2).max(40) }).parse(d))
  .handler(async ({ data }): Promise<StateCountyData> => {
    // The state column holds the name in some datasets and the USPS code in others; ask for both spellings.
    const stateValue = stateQueryValue(data.stateName);
    if (!stateValue) return { counts: {}, records: [], truncated: false, directoryCounties: 0 };
    const dir = await restGet<{ county_geoids: string[] }[]>(
      `corpus_records?select=county_geoids&dataset=eq.${DIRECTORY_DATASET}&state=${stateValue}&limit=1000`,
    );
    const geoids = [...new Set(dir.rows.flatMap((r) => r.county_geoids ?? []))].filter((g) =>
      /^\d{5}$/.test(g),
    );
    if (geoids.length === 0)
      return { counts: {}, records: [], truncated: false, directoryCounties: 0 };
    const res = await restGet<CountyRecord[]>(
      `corpus_records?select=id,dataset,category,title,source_url,county_geoids&county_geoids=ov.%7B${geoids.join(",")}%7D&dataset=neq.${DIRECTORY_DATASET}&limit=${ROW_CAP}`,
    );
    const inState = new Set(geoids);
    const counts: Record<string, number> = {};
    for (const r of res.rows)
      for (const g of new Set(r.county_geoids))
        if (inState.has(g)) counts[g] = (counts[g] ?? 0) + 1;
    const records = res.rows.map((r) => ({
      ...r,
      title: r.title?.replace(/\s+/g, " ").trim() ?? null,
    }));
    return {
      counts,
      records,
      truncated: res.rows.length >= ROW_CAP,
      directoryCounties: geoids.length,
    };
  });

const listInput = z.object({
  q: z.string().max(120).default(""),
  state: z.string().max(40).default(""),
  offset: z.number().int().min(0).max(100000).default(0),
});
const PAGE = 50;

export type JudgeRow = {
  id: string;
  title: string;
  state: string | null;
  source_url: string | null;
  role: string | null;
  system: string | null;
  courts: string[] | null;
  mdl_total: number | null;
};
export const listJudges = createServerFn({ method: "GET" })
  .inputValidator((d) => listInput.parse(d))
  .handler(async ({ data }) => {
    let p = `corpus_records?select=id,title,state,source_url,role:detail->>role,system:detail->>system,courts:detail->courts,mdl_total:detail->mdls->total&dataset=eq.judges&order=title.asc`;
    if (data.q.trim()) p += `&title=ilike.${ilikeTerm(data.q)}`;
    if (data.state) {
      // Name and USPS code are both stored; a value that is not a state (e.g. "US") matches nothing.
      const stateValue = stateQueryValue(data.state);
      if (!stateValue) return { rows: [] as JudgeRow[], total: 0, pageSize: PAGE };
      p += `&state=${stateValue}`;
    }
    const r = await restGet<JudgeRow[]>(p, {
      count: true,
      range: [data.offset, data.offset + PAGE - 1],
    });
    return { rows: r.rows, total: r.total, pageSize: PAGE };
  });

export type MdlRow = {
  id: string;
  title: string;
  status: string | null;
  total_actions: number | null;
  actions_pending: number | null;
  court_name: string | null;
  transferee_judge: string | null;
};
export const listMdls = createServerFn({ method: "GET" })
  .inputValidator((d) => listInput.parse(d))
  .handler(async ({ data }) => {
    let p = `corpus_records?select=id,title,status:detail->>status,total_actions:detail->total_actions,actions_pending:detail->actions_pending,court_name:detail->>court_name,transferee_judge:detail->transferee_judge->>name_as_printed&dataset=eq.mdls&order=id.desc`;
    if (data.q.trim()) p += `&or=(title.ilike.${ilikeTerm(data.q)},id.ilike.${ilikeTerm(data.q)})`;
    const r = await restGet<MdlRow[]>(p, {
      count: true,
      range: [data.offset, data.offset + PAGE - 1],
    });
    return { rows: r.rows, total: r.total, pageSize: PAGE };
  });

export type LawProvision = {
  publicationReady: boolean | null;
  id: string;
  dataset: string;
  title: string | null;
  state: string | null;
  kind: string | null;
  citation: string | null;
  status: string | null;
  quality: string | null;
  sourceUrl: string | null;
  text: string | null;
  file: { id?: string; bytes?: number; sha256?: string } | null;
  /** Reference frame from the publisher snapshot (eCFR detail fields); all null when the source does not state them. */
  frame: {
    titleName: string | null;
    chapter: string | null;
    part: string | null;
    partHeading: string | null;
    subpart: string | null;
    subjectGroup: string | null;
    section: string | null;
  } | null;
  dates: {
    sourceAsOf: string | null;
    capturedAt: string | null;
    latestAmendmentDate: string | null;
    latestIssueDate: string | null;
  } | null;
  frCitations: string[] | null;
  authorityNote: string | null;
  sourceNote: string | null;
};

/** The provision `detail` JSON as stored; every field is optional and checked before it is shown. */
type ProvisionDetail = {
  metadata?: {
    citation?: string | null;
    status?: string | null;
    file?: { id?: string; bytes?: number; sha256?: string } | null;
  } | null;
  temporal?: { source_as_of?: unknown; captured_at?: unknown } | null;
  title?: string | null;
  state?: string | null;
  kind?: string | null;
  quality?: string | null;
  citation?: unknown;
  title_name?: unknown;
  chapter?: unknown;
  part?: unknown;
  part_heading?: unknown;
  subpart?: unknown;
  subject_group?: unknown;
  section?: unknown;
  latest_amendment_date?: unknown;
  latest_issue_date?: unknown;
  printed_fr_citations?: unknown;
  authority_note_as_printed?: unknown;
  source_note_as_printed?: unknown;
};

/** One-line display value: entities decoded and whitespace collapsed; the stored value is not changed. */
const str = (v: unknown): string | null =>
  typeof v === "string" && cleanText(v) ? cleanText(v) : null;
const strArr = (v: unknown): string[] | null =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map(cleanText)
    : null;

/** One provision: stored text and the publisher's own http(s) link. Internal file paths are not exposed. */
export const getLawProvision = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        id: z.string().min(1).max(RECORD_ID_MAX_LENGTH),
        dataset: z.enum(PROVISION_DATASETS).nullable().default(null),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<LawProvision | null> => {
    const r = await restGet<
      {
        id: string;
        dataset: string;
        title: string | null;
        state: string | null;
        source_url: string | null;
        text: string | null;
        detail: ProvisionDetail | null;
      }[]
    >(
      `corpus_records?select=id,dataset,title,state,source_url,text,detail&id=eq.${encodeURIComponent(data.id)}&dataset=${data.dataset ? `eq.${data.dataset}` : `in.(${PROVISION_DATASETS.join(",")})`}&limit=2`,
    );
    const row = r.rows[0];
    if (!row || r.rows.length !== 1) return null;
    const publication = await restGet<{ ready: boolean }[]>(
      `corpus_datasets?select=ready&id=eq.${encodeURIComponent(row.dataset)}&limit=1`,
    );
    const d = row.detail ?? {};
    const md = d.metadata ?? {};
    const src =
      typeof row.source_url === "string" && /^https?:\/\//i.test(row.source_url)
        ? externalHref(row.source_url)
        : null;
    const t = d.temporal ?? {};
    const frame =
      d.part || d.title_name || d.chapter || d.subpart
        ? {
            titleName: str(d.title_name),
            chapter: str(d.chapter),
            part: str(d.part),
            partHeading: str(d.part_heading),
            subpart: str(d.subpart),
            subjectGroup: str(d.subject_group),
            section: str(d.section),
          }
        : null;
    const dates =
      d.temporal || d.latest_amendment_date || d.latest_issue_date
        ? {
            sourceAsOf: str(t.source_as_of),
            capturedAt: str(t.captured_at),
            latestAmendmentDate: str(d.latest_amendment_date),
            latestIssueDate: str(d.latest_issue_date),
          }
        : null;
    return {
      publicationReady:
        typeof publication.rows[0]?.ready === "boolean" ? publication.rows[0].ready : null,
      id: row.id,
      dataset: row.dataset,
      title: str(row.title) ?? str(d.title),
      state: row.state ?? d.state ?? null,
      kind: d.kind ?? null,
      citation: str(md.citation) ?? str(d.citation),
      status: md.status ?? null,
      quality: d.quality ?? null,
      sourceUrl: src,
      text: row.text && row.text.trim() ? decodeEntities(row.text) : null,
      file: md.file ?? null,
      frame,
      dates,
      frCitations: strArr(d.printed_fr_citations),
      authorityNote: str(d.authority_note_as_printed),
      sourceNote: str(d.source_note_as_printed),
    };
  });

export type StateRecordCount = { state: string; total: number | null };
/** Exact corpus_records totals per state name (HEAD count=exact; null when the database times out). */
export const getStateRecordCounts = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({ states: z.array(z.string().min(2).max(60)).min(1).max(80) }).parse(d),
  )
  .handler(async ({ data }): Promise<StateRecordCount[]> => {
    const out: StateRecordCount[] = [];
    const CHUNK = 8;
    for (let i = 0; i < data.states.length; i += CHUNK) {
      const part = await Promise.all(
        data.states.slice(i, i + CHUNK).map(async (state): Promise<StateRecordCount> => {
          // Both stored spellings (name and USPS code) count; "US" is a country, so it has no state count.
          const stateValue = stateQueryValue(state);
          if (!stateValue) return { state, total: null };
          try {
            const r = await restGet<unknown[]>(
              `corpus_records?select=id&state=${stateValue}&limit=1`,
              { count: true },
            );
            return { state, total: r.total ?? null };
          } catch {
            return { state, total: null };
          }
        }),
      );
      out.push(...part);
    }
    return out;
  });

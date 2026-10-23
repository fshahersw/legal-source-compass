/**
 * Enforcement actions and official settlements: DOJ press releases (doj_press_releases index + yearly partitions
 * doj_press_releases_YYYY), FTC enforcement data sets (ftc_enforcement_actions), FTC Legal Library cases (ftc_cases),
 * SEC litigation releases and administrative proceedings (sec_enforcement_actions) and settlements confirmed on their
 * official pages (settlement_claims_official). Built by scripts/enrichment/enforcement_actions/*.
 *
 * Read-only. Stored JSON is validated here; malformed rows and values are dropped, never repaired. External links are
 * kept only for http(s) URLs; in-app links only for the shapes /courts/<id>, /companies/<10-digit CIK> and
 * /records/<dataset>/<id>.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ilikeTerm, restGet } from "./rest.server";

// ---------------------------------------------------------------- primitives

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const str = (v: unknown, max = 2000) =>
  typeof v === "string" && v.trim() ? (v.length > max ? v.slice(0, max) : v) : null;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown) => {
  const n = num(v);
  return n != null && Number.isInteger(n) && n >= 0 ? n : null;
};
const strings = (v: unknown, max = 300) =>
  arr(v).flatMap((s) => {
    const x = str(s, max);
    return x ? [x] : [];
  });
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (v: unknown) => {
  const s = str(v, 10);
  return s && ISO_DATE.test(s) ? s : null;
};
export const COURT_ID = /^[a-z0-9]{2,16}$/;
export const CIK = /^\d{10}$/;
const YEAR = /^(19|20)\d{2}$/;
const enc = encodeURIComponent;
const cs = (v: Record<string, string[]>) => enc(JSON.stringify(v));

/** http(s) URL or null. */
export function webUrl(v: unknown): string | null {
  const s = str(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const courtId = (v: unknown) => {
  const s = str(v, 16);
  return s && COURT_ID.test(s) ? s : null;
};

export type CompanyLink = { cik: string; registrant: string; asWritten: string };
function parseCompanies(v: unknown): CompanyLink[] {
  return arr(v).flatMap((x) => {
    const o = obj(x);
    const cik = str(o?.["cik"], 10);
    const registrant = str(o?.["registrant"], 200);
    const asWritten = str(o?.["as_written"], 300);
    return cik && CIK.test(cik) && registrant && asWritten ? [{ cik, registrant, asWritten }] : [];
  });
}

export type CourtRef = { asWritten: string; courtId: string | null };
function parseCourts(v: unknown): CourtRef[] {
  return arr(v).flatMap((x) => {
    const o = obj(x);
    const asWritten = str(o?.["as_written"], 300) ?? str(o?.["name"], 300);
    return asWritten ? [{ asWritten, courtId: courtId(o?.["court_id"]) }] : [];
  });
}

export type StatedAmount = {
  asWritten: string;
  valueUsd: number | null;
  keyword: string | null;
  sentence: string | null;
  /** The sentence recurs verbatim in many releases (a stock program paragraph). */
  boilerplate: boolean;
  /** A multiplier on a number of 1,000 or more ("$6,705,000 million"): no value is computed. */
  ambiguous: boolean;
};
function parseAmounts(v: unknown): StatedAmount[] {
  return arr(v).flatMap((x) => {
    const o = obj(x);
    const asWritten = str(o?.["as_written"], 60);
    if (!asWritten || !asWritten.startsWith("$")) return [];
    return [
      {
        asWritten,
        valueUsd: num(o?.["value_usd"]),
        keyword: str(o?.["keyword"], 60),
        sentence: str(o?.["sentence"], 400),
        boilerplate: o?.["boilerplate"] === true,
        ambiguous: o?.["ambiguous_as_written"] === true,
      },
    ];
  });
}

/**
 * The figure a reader takes as the release's own resolution figure, verbatim: the title's figure when the title states
 * one with a resolution verb or noun ("to Pay $14.5 Million"), otherwise the first resolution figure of the text in
 * reading order. `differsFromLargest` marks releases whose largest stated resolution figure is another value (often a
 * related earlier settlement, a co-defendant or a total), which is kept for sorting and the amount filter.
 */
export type HeadlineFigure = {
  asWritten: string;
  valueUsd: number;
  source: "title" | "first resolution sentence";
  sentence: string | null;
  keyword: string | null;
  differsFromLargest: boolean;
};
export function parseHeadline(v: unknown): HeadlineFigure | null {
  const o = obj(v);
  const asWritten = str(o?.["as_written"], 60);
  const valueUsd = num(o?.["value_usd"]);
  const source = o?.["source"];
  if (!asWritten || !/\d/.test(asWritten) || valueUsd == null || valueUsd < 0) return null;
  if (source !== "title" && source !== "first resolution sentence") return null;
  const sentence = source === "first resolution sentence" ? str(o?.["sentence"], 400) : null;
  // a figure from the text is shown only with the sentence it was read from
  if (source === "first resolution sentence" && (!sentence || !sentence.includes(asWritten)))
    return null;
  return {
    asWritten,
    valueUsd,
    source,
    sentence,
    keyword: str(o?.["keyword"], 60),
    differsFromLargest: o?.["differs_from_largest"] === true,
  };
}

export const AMOUNT_BUCKETS = [
  { id: "1b_plus", label: "$1 billion or more" },
  { id: "100m_plus", label: "$100M to under $1B" },
  { id: "10m_plus", label: "$10M to under $100M" },
  { id: "1m_plus", label: "$1M to under $10M" },
  { id: "under_1m", label: "Under $1M" },
  { id: "none", label: "No figure stated" },
] as const;
export type AmountBucket = (typeof AMOUNT_BUCKETS)[number]["id"];
const AMOUNT_IDS = AMOUNT_BUCKETS.map((b) => b.id) as [AmountBucket, ...AmountBucket[]];

type Page<T> = { rows: T[]; total: number | null; page: number; pageSize: number };
const PAGE_SIZE = 50;

/** Every row of an ordered read, 1,000 at a time (the API returns at most 1,000 rows per request). */
export async function readAll<T>(path: string, max = 20_000): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; start < max; start += 1000) {
    const { rows } = await restGet<T[]>(path, { range: [start, start + 999] });
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

// ---------------------------------------------------------------- DOJ

export type DojPartition = { dataset: string; year: string; records: number };
export type DojOverview = {
  total: number;
  years: string[];
  partitions: DojPartition[];
  components: { name: string; count: number }[];
  topics: { name: string; count: number }[];
  byYear: { year: string; count: number; amount: Partial<Record<AmountBucket, number>> }[];
  checks: { valuesChecked: number | null; spanFailures: number | null; releases: number | null };
};

const PARTITION = /^doj_press_releases(?:_\d{4})?$/;

export function parseDojOverview(raw: unknown): DojOverview | null {
  const o = obj(raw);
  if (!o) return null;
  const partitions = arr(o["partitions"]).flatMap((x) => {
    const p = obj(x);
    const dataset = str(p?.["dataset"], 40);
    const year = str(p?.["year"], 4);
    const records = int(p?.["records"]);
    return dataset && PARTITION.test(dataset) && year && YEAR.test(year) && records != null
      ? [{ dataset, year, records }]
      : [];
  });
  if (!partitions.length) return null;
  const named = (v: unknown) =>
    arr(v).flatMap((x) => {
      const n = obj(x);
      const name = str(n?.["name"], 200);
      const count = int(n?.["count"]);
      return name && count != null ? [{ name, count }] : [];
    });
  const byYear = arr(o["by_year"]).flatMap((x) => {
    const y = obj(x);
    const year = str(y?.["year"], 4);
    const count = int(y?.["count"]);
    if (!year || !YEAR.test(year) || count == null) return [];
    const amount: Partial<Record<AmountBucket, number>> = {};
    for (const b of AMOUNT_IDS) {
      const n = int(obj(y?.["amount"])?.[b]);
      if (n != null) amount[b] = n;
    }
    return [{ year, count, amount }];
  });
  const checks = obj(o["checks"]);
  return {
    total: int(o["total"]) ?? partitions.reduce((s, p) => s + p.records, 0),
    years: partitions.map((p) => p.year).sort(),
    partitions: [...partitions].sort((a, b) => a.year.localeCompare(b.year)),
    components: named(o["components"]).slice(0, 400),
    topics: named(o["topics"]).slice(0, 400),
    byYear: byYear.sort((a, b) => a.year.localeCompare(b.year)),
    checks: {
      valuesChecked: int(checks?.["values_checked"]),
      spanFailures: int(checks?.["span_failures"]),
      releases: int(checks?.["releases"]),
    },
  };
}

export type DojRelease = {
  id: string;
  dataset: string;
  title: string;
  url: string | null;
  date: string | null;
  number: string | null;
  components: string[];
  topics: string[];
  teaser: string | null;
  amounts: StatedAmount[];
  amountsTotal: number;
  /** Largest stated resolution figure: sorting and the amount filter only. */
  maxResolutionUsd: number | null;
  headline: HeadlineFigure | null;
  statutes: string[];
  dockets: string[];
  courts: CourtRef[];
  parties: { asWritten: string; kind: string | null }[];
  companies: CompanyLink[];
  officeState: string | null;
};

export function parseDojRelease(
  row: { id?: unknown; title?: unknown; source_url?: unknown; r?: unknown },
  dataset: string,
): DojRelease | null {
  const id = str(row.id, 80);
  const title = str(row.title, 600);
  const r = obj(row.r);
  if (!id || !id.startsWith("doj-pr:") || !title || !r) return null;
  return {
    id,
    dataset,
    title,
    url: webUrl(r["url"]) ?? webUrl(row.source_url),
    date: isoDate(r["date"]),
    number: str(r["number"], 40),
    components: strings(r["components"], 200),
    topics: strings(r["topics"], 200),
    teaser: str(r["teaser"], 600),
    amounts: parseAmounts(r["amounts"]),
    amountsTotal: int(r["amounts_total"]) ?? 0,
    maxResolutionUsd: num(r["max_resolution_amount_usd"]),
    headline: (() => {
      const h = parseHeadline(r["headline_figure"]);
      // a title figure must be in the title shown
      return h && (h.source !== "title" || title.includes(h.asWritten)) ? h : null;
    })(),
    statutes: arr(r["statutes"]).flatMap((s) => {
      const c = str(obj(s)?.["cite"], 200);
      return c ? [c] : [];
    }),
    dockets: arr(r["dockets"]).flatMap((d) => {
      const c = str(obj(d)?.["as_written"], 80);
      return c ? [c] : [];
    }),
    courts: parseCourts(r["courts"]),
    parties: arr(r["parties"]).flatMap((p) => {
      const o = obj(p);
      const asWritten = str(o?.["as_written"], 200);
      return asWritten ? [{ asWritten, kind: str(o?.["kind"], 60) }] : [];
    }),
    companies: parseCompanies(r["companies"]),
    officeState: (() => {
      const s = str(r["office_state"], 2);
      return s && /^[A-Z]{2}$/.test(s) ? s : null;
    })(),
  };
}

let dojOverviewCache: { at: number; value: DojOverview | null } | null = null;
const TTL = 10 * 60 * 1000;

async function readDojOverview(): Promise<DojOverview | null> {
  if (dojOverviewCache && Date.now() - dojOverviewCache.at < TTL) return dojOverviewCache.value;
  const { rows } = await restGet<{ o: unknown }[]>(
    "corpus_records?select=o:item->overview&dataset=eq.doj_press_releases&id=eq.doj-index:overview&limit=1",
  );
  const value = parseDojOverview(rows[0]?.o);
  dojOverviewCache = { at: Date.now(), value };
  return value;
}

export const getDojOverview = createServerFn({ method: "GET" }).handler(readDojOverview);

const dojQuery = z.object({
  year: z.string().regex(YEAR),
  component: z.string().min(1).max(200).optional(),
  topic: z.string().min(1).max(200).optional(),
  amount: z.enum(AMOUNT_IDS).optional(),
  q: z.string().max(120).optional(),
  page: z.number().int().min(0).max(2000).default(0),
});
export type DojQuery = z.input<typeof dojQuery>;

const DOJ_SELECT = "select=id,title,source_url,r:item->release";

/** PostgREST path for one page of releases in a yearly partition (filters are exact containment). */
export function dojReleasesPath(dataset: string, q: z.output<typeof dojQuery>): string {
  const parts = [DOJ_SELECT, `dataset=eq.${dataset}`];
  const containment: Record<string, string[]> = {};
  if (q.component) containment["component"] = [q.component];
  if (q.topic) containment["topic"] = [q.topic];
  if (q.amount) containment["amount"] = [q.amount];
  if (Object.keys(containment).length) parts.push(`filters=cs.${cs(containment)}`);
  const term = q.q?.trim();
  if (term && term.length >= 2) {
    const t = ilikeTerm(term);
    parts.push(`or=(title.ilike.${t},text.ilike.${t})`);
  }
  parts.push("order=ordinal.asc");
  return `corpus_records?${parts.join("&")}`;
}

export const getDojReleases = createServerFn({ method: "GET" })
  .inputValidator((d: DojQuery) => dojQuery.parse(d))
  .handler(async ({ data }): Promise<Page<DojRelease> & { dataset: string | null }> => {
    const overview = await readDojOverview();
    const partition = overview?.partitions.find((p) => p.year === data.year);
    if (!partition)
      return { rows: [], total: 0, page: data.page, pageSize: PAGE_SIZE, dataset: null };
    const start = data.page * PAGE_SIZE;
    const res = await restGet<{ id: unknown; title: unknown; source_url: unknown; r: unknown }[]>(
      dojReleasesPath(partition.dataset, data),
      { count: true, range: [start, start + PAGE_SIZE - 1] },
    );
    return {
      rows: res.rows.flatMap((r) => {
        const p = parseDojRelease(r, partition.dataset);
        return p ? [p] : [];
      }),
      total: res.total,
      page: data.page,
      pageSize: PAGE_SIZE,
      dataset: partition.dataset,
    };
  });

/** Releases whose largest stated resolution figure is $1 billion or more, across every yearly partition. */
export const getDojLargest = createServerFn({ method: "GET" }).handler(
  async (): Promise<DojRelease[]> => {
    const overview = await readDojOverview();
    if (!overview) return [];
    const list = overview.partitions.map((p) => p.dataset).join(",");
    const rows = await readAll<{
      dataset: unknown;
      id: unknown;
      title: unknown;
      source_url: unknown;
      r: unknown;
    }>(
      `corpus_records?select=dataset,id,title,source_url,r:item->release&dataset=in.(${list})&filters=cs.${cs({ amount: ["1b_plus"] })}&order=dataset.asc,ordinal.asc`,
      5000,
    );
    return rows
      .flatMap((r) => {
        const ds = str(r.dataset, 40);
        const p = ds && PARTITION.test(ds) ? parseDojRelease(r, ds) : null;
        return p ? [p] : [];
      })
      .sort((a, b) => (b.maxResolutionUsd ?? 0) - (a.maxResolutionUsd ?? 0));
  },
);

export type DojReleaseDetail = { excerpt: string | null; facts: [string, string][] };
export function parseFacts(v: unknown): [string, string][] {
  return arr(v).flatMap((f) => {
    const pair = arr(f);
    const k = str(pair[0], 200);
    const val = str(pair[1], 4000);
    return k && val ? [[k, val] as [string, string]] : [];
  });
}

export const getDojReleaseDetail = createServerFn({ method: "GET" })
  .inputValidator((d: { dataset: string; id: string }) =>
    z
      .object({
        dataset: z.string().regex(/^doj_press_releases_\d{4}$/),
        id: z.string().regex(/^doj-pr:[0-9a-f-]{36}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<DojReleaseDetail | null> => {
    const { rows } = await restGet<{ f: unknown }[]>(
      `corpus_records?select=f:detail->facts&dataset=eq.${data.dataset}&id=eq.${enc(data.id)}&limit=1`,
    );
    if (!rows[0]) return null;
    const facts = parseFacts(rows[0].f);
    const excerpt = facts.find(([k]) => k.startsWith("Excerpt"))?.[1] ?? null;
    return { excerpt, facts };
  });

// ---------------------------------------------------------------- FTC

export const FTC_KINDS = [
  { id: "merger", label: "Merger enforcement" },
  { id: "nonmerger", label: "Nonmerger (conduct)" },
  { id: "bc_penalty", label: "Competition civil penalty" },
  { id: "bcp_penalty", label: "Consumer protection civil penalty" },
] as const;
export type FtcKind = (typeof FTC_KINDS)[number]["id"];
const FTC_KIND_IDS = FTC_KINDS.map((k) => k.id) as [FtcKind, ...FtcKind[]];

export type FtcAction = {
  id: string;
  kind: FtcKind;
  name: string;
  date: string | null;
  fy: string | null;
  matterNumber: string | null;
  actionType: string | null;
  industry: string | null;
  page: string | null;
  orderedAmount: number | null;
  basis: string | null;
  office: string | null;
  caseIds: string[];
  companies: CompanyLink[];
  sourceUrl: string | null;
};

const FTC_CASE_ID = /^ftc-case:[a-z0-9-]{1,200}$/;

export function parseFtcAction(row: {
  id?: unknown;
  source_url?: unknown;
  a?: unknown;
}): FtcAction | null {
  const id = str(row.id, 120);
  const a = obj(row.a);
  const kind = FTC_KIND_IDS.find((k) => k === a?.["kind"]);
  if (!id || !id.startsWith("ftc-action:") || !a || !kind) return null;
  return {
    id,
    kind,
    name: str(a["name"], 400) ?? "Name withheld by the FTC (confidential action)",
    date: isoDate(a["date"]),
    fy: str(a["fy"], 6),
    matterNumber: str(a["matter_number"], 40),
    actionType: str(a["action_type"], 200),
    industry: str(a["industry"], 200),
    page: webUrl(a["page"]),
    orderedAmount: num(a["ordered_amount"]),
    basis: str(a["basis"], 300),
    office: str(a["office"], 200),
    caseIds: strings(a["case_ids"], 220).filter((c) => FTC_CASE_ID.test(c)),
    companies: parseCompanies(a["companies"]),
    sourceUrl: webUrl(row.source_url),
  };
}

let ftcActionsCache: { at: number; value: FtcAction[] } | null = null;
export const getFtcActions = createServerFn({ method: "GET" }).handler(
  async (): Promise<FtcAction[]> => {
    if (ftcActionsCache && Date.now() - ftcActionsCache.at < TTL) return ftcActionsCache.value;
    const rows = await readAll<{ id: unknown; source_url: unknown; a: unknown }>(
      "corpus_records?select=id,source_url,a:item->ftc_action&dataset=eq.ftc_enforcement_actions&order=ordinal.asc",
    );
    const value = rows.flatMap((r) => {
      const p = parseFtcAction(r);
      return p ? [p] : [];
    });
    if (value.length) ftcActionsCache = { at: Date.now(), value };
    return value;
  },
);

export type FtcCase = {
  id: string;
  name: string;
  url: string | null;
  actionType: string | null;
  status: string | null;
  lastUpdated: string | null;
  matterNumbers: string[];
  civilActionNumbers: string[];
  docketNumbers: string[];
  courts: CourtRef[];
  tags: string[];
  summary: string | null;
  documentsTotal: number | null;
  documents: { title: string; url: string; date: string | null }[];
  companies: CompanyLink[];
  pageRead: boolean;
};

export function parseFtcCase(row: { id?: unknown; c?: unknown }): FtcCase | null {
  const id = str(row.id, 220);
  const c = obj(row.c);
  if (!id || !FTC_CASE_ID.test(id) || !c) return null;
  const name = str(c["name"], 400);
  if (!name) return null;
  const pageRead = c["page_read"] === true;
  return {
    id,
    name,
    url: webUrl(c["url"]),
    actionType: str(c["action_type"], 60),
    status: str(c["status"], 60),
    lastUpdated: isoDate(c["last_updated"]),
    matterNumbers: strings(c["matter_numbers"], 40),
    civilActionNumbers: strings(c["civil_action_numbers"], 80),
    docketNumbers: strings(c["docket_numbers"], 80),
    courts: parseCourts(c["courts"]),
    tags: strings(c["tags"], 100),
    summary: str(c["summary"], 1200),
    documentsTotal: pageRead ? int(c["documents_total"]) : null,
    documents: arr(c["documents"]).flatMap((d) => {
      const o = obj(d);
      const title = str(o?.["title"], 400);
      const url = webUrl(o?.["url"]);
      return title && url ? [{ title, url, date: isoDate(o?.["date"]) }] : [];
    }),
    companies: parseCompanies(c["companies"]),
    pageRead,
  };
}

const ftcCasesQuery = z.object({
  actionType: z.enum(["Federal", "Administrative"]).optional(),
  status: z.enum(["Pending", "Closed"]).optional(),
  mission: z.enum(["Competition", "Consumer Protection"]).optional(),
  q: z.string().max(120).optional(),
  page: z.number().int().min(0).max(1000).default(0),
});
export type FtcCasesQuery = z.input<typeof ftcCasesQuery>;

export function ftcCasesPath(q: z.output<typeof ftcCasesQuery>): string {
  const parts = ["select=id,c:item->ftc_case", "dataset=eq.ftc_cases"];
  const containment: Record<string, string[]> = {};
  if (q.actionType) containment["action_type"] = [q.actionType];
  if (q.status) containment["status"] = [q.status];
  if (q.mission) containment["mission"] = [q.mission];
  if (Object.keys(containment).length) parts.push(`filters=cs.${cs(containment)}`);
  const term = q.q?.trim();
  if (term && term.length >= 2) {
    const t = ilikeTerm(term);
    parts.push(`or=(title.ilike.${t},text.ilike.${t})`);
  }
  parts.push("order=ordinal.asc");
  return `corpus_records?${parts.join("&")}`;
}

export const getFtcCases = createServerFn({ method: "GET" })
  .inputValidator((d: FtcCasesQuery) => ftcCasesQuery.parse(d))
  .handler(async ({ data }): Promise<Page<FtcCase>> => {
    const start = data.page * PAGE_SIZE;
    const res = await restGet<{ id: unknown; c: unknown }[]>(ftcCasesPath(data), {
      count: true,
      range: [start, start + PAGE_SIZE - 1],
    });
    return {
      rows: res.rows.flatMap((r) => {
        const p = parseFtcCase(r);
        return p ? [p] : [];
      }),
      total: res.total,
      page: data.page,
      pageSize: PAGE_SIZE,
    };
  });

// ---------------------------------------------------------------- SEC

export type SecAction = {
  id: string;
  type: "Litigation release" | "Administrative proceeding";
  releaseNumber: string;
  date: string | null;
  respondents: string;
  url: string | null;
  series: string | null;
  fileNumber: string | null;
  civilActions: string[];
  courts: CourtRef[];
  amounts: StatedAmount[];
  /** Largest stated resolution figure: sorting and the amount filter only. */
  maxResolutionUsd: number | null;
  headline: HeadlineFigure | null;
  statutes: string[];
  seeAlso: { label: string; url: string }[];
  companies: CompanyLink[];
  textRead: boolean;
  excerpt: string | null;
};

export function parseSecAction(row: { id?: unknown; s?: unknown }): SecAction | null {
  const id = str(row.id, 120);
  const s = obj(row.s);
  const type = s?.["type"];
  if (!id || !/^sec-(lr|ap):/.test(id) || !s) return null;
  if (type !== "Litigation release" && type !== "Administrative proceeding") return null;
  const releaseNumber = str(s["release_number"], 60);
  const respondents = str(s["respondents"], 1000);
  if (!releaseNumber || !respondents) return null;
  return {
    id,
    type,
    releaseNumber,
    date: isoDate(s["date"]),
    respondents,
    url: webUrl(s["url"]),
    series: str(s["series"], 100),
    fileNumber: str(s["file_number"], 40),
    civilActions: arr(s["civil_actions"]).flatMap((d) => {
      const c = str(obj(d)?.["as_written"], 80);
      return c ? [c] : [];
    }),
    courts: parseCourts(s["courts"]),
    amounts: parseAmounts(s["amounts"]),
    maxResolutionUsd: num(s["max_resolution_amount_usd"]),
    headline: (() => {
      const h = parseHeadline(s["headline_figure"]);
      const pageTitle = str(s["title"], 600) ?? "";
      return h && (h.source !== "title" || pageTitle.includes(h.asWritten)) ? h : null;
    })(),
    statutes: strings(s["statutes"], 200),
    seeAlso: arr(s["see_also"]).flatMap((x) => {
      const o = obj(x);
      const url = webUrl(o?.["url"]);
      return url ? [{ label: str(o?.["label"], 200) ?? "Related document", url }] : [];
    }),
    companies: parseCompanies(s["companies"]),
    textRead: s["text_read"] === true,
    excerpt: str(s["excerpt"], 1200),
  };
}

const secQuery = z.object({
  type: z.enum(["litigation_release", "administrative_proceeding"]).optional(),
  year: z.string().regex(YEAR).optional(),
  amount: z.enum(AMOUNT_IDS).optional(),
  court: z.string().regex(COURT_ID).optional(),
  q: z.string().max(120).optional(),
  page: z.number().int().min(0).max(2000).default(0),
});
export type SecQuery = z.input<typeof secQuery>;

export function secActionsPath(q: z.output<typeof secQuery>): string {
  const parts = ["select=id,s:item->sec_action", "dataset=eq.sec_enforcement_actions"];
  const containment: Record<string, string[]> = {};
  if (q.type) containment["type"] = [q.type];
  if (q.year) containment["year"] = [q.year];
  if (q.amount) containment["amount"] = [q.amount];
  if (q.court) containment["court"] = [q.court];
  if (Object.keys(containment).length) parts.push(`filters=cs.${cs(containment)}`);
  const term = q.q?.trim();
  if (term && term.length >= 2) {
    const t = ilikeTerm(term);
    parts.push(`or=(title.ilike.${t},text.ilike.${t})`);
  }
  parts.push("order=ordinal.asc");
  return `corpus_records?${parts.join("&")}`;
}

export const getSecActions = createServerFn({ method: "GET" })
  .inputValidator((d: SecQuery) => secQuery.parse(d))
  .handler(async ({ data }): Promise<Page<SecAction>> => {
    const start = data.page * PAGE_SIZE;
    const res = await restGet<{ id: unknown; s: unknown }[]>(secActionsPath(data), {
      count: true,
      range: [start, start + PAGE_SIZE - 1],
    });
    return {
      rows: res.rows.flatMap((r) => {
        const p = parseSecAction(r);
        return p ? [p] : [];
      }),
      total: res.total,
      page: data.page,
      pageSize: PAGE_SIZE,
    };
  });

// ---------------------------------------------------------------- official settlements

export type ConfirmedFact = "deadline" | "amount" | "court" | "case number";
export type OfficialSettlement = {
  id: string;
  name: string;
  nameCheck: string;
  pageTitle: string | null;
  officialUrl: string;
  officialHost: string | null;
  retrievedAt: string | null;
  deadline: string | null;
  deadlineAsWritten: string | null;
  deadlineSentence: string | null;
  amounts: {
    asWritten: string;
    valueUsd: number | null;
    sentence: string | null;
    status: string;
  }[];
  courts: CourtRef[];
  caseNumbers: string[];
  claimUrl: string | null;
  confirmed: ConfirmedFact[];
  leadUrl: string | null;
};

const FACTS: ConfirmedFact[] = ["deadline", "amount", "court", "case number"];

export function parseOfficialSettlement(row: {
  id?: unknown;
  source_url?: unknown;
  s?: unknown;
}): OfficialSettlement | null {
  const id = str(row.id, 120);
  const s = obj(row.s);
  const name = str(s?.["name"], 400);
  const officialUrl = webUrl(row.source_url) ?? webUrl(s?.["official_url"]);
  const nameCheck = str(s?.["name_check"], 60);
  if (!id || !id.startsWith("settle:") || !s || !name || !officialUrl || !nameCheck) return null;
  const confirmed = strings(s["facts_confirmed"], 30).filter((f): f is ConfirmedFact =>
    FACTS.includes(f as ConfirmedFact),
  );
  if (!confirmed.length) return null;
  const d = obj(s["deadline"]);
  const deadlineConfirmed = d?.["status"] === "confirmed";
  const discovery = obj(s["discovery"]);
  return {
    id,
    name,
    nameCheck,
    pageTitle: str(s["page_title"], 300),
    officialUrl,
    officialHost: str(s["official_host"], 200),
    retrievedAt: str(s["page_retrieved_at"], 30),
    deadline: deadlineConfirmed ? isoDate(d?.["date"]) : null,
    deadlineAsWritten: deadlineConfirmed ? str(d?.["as_written"], 80) : null,
    deadlineSentence: deadlineConfirmed ? str(d?.["sentence"], 400) : null,
    amounts: arr(s["amounts"]).flatMap((x) => {
      const o = obj(x);
      const asWritten = str(o?.["page_as_written"], 60);
      const status = str(o?.["status"], 40);
      return asWritten && status
        ? [
            {
              asWritten,
              valueUsd: num(o?.["value_usd"]),
              sentence: str(o?.["sentence"], 400),
              status,
            },
          ]
        : [];
    }),
    courts: parseCourts(s["courts"]),
    caseNumbers: arr(s["case_numbers"]).flatMap((c) => {
      const x = str(obj(c)?.["as_written"], 80);
      return x ? [x] : [];
    }),
    claimUrl: webUrl(s["claim_url"]),
    confirmed,
    leadUrl: webUrl(discovery?.["url"]),
  };
}

let settlementsCache: { at: number; value: OfficialSettlement[] } | null = null;
export const getOfficialSettlements = createServerFn({ method: "GET" }).handler(
  async (): Promise<OfficialSettlement[]> => {
    if (settlementsCache && Date.now() - settlementsCache.at < TTL) return settlementsCache.value;
    const rows = await readAll<{ id: unknown; source_url: unknown; s: unknown }>(
      "corpus_records?select=id,source_url,s:item->settlement&dataset=eq.settlement_claims_official&order=ordinal.asc",
    );
    const value = rows.flatMap((r) => {
      const p = parseOfficialSettlement(r);
      return p ? [p] : [];
    });
    if (value.length) settlementsCache = { at: Date.now(), value };
    return value;
  },
);

// ---------------------------------------------------------------- company panel

export type CompanyEnforcement = {
  doj: DojRelease[];
  dojTotal: number | null;
  sec: SecAction[];
  secTotal: number | null;
  ftcActions: FtcAction[];
  ftcCases: FtcCase[];
};

export const getCompanyEnforcement = createServerFn({ method: "GET" })
  .inputValidator((d: { cik: string }) => z.object({ cik: z.string().regex(CIK) }).parse(d))
  .handler(async ({ data }): Promise<CompanyEnforcement> => {
    const filter = `filters=cs.${cs({ company: [data.cik] })}`;
    const overview = await readDojOverview();
    const list = overview?.partitions.map((p) => p.dataset).join(",");
    const [doj, sec, ftcA, ftcC] = await Promise.all([
      list
        ? restGet<
            { dataset: unknown; id: unknown; title: unknown; source_url: unknown; r: unknown }[]
          >(
            `corpus_records?select=dataset,id,title,source_url,r:item->release&dataset=in.(${list})&${filter}&limit=200`,
            { count: true },
          )
        : Promise.resolve({ rows: [], total: 0 }),
      restGet<{ id: unknown; s: unknown }[]>(
        `corpus_records?select=id,s:item->sec_action&dataset=eq.sec_enforcement_actions&${filter}&order=ordinal.asc&limit=100`,
        { count: true },
      ),
      restGet<{ id: unknown; source_url: unknown; a: unknown }[]>(
        `corpus_records?select=id,source_url,a:item->ftc_action&dataset=eq.ftc_enforcement_actions&${filter}&order=ordinal.asc&limit=100`,
      ),
      restGet<{ id: unknown; c: unknown }[]>(
        `corpus_records?select=id,c:item->ftc_case&dataset=eq.ftc_cases&${filter}&order=ordinal.asc&limit=100`,
      ),
    ]);
    const dojRows = doj.rows
      .flatMap((r) => {
        const ds = str(r.dataset, 40);
        const p = ds && PARTITION.test(ds) ? parseDojRelease(r, ds) : null;
        return p ? [p] : [];
      })
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    return {
      doj: dojRows,
      dojTotal: doj.total,
      sec: sec.rows.flatMap((r) => {
        const p = parseSecAction(r);
        return p ? [p] : [];
      }),
      secTotal: sec.total,
      ftcActions: ftcA.rows.flatMap((r) => {
        const p = parseFtcAction(r);
        return p ? [p] : [];
      }),
      ftcCases: ftcC.rows.flatMap((r) => {
        const p = parseFtcCase(r);
        return p ? [p] : [];
      }),
    };
  });

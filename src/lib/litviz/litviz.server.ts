/**
 * Server-only reads for the litigation visualizations. Each read calls its litviz/1 RPC first
 * (database/contracts/litviz-v1.sql); when that function is not applied or not built yet, the same payload is computed
 * from the published records over REST with the twin derivations in derive.ts (slower, cached), and the payload says
 * so (`basis: "live"`). Citations have no REST equivalent: before the RPCs exist they report "not built".
 */
import { restGet, rpcPostOptional } from "@/lib/external/rest.server";
import {
  CITATION_ADAPTERS,
  type CitationGrid,
  type CitationMap,
  type FilingCitations,
} from "./citations";
import {
  COURT_METRIC_IDS,
  parseCourtLevel,
  type CourtFact,
  type CourtLevel,
  type CourtLevelType,
  type CourtNode,
  type MetricInfo,
} from "./courtTree";
import {
  docketRows,
  filingRowsYearly,
  fjcRows,
  fjcThrough,
  fyEditionUrls,
  fyRows,
  jpmlMonthlyRows,
  nationalRows,
  productRows,
  sourceRows,
  type DocketEntry,
  type MdlRow,
  type RawRecord,
} from "./derive";
import { assembleLanes, parseLanesSource, rollupForLanes, type LanesPayload } from "./lanes";
import { parseSeriesRows, type SeriesRow } from "./model";
import { parseMdlDetail, productSignals, type MdlDetail, type ProductSignals } from "./signals";

export type Available<T> = { available: true; data: T } | { available: false; reason: string };

const LIVE_TTL = 30 * 60 * 1000;
const RPC_TTL = 10 * 60 * 1000;

/** Keyed memo: one in-flight read per key, successes kept for `ttl`, failures never cached. */
function memo<T>(ttl: number, fn: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const hits = new Map<string, { at: number; value: T }>();
  const inflight = new Map<string, Promise<T>>();
  return (key) => {
    const hit = hits.get(key);
    if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.value);
    const running = inflight.get(key);
    if (running) return running;
    const p = fn(key).then(
      (value) => {
        hits.set(key, { at: Date.now(), value });
        inflight.delete(key);
        if (hits.size > 400) hits.delete(hits.keys().next().value!);
        return value;
      },
      (e: unknown) => {
        inflight.delete(key);
        throw e;
      },
    );
    inflight.set(key, p);
    return p;
  };
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Every row of a REST read, 1,000 per request, stable order required (`order=` in the path). */
async function readAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; ; start += 1000) {
    const page = await restGet<T[]>(path, { range: [start, start + 999] });
    out.push(...page.rows);
    if (page.rows.length < 1000) return out;
  }
}

const enc = encodeURIComponent;
const todayIso = () => new Date().toISOString().slice(0, 10);
const chunk = <T>(xs: readonly T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// ------------------------------------------------------------------------------------------------ record reads

type Rec = { id: string; source_url?: string | null; item: unknown };
const records = (dataset: string, select = "id,source_url,item", extra = "") =>
  readAll<Rec>(`corpus_records?select=${select}&dataset=eq.${dataset}${extra}&order=id.asc`);

const HISTORY_SELECT =
  "id,series:item->history->series,title:item->history->title,type:item->history->type," +
  "judge:item->history->judge,district:item->history->district,date_filed:item->history->date_filed," +
  "date_transferred:item->history->date_transferred,date_closed:item->history->date_closed," +
  "exit_status:item->history->exit_status,last_report:item->history->last_report," +
  "closed_evidence:item->history->closed_evidence";

/** jpml_pending_history_mdls, projected to the history fields the lanes use (the full records are large). */
async function readHistory(filter = ""): Promise<RawRecord[]> {
  const rows = await readAll<Record<string, unknown> & { id: string }>(
    `corpus_records?select=${HISTORY_SELECT}&dataset=eq.jpml_pending_history_mdls${filter}&order=id.asc`,
  );
  return rows.map(({ id, ...history }) => ({ id, item: { history } }));
}

const PRODUCT_SELECT =
  "id,source_url,mdl:item->mdl,product:item->product,data_through:item->data_through,series:item->series";
async function readProducts(filter = ""): Promise<(RawRecord & { dataset: string })[]> {
  const read = (dataset: string) =>
    readAll<Record<string, unknown> & { id: string; source_url: string | null }>(
      `corpus_records?select=${PRODUCT_SELECT}&dataset=eq.${dataset}${filter}&order=id.asc`,
    ).then((rows) =>
      rows.map(({ id, source_url, ...item }) => ({ id, source_url, item, dataset })),
    );
  const [a, b] = await Promise.all([
    read("fda_faers_product_series"),
    read("fda_device_event_series"),
  ]);
  return [...a, ...b];
}

const editionsMemo = memo(LIVE_TTL, async () =>
  readAll<Rec>(
    "corpus_records?select=id,source_url,item:item->fy_stats&dataset=eq.jpml_statistics_extra&id=like.fy:*&order=id.asc",
  ).then((rows) => rows.map((r) => ({ ...r, item: { fy_stats: r.item } }))),
);
const intelMemo = memo(LIVE_TTL, () =>
  readAll<Rec>(
    "corpus_records?select=id,source_url,item&dataset=eq.mdl_intel_jpml_stats&id=like.year:*&order=id.asc",
  ),
);
const fjcNoteMemo = memo(LIVE_TTL, async () => {
  const r = await restGet<{ s: string | null }[]>(
    "corpus_datasets?select=s:metadata->summary->>snapshot&id=eq.fjc_civil_mdls&limit=1",
  );
  return fjcThrough(r.rows[0]?.s ?? null);
});

/** Docket entries projected to MDL, date and docket link (both docket datasets; shared by every live read). */
const docketMemo = memo(LIVE_TTL, async () => {
  const read = async (
    dataset: string,
    dateField: string,
    urlSelect: string,
  ): Promise<DocketEntry[]> => {
    const first = await restGet<{ m: unknown; d: unknown; u: unknown }[]>(
      `corpus_records?select=m:item->cells->>mdl&dataset=eq.${dataset}&order=id.asc&limit=1`,
      { count: true },
    );
    const total = first.total ?? 0;
    const pages = Array.from({ length: Math.ceil(total / 1000) }, (_, i) => i * 1000);
    const parts = await mapLimit(pages, 6, (start) =>
      restGet<{ m: unknown; d: unknown; u: unknown }[]>(
        `corpus_records?select=m:item->cells->>mdl,d:item->cells->>${dateField},u:${urlSelect}&dataset=eq.${dataset}&order=id.asc`,
        { range: [start, start + 999] },
      ).then((p) => p.rows),
    );
    return parts.flat().map((r) => ({ mdl: r.m, date: r.d, url: r.u }));
  };
  const [sw, activity] = await Promise.all([
    read("sw_docket_entries_v1", "date_filed", "item->cells->>source_url"),
    read("mdl_docket_activity", "published_at", "source_url"),
  ]);
  return { sw, activity };
});

type ForEntity = {
  total?: number;
  with_text?: number;
  undated?: number;
  by_year?: [number, number][];
};
/** Filings per calendar year of one MDL from the documents layer (the month needs litviz_refresh_v1). */
const filingsMemo = memo(LIVE_TTL, async (mdl: string) => {
  const r = await rpcPostOptional<ForEntity>("documents_for_entity_v1", {
    p_type: "mdl",
    p_id: mdl,
    p_limit: 0,
  });
  return r ?? null;
});

function filingYears(mdl: string, f: ForEntity | null) {
  return (f?.by_year ?? []).flatMap((p) =>
    Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1])
      ? [{ mdl, year: p[0], n: p[1] }]
      : [],
  );
}

// ------------------------------------------------------------------------------------------------ lanes

async function liveLanes(scope: "reported" | "historical"): Promise<LanesPayload> {
  const today = todayIso();
  const [mdls, history, analytics, editions, intel, through, docket, products] = await Promise.all([
    records("mdls"),
    readHistory(),
    records("mdl_analytics", "id,source_url,item"),
    editionsMemo("all"),
    intelMemo("all"),
    fjcNoteMemo("all"),
    docketMemo("all"),
    readProducts(),
  ]);
  const reported = new Set(
    [...mdls, ...history, ...analytics]
      .map((r) => r.id)
      .filter((id) => /^[1-9][0-9]{0,5}$/.test(id)),
  );
  let fy: Rec[];
  let terminated: Rec[] = [];
  let fjc: Rec[];
  if (scope === "reported") {
    const ids = [...reported].map((id) => `mdl:${id}`);
    const read = (dataset: string, select: string) =>
      Promise.all(
        chunk(ids, 80).map((c) =>
          readAll<Rec>(
            `corpus_records?select=${select}&dataset=eq.${dataset}&id=in.(${c.map(enc).join(",")})&order=id.asc`,
          ),
        ),
      ).then((x) => x.flat());
    [fy, fjc] = await Promise.all([
      read("jpml_statistics_extra", "id,source_url,item"),
      read("fjc_civil_mdls", "id,source_url,item:item->profile").then((rows) =>
        rows.map((r) => ({ ...r, item: { profile: r.item } })),
      ),
    ]);
  } else {
    [fy, terminated, fjc] = await Promise.all([
      records("jpml_statistics_extra", "id,source_url,item", "&id=like.mdl:*"),
      records("mdl_terminated_history", "id,source_url,item"),
      records("fjc_civil_mdls", "id,source_url,item:item->profile").then((rows) =>
        rows.map((r) => ({ ...r, item: { profile: r.item } })),
      ),
    ]);
  }
  const sources = sourceRows({ mdls, history, analytics, fy, terminated, products }).filter(
    (s) => s.scope === scope,
  );
  const inScope = new Set(sources.map((s) => s.mdl));
  const filings = await mapLimit([...inScope], 8, async (mdl) =>
    filingYears(mdl, await filingsMemo(mdl)),
  );
  const rows: MdlRow[] = [
    ...jpmlMonthlyRows(history),
    ...fyRows(fy, fyEditionUrls(editions)),
    ...fjcRows(fjc, through),
    ...docketRows(docket.sw, docket.activity, today),
    ...filingRowsYearly(filings.flat(), today),
  ].filter((r) => inScope.has(r.mdl));
  const national = nationalRows(editions, intel);
  return assembleLanes(
    {
      scope,
      today,
      refreshed: null,
      mdls: sources.map((s) => ({ mdl: s.mdl, src: s.src })),
      rows: rollupForLanes(rows, today),
      national: parseSeriesRows(national),
    },
    "live",
    [
      "Computed from the published records on request; the precomputed lanes are not published yet.",
    ],
  );
}

const lanesMemo = memo(RPC_TTL, async (scope: string): Promise<LanesPayload> => {
  const s = scope === "historical" ? "historical" : "reported";
  const raw = await rpcPostOptional<unknown>("litviz_mdl_lanes_v1", { p_scope: s });
  const parsed = raw ? parseLanesSource(raw) : null;
  if (parsed) return assembleLanes(parsed, "precomputed");
  return liveLanesMemo(s);
});
const liveLanesMemo = memo(LIVE_TTL, (scope: string) =>
  liveLanes(scope === "historical" ? "historical" : "reported"),
);

export const readLanes = (scope: "reported" | "historical") => lanesMemo(scope);

// ------------------------------------------------------------------------------------------------ one MDL

async function liveDetail(mdl: string): Promise<MdlDetail | null> {
  const today = todayIso();
  const one = (dataset: string, id: string, select = "id,source_url,item") =>
    readAll<Rec>(
      `corpus_records?select=${select}&dataset=eq.${dataset}&id=eq.${enc(id)}&order=id.asc`,
    );
  const [mdls, history, analytics, fy, fjc, terminated, products, editions, through, filings] =
    await Promise.all([
      one("mdls", mdl),
      readHistory(`&id=eq.${mdl}`),
      one("mdl_analytics", mdl),
      one("jpml_statistics_extra", `mdl:${mdl}`),
      one("fjc_civil_mdls", `mdl:${mdl}`, "id,source_url,item:item->profile").then((rows) =>
        rows.map((r) => ({ ...r, item: { profile: r.item } })),
      ),
      records("mdl_terminated_history", "id,source_url,item", `&item->history->>mdl=eq.${mdl}`),
      readProducts(`&item->>mdl=eq.${mdl}`),
      editionsMemo("all"),
      fjcNoteMemo("all"),
      filingsMemo(mdl),
    ]);
  const readEntries = (dataset: string, dateField: string, urlSelect: string) =>
    readAll<{ m: unknown; d: unknown; u: unknown }>(
      `corpus_records?select=m:item->cells->>mdl,d:item->cells->>${dateField},u:${urlSelect}&dataset=eq.${dataset}&item->cells->>mdl=eq.${mdl}&order=id.asc`,
    ).then((rows) => rows.map((r) => ({ mdl: r.m, date: r.d, url: r.u })));
  const sw = await readEntries("sw_docket_entries_v1", "date_filed", "item->cells->>source_url");
  const activity = sw.length
    ? []
    : await readEntries("mdl_docket_activity", "published_at", "source_url");
  const src = sourceRows({ mdls, history, analytics, fy, terminated, products }).find(
    (s) => s.mdl === mdl,
  );
  const rows: MdlRow[] = [
    ...jpmlMonthlyRows(history),
    ...fyRows(fy, fyEditionUrls(editions)),
    ...fjcRows(fjc, through),
    ...docketRows(sw, activity, today),
    ...filingRowsYearly(filingYears(mdl, filings), today),
    ...productRows(products),
  ].filter((r) => r.mdl === mdl);
  if (!src && !rows.length) return null;
  const dated = rows
    .filter((r) => r.series === "docket_entries")
    .reduce((s, r) => s + (r.value ?? 0), 0);
  const entries = sw.length ? sw : activity;
  return parseMdlDetail(
    {
      mdl,
      today,
      refreshed: null,
      scope: src?.scope ?? null,
      src: src?.src ?? null,
      rows,
      meta: {
        docket_dataset: entries.length
          ? sw.length
            ? "sw_docket_entries_v1"
            : "mdl_docket_activity"
          : null,
        docket_total: entries.length,
        docket_undated: entries.length - dated,
        filings: filings?.total ?? 0,
        filings_undated: filings?.undated ?? 0,
        with_text: filings?.with_text ?? 0,
      },
    },
    "live",
    [
      "Computed from the published records on request; filings are counted per calendar year until the precomputed series are published.",
    ],
  );
}

const detailMemo = memo(RPC_TTL, async (mdl: string): Promise<MdlDetail | null> => {
  const raw = await rpcPostOptional<unknown>("litviz_mdl_series_v1", { p_mdl: mdl });
  if (raw) return parseMdlDetail(raw, "precomputed");
  return liveDetailMemo(mdl);
});
const liveDetailMemo = memo(LIVE_TTL, liveDetail);

export const readMdlDetail = (mdl: string) => detailMemo(mdl);

/** Worker SAFETY's product_signals_v1 rows, or null when that function is not applied. */
async function safetyRows(mdl: string): Promise<{ rows: SeriesRow[] | null; failed: boolean }> {
  try {
    const raw = await rpcPostOptional<unknown>("product_signals_v1", { p_mdl: mdl });
    return { rows: raw === null ? null : parseSeriesRows(raw), failed: false };
  } catch {
    return { rows: null, failed: true };
  }
}

export async function readProductSignals(mdl: string): Promise<ProductSignals | null> {
  const [detail, safety] = await Promise.all([readMdlDetail(mdl), safetyRows(mdl)]);
  if (!detail) return null;
  const out = productSignals(detail, safety.rows);
  if (safety.failed)
    out.notices = [
      ...out.notices,
      "The agency safety series could not be read just now; the FDA product series held for this MDL are shown.",
    ];
  return out;
}

// ------------------------------------------------------------------------------------------------ citations

const NOT_BUILT = "The citation map is not published yet.";

async function viaAdapters<T>(
  pick: (a: (typeof CITATION_ADAPTERS)[number]) => {
    rpc: string;
    body: Record<string, unknown>;
    parse: (raw: unknown) => T | null;
  },
): Promise<Available<T>> {
  for (const adapter of CITATION_ADAPTERS) {
    const { rpc, body, parse } = pick(adapter);
    const raw = await rpcPostOptional<unknown>(rpc, body);
    if (raw === null) continue;
    const data = parse(raw);
    if (data) return { available: true, data };
  }
  return { available: false, reason: NOT_BUILT };
}

export const readCitationMap = memo(RPC_TTL, (key: string) => {
  const [mdl, limit] = key.split("|") as [string, string];
  return viaAdapters<CitationMap>((a) => ({
    rpc: a.map.rpc,
    body: a.map.args(mdl, Number(limit)),
    parse: a.map.parse,
  }));
});

export const readCitationGrid = memo(RPC_TTL, (key: string) => {
  const [list, limit] = key.split("|") as [string, string];
  const mdls = list ? list.split(",") : null;
  return viaAdapters<CitationGrid>((a) => ({
    rpc: a.grid.rpc,
    body: a.grid.args(mdls, Number(limit)),
    parse: a.grid.parse,
  }));
});

export const readFilingCitations = memo(RPC_TTL, (document: string) =>
  viaAdapters<FilingCitations>((a) => ({
    rpc: a.filing.rpc,
    body: a.filing.args(document),
    parse: a.filing.parse,
  })),
);

// ------------------------------------------------------------------------------------------------ courts

type EntityJson = {
  type: string;
  id: string;
  label: string;
  parent: { type: string; id: string } | null;
  keys: Record<string, unknown> | null;
  href: string | null;
};
type FactJson = {
  metric_id: string;
  entity_type: string;
  entity_id: string;
  period: string;
  value: number | null;
};
type EntityDetail = { entity: EntityJson | null; facts: FactJson[]; children: EntityJson[] };

const entityMemo = memo(LIVE_TTL, async (key: string): Promise<EntityDetail> => {
  const [type, id] = key.split("|") as [string, string];
  const r = await rpcPostOptional<EntityDetail>("insights_entity_v1", { p_type: type, p_id: id });
  return r ?? { entity: null, facts: [], children: [] };
});
const entity = (type: string, id: string) => entityMemo(`${type}|${id}`);

type CatalogEntry = {
  id: string;
  label: string;
  unit: string;
  format: string;
  period_type: string;
  entity_types: string[];
  source_links?: { label?: string; url?: string }[];
};
const catalogMemo = memo(LIVE_TTL, async () => {
  const r = await rpcPostOptional<CatalogEntry[]>("insights_catalog_v1", {});
  return (r ?? []).filter((m) => COURT_METRIC_IDS.includes(m.id));
});

/** Latest complete fact per entity for a metric and entity type (insights_latest_v1), keyed by entity id. */
const latestMemo = memo(LIVE_TTL, async (key: string) => {
  const [metric, type] = key.split("|") as [string, string];
  const r = await rpcPostOptional<FactJson[]>("insights_latest_v1", {
    p_metric: metric,
    p_entity_type: type,
  });
  return new Map((r ?? []).map((f) => [f.entity_id, f] as const));
});

async function factsFor(
  refs: { type: string; id: string }[],
): Promise<Map<string, Record<string, CourtFact>>> {
  const catalog = await catalogMemo("all");
  const types = [...new Set(refs.map((r) => r.type))];
  const combos = catalog.flatMap((m) =>
    types.filter((t) => m.entity_types.includes(t)).map((t) => [m.id, t] as const),
  );
  const maps = await Promise.all(
    combos.map(([m, t]) => latestMemo(`${m}|${t}`).then((map) => [m, t, map] as const)),
  );
  const out = new Map<string, Record<string, CourtFact>>();
  for (const ref of refs) {
    const rec: Record<string, CourtFact> = {};
    for (const [m, t, map] of maps) {
      if (t !== ref.type) continue;
      const f = map.get(ref.id);
      if (f && typeof f.value === "number") rec[m] = { value: f.value, period: f.period, level: t };
    }
    out.set(`${ref.type}:${ref.id}`, rec);
  }
  return out;
}

/** A circuit node prefers its circuit-level facts (U.S. Courts tables) and adds the court-level ones it lacks. */
function mergeFacts(...recs: (Record<string, CourtFact> | undefined)[]): Record<string, CourtFact> {
  const out: Record<string, CourtFact> = {};
  for (const r of recs) for (const [k, v] of Object.entries(r ?? {})) if (!out[k]) out[k] = v;
  return out;
}

const judgeMdlsMemo = memo(LIVE_TTL, async () => {
  const rows = await readAll<{ p: string | null; k: string | null; a: unknown; o: string | null }>(
    "corpus_records?select=p:item->>judge_profile_id,k:item->>judge_match_kind,a:item->actions_pending,o:item->>as_of&dataset=eq.mdls&order=id.asc",
  );
  const m = new Map<
    string,
    { pendingMdls: number; actionsPending: number | null; asOf: string | null }
  >();
  for (const r of rows) {
    if (!r.p || r.k !== "exact") continue;
    const cur = m.get(r.p) ?? { pendingMdls: 0, actionsPending: null, asOf: null };
    cur.pendingMdls += 1;
    if (typeof r.a === "number") cur.actionsPending = (cur.actionsPending ?? 0) + r.a;
    if (r.o && (!cur.asOf || r.o > cur.asOf)) cur.asOf = r.o;
    m.set(r.p, cur);
  }
  return m;
});

const APPELLATE = new Set(["S", "TS", "SA", "TA"]);
/** Territories the court directory files under its "Territory" system. */
const TERRITORIES = new Set(["AS", "GU", "MP", "PR", "VI"]);
const courtType = (e: EntityJson) =>
  typeof e.keys?.["court_type"] === "string" ? (e.keys["court_type"] as string) : null;
const node = (
  type: CourtNode["type"],
  e: Pick<EntityJson, "id" | "label" | "href">,
  extra: Partial<CourtNode> = {},
): CourtNode => ({
  type,
  id: e.id,
  label: e.label,
  href: e.href && e.href.startsWith("/") ? e.href : null,
  courtType: null,
  children: 0,
  metrics: {},
  judge: null,
  ...extra,
});
const byLabel = (a: CourtNode, b: CourtNode) =>
  a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : 1;
const circuitOrder = (id: string) => {
  const m = /^ca([0-9]+)$/.exec(id);
  return m ? Number(m[1]) : id === "cadc" ? 12 : 13;
};

async function judgeNodes(courtId: string): Promise<CourtNode[]> {
  const [e, mdls] = await Promise.all([entity("court", courtId), judgeMdlsMemo("all")]);
  return e.children
    .filter((c) => c.type === "judge")
    .map((c) => {
      const profile =
        typeof c.keys?.["judge_profile"] === "string" ? (c.keys["judge_profile"] as string) : null;
      return node("judge", c, { judge: (profile && mdls.get(profile)) || null });
    })
    .sort(byLabel);
}

async function liveCourtLevel(type: CourtLevelType, id: string | null): Promise<CourtLevel> {
  const catalogRows = await catalogMemo("all");
  const catalog: Record<string, MetricInfo> = Object.fromEntries(
    catalogRows.map((m) => [
      m.id,
      {
        label: m.label,
        unit: m.unit,
        format: m.format,
        periodType: m.period_type,
        sources: (m.source_links ?? []).flatMap((l) =>
          l.url && /^https?:\/\//.test(l.url) ? [{ label: l.label ?? l.url, url: l.url }] : [],
        ),
      },
    ]),
  );
  let nodes: CourtNode[] = [];
  if (type === "root") {
    const [scotus, nation] = await Promise.all([entity("court", "scotus"), entity("nation", "US")]);
    const facts = await factsFor([{ type: "court", id: "scotus" }]);
    const states = await stateSystems(nation);
    if (scotus.entity)
      nodes.push(
        node("court", scotus.entity, {
          courtType: courtType(scotus.entity),
          children: nation.children.filter((c) => c.type === "circuit").length,
          metrics: facts.get("court:scotus") ?? {},
        }),
      );
    nodes.push(
      node(
        "states",
        { id: "US", label: "State court systems", href: null },
        { children: states.length },
      ),
    );
  } else if (type === "court" && id === "scotus") {
    const [nation, scotus] = await Promise.all([entity("nation", "US"), entity("court", "scotus")]);
    const circuits = nation.children.filter((c) => c.type === "circuit");
    const details = await Promise.all(
      circuits.map((c) => Promise.all([entity("circuit", c.id), entity("court", c.id)])),
    );
    const facts = await factsFor(
      circuits.flatMap((c) => [
        { type: "circuit", id: c.id },
        { type: "court", id: c.id },
      ]),
    );
    nodes = circuits
      .map((c, i) => {
        const [circ, court] = details[i]!;
        const districts = circ.children.filter((x) => x.type === "court").length;
        const judges = court.children.filter((x) => x.type === "judge").length;
        return node("circuit", c, {
          children: districts + (judges ? 1 : 0),
          metrics: mergeFacts(facts.get(`circuit:${c.id}`), facts.get(`court:${c.id}`)),
        });
      })
      .sort((a, b) => circuitOrder(a.id) - circuitOrder(b.id));
    const justices = scotus.children.filter((x) => x.type === "judge").length;
    if (justices)
      nodes.push(
        node("judges", { id: "scotus", label: "Justices", href: null }, { children: justices }),
      );
  } else if (type === "circuit" && id) {
    const [circ, court] = await Promise.all([entity("circuit", id), entity("court", id)]);
    const districts = circ.children.filter((x) => x.type === "court");
    const [facts, judgesOf] = await Promise.all([
      factsFor(districts.map((d) => ({ type: "court", id: d.id }))),
      Promise.all(districts.map((d) => entity("court", d.id))),
    ]);
    nodes = districts
      .map((d, i) =>
        node("court", d, {
          courtType: courtType(d),
          children: judgesOf[i]!.children.filter((x) => x.type === "judge").length,
          metrics: facts.get(`court:${d.id}`) ?? {},
        }),
      )
      .sort(byLabel);
    const judges = court.children.filter((x) => x.type === "judge").length;
    if (judges)
      nodes.push(
        node(
          "judges",
          { id, label: "Judges of the court of appeals", href: null },
          { children: judges },
        ),
      );
  } else if ((type === "court" || type === "judges") && id) {
    nodes = await judgeNodes(id);
  } else if (type === "states") {
    nodes = await stateSystems(await entity("nation", "US"));
  } else if (type === "state" && id) {
    const st = await entity("state", id);
    const courts = st.children.filter((c) => c.type === "court");
    const appellate = courts.filter((c) => APPELLATE.has(courtType(c) ?? ""));
    const facts = await factsFor(appellate.map((c) => ({ type: "court", id: c.id })));
    nodes = appellate
      .map((c) =>
        node("court", c, { courtType: courtType(c), metrics: facts.get(`court:${c.id}`) ?? {} }),
      )
      .sort((a, b) => {
        const ra = a.courtType === "S" || a.courtType === "TS" ? 0 : 1;
        const rb = b.courtType === "S" || b.courtType === "TS" ? 0 : 1;
        return ra - rb || byLabel(a, b);
      });
    const others = courts.length - appellate.length;
    nodes.push(
      node(
        "other_courts",
        {
          id,
          label: "Trial and other courts",
          href: `/courts?system=${TERRITORIES.has(id) ? "Territory" : "State"}&state=${id}`,
        },
        { children: others },
      ),
    );
  }
  return { type, id, nodes, catalog };
}

async function stateSystems(nation: EntityDetail): Promise<CourtNode[]> {
  const states = nation.children.filter((c) => c.type === "state");
  const details = await mapLimit(states, 8, (s) => entity("state", s.id));
  return states
    .map((s, i) =>
      node("state", s, {
        children: details[i]!.children.filter(
          (c) => c.type === "court" && APPELLATE.has(courtType(c) ?? ""),
        ).length,
      }),
    )
    .filter((n) => n.children > 0)
    .sort(byLabel);
}

const courtMemo = memo(
  RPC_TTL,
  async (key: string): Promise<CourtLevel & { basis: "precomputed" | "live" }> => {
    const [type, id] = key.split("|") as [CourtLevelType, string];
    const raw = await rpcPostOptional<unknown>("litviz_court_children_v1", {
      p_type: type,
      p_id: id || null,
    });
    const parsed = raw ? parseCourtLevel(raw) : null;
    if (parsed) return { ...parsed, basis: "precomputed" };
    return { ...(await liveCourtLevel(type, id || null)), basis: "live" };
  },
);

export const readCourtLevel = (type: CourtLevelType, id: string | null) =>
  courtMemo(`${type}|${id ?? ""}`);

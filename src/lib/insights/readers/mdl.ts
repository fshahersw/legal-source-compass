/** MDL analytics read: mdl_analytics (overview + compact per-MDL rows) and mdl_terminated_history. */
import { restGet } from "@/lib/external/rest.server";
import type {
  MdlGroup,
  MdlInput,
  MdlMover,
  MdlPortfolioPoint,
  MdlRowLite,
  TerminatedLite,
} from "../generators/mdl";
import { memoAsync, READ_TTL_MS } from "./cache";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

function movers(v: unknown): MdlMover[] {
  return arr(v).flatMap((x) => {
    const o = obj(x);
    const mdl = num(o?.["mdl"]);
    const pending = num(o?.["pending"]);
    const change = num(o?.["change_12m"]);
    return o && mdl != null && pending != null && change != null
      ? [{ mdl, title: str(o["title"]) ?? "", pending, change12m: change }]
      : [];
  });
}

function groups(v: unknown): MdlGroup[] {
  return arr(v).flatMap((x) => {
    const o = obj(x);
    const key = str(o?.["key"]);
    const pending = num(o?.["pending"]);
    return o && key && pending != null
      ? [
          {
            key,
            mdls: num(o["mdls"]) ?? 0,
            pending,
            total: num(o["total"]) ?? 0,
            change12m: num(o["change_12m"]) ?? 0,
          },
        ]
      : [];
  });
}

export function parseOverview(raw: unknown): Omit<MdlInput, "rows" | "terminated"> | null {
  const o = obj(raw);
  const asOf = str(o?.["as_of"]);
  const pendingActions = num(o?.["pending_actions"]);
  const pendingMdls = num(o?.["pending_mdls"]);
  if (!o || !asOf || pendingActions == null || pendingMdls == null) return null;
  const portfolio: MdlPortfolioPoint[] = arr(o["portfolio"]).flatMap((p) => {
    const q = obj(p);
    const date = str(q?.["date"]);
    const pending = num(q?.["pending"]);
    return q && date && /^\d{4}-\d{2}-\d{2}$/.test(date) && pending != null
      ? [
          {
            date,
            pending,
            mdls: num(q["mdls"]) ?? 0,
            massTortPending: num(q["mass_tort_pending"]) ?? 0,
            massTortMdls: num(q["mass_tort_mdls"]) ?? 0,
          },
        ]
      : [];
  });
  portfolio.sort((a, b) => a.date.localeCompare(b.date));
  return {
    asOf,
    reports: num(o["reports"]) ?? portfolio.length,
    firstReport: str(o["first_report"]) ?? portfolio[0]?.date ?? asOf,
    pendingMdls,
    pendingActions,
    massTortMdls: num(o["mass_tort_mdls"]) ?? 0,
    massTortActions: num(o["mass_tort_actions"]) ?? 0,
    top10SharePct: num(o["top10_share_pct"]),
    medianAgeYears: num(o["median_age_years"]),
    newMdlsInSeries: num(o["new_mdls_in_series"]),
    leftSeries: num(o["left_series"]),
    portfolio,
    fastestGrowing: movers(o["fastest_growing"]),
    fastestDeclining: movers(o["fastest_declining"]),
    byType: groups(o["by_type"]),
    byDistrict: groups(o["by_district"]),
  };
}

export function parseRow(raw: Json): MdlRowLite | null {
  const mdl = num(raw["mdl"]);
  if (mdl == null) return null;
  const status =
    raw["status"] === "terminated" || raw["status"] === "no_longer_listed"
      ? raw["status"]
      : "pending";
  return {
    mdl,
    title: str(raw["title"]) ?? "",
    type: str(raw["type"]),
    status,
    pending: num(raw["pending"]) ?? 0,
    total: num(raw["total"]) ?? 0,
    change12m: num(raw["change12"]),
    ageYears: num(raw["age"]),
    rank: num(raw["rank"]),
    sharePct: num(raw["share"]),
  };
}

export function parseTerminated(raw: unknown): TerminatedLite | null {
  const h = obj(raw);
  const mdl = num(h?.["mdl"]);
  const year = num(h?.["termination_year"]);
  const closed = num(h?.["actions_closed"]);
  const remanded = num(h?.["actions_remanded"]);
  if (!h || mdl == null || year == null || closed == null || remanded == null) return null;
  return {
    mdl,
    caption: str(h["caption"]) ?? "",
    district: str(h["district_name"]) ?? "",
    year,
    closed,
    remanded,
  };
}

async function readHistory(): Promise<TerminatedLite[]> {
  const out: TerminatedLite[] = [];
  for (let start = 0; start < 20000; start += 1000) {
    const page = await restGet<{ h: unknown }[]>(
      "corpus_records?select=h:item->history&dataset=eq.mdl_terminated_history&order=ordinal.asc",
      { range: [start, start + 999] },
    );
    for (const r of page.rows) {
      const parsed = parseTerminated(r.h);
      if (parsed) out.push(parsed);
    }
    if (page.rows.length < 1000) break;
  }
  return out;
}

export const readMdl = memoAsync<MdlInput | null>(READ_TTL_MS, async () => {
  const [overview, rows, terminated] = await Promise.all([
    restGet<{ o: unknown }[]>(
      "corpus_records?select=o:item->overview&dataset=eq.mdl_analytics&id=eq.summary:overview&limit=1",
    ),
    restGet<Json[]>(
      "corpus_records?select=title,mdl:item->analytics->mdl,type:item->analytics->>type,status:item->analytics->>status,pending:item->analytics->pending,total:item->analytics->total,change12:item->analytics->change_12m,age:item->analytics->age_years,rank:item->rank,share:item->share_pct&dataset=eq.mdl_analytics&id=neq.summary:overview&order=ordinal.asc&limit=1000",
    ),
    readHistory(),
  ]);
  const parsed = parseOverview(overview.rows[0]?.o);
  if (!parsed) return null;
  return {
    ...parsed,
    rows: rows.rows.flatMap((r) => {
      const row = parseRow(r);
      return row ? [row] : [];
    }),
    terminated,
  };
});

/**
 * MDL deep intelligence (datasets mdl_intel_jpml_stats, mdl_intel_hearing_orders, mdl_intel_court_pages,
 * mdl_intel_summary). Server-side reads only; stored JSON is validated defensively and malformed rows are dropped.
 */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "./rest.server";

type Json = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export type Categories = {
  denied: number;
  moot: number;
  withdrawn: number;
  closed: number;
  stricken: number;
};
export type StatYear = {
  year: number;
  hearings: number;
  motionsFiled: number;
  motionsGranted: number;
  actionsInGranted: number;
  deniedMootWithdrawn: number;
  actionsInDenied: number;
  tagAlongs: number;
  remands: number;
  rateAll: number | null;
  rateMerits: number | null;
  actionsPerGrant: number | null;
  categories: Categories | null;
  categoriesConsistent: boolean | null;
  hearingSet: number | null;
  hearingDecided: number | null;
  pendingMdls: number | null;
  revised: string[];
};
export type TypeYear = { year: number; types: Record<string, number>; flag: string | null };
export type Edition = { edition: number; url: string };
export type SessionRow = {
  date: string;
  location: string | null;
  noticeUrl: string;
  machineReadable: boolean;
  tallies: Record<string, number>;
};
export type Matter = {
  session: string;
  mdl: number;
  title: string;
  section: "A" | "B";
  outcome: string;
  outcomeLabel: string;
  requestedDistrict: string | null;
  actionsListed: number | null;
  evidenceSource: string | null;
  evidenceUrl: string | null;
  evidenceDate: string | null;
  district: string | null;
};
export type DistrictStat = {
  district: string;
  label: string;
  mdls: number;
  pending: number;
  judges: number;
  sharePct: number;
};
export type JudgeStat = {
  judge: string;
  mdls: number;
  pending: number;
  districts: string[];
  sharePct: number;
};
export type GrowthLeader = {
  mdl: number;
  title: string | null;
  type: string | null;
  pending: number | null;
  change12m: number;
  pct12m: number | null;
  growth: string | null;
};
export type Quote = {
  category: string;
  text: string;
  url: string;
  retrieved: string | null;
  /** True when contact details were removed from this otherwise verbatim statement. */
  contactRemoved: boolean;
};
export type CourtOrder = {
  title: string;
  url: string;
  date: string | null;
  datePrinted: string | null;
  kind: string;
  vacated: boolean;
};
export type CourtMdl = {
  mdl: number;
  title: string;
  district: string | null;
  districtLabel: string | null;
  judge: string | null;
  dateTransferred: string | null;
  pending: number | null;
  total: number | null;
  ageYears: number | null;
  change12m: number | null;
  growth: string | null;
  pages: { url: string; title: string; retrieved: string | null }[];
  ordersTotal: number;
  latestOrders: CourtOrder[];
  quoteCounts: { leadership: number; bellwether: number; settlement: number };
  quotes: Quote[];
  leadership: { heading: string; lines: string[]; url: string; contactLinesRemoved: boolean }[];
  bellwetherOrders: number;
  firstBellwetherDate: string | null;
  firstBellwetherQuote: string | null;
  monthsToBellwether: number | null;
  flags: string[];
  /** How counsel contact details were removed (owner decision 2026-10-03), as stored with the record. */
  contactMethod: string | null;
  /** "transferred" or "not_transferred_as_of_report" (JPML pending report of 10/1/2026). */
  status: string;
  transferOrderFiled: string | null;
  bellwetherTimingNote: string | null;
};

// Defence in depth: counsel are shown without contact fields even if an older record still carried them.
const CONTACT = "[contact removed]";
const EMAIL_RE = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /(?<![\d-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\d-])/g;
const scrub = (s: string) => s.replace(EMAIL_RE, CONTACT).replace(PHONE_RE, CONTACT);
export type MdlIntel = {
  asOf: string;
  retrieved: string | null;
  kpis: {
    pendingMdls: number | null;
    pendingActions: number | null;
    plMdls: number | null;
    plWithCourtPage: number | null;
    plBellwetherQuoted: number | null;
    flagged: number | null;
    medianAgeAll: number | null;
    medianAgePl: number | null;
    tenYearGrantMedian: number | null;
    plListed: number | null;
    plNotTransferred: number | null;
    plPagesRead: number | null;
  };
  ageCoverage: { withTransferDate: number | null; listed: number | null };
  unparsedEditions: number[];
  unparsedNote: string | null;
  govinfoMethod: string | null;
  govinfoProbed: number | null;
  hhiBands: { high: number; moderate: number };
  stats: StatYear[];
  types: TypeYear[];
  editions: Edition[];
  inconsistencies: { year: number; note: string }[];
  sessions: SessionRow[];
  matters: Matter[];
  coverage: {
    year: number;
    govinfoTransfers: number;
    jpmlGranted: number;
    govinfoDenials: number;
    jpmlDenied: number | null;
  }[];
  grantedDistricts: { district: string; count: number }[];
  concentration: {
    hhiDistrictPending: number | null;
    hhiJudgePending: number | null;
    hhiDistrictMdls: number | null;
    top5DistrictShare: number | null;
    top5JudgeShare: number | null;
    districts: number | null;
    judges: number | null;
    multiMdlJudges: number | null;
  };
  districts: DistrictStat[];
  judges: JudgeStat[];
  ages: { bucket: string; all: number; pl: number }[];
  growthLeaders: GrowthLeader[];
  courts: CourtMdl[];
  rules: Record<string, string>;
};

type RecordRow = { id: string; item: Json };

async function readAll(dataset: string, select: string, extra = "") {
  const rows: RecordRow[] = [];
  for (let start = 0; ; start += 1000) {
    const page = await restGet<RecordRow[]>(
      `corpus_records?select=${select}&dataset=eq.${dataset}${extra}&order=ordinal.asc`,
      { range: [start, start + 999] },
    );
    rows.push(...page.rows);
    if (page.rows.length < 1000) return rows;
  }
}

function toStat(v: unknown): StatYear | null {
  const s = obj(v);
  const year = num(s?.["year"]);
  if (!s || year === null) return null;
  const cat = obj(s["categories"]);
  const hm = obj(s["hearing_matters"]);
  const need = [
    "hearings",
    "motions_filed",
    "motions_granted",
    "actions_in_granted",
    "motions_denied_moot_withdrawn",
    "actions_in_denied",
    "tag_along_transfers",
    "remands",
  ].map((k) => num(s[k]));
  if (need.some((x) => x === null)) return null;
  const [hearings, filed, granted, aGranted, dmw, aDenied, tags, remands] = need as number[];
  return {
    year,
    hearings: hearings!,
    motionsFiled: filed!,
    motionsGranted: granted!,
    actionsInGranted: aGranted!,
    deniedMootWithdrawn: dmw!,
    actionsInDenied: aDenied!,
    tagAlongs: tags!,
    remands: remands!,
    rateAll: num(s["grant_rate_all_pct"]),
    rateMerits: num(s["grant_rate_merits_pct"]),
    actionsPerGrant: num(s["actions_per_granted_motion"]),
    categories: cat
      ? {
          denied: num(cat["denied"]) ?? 0,
          moot: num(cat["moot"]) ?? 0,
          withdrawn: num(cat["withdrawn"]) ?? 0,
          closed: num(cat["closed"]) ?? 0,
          stricken: num(cat["stricken"]) ?? 0,
        }
      : null,
    categoriesConsistent:
      typeof s["categories_consistent"] === "boolean" ? s["categories_consistent"] : null,
    hearingSet: num(hm?.["matters_set"]),
    hearingDecided: num(hm?.["matters_decided"]),
    pendingMdls: num(s["pending_mdls_total"]),
    revised: arr(s["revised_fields"]).filter((x): x is string => typeof x === "string"),
  };
}

function toMatter(v: unknown): Matter | null {
  const m = obj(v);
  const mdl = num(m?.["mdl"]);
  const session = str(m?.["session"]);
  const section = m?.["section"];
  if (!m || mdl === null || !session || (section !== "A" && section !== "B")) return null;
  const ev = obj(m["evidence"]);
  return {
    session,
    mdl,
    title: str(m["title"]) ?? "",
    section,
    outcome: str(m["outcome"]) ?? "not_found",
    outcomeLabel: str(m["outcome_label"]) ?? "Not recorded",
    requestedDistrict: str(m["requested_district"]),
    actionsListed: num(m["actions_listed"]),
    evidenceSource: str(ev?.["source"]),
    evidenceUrl: str(ev?.["url"]),
    evidenceDate: str(ev?.["date"]),
    district: str(ev?.["district"]),
  };
}

function toOrder(v: unknown): CourtOrder | null {
  const o = obj(v);
  const url = str(o?.["url"]);
  const title = str(o?.["title"]);
  if (!o || !url || !title) return null;
  return {
    title,
    url,
    date: str(o["date"]),
    datePrinted: str(o["date_printed"]),
    kind: str(o["kind"]) ?? "other_order",
    vacated: o["vacated"] === true,
  };
}

/**
 * Validate one `mdl_intel_court_pages` record's `item.court` (malformed rows return null; nothing is guessed).
 * Exported for the MDL case lens, which reads the record with id = MDL number.
 */
export function parseCourtPage(v: unknown): CourtMdl | null {
  return toCourt(v);
}

function toCourt(v: unknown): CourtMdl | null {
  const c = obj(v);
  const mdl = num(c?.["mdl"]);
  if (!c || mdl === null) return null;
  const qc = obj(c["quote_counts"]);
  const qs = obj(c["quotes"]);
  const quotes: Quote[] = [];
  for (const cat of ["leadership", "bellwether", "settlement"]) {
    for (const q of arr(qs?.[cat]).slice(0, 6)) {
      const qq = obj(q);
      const text = str(qq?.["text"]);
      const url = str(qq?.["url"]);
      if (text && url) {
        const clean = scrub(text);
        quotes.push({
          category: cat,
          text: clean,
          url,
          retrieved: str(qq?.["retrieved"]),
          contactRemoved: qq?.["contact_details_removed"] === true || clean !== text,
        });
      }
    }
  }
  return {
    mdl,
    title: str(c["title"]) ?? "",
    district: str(c["district"]),
    districtLabel: str(c["district_label"]),
    judge: str(c["judge"]),
    dateTransferred: str(c["date_transferred"]),
    pending: num(c["pending"]),
    total: num(c["total"]),
    ageYears: num(c["age_years"]),
    change12m: num(c["change_12m"]),
    growth: str(c["growth"]),
    pages: arr(c["pages"])
      .map(obj)
      .filter((p): p is Json => !!p && !!str(p["url"]))
      .map((p) => ({
        url: str(p["url"])!,
        title: str(p["title"]) ?? "Court page",
        retrieved: str(p["retrieved"]),
      })),
    ordersTotal: num(c["orders_total"]) ?? 0,
    latestOrders: arr(c["orders"])
      .map(toOrder)
      .filter((o): o is CourtOrder => o !== null)
      .slice(0, 6),
    quoteCounts: {
      leadership: num(qc?.["leadership"]) ?? 0,
      bellwether: num(qc?.["bellwether"]) ?? 0,
      settlement: num(qc?.["settlement"]) ?? 0,
    },
    quotes,
    leadership: arr(c["leadership_blocks"])
      .map(obj)
      .filter((b): b is Json => !!b && !!str(b["heading"]))
      .slice(0, 4)
      .map((b) => {
        const raw = arr(b["lines"])
          .filter((l): l is string => typeof l === "string")
          .slice(0, 4);
        const lines = raw.map(scrub);
        return {
          heading: str(b["heading"])!,
          lines,
          url: str(b["url"]) ?? "",
          contactLinesRemoved:
            b["contact_lines_removed"] === true || lines.some((l, i) => l !== raw[i]),
        };
      }),
    bellwetherOrders: num(c["bellwether_orders"]) ?? 0,
    firstBellwetherDate: str(c["first_bellwether_date_quoted"]),
    firstBellwetherQuote: str(c["first_bellwether_quote"]),
    monthsToBellwether: num(c["months_transfer_to_quoted_bellwether"]),
    status: str(c["status"]) ?? "transferred",
    transferOrderFiled: str(c["transfer_order_filed"]),
    bellwetherTimingNote: str(c["bellwether_timing_note"]),
    flags: arr(c["flags"]).filter((f): f is string => typeof f === "string"),
    contactMethod: str(c["contact_method"]),
  };
}

let cache: { at: number; value: MdlIntel } | null = null;
const TTL_MS = 10 * 60 * 1000;

export const getMdlIntel = createServerFn({ method: "GET" }).handler(
  async (): Promise<MdlIntel | null> => {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
    const [summary, stats, hearing, matters, courts] = await Promise.all([
      readAll("mdl_intel_summary", "id,item:item->overview", "&id=eq.summary:overview"),
      readAll("mdl_intel_jpml_stats", "id,item:item->overview", "&id=eq.summary:overview"),
      readAll("mdl_intel_hearing_orders", "id,item:item->overview", "&id=eq.summary:overview"),
      readAll("mdl_intel_hearing_orders", "id,item:item->matter", "&id=like.matter:*"),
      readAll("mdl_intel_court_pages", "id,item:item->court"),
    ]);
    const s = obj(summary[0]?.item);
    const st = obj(stats[0]?.item);
    const h = obj(hearing[0]?.item);
    if (!s || !st) return null;
    const kp = obj(s["kpis"]) ?? {};
    const conc = obj(s["concentration"]) ?? {};
    const value: MdlIntel = {
      asOf: str(s["as_of"]) ?? "Not recorded",
      retrieved: str(s["retrieved"]),
      kpis: {
        pendingMdls: num(kp["pending_mdls"]),
        pendingActions: num(kp["pending_actions"]),
        plMdls: num(kp["pl_mdls"]),
        plWithCourtPage: num(kp["pl_with_court_page"]),
        plBellwetherQuoted: num(kp["pl_bellwether_quoted"]),
        flagged: num(kp["flagged_fast_growth_no_bellwether"]),
        medianAgeAll: num(kp["median_age_years_all"]),
        medianAgePl: num(kp["median_age_years_pl"]),
        tenYearGrantMedian: num(kp["ten_year_grant_rate_median"]),
        plListed: num(kp["pl_listed"]),
        plNotTransferred: num(kp["pl_not_transferred"]),
        plPagesRead: num(kp["pl_pages_read"]),
      },
      ageCoverage: {
        withTransferDate: num(obj(s["age_coverage"])?.["with_transfer_date"]),
        listed: num(obj(s["age_coverage"])?.["listed_mdls"]),
      },
      unparsedEditions: arr(st["unparsed_summary_editions"]).filter(
        (x): x is number => typeof x === "number",
      ),
      unparsedNote: str(st["unparsed_note"]),
      govinfoMethod: str(h?.["govinfo_method"]),
      govinfoProbed: num(h?.["govinfo_probed_packages"]),
      hhiBands: {
        high: num(obj(obj(s["rules"])?.["hhi_bands"])?.["high"]) ?? 1800,
        moderate: num(obj(obj(s["rules"])?.["hhi_bands"])?.["moderate"]) ?? 1000,
      },
      stats: arr(st["series"])
        .map(toStat)
        .filter((x): x is StatYear => x !== null),
      types: arr(st["types_by_year"])
        .map(obj)
        .filter((t): t is Json => !!t && num(t["year"]) !== null && !!obj(t["types"]))
        .map((t) => ({
          year: num(t["year"])!,
          types: Object.fromEntries(
            Object.entries(obj(t["types"])!).filter(([, v]) => typeof v === "number"),
          ) as Record<string, number>,
          flag: str(t["flag"]),
        })),
      editions: arr(st["editions"])
        .map(obj)
        .filter((e): e is Json => !!e && num(e["edition"]) !== null && !!str(e["url"]))
        .map((e) => ({ edition: num(e["edition"])!, url: str(e["url"])! })),
      inconsistencies: arr(st["inconsistencies"])
        .map(obj)
        .filter((x): x is Json => !!x && num(x["year"]) !== null)
        .map((x) => ({
          year: num(x["year"])!,
          note:
            str(x["note"]) ??
            `termination categories total ${num(x["categories_total"]) ?? "?"} vs summary table ${num(x["summary_total"]) ?? "?"}`,
        })),
      sessions: arr(h?.["session_rows"])
        .map(obj)
        .filter((x): x is Json => !!x && !!str(x["date"]) && !!str(x["notice_url"]))
        .map((x) => ({
          date: str(x["date"])!,
          location: str(x["location"]),
          noticeUrl: str(x["notice_url"])!,
          machineReadable: x["machine_readable"] === true,
          tallies: Object.fromEntries(
            Object.entries(obj(x["tallies"]) ?? {}).filter(([, v]) => typeof v === "number"),
          ) as Record<string, number>,
        })),
      matters: matters.map((r) => toMatter(r.item)).filter((m): m is Matter => m !== null),
      coverage: arr(s["govinfo_vs_jpml"])
        .map(obj)
        .filter((x): x is Json => !!x && num(x["year"]) !== null)
        .map((x) => ({
          year: num(x["year"])!,
          govinfoTransfers: num(x["govinfo_initial_transfer_orders"]) ?? 0,
          jpmlGranted: num(x["jpml_granted"]) ?? 0,
          govinfoDenials: num(x["govinfo_initial_denials"]) ?? 0,
          jpmlDenied: num(x["jpml_denied"]),
        })),
      grantedDistricts: arr(s["granted_transferee_districts"])
        .map(obj)
        .filter((x): x is Json => !!x && !!str(x["district"]) && num(x["count"]) !== null)
        .map((x) => ({ district: str(x["district"])!, count: num(x["count"])! })),
      concentration: {
        hhiDistrictPending: num(conc["hhi_district_pending"]),
        hhiJudgePending: num(conc["hhi_judge_pending"]),
        hhiDistrictMdls: num(conc["hhi_district_mdls"]),
        top5DistrictShare: num(conc["top5_district_share_pct"]),
        top5JudgeShare: num(conc["top5_judge_share_pct"]),
        districts: num(conc["districts"]),
        judges: num(conc["judges"]),
        multiMdlJudges: num(conc["multi_mdl_judges"]),
      },
      districts: arr(s["districts"])
        .map(obj)
        .filter((d): d is Json => !!d && !!str(d["district"]) && num(d["pending"]) !== null)
        .map((d) => ({
          district: str(d["district"])!,
          label: str(d["label"]) ?? str(d["district"])!,
          mdls: num(d["mdls"]) ?? 0,
          pending: num(d["pending"])!,
          judges: num(d["judges"]) ?? 0,
          sharePct: num(d["share_pending_pct"]) ?? 0,
        })),
      judges: arr(s["judges"])
        .map(obj)
        .filter((j): j is Json => !!j && !!str(j["judge"]) && num(j["pending"]) !== null)
        .map((j) => ({
          judge: str(j["judge"])!,
          mdls: num(j["mdls"]) ?? 0,
          pending: num(j["pending"])!,
          districts: arr(j["districts"]).filter((x): x is string => typeof x === "string"),
          sharePct: num(j["share_pending_pct"]) ?? 0,
        })),
      ages: arr(s["age_distribution"])
        .map(obj)
        .filter((a): a is Json => !!a && !!str(a["bucket"]))
        .map((a) => ({
          bucket: str(a["bucket"])!,
          all: num(a["all"]) ?? 0,
          pl: num(a["products_liability"]) ?? 0,
        })),
      growthLeaders: arr(s["growth_leaders"])
        .map(obj)
        .filter((g): g is Json => !!g && num(g["mdl"]) !== null && num(g["change_12m"]) !== null)
        .map((g) => ({
          mdl: num(g["mdl"])!,
          title: str(g["title"]),
          type: str(g["type"]),
          pending: num(g["pending"]),
          change12m: num(g["change_12m"])!,
          pct12m: num(g["pct_12m"]),
          growth: str(g["growth"]),
        })),
      courts: courts.map((r) => toCourt(r.item)).filter((c): c is CourtMdl => c !== null),
      rules: Object.fromEntries(
        Object.entries(obj(s["rules"]) ?? {}).filter(([, v]) => typeof v === "string"),
      ) as Record<string, string>,
    };
    cache = { at: Date.now(), value };
    return value;
  },
);

/**
 * Recall patterns (dataset recall_patterns): per domain an overview (recalls by year, class mix, timing, rising themes, anomalous
 * months), keyword themes, repeat-recall firms, multi-firm food clusters and suppliers named in recall reasons. Read-only; values
 * that fail validation are dropped, never repaired. Themes are the builder's keyword rules, not agency categories.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

export const RECALL_DOMAINS = ["fda_drug", "fda_device", "fda_food", "cpsc", "nhtsa"] as const;
export type RecallDomain = (typeof RECALL_DOMAINS)[number];

export type YearCount = { year: string; count: number };
export type Growth = {
  recentYears: string;
  recent: number;
  priorYears: string;
  prior: number;
  changePct: number | null;
};
export type ThemeSummary = {
  theme: string;
  label: string;
  events: number;
  firms: number;
  growth: Growth | null;
  class1Share: number | null;
};
export type Anomaly = {
  month: string;
  count: number;
  trailingMedian: number;
  robustZ: number;
  measure: string;
  measureLabel: string;
  firms: number;
  topFirms: { firm: string; amount: number }[];
  topFirmShare: number | null;
  topThemes: { label: string; events: number }[];
  pattern: string;
};
export type FirmRef = { firm: string; role: string | null; events: number; id: string | null };
export type RecallOverview = {
  domain: RecallDomain;
  domainLabel: string;
  events: number;
  productRows: number | null;
  firms: number;
  first: string | null;
  last: string | null;
  byYear: YearCount[];
  class1ByYear: YearCount[];
  classMix: { label: string; count: number }[];
  daysToClassification: { year: string; days: number }[];
  medianDaysToTermination: number | null;
  terminatedEvents: number | null;
  nationwideShare: number | null;
  themes: ThemeSummary[];
  rising: ThemeSummary[];
  anomalies: Anomaly[];
  untagged: number;
  topFirms: FirmRef[];
  lastFullYear: number | null;
  countries: { label: string; count: number }[];
  chinaShareByYear: { year: string; share: number }[];
  unitsByYear: YearCount[];
  deathMentions: number | null;
  productTypes: { label: string; count: number }[];
};
export type RecallSample = {
  id: string;
  firm: string | null;
  date: string | null;
  classification: string | null;
  recallNumbers: string[];
  reason: string | null;
  url: string | null;
};
export type RecallItem = {
  id: string;
  kind: "theme" | "firm" | "cluster" | "supplier";
  title: string;
  events: number;
  firms: number | null;
  first: string | null;
  last: string | null;
  label: string;
  note: string | null;
  growth: Growth | null;
  byYear: YearCount[];
  topFirms: { firm: string; events: number }[];
  commodities: { label: string; count: number }[];
  recent: RecallSample[];
  anomalies: Anomaly[];
  repeatThemes: { label: string; events: number }[];
  themes: { label: string; events: number }[];
  medianGapDays: number | null;
  suppliers: string[];
  members: RecallSample[];
  membersTotal: number | null;
  spanDays: number | null;
  reading: string | null;
};
export type RecallDomainData = {
  overview: RecallOverview | null;
  themes: RecallItem[];
  firms: RecallItem[];
  clusters: RecallItem[];
  suppliers: RecallItem[];
  dropped: number;
};

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 600) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const num = (v: unknown, min = 0, max = 1e12) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const YEAR = /^\d{4}$/;
const date = (v: unknown) => (typeof v === "string" && DATE.test(v) ? v : null);
const ID = /^[a-z_]+:[A-Za-z0-9:_.-]{1,160}$|^supplier:[a-z0-9-]{1,90}$/;
const url = (v: unknown) => {
  const s = str(v, 400);
  return s && /^https:\/\/(www\.)?(cpsc\.gov|nhtsa\.gov|fda\.gov|accessdata\.fda\.gov)\//.test(s)
    ? s
    : null;
};

function yearCounts(v: unknown): YearCount[] {
  const o = obj(v);
  if (!o) return [];
  return Object.entries(o)
    .filter(([y, c]) => YEAR.test(y) && num(c) !== null)
    .map(([year, count]) => ({ year, count: count as number }))
    .sort((a, b) => a.year.localeCompare(b.year));
}
function labelCounts(v: unknown, limit = 20) {
  const o = obj(v);
  if (!o) return [];
  return Object.entries(o)
    .filter(([k, c]) => k && k !== "null" && num(c) !== null)
    .map(([label, count]) => ({ label: label.slice(0, 120), count: count as number }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
export function parseGrowth(v: unknown): Growth | null {
  const o = obj(v);
  const recent = num(o?.["recent"]);
  const prior = num(o?.["prior"]);
  if (!o || recent === null || prior === null) return null;
  const pct = o["change_pct"];
  return {
    recentYears: str(o["recent_years"], 20) ?? "",
    recent,
    priorYears: str(o["prior_years"], 20) ?? "",
    prior,
    changePct: typeof pct === "number" && Number.isFinite(pct) ? pct : null,
  };
}
export function parseTheme(v: unknown): ThemeSummary | null {
  const o = obj(v);
  const theme = str(o?.["theme"], 80);
  const label = str(o?.["label"], 160);
  const events = num(o?.["events"]);
  if (!o || !theme || !label || events === null) return null;
  return {
    theme,
    label,
    events,
    firms: num(o["firms"]) ?? 0,
    growth: parseGrowth(o["growth"]),
    class1Share: num(o["class1_share"], 0, 100),
  };
}
export function parseAnomaly(v: unknown): Anomaly | null {
  const o = obj(v);
  const month = str(o?.["month"], 7);
  const count = num(o?.["count"]);
  const median = num(o?.["trailing_median"]);
  if (!o || !month || !MONTH.test(month) || count === null || median === null || count <= median)
    return null;
  return {
    month,
    count,
    trailingMedian: median,
    robustZ: typeof o["robust_z"] === "number" ? (o["robust_z"] as number) : 0,
    measure: str(o["measure"], 30) ?? "recalls",
    measureLabel: str(o["measure_label"], 60) ?? "Recalls",
    firms: num(o["firms"]) ?? 0,
    topFirms: arr(o["top_firms"])
      .map((x) => {
        const f = obj(x);
        const firm = str(f?.["firm"], 160);
        const amount = num(f?.["amount"] ?? f?.["events"]);
        return firm && amount !== null ? { firm, amount } : null;
      })
      .filter((x): x is { firm: string; amount: number } => !!x)
      .slice(0, 5),
    topFirmShare: num(o["top_firm_share"], 0, 100),
    topThemes: arr(o["top_themes"])
      .map((x) => {
        const t = obj(x);
        const label = str(t?.["label"], 160);
        const events = num(t?.["events"]);
        return label && events !== null ? { label, events } : null;
      })
      .filter((x): x is { label: string; events: number } => !!x)
      .slice(0, 4),
    pattern: str(o["pattern"], 30) ?? "",
  };
}
const compact = <T>(list: (T | null)[]) => list.filter((x): x is T => x !== null);

export function parseOverview(raw: unknown, domain: RecallDomain): RecallOverview | null {
  const p = obj(raw);
  if (!p || p["kind"] !== "overview" || p["domain"] !== domain) return null;
  const events = num(p["events"]);
  if (events === null) return null;
  const themes = compact(arr(p["themes"]).map(parseTheme));
  const toClass = obj(p["median_days_to_classification_by_year"]);
  return {
    domain,
    domainLabel: str(p["domain_label"], 80) ?? domain,
    events,
    productRows: num(p["product_rows"]),
    firms: num(p["firms"]) ?? 0,
    first: date(p["first"]),
    last: date(p["last"]),
    byYear: yearCounts(p["by_year"]),
    class1ByYear: yearCounts(p["class1_by_year"]),
    classMix: labelCounts(p["class_mix"], 6),
    daysToClassification: toClass
      ? Object.entries(toClass)
          .filter(([y, d]) => YEAR.test(y) && num(d, 0, 5000) !== null)
          .map(([year, days]) => ({ year, days: days as number }))
      : [],
    medianDaysToTermination: num(p["median_days_to_termination"], 0, 10000),
    terminatedEvents: num(p["terminated_events"]),
    nationwideShare: num(p["nationwide_share"], 0, 100),
    themes,
    rising: compact(arr(p["rising_themes"]).map(parseTheme)),
    anomalies: compact(arr(p["anomalies"]).map(parseAnomaly)),
    untagged: num(p["untagged_events"]) ?? 0,
    topFirms: compact(
      arr(p["top_firms"]).map((x) => {
        const f = obj(x);
        const firm = str(f?.["firm"], 160);
        const n = num(f?.["events"]);
        const id = str(f?.["id"], 200);
        return firm && n !== null
          ? { firm, role: str(f?.["role"], 30), events: n, id: id && ID.test(id) ? id : null }
          : null;
      }),
    ),
    lastFullYear: num(p["last_full_year"], 1900, 2100),
    countries: labelCounts(p["countries"], 12),
    chinaShareByYear: (() => {
      const o = obj(p["china_share_by_year"]);
      return o
        ? Object.entries(o)
            .filter(([y, s]) => YEAR.test(y) && num(s, 0, 100) !== null)
            .map(([year, share]) => ({ year, share: share as number }))
        : [];
    })(),
    unitsByYear: yearCounts(p["units_by_year"]),
    deathMentions: num(p["death_mentions"]),
    productTypes: labelCounts(p["product_types"], 15),
  };
}

function sampleList(v: unknown, limit = 60): RecallSample[] {
  return compact(
    arr(v).map((x) => {
      const s = obj(x);
      const id = str(s?.["id"], 80);
      if (!s || !id) return null;
      return {
        id,
        firm: str(s["firm"], 200),
        date: date(s["date"] ?? s["start"]),
        classification: str(s["classification"], 30),
        recallNumbers: arr(s["recall_numbers"])
          .map((n) => str(n, 40))
          .filter((n): n is string => !!n)
          .slice(0, 4),
        reason: str(s["reason"], 400),
        url: url(s["url"]),
      };
    }),
  ).slice(0, limit);
}
const labelled = (v: unknown, key = "label") =>
  compact(
    arr(v).map((x) => {
      const o = obj(x);
      const label = str(o?.[key], 200);
      const events = num(o?.["events"]);
      return label && events !== null ? { label, events } : null;
    }),
  );

export function parseItem(id: string, raw: unknown, domain?: RecallDomain): RecallItem | null {
  const p = obj(raw);
  const kind = p?.["kind"];
  if (
    !p ||
    !ID.test(id) ||
    (kind !== "theme" && kind !== "firm" && kind !== "cluster" && kind !== "supplier")
  )
    return null;
  if (domain && kind !== "supplier" && p["domain"] !== domain) return null;
  const events = num(p["events"]);
  if (events === null) return null;
  const title =
    kind === "theme"
      ? str(p["label"], 200)
      : kind === "firm"
        ? str(p["firm"], 200)
        : kind === "cluster"
          ? [str(p["theme_label"], 120), str(p["commodity"], 60)].filter(Boolean).join(" · ")
          : str(p["supplier"], 200);
  if (!title) return null;
  const firmsValue = kind === "supplier" ? p["recalling_firms"] : p["firms"];
  return {
    id,
    kind,
    title,
    events,
    firms: typeof firmsValue === "number" ? num(firmsValue) : null,
    first: date(p["first"] ?? p["start"]),
    last: date(p["last"] ?? p["end"]),
    label: kind === "firm" ? (str(p["role"], 30) ?? "") : "",
    note: kind === "cluster" ? str(p["commodity"], 60) : null,
    growth: parseGrowth(p["growth"]),
    byYear: yearCounts(p["by_year"]),
    topFirms: compact(
      arr(kind === "supplier" ? p["firms"] : p["top_firms"]).map((x) => {
        const f = obj(x);
        const firm = str(f?.["firm"], 200);
        const n = num(f?.["events"]);
        return firm && n !== null ? { firm, events: n } : null;
      }),
    ).slice(0, 30),
    commodities: labelCounts(p["commodities"], 12),
    recent: sampleList(p["recent"], 12),
    anomalies: compact(arr(p["anomalies"]).map(parseAnomaly)),
    repeatThemes: labelled(p["repeat_themes"]),
    themes: labelled(p["themes"]),
    medianGapDays: num(p["median_gap_days"], 0, 20000),
    suppliers: [
      ...arr(p["suppliers_named"]).map((x) => (typeof x === "string" ? x : obj(x)?.["supplier"])),
    ]
      .map((s) => str(s, 200))
      .filter((s): s is string => !!s)
      .slice(0, 10),
    members: sampleList(p["members"], 60),
    membersTotal: num(p["members_total"]),
    spanDays: num(p["span_days"], 0, 3650),
    reading: str(p["reading"], 400),
  };
}

/** Lists keep only what the list rows show; the full record is read when one is opened. */
function listView(item: RecallItem): RecallItem {
  return {
    ...item,
    recent: [],
    members: [],
    anomalies: [],
    commodities: item.commodities.slice(0, 3),
  };
}

export const getRecallDomain = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({ domain: z.enum(RECALL_DOMAINS) })
      .strict()
      .parse(d),
  )
  .handler(async ({ data }): Promise<RecallDomainData> => {
    const [overview, items, suppliers] = await Promise.all([
      restGet<{ p: unknown }[]>(
        `corpus_records?select=p:item->profile&dataset=eq.recall_patterns&id=eq.${data.domain}:overview&limit=1`,
      ),
      restGet<{ id: string; p: unknown }[]>(
        `corpus_records?select=id,p:item->profile&dataset=eq.recall_patterns&item->profile->>domain=eq.${data.domain}&item->profile->>kind=in.(theme,firm,cluster)&limit=400`,
      ),
      restGet<{ id: string; p: unknown }[]>(
        `corpus_records?select=id,p:item->profile&dataset=eq.recall_patterns&item->profile->>kind=eq.supplier&limit=200`,
      ),
    ]);
    let dropped = 0;
    const parsed: RecallItem[] = [];
    for (const row of items.rows) {
      const item = parseItem(row.id, row.p, data.domain);
      if (item) parsed.push(listView(item));
      else dropped += 1;
    }
    const supplierItems: RecallItem[] = [];
    for (const row of suppliers.rows) {
      const p = obj(row.p);
      const domains = arr(p?.["domains"]);
      const item = parseItem(row.id, row.p);
      if (!item) {
        dropped += 1;
        continue;
      }
      const ov = overview.rows[0] ? obj(overview.rows[0].p) : null;
      if (ov && domains.includes(ov["domain_label"])) supplierItems.push(listView(item));
    }
    const byEvents = (a: RecallItem, b: RecallItem) => b.events - a.events;
    return {
      overview: overview.rows[0] ? parseOverview(overview.rows[0].p, data.domain) : null,
      themes: parsed.filter((i) => i.kind === "theme").sort(byEvents),
      firms: parsed.filter((i) => i.kind === "firm").sort(byEvents),
      clusters: parsed
        .filter((i) => i.kind === "cluster")
        .sort((a, b) => (b.firms ?? 0) - (a.firms ?? 0) || byEvents(a, b)),
      suppliers: supplierItems.sort((a, b) => (b.firms ?? 0) - (a.firms ?? 0)),
      dropped,
    };
  });

export const getRecallRecord = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({ id: z.string().regex(ID) })
      .strict()
      .parse(d),
  )
  .handler(async ({ data }): Promise<RecallItem | null> => {
    const r = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.recall_patterns&id=eq.${encodeURIComponent(data.id)}&limit=1`,
    );
    return r.rows[0] ? parseItem(data.id, r.rows[0].p) : null;
  });

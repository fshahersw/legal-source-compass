/**
 * Federal agency profiles, Federal Register activity, Unified Agenda pipeline, budget and state spending, built by
 * scripts/enrichment/agencies_fr from the Federal Register API, eCFR, reginfo.gov, USAspending, the Census Bureau
 * and the U.S. Government Manual. Stored JSON is validated here: malformed values are dropped (never repaired),
 * external links are kept only on the official hosts each source uses, in-app links only in known shapes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

export const DOC_TYPES = ["RULE", "PRORULE", "NOTICE", "PRESDOCU"] as const;
export type DocType = (typeof DOC_TYPES)[number];
export type Series = Record<string, number>;
export type AgencyKind = "department" | "component" | "independent";

export type FrDoc = {
  title: string;
  date: string | null;
  type: string | null;
  citation: string | null;
  url: string;
  documentNumber: string | null;
  cfr: string[];
  rins: string[];
  effectiveOn: string | null;
  commentsCloseOn: string | null;
  dockets: string[];
  abstract: string | null;
  significant: boolean | null;
};

export type AdminRow = {
  key: string;
  label: string;
  president: string;
  start: string;
  end: string;
  days: number;
  current: boolean;
  ALL: number | null;
  RULE: number;
  PRORULE: number;
  NOTICE: number;
  PRESDOCU: number | null;
  executiveOrders: number | null;
  significantRules: number;
  rulesPerYear: number | null;
  significantRulesPerYear: number | null;
  executiveOrdersPerYear: number | null;
};

export type OpenComments = {
  asOf: string;
  count: number;
  closingWithin30Days: number;
  byType: Record<string, number>;
  items: FrDoc[];
};

export type AgendaAction = {
  action: string;
  date: string | null;
  month: string | null;
  passed: boolean;
};
export type AgendaItem = {
  rin: string;
  title: string;
  stage: string;
  priority: string;
  major: string;
  agency: string;
  nextAction: AgendaAction | null;
  regulatoryPlan: boolean;
  url: string;
};
export type AgendaSummary = {
  total: number;
  byStage: Record<string, number>;
  byPriority: Record<string, number>;
  major: number;
  regulatoryPlan: number;
  withLegalDeadline: number;
  withNextAction: number;
  edition: string;
  runDate: string | null;
  items: AgendaItem[];
};

export type AgencyTrends = {
  asOf: string;
  partialYear: string;
  partialMonth: string;
  yearly: Record<"ALL" | DocType, Series>;
  monthly: Record<"RULE" | "PRORULE" | "NOTICE", Series>;
  byAdministration: AdminRow[];
  significantYearly: { RULE: Series; PRORULE: Series };
  significantTotals: { RULE: number; PRORULE: number };
  latestSignificantRules: FrDoc[];
  latestSignificantProposed: FrDoc[];
  openComments: OpenComments;
  /** Agency final rules as a percent of all final rules published that year (last complete year only). */
  shareOfFinalRules: Record<string, number>;
};

export type ExecutiveOrder = {
  number: string;
  title: string;
  signed: string;
  president: string | null;
  citation: string | null;
  url: string;
};
export type RegisterOverview = AgencyTrends & {
  presidentialYearly: Record<string, Series>;
  executiveOrders: { total: number; yearly: Series; latest: ExecutiveOrder[] };
  topAgencies: {
    year: string;
    rows: { agencyId: number; name: string; kind: AgencyKind; rules: number }[];
  };
  agenda: AgendaSummary | null;
};

export type CfrRef = {
  title: number;
  titleName: string | null;
  chapter: string | null;
  url: string;
};
export type CfrPart = {
  title: number;
  part: string;
  docs: number;
  rules: number;
  first: string;
  last: string;
  url: string;
};
export type InAppLink = {
  to: "/safety" | "/law/enforcement" | "/companies";
  search: Record<string, string>;
};

export type AgencyStats = {
  kind: AgencyKind;
  parentId: number | null;
  childCount: number;
  documentsSince1994: number;
  rulesLastYear: number;
  proposedLastYear: number;
  noticesLastYear: number;
  rulesThisYear: number;
  significantRules: number;
  openComments: number;
  agendaActions: number;
  agendaEconomicallySignificant: number;
  obligationsLatestFy: number | null;
  budgetaryResourcesLatestFy: number | null;
  lastActiveYear: string | null;
  lastFullYear: string;
  latestFy: number;
};

export type AgencyProfile = {
  id: number;
  name: string;
  shortName: string | null;
  slug: string;
  kind: AgencyKind;
  parent: { id: number; name: string } | null;
  children: { id: number; name: string }[];
  description: string | null;
  frUrl: string;
  agencyUrl: string | null;
  ecfr: { refs: CfrRef[] } | null;
  cfrParts: {
    distinctParts: number;
    distinctTitles: number;
    top: CfrPart[];
    titles: { title: number; titleName: string | null; partCitations: number }[];
    corpusRange: [string, string] | null;
  } | null;
  govman: {
    name: string;
    category: string;
    mission: string | null;
    website: string | null;
    /** Sub-entities the Manual describes under this agency (its own headings). */
    components: string[];
    legalAuthority: string | null;
    edition: string;
    sourceUrl: string;
    pageUrl: string;
  } | null;
  usaspending: {
    toptierCode: string;
    name: string;
    abbreviation: string | null;
    mission: string | null;
    website: string | null;
    congressionalJustificationUrl: string | null;
    usaspendingUrl: string | null;
  } | null;
  subtierObligations: {
    name: string;
    obligations: number;
    fy: number;
    parentToptierCode: string;
  } | null;
  agenda: AgendaSummary | null;
  enforcement: {
    page: InAppLink | null;
    datasets: { id: string; label: string; records: number }[];
  } | null;
  stats: AgencyStats;
};

export type BudgetYear = {
  fy: number;
  budgetaryResources: number | null;
  obligated: number | null;
  outlayed: number | null;
  sharePct: number | null;
  latestPeriod: number | null;
  partial: boolean;
  obligatedChangePct: number | null;
};
export type AgencyBudget = {
  toptierCode: string;
  name: string;
  years: BudgetYear[];
  subAgencies: {
    name: string;
    obligations: number;
    transactions: number | null;
    newAwards: number | null;
    frAgencyId: number | null;
  }[];
  subAgencyCount: number;
  usaspendingUrl: string | null;
};
export type StateSpending = {
  code: string;
  name: string;
  fy2025: number;
  fy2024: number | null;
  changePct: number | null;
  population2025: number | null;
  perResident: number | null;
  perResidentRank: number | null;
  sharePct: number | null;
};
export type AgencySpending = {
  toptierCode: string;
  name: string;
  fiscalYear: number;
  total: number;
  total2024: number | null;
  statesWithSpending: number;
  medianPerResidentStates: number | null;
  states: StateSpending[];
  denominator: { measure: string; source: string; year: number } | null;
};

export type AgencyProfileData = {
  profile: AgencyProfile | null;
  trends: AgencyTrends | null;
  budget: AgencyBudget | null;
  spending: AgencySpending | null;
};

export type DirectoryRow = AgencyStats & { id: number; name: string; shortName: string | null };
export type AgencyDirectory = { asOf: string | null; rows: DirectoryRow[] };

// ---------------------------------------------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------------------------------------------
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strOrNull = (v: unknown): string | null => str(v) || null;
const isoDate = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
const strings = (v: unknown, max = 12): string[] =>
  arr(v)
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .slice(0, max);

const OFFICIAL: Record<string, RegExp> = {
  fr: /^https:\/\/www\.federalregister\.gov\//,
  reginfo: /^https:\/\/www\.reginfo\.gov\/public\//,
  ecfr: /^https:\/\/www\.ecfr\.gov\/current\//,
  usaspending: /^https:\/\/(www\.usaspending\.gov|api\.usaspending\.gov)\//,
  govinfo: /^https:\/\/www\.govinfo\.gov\//,
  census: /^https:\/\/www2?\.census\.gov\//,
};
const official = (v: unknown, host: keyof typeof OFFICIAL): string | null => {
  const s = str(v);
  return OFFICIAL[host]!.test(s) ? s : null;
};
/** An agency's own website as recorded by an official source; plain http(s) only, no credentials or scripts. */
export function webUrl(v: unknown): string | null {
  const s = str(v);
  if (!/^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s"'<>]*)?$/i.test(s)) return null;
  return s;
}

export function series(raw: unknown, pattern = /^\d{4}(-\d{2})?$/): Series {
  const out: Series = {};
  const o = obj(raw);
  if (o)
    for (const [k, v] of Object.entries(o))
      if (pattern.test(k) && count(v) != null) out[k] = v as number;
  return out;
}

function parseDoc(raw: unknown): FrDoc | null {
  const d = obj(raw);
  const url = official(d?.["url"], "fr");
  if (!d || !url) return null;
  return {
    title: str(d["title"]) || "Not recorded",
    date: isoDate(d["date"]),
    type: strOrNull(d["type"]),
    citation: strOrNull(d["citation"]),
    url,
    documentNumber: strOrNull(d["documentNumber"]),
    cfr: strings(d["cfr"], 8),
    rins: strings(d["rins"], 4).filter((r) => /^\d{4}-[A-Z]{2}\d{2}$/.test(r)),
    effectiveOn: isoDate(d["effectiveOn"]),
    commentsCloseOn: isoDate(d["commentsCloseOn"]),
    dockets: strings(d["dockets"], 3),
    abstract: strOrNull(d["abstract"]),
    significant: typeof d["significant"] === "boolean" ? d["significant"] : null,
  };
}
const docs = (v: unknown, max = 40) =>
  arr(v)
    .map(parseDoc)
    .filter((d): d is FrDoc => d !== null)
    .slice(0, max);

function parseAdmin(raw: unknown): AdminRow | null {
  const r = obj(raw);
  if (!r) return null;
  const start = isoDate(r["start"]);
  const end = isoDate(r["end"]);
  const days = count(r["days"]);
  const RULE = count(r["RULE"]);
  if (!str(r["key"]) || !start || !end || !days || RULE == null) return null;
  return {
    key: str(r["key"]),
    label: str(r["label"]) || str(r["key"]),
    president: str(r["president"]),
    start,
    end,
    days,
    current: r["current"] === true,
    ALL: count(r["ALL"]),
    RULE,
    PRORULE: count(r["PRORULE"]) ?? 0,
    NOTICE: count(r["NOTICE"]) ?? 0,
    PRESDOCU: count(r["PRESDOCU"]),
    executiveOrders: count(r["executiveOrders"]),
    significantRules: count(r["significantRules"]) ?? 0,
    rulesPerYear: num(r["rulesPerYear"]),
    significantRulesPerYear: num(r["significantRulesPerYear"]),
    executiveOrdersPerYear: num(r["executiveOrdersPerYear"]),
  };
}

function parseComments(raw: unknown, asOf: string): OpenComments {
  const c = obj(raw);
  const byType: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(c?.["byType"]) ?? {}))
    if (count(v) != null) byType[k] = v as number;
  return {
    asOf: isoDate(c?.["asOf"]) ?? asOf,
    count: count(c?.["count"]) ?? 0,
    closingWithin30Days: count(c?.["closingWithin30Days"]) ?? 0,
    byType,
    items: docs(c?.["items"], 40),
  };
}

const RIN = /^\d{4}-[A-Z]{2}\d{2}$/;
function parseAgendaItem(raw: unknown): AgendaItem | null {
  const r = obj(raw);
  const rin = str(r?.["rin"]);
  const url = official(r?.["url"], "reginfo");
  if (!r || !RIN.test(rin) || !url) return null;
  const n = obj(r["nextAction"]);
  return {
    rin,
    title: str(r["title"]) || rin,
    stage: str(r["stage"]) || "Not recorded",
    priority: str(r["priority"]) || "Not recorded",
    major: str(r["major"]) || "Not recorded",
    agency: str(r["agency"]),
    nextAction:
      n && str(n["action"])
        ? {
            action: str(n["action"]),
            date: strOrNull(n["date"]),
            month: /^\d{4}-\d{2}$/.test(str(n["month"])) ? str(n["month"]) : null,
            passed: n["passed"] === true,
          }
        : null,
    regulatoryPlan: r["regulatoryPlan"] === true,
    url,
  };
}

function countMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(raw) ?? {})) if (count(v) != null) out[k] = v as number;
  return out;
}

export function parseAgendaSummary(raw: unknown): AgendaSummary | null {
  const a = obj(raw);
  const total = count(a?.["total"]);
  if (!a || total == null) return null;
  return {
    total,
    byStage: countMap(a["byStage"]),
    byPriority: countMap(a["byPriority"]),
    major: count(a["major"]) ?? 0,
    regulatoryPlan: count(a["regulatoryPlan"]) ?? 0,
    withLegalDeadline: count(a["withLegalDeadline"]) ?? 0,
    withNextAction: count(a["withNextAction"]) ?? 0,
    edition: str(a["edition"]) || "Not recorded",
    runDate: strOrNull(a["runDate"]),
    items: arr(a["items"])
      .map(parseAgendaItem)
      .filter((x): x is AgendaItem => x !== null)
      .slice(0, 24),
  };
}

/** Validate one stored trends record; a record without its yearly series is dropped. */
export function parseTrends(raw: unknown): AgencyTrends | null {
  const t = obj(raw);
  const asOf = isoDate(t?.["asOf"]);
  const yearly = obj(t?.["yearly"]);
  if (!t || !asOf || !yearly) return null;
  const monthly = obj(t["monthly"]) ?? {};
  const sig = obj(t["significantYearly"]) ?? {};
  const totals = obj(t["significantTotals"]) ?? {};
  return {
    asOf,
    partialYear: /^\d{4}$/.test(str(t["partialYear"])) ? str(t["partialYear"]) : asOf.slice(0, 4),
    partialMonth: /^\d{4}-\d{2}$/.test(str(t["partialMonth"]))
      ? str(t["partialMonth"])
      : asOf.slice(0, 7),
    yearly: {
      ALL: series(yearly["ALL"], /^\d{4}$/),
      RULE: series(yearly["RULE"], /^\d{4}$/),
      PRORULE: series(yearly["PRORULE"], /^\d{4}$/),
      NOTICE: series(yearly["NOTICE"], /^\d{4}$/),
      PRESDOCU: series(yearly["PRESDOCU"], /^\d{4}$/),
    },
    monthly: {
      RULE: series(monthly["RULE"], /^\d{4}-\d{2}$/),
      PRORULE: series(monthly["PRORULE"], /^\d{4}-\d{2}$/),
      NOTICE: series(monthly["NOTICE"], /^\d{4}-\d{2}$/),
    },
    byAdministration: arr(t["byAdministration"])
      .map(parseAdmin)
      .filter((x): x is AdminRow => x !== null),
    significantYearly: {
      RULE: series(sig["RULE"], /^\d{4}$/),
      PRORULE: series(sig["PRORULE"], /^\d{4}$/),
    },
    significantTotals: { RULE: count(totals["RULE"]) ?? 0, PRORULE: count(totals["PRORULE"]) ?? 0 },
    latestSignificantRules: docs(t["latestSignificantRules"], 12),
    latestSignificantProposed: docs(t["latestSignificantProposed"], 6),
    openComments: parseComments(t["openComments"], asOf),
    shareOfFinalRules: Object.fromEntries(
      Object.entries(obj(t["shareOfFinalRules"]) ?? {}).flatMap(([k, v]) =>
        /^\d{4}$/.test(k) && num(v) != null && (v as number) >= 0 && (v as number) <= 100
          ? [[k, v as number]]
          : [],
      ),
    ),
  };
}

export function parseOverview(raw: unknown): RegisterOverview | null {
  const base = parseTrends(raw);
  const t = obj(raw);
  if (!base || !t) return null;
  const pres: Record<string, Series> = {};
  for (const [k, v] of Object.entries(obj(t["presidentialYearly"]) ?? {}))
    if (/^[a-z_]+$/.test(k)) pres[k] = series(v, /^\d{4}$/);
  const eo = obj(t["executiveOrders"]) ?? {};
  const top = obj(t["topAgenciesByRules"]) ?? {};
  return {
    ...base,
    presidentialYearly: pres,
    executiveOrders: {
      total: count(eo["total"]) ?? 0,
      yearly: series(eo["yearly"], /^\d{4}$/),
      latest: arr(eo["latest"]).flatMap((x) => {
        const e = obj(x);
        const url = official(e?.["url"], "fr");
        const signed = isoDate(e?.["signed"]);
        if (!e || !url || !signed || !str(e["number"])) return [];
        return [
          {
            number: str(e["number"]),
            title: str(e["title"]) || "Not recorded",
            signed,
            president: strOrNull(e["president"]),
            citation: strOrNull(e["citation"]),
            url,
          },
        ];
      }),
    },
    topAgencies: {
      year: str(top["year"]),
      rows: arr(top["rows"]).flatMap((x) => {
        const r = obj(x);
        const id = count(r?.["agencyId"]);
        const rules = count(r?.["rules"]);
        const kind = str(r?.["kind"]);
        if (!r || id == null || rules == null || !str(r["name"])) return [];
        return [
          {
            agencyId: id,
            name: str(r["name"]),
            kind: (kind === "department" || kind === "component"
              ? kind
              : "independent") as AgencyKind,
            rules,
          },
        ];
      }),
    },
    agenda: parseAgendaSummary(t["agenda"]),
  };
}

const KINDS = new Set(["department", "component", "independent"]);
export function parseStats(raw: unknown): AgencyStats | null {
  const s = obj(raw);
  const kind = str(s?.["kind"]);
  if (!s || !KINDS.has(kind)) return null;
  return {
    kind: kind as AgencyKind,
    parentId: count(s["parentId"]),
    childCount: count(s["childCount"]) ?? 0,
    documentsSince1994: count(s["documentsSince1994"]) ?? 0,
    rulesLastYear: count(s["rulesLastYear"]) ?? 0,
    proposedLastYear: count(s["proposedLastYear"]) ?? 0,
    noticesLastYear: count(s["noticesLastYear"]) ?? 0,
    rulesThisYear: count(s["rulesThisYear"]) ?? 0,
    significantRules: count(s["significantRules"]) ?? 0,
    openComments: count(s["openComments"]) ?? 0,
    agendaActions: count(s["agendaActions"]) ?? 0,
    agendaEconomicallySignificant: count(s["agendaEconomicallySignificant"]) ?? 0,
    obligationsLatestFy: num(s["obligationsLatestFy"]),
    budgetaryResourcesLatestFy: num(s["budgetaryResourcesLatestFy"]),
    lastActiveYear: /^\d{4}$/.test(str(s["lastActiveYear"])) ? str(s["lastActiveYear"]) : null,
    lastFullYear: /^\d{4}$/.test(str(s["lastFullYear"])) ? str(s["lastFullYear"]) : "Not recorded",
    latestFy: count(s["latestFy"]) ?? 0,
  };
}

const IN_APP_TARGETS = new Set(["/safety", "/law/enforcement", "/companies"]);
function parseInApp(raw: unknown): InAppLink | null {
  const r = obj(raw);
  const to = str(r?.["to"]);
  if (!r || !IN_APP_TARGETS.has(to)) return null;
  const search: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(r["search"]) ?? {}))
    if (/^[a-z]+$/.test(k) && typeof v === "string" && /^[A-Za-z]{1,12}$/.test(v)) search[k] = v;
  return { to: to as InAppLink["to"], search };
}

export function parseProfile(raw: unknown): AgencyProfile | null {
  const p = obj(raw);
  const id = count(p?.["id"]);
  const name = str(p?.["name"]);
  const stats = parseStats(p?.["stats"]);
  const frUrl = official(p?.["frUrl"], "fr");
  if (!p || id == null || !name || !stats || !frUrl) return null;
  const parent = obj(p["parent"]);
  const ecfr = obj(p["ecfr"]);
  const parts = obj(p["cfrParts"]);
  const gm = obj(p["govman"]);
  const usa = obj(p["usaspending"]);
  const sub = obj(p["subtierObligations"]);
  const enf = obj(p["enforcement"]);
  const range = arr(parts?.["corpusRange"]).map(isoDate);
  return {
    id,
    name,
    shortName: strOrNull(p["shortName"]),
    slug: str(p["slug"]),
    kind: stats.kind,
    parent:
      parent && count(parent["id"]) != null && str(parent["name"])
        ? { id: count(parent["id"])!, name: str(parent["name"]) }
        : null,
    children: arr(p["children"]).flatMap((c) => {
      const o = obj(c);
      return o && count(o["id"]) != null && str(o["name"])
        ? [{ id: count(o["id"])!, name: str(o["name"]) }]
        : [];
    }),
    description: strOrNull(p["description"]),
    frUrl,
    agencyUrl: webUrl(p["agencyUrl"]),
    ecfr: ecfr
      ? {
          refs: arr(ecfr["refs"]).flatMap((r) => {
            const o = obj(r);
            const title = count(o?.["title"]);
            const url = official(o?.["url"], "ecfr");
            return o && title != null && url
              ? [
                  {
                    title,
                    titleName: strOrNull(o["titleName"]),
                    chapter: strOrNull(o["chapter"]),
                    url,
                  },
                ]
              : [];
          }),
        }
      : null,
    cfrParts: parts
      ? {
          distinctParts: count(parts["distinctParts"]) ?? 0,
          distinctTitles: count(parts["distinctTitles"]) ?? 0,
          top: arr(parts["top"]).flatMap((r) => {
            const o = obj(r);
            const title = count(o?.["title"]);
            const docsN = count(o?.["docs"]);
            const url = official(o?.["url"], "ecfr");
            const part = str(o?.["part"]);
            return o && title != null && docsN != null && url && /^[0-9A-Za-z.-]{1,12}$/.test(part)
              ? [
                  {
                    title,
                    part,
                    docs: docsN,
                    rules: count(o["rules"]) ?? 0,
                    first: str(o["first"]),
                    last: str(o["last"]),
                    url,
                  },
                ]
              : [];
          }),
          titles: arr(parts["titles"]).flatMap((r) => {
            const o = obj(r);
            const title = count(o?.["title"]);
            const n = count(o?.["partCitations"]);
            return o && title != null && n != null
              ? [{ title, titleName: strOrNull(o["titleName"]), partCitations: n }]
              : [];
          }),
          corpusRange: range.length === 2 && range[0] && range[1] ? [range[0], range[1]] : null,
        }
      : null,
    govman:
      gm && official(gm["sourceUrl"], "govinfo") && official(gm["pageUrl"], "govinfo")
        ? {
            name: str(gm["name"]),
            category: str(gm["category"]),
            mission: strOrNull(gm["mission"]),
            website: webUrl(gm["website"]),
            components: strings(gm["components"], 40),
            legalAuthority: strOrNull(gm["legalAuthority"]),
            edition: isoDate(gm["edition"]) ?? "Not recorded",
            sourceUrl: official(gm["sourceUrl"], "govinfo")!,
            pageUrl: official(gm["pageUrl"], "govinfo")!,
          }
        : null,
    usaspending:
      usa && /^\d{3,4}$/.test(str(usa["toptierCode"]))
        ? {
            toptierCode: str(usa["toptierCode"]),
            name: str(usa["name"]),
            abbreviation: strOrNull(usa["abbreviation"]),
            mission: strOrNull(usa["mission"]),
            website: webUrl(usa["website"]),
            congressionalJustificationUrl: webUrl(usa["congressionalJustificationUrl"]),
            usaspendingUrl: official(usa["usaspendingUrl"], "usaspending"),
          }
        : null,
    subtierObligations:
      sub && num(sub["obligations"]) != null && /^\d{3,4}$/.test(str(sub["parentToptierCode"]))
        ? {
            name: str(sub["name"]),
            obligations: num(sub["obligations"])!,
            fy: count(sub["fy"]) ?? 0,
            parentToptierCode: str(sub["parentToptierCode"]),
          }
        : null,
    agenda: parseAgendaSummary(p["agenda"]),
    enforcement: enf
      ? {
          page: parseInApp(enf["page"]),
          datasets: arr(enf["datasets"]).flatMap((d) => {
            const o = obj(d);
            const dsId = str(o?.["id"]);
            const records = count(o?.["records"]);
            return o && /^[a-z0-9_]{1,80}$/.test(dsId) && records != null
              ? [{ id: dsId, label: str(o["label"]) || dsId, records }]
              : [];
          }),
        }
      : null,
    stats,
  };
}

export function parseBudget(raw: unknown): AgencyBudget | null {
  const b = obj(raw);
  const code = str(b?.["toptierCode"]);
  if (!b || !/^\d{3,4}$/.test(code)) return null;
  return {
    toptierCode: code,
    name: str(b["name"]),
    years: arr(b["years"])
      .flatMap((y) => {
        const o = obj(y);
        const fy = count(o?.["fy"]);
        if (!o || fy == null || fy < 2000 || fy > 2100) return [];
        return [
          {
            fy,
            budgetaryResources: num(o["budgetaryResources"]),
            obligated: num(o["obligated"]),
            outlayed: num(o["outlayed"]),
            sharePct: num(o["sharePct"]),
            latestPeriod: count(o["latestPeriod"]),
            partial: o["partial"] === true,
            obligatedChangePct: num(o["obligatedChangePct"]),
          },
        ];
      })
      .sort((a, c) => a.fy - c.fy),
    subAgencies: arr(b["subAgencies"]).flatMap((s) => {
      const o = obj(s);
      const ob = num(o?.["obligations"]);
      if (!o || !str(o["name"]) || ob == null) return [];
      return [
        {
          name: str(o["name"]),
          obligations: ob,
          transactions: count(o["transactions"]),
          newAwards: count(o["newAwards"]),
          frAgencyId: count(o["frAgencyId"]),
        },
      ];
    }),
    subAgencyCount: count(b["subAgencyCount"]) ?? 0,
    usaspendingUrl: official(b["usaspendingUrl"], "usaspending"),
  };
}

export function parseSpending(raw: unknown): AgencySpending | null {
  const s = obj(raw);
  const code = str(s?.["toptierCode"]);
  const total = num(s?.["total"]);
  if (!s || !/^\d{3,4}$/.test(code) || total == null) return null;
  const den = obj(s["denominator"]);
  const source = official(den?.["source"], "census");
  return {
    toptierCode: code,
    name: str(s["name"]),
    fiscalYear: count(s["fiscalYear"]) ?? 0,
    total,
    total2024: num(s["total2024"]),
    statesWithSpending: count(s["statesWithSpending"]) ?? 0,
    medianPerResidentStates: num(s["medianPerResidentStates"]),
    states: arr(s["states"]).flatMap((x) => {
      const o = obj(x);
      const st = str(o?.["code"]);
      const amount = num(o?.["fy2025"]);
      if (!o || !/^[A-Z]{2}$/.test(st) || amount == null) return [];
      return [
        {
          code: st,
          name: str(o["name"]) || st,
          fy2025: amount,
          fy2024: num(o["fy2024"]),
          changePct: num(o["changePct"]),
          population2025: count(o["population2025"]),
          perResident: num(o["perResident"]),
          perResidentRank: count(o["perResidentRank"]),
          sharePct: num(o["sharePct"]),
        },
      ];
    }),
    denominator:
      den && source
        ? { measure: str(den["measure"]), source, year: count(den["year"]) ?? 0 }
        : null,
  };
}

export function parseDirectory(rows: unknown[]): DirectoryRow[] {
  return rows.flatMap((r) => {
    const o = obj(r);
    const id = Number(str(o?.["id"]));
    const stats = parseStats(o?.["stats"]);
    const name = str(o?.["title"]);
    if (!o || !Number.isSafeInteger(id) || id <= 0 || !stats || !name) return [];
    return [{ ...stats, id, name, shortName: strOrNull(o["sub"]) }];
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------------------------------------------
const TTL = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  return value;
}

async function one(dataset: string, id: string, field: string): Promise<unknown> {
  const { rows } = await restGet<{ v: unknown }[]>(
    `corpus_records?select=v:item->${field}&dataset=eq.${dataset}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows[0]?.v ?? null;
}

/** Every Federal Register agency with its stored statistics; empty until the profiles dataset is published. */
export const listAgencyDirectory = createServerFn({ method: "GET" }).handler(
  async (): Promise<AgencyDirectory> =>
    cached("directory", async () => {
      const [records, catalog] = await Promise.all([
        restGet<unknown[]>(
          "corpus_records?select=id,title,sub:item->>subtitle,stats:item->stats&dataset=eq.fr_agency_profiles&order=ordinal.asc&limit=1000",
        ),
        restGet<{ asOf: unknown }[]>(
          "corpus_datasets?select=asOf:metadata->summary->>as_of&id=eq.fr_agency_profiles&limit=1",
        ),
      ]);
      return { asOf: isoDate(catalog.rows[0]?.asOf), rows: parseDirectory(records.rows) };
    }),
);

export const getAgencyProfile = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(/^\d{1,6}$/) }).parse(d))
  .handler(async ({ data }): Promise<AgencyProfileData> =>
    cached(`profile:${data.id}`, async () => {
      const [p, t] = await Promise.all([
        one("fr_agency_profiles", data.id, "profile"),
        one("fr_agency_trends", data.id, "trends"),
      ]);
      const profile = parseProfile(p);
      const code = profile?.usaspending?.toptierCode;
      const [b, s] = code
        ? await Promise.all([
            one("agency_budget_trends", code, "budget"),
            one("agency_spending_by_state", code, "spending"),
          ])
        : [null, null];
      return {
        profile,
        trends: parseTrends(t),
        budget: parseBudget(b),
        spending: parseSpending(s),
      };
    }),
  );

export const getRegisterOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<RegisterOverview | null> =>
    cached("overview", async () =>
      parseOverview(await one("fr_agency_trends", "federal-register", "trends")),
    ),
);

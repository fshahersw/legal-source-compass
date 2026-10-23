/**
 * Financial-regulatory records: Federal Reserve Board enforcement actions (frb_enforcement_actions), SEC broker-dealer lists
 * (sec_broker_dealers), SEC investment advisers (sec_investment_advisers) and SEC adviser statistics (sec_adviser_statistics).
 * Built by scripts/enrichment/regfin/*.
 *
 * Read-only. Stored JSON is validated here; malformed rows and values are dropped, never repaired. External links are kept
 * only for http(s) URLs; in-app links only for the shape /companies/<10-digit CIK>.
 *
 * Company matching on the page: broker-dealer and adviser records are keyed by CIK (exact); Federal Reserve records carry no
 * CIK, so a company matches only when its registrant name has the same normalised key as a banking organization (or an
 * individual's affiliation) and no other company_sec_profiles registrant shares that key.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CIK, webUrl } from "./enforcementActions.functions";
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
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;
const isoDate = (v: unknown) => {
  const s = str(v, 10);
  return s && ISO_DATE.test(s) ? s : null;
};
const isoMonth = (v: unknown) => {
  const s = str(v, 7);
  return s && ISO_MONTH.test(s) ? s : null;
};
const YEAR = /^(19|20)\d{2}$/;
const enc = encodeURIComponent;
const cs = (v: Record<string, string[]>) => enc(JSON.stringify(v));

export const PAGE_SIZE = 50;
export type Page<T> = { rows: T[]; total: number | null; page: number; pageSize: number };

/** The exact-key normalisation of scripts/enrichment/regfin/names.py (same as the enforcement_actions builders). */
const SUFFIXES = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "llc",
  "ltd",
  "limited",
  "plc",
  "sa",
  "ag",
  "nv",
  "the",
]);
export function companyKey(name: string | null | undefined): string {
  if (!name) return "";
  let s = name.replace(/\s*\/(?:[A-Za-z]{2,4})?\/?\s*$/, "");
  s = s.toLowerCase().replace(/&/g, " and ");
  s = s.replace(/[^\p{L}\p{N}_\s]/gu, " ");
  const tokens = s.split(/\s+/).filter(Boolean);
  while (tokens.length && tokens[0] === "the") tokens.shift();
  while (tokens.length && SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join(" ");
}

// ------------------------------------------------------------------- Federal Reserve actions

export const FRB_FAMILIES = [
  "Written agreements",
  "Cease-and-desist and consent orders",
  "Civil money penalties",
  "Prohibitions and suspensions",
  "Section 19 letters",
  "Prompt corrective action",
  "Notices of intent",
  "Amendments and modifications",
  "Other order types",
] as const;
export type FrbFamily = (typeof FRB_FAMILIES)[number];
const FAMILY_SET = new Set<string>(FRB_FAMILIES);

export type OrgSegment = {
  asWritten: string;
  name: string;
  location: string | null;
  key: string;
  match: { cik: string; registrant: string } | null;
};

function parseSegments(v: unknown): OrgSegment[] {
  return arr(v).flatMap((x) => {
    const o = obj(x);
    const asWritten = str(o?.["as_written"], 600);
    const name = str(o?.["name"], 600);
    if (!asWritten || !name) return [];
    const m = obj(o?.["match"]);
    const cik = str(m?.["cik"], 10);
    const registrant = str(m?.["registrant"], 200);
    return [
      {
        asWritten,
        name,
        location: str(o?.["location"], 200),
        key: str(o?.["key"], 300) ?? "",
        match: cik && CIK.test(cik) && registrant ? { cik, registrant } : null,
      },
    ];
  });
}

export type FrbAction = {
  /** Corpus record id, "frb:<Board id>". */
  id: string;
  effectiveDate: string;
  year: string;
  /** null = the Board publishes no termination date. */
  terminationDate: string | null;
  type: string;
  typeFamily: FrbFamily;
  subject: "organization" | "individual";
  individual: string | null;
  individualAffiliation: string | null;
  bankingOrganization: string | null;
  organizations: OrgSegment[];
  affiliations: OrgSegment[];
  /** The Board document for the action (press release, order, letter). */
  url: string | null;
  urlLabel: string | null;
  /** URL text the Board published that is not a usable link (shown as written). */
  urlUnresolved: string | null;
  note: string | null;
  noteLinks: { label: string; url: string }[];
  /** Source page for the record: the document when there is one, else the Board's search page. */
  sourceUrl: string;
};

export function parseFrbAction(row: {
  id?: unknown;
  source_url?: unknown;
  a?: unknown;
}): FrbAction | null {
  const id = str(row.id, 40);
  const a = obj(row.a);
  if (!id || !/^frb:\d+$/.test(id) || !a) return null;
  const effectiveDate = isoDate(a["effective_date"]);
  const type = str(a["type"], 300);
  const family = str(a["type_family"], 80);
  const subject = a["subject"];
  if (!effectiveDate || !type || !family || !FAMILY_SET.has(family)) return null;
  if (subject !== "organization" && subject !== "individual") return null;
  return {
    id,
    effectiveDate,
    year: effectiveDate.slice(0, 4),
    terminationDate: isoDate(a["termination_date"]),
    type,
    typeFamily: family as FrbFamily,
    subject,
    individual: str(a["individual"], 300),
    individualAffiliation: str(a["individual_affiliation"], 1200),
    bankingOrganization: str(a["banking_organization"], 2000),
    organizations: parseSegments(a["organizations"]),
    affiliations: parseSegments(a["affiliations"]),
    url: webUrl(a["url"]),
    urlLabel: str(a["url_label"], 100),
    urlUnresolved: str(a["url_unresolved"], 300),
    note: str(a["note"], 1500),
    noteLinks: arr(a["note_links"]).flatMap((x) => {
      const o = obj(x);
      const url = webUrl(o?.["url"]);
      const label = str(o?.["label"], 200);
      return url && label ? [{ label, url }] : [];
    }),
    sourceUrl:
      webUrl(row.source_url) ??
      "https://www.federalreserve.gov/supervisionreg/enforcementactions.htm",
  };
}

export type FrbOverview = {
  firstEffectiveDate: string;
  latestEffectiveDate: string;
  actions: number;
  /** year -> family -> rows of the Board's list effective that year. */
  byYearFamily: Record<string, Partial<Record<FrbFamily, number>>>;
  subjects: { organization: number; individual: number };
  countDefinition: string;
  /** The year that is not complete (the year of the latest effective date). */
  partialYear: string;
};

export function parseFrbOverview(raw: unknown): FrbOverview | null {
  const o = obj(raw);
  const first = isoDate(o?.["first_effective_date"]);
  const latest = isoDate(o?.["latest_effective_date"]);
  const actions = int(o?.["actions"]);
  const by = obj(o?.["by_year_family"]);
  if (!o || !first || !latest || actions == null || !by) return null;
  const byYearFamily: FrbOverview["byYearFamily"] = {};
  for (const [year, fams] of Object.entries(by)) {
    const f = obj(fams);
    if (!YEAR.test(year) || !f) continue;
    const row: Partial<Record<FrbFamily, number>> = {};
    for (const [fam, n] of Object.entries(f)) {
      const count = int(n);
      if (FAMILY_SET.has(fam) && count != null) row[fam as FrbFamily] = count;
    }
    byYearFamily[year] = row;
  }
  const subjects = obj(o["subjects"]);
  return {
    firstEffectiveDate: first,
    latestEffectiveDate: latest,
    actions,
    byYearFamily,
    subjects: {
      organization: int(subjects?.["organization"]) ?? 0,
      individual: int(subjects?.["individual"]) ?? 0,
    },
    countDefinition: str(o["count_definition"], 600) ?? "",
    partialYear: str(o["partial_year"], 4) ?? latest.slice(0, 4),
  };
}

const frbQuery = z.object({
  year: z.string().regex(YEAR).optional(),
  family: z.enum(FRB_FAMILIES).optional(),
  subject: z.enum(["organization", "individual"]).optional(),
  q: z.string().max(120).optional(),
  page: z.number().int().min(0).max(500).default(0),
});
export type FrbQuery = z.input<typeof frbQuery>;

const FRB_SELECT = "select=id,source_url,a:item->frb_action";

export function frbActionsPath(q: z.output<typeof frbQuery>): string {
  const parts = [FRB_SELECT, "dataset=eq.frb_enforcement_actions"];
  const containment: Record<string, string[]> = { _listing: ["yes"] };
  if (q.year) containment["year"] = [q.year];
  if (q.family) containment["type_family"] = [q.family];
  if (q.subject) containment["subject"] = [q.subject];
  parts.push(`filters=cs.${cs(containment)}`);
  const term = q.q?.trim();
  if (term && term.length >= 2) {
    const t = ilikeTerm(term);
    parts.push(`or=(title.ilike.${t},text.ilike.${t})`);
  }
  parts.push("order=ordinal.asc");
  return `corpus_records?${parts.join("&")}`;
}

// ---------------------------------------------------------------------------- overview cache

let overviewCache: { at: number; value: unknown } | null = null;
const OVERVIEW_TTL = 10 * 60 * 1000;

async function cachedOverviews(): Promise<{
  frb: FrbOverview | null;
  bd: BdOverview | null;
  tab11: AdviserTable | null;
  tab21: AdviserTable | null;
  tab111: AdviserTable | null;
}> {
  if (overviewCache && Date.now() - overviewCache.at < OVERVIEW_TTL)
    return overviewCache.value as Awaited<ReturnType<typeof cachedOverviews>>;
  const ov = (dataset: string) =>
    restGet<{ o: unknown }[]>(
      `corpus_records?select=o:item->overview&dataset=eq.${dataset}&id=eq.summary:overview&limit=1`,
    );
  const [frb, bd, tabs] = await Promise.all([
    ov("frb_enforcement_actions"),
    ov("sec_broker_dealers"),
    restGet<{ id: unknown; t: unknown }[]>(
      `corpus_records?select=id,t:item->adviser_table&dataset=eq.sec_adviser_statistics&id=in.(${["iastat:Tab.1.1", "iastat:Tab.2.1", "iastat:Tab.11.1"].map(enc).join(",")})`,
    ),
  ]);
  const table = (id: string) => parseAdviserTable(tabs.rows.find((r) => r.id === id)?.t);
  const value = {
    frb: parseFrbOverview(frb.rows[0]?.o),
    bd: parseBdOverview(bd.rows[0]?.o),
    tab11: table("iastat:Tab.1.1"),
    tab21: table("iastat:Tab.2.1"),
    tab111: table("iastat:Tab.11.1"),
  };
  if (value.frb || value.bd || value.tab11) overviewCache = { at: Date.now(), value };
  return value;
}

export const getFrbOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<FrbOverview | null> => (await cachedOverviews()).frb,
);

export const getFrbActions = createServerFn({ method: "GET" })
  .inputValidator((d: FrbQuery) => frbQuery.parse(d))
  .handler(async ({ data }): Promise<Page<FrbAction>> => {
    const start = data.page * PAGE_SIZE;
    const res = await restGet<{ id: unknown; source_url: unknown; a: unknown }[]>(
      frbActionsPath(data),
      {
        count: true,
        range: [start, start + PAGE_SIZE - 1],
      },
    );
    return {
      rows: res.rows.flatMap((r) => {
        const p = parseFrbAction(r);
        return p ? [p] : [];
      }),
      total: res.total,
      page: data.page,
      pageSize: PAGE_SIZE,
    };
  });

// -------------------------------------------------------------------------- broker-dealers

export type BrokerDealer = {
  id: string;
  cik: string;
  name: string;
  fileNumber: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  firstListed: string;
  lastListed: string;
  monthsListed: number;
  inLatestFile: boolean;
  latestFileMonth: string;
  nameHistory: { name: string; first: string; last: string }[];
  listingUrl: string;
};

export function parseBrokerDealer(row: {
  id?: unknown;
  source_url?: unknown;
  b?: unknown;
}): BrokerDealer | null {
  const id = str(row.id, 40);
  const b = obj(row.b);
  if (!id || !b) return null;
  const cik = str(b["cik"], 10);
  const name = str(b["name"], 200);
  const first = isoMonth(b["first_listed"]);
  const last = isoMonth(b["last_listed"]);
  const latest = isoMonth(b["latest_file_month"]);
  const months = int(b["months_listed"]);
  if (
    !cik ||
    !CIK.test(cik) ||
    id !== `bd:${cik}` ||
    !name ||
    !first ||
    !last ||
    !latest ||
    months == null
  )
    return null;
  const address = [b["address1"], b["address2"]].flatMap((x) => {
    const s = str(x, 200);
    return s ? [s.replace(/,\s*$/, "")] : [];
  });
  return {
    id,
    cik,
    name,
    fileNumber: str(b["file_number"], 40),
    address: address.length ? address.join(", ") : null,
    city: str(b["city"], 100),
    state: str(b["state"], 4),
    firstListed: first,
    lastListed: last,
    monthsListed: months,
    inLatestFile: b["in_latest_file"] === true,
    latestFileMonth: latest,
    nameHistory: arr(b["name_history"]).flatMap((x) => {
      const o = obj(x);
      const n = str(o?.["name"], 200);
      const f = isoMonth(o?.["first"]);
      const l = isoMonth(o?.["last"]);
      return n && f && l ? [{ name: n, first: f, last: l }] : [];
    }),
    listingUrl:
      webUrl(b["listing_url"]) ??
      webUrl(row.source_url) ??
      "https://www.sec.gov/foia/frequently-requested-documents/company-information-about-active-broker-dealers",
  };
}

export type BdOverview = {
  firstMonth: string;
  latestMonth: string;
  files: number;
  missingMonths: string[];
  series: { month: string; count: number }[];
  uniqueCiks: number;
  inLatestFile: number;
  countDefinition: string;
};

export function parseBdOverview(raw: unknown): BdOverview | null {
  const o = obj(raw);
  const first = isoMonth(o?.["first_month"]);
  const latest = isoMonth(o?.["latest_month"]);
  if (!o || !first || !latest) return null;
  const series = arr(o["series"]).flatMap((x) => {
    const s = obj(x);
    const month = isoMonth(s?.["month"]);
    const count = int(s?.["count"]);
    return month && count != null ? [{ month, count }] : [];
  });
  if (!series.length) return null;
  return {
    firstMonth: first,
    latestMonth: latest,
    files: int(o["files"]) ?? series.length,
    missingMonths: arr(o["missing_months"]).flatMap((m) => {
      const x = isoMonth(m);
      return x ? [x] : [];
    }),
    series,
    uniqueCiks: int(o["unique_ciks"]) ?? 0,
    inLatestFile: int(o["in_latest_file"]) ?? 0,
    countDefinition: str(o["count_definition"], 400) ?? "",
  };
}

// ----------------------------------------------------------------------- investment advisers

export type Adviser = {
  id: string;
  crd: string;
  firmType: "Registered" | "ERA";
  secNumber: string | null;
  cik: string | null;
  legalName: string;
  primaryBusinessName: string | null;
  status: string | null;
  statusEffectiveDate: string | null;
  latestAdvFilingDate: string | null;
  city: string | null;
  state: string | null;
  addressWithheld: boolean;
  website: string | null;
  /** Item 5.F.(2)(c), USD; null for exempt reporting advisers and when not recorded. */
  regulatoryAumUsd: number | null;
  accountsTotal: number | null;
  privateFunds: number | null;
  disclosureAny: "Y" | "N" | null;
  /** Item 11 questions answered Yes, with the SEC's count of disclosure pages when stated. */
  disclosureYesItems: { item: string; count: number | null }[];
  /** How the adviser matched this company: the CIK#, or an exact normalised legal name. */
  matchMethod: string | null;
  reportUrl: string;
};

export function parseAdviser(row: {
  id?: unknown;
  source_url?: unknown;
  a?: unknown;
}): Adviser | null {
  const id = str(row.id, 40);
  const a = obj(row.a);
  if (!id || !a) return null;
  const crd = str(a["crd"], 20);
  const legalName = str(a["legal_name"], 300);
  const firmType = a["firm_type"];
  if (!crd || id !== `ia:${crd}` || !legalName || (firmType !== "Registered" && firmType !== "ERA"))
    return null;
  const mo = obj(a["main_office"]);
  const cik = str(a["cik"], 10);
  const match = obj(a["profile_match"]);
  const disclosure = a["disclosure_any"];
  return {
    id,
    crd,
    firmType,
    secNumber: str(a["sec_number"], 30),
    cik: cik && CIK.test(cik) ? cik : null,
    legalName,
    primaryBusinessName: str(a["primary_business_name"], 300),
    status: str(a["status"], 80),
    statusEffectiveDate: isoDate(a["status_effective_date"]),
    latestAdvFilingDate: isoDate(a["latest_adv_filing_date"]),
    city: str(mo?.["city"], 100),
    state: str(mo?.["state"], 40),
    addressWithheld: mo?.["address_withheld"] === true,
    website: webUrl(a["website"]),
    regulatoryAumUsd: num(a["raum_total_usd"]),
    accountsTotal: int(a["accounts_total"]),
    privateFunds: int(a["private_funds_item_7b1"]),
    disclosureAny: disclosure === "Y" || disclosure === "N" ? disclosure : null,
    disclosureYesItems: arr(a["disclosure_yes_items"]).flatMap((x) => {
      const o = obj(x);
      const item = str(o?.["item"], 20);
      return item ? [{ item, count: int(o?.["count"]) }] : [];
    }),
    matchMethod: str(match?.["method"], 80),
    reportUrl:
      webUrl(row.source_url) ??
      "https://www.sec.gov/data-research/sec-markets-data/information-about-registered-investment-advisers-exempt-reporting-advisers",
  };
}

export type AdviserTable = {
  tab: string;
  title: string | null;
  years: number[];
  rows: { labels: string[]; values: (number | null)[] }[];
};

export function parseAdviserTable(raw: unknown): AdviserTable | null {
  const o = obj(raw);
  const tab = str(o?.["tab"], 20);
  const years = arr(o?.["years"]).flatMap((y) =>
    typeof y === "number" && Number.isInteger(y) ? [y] : [],
  );
  if (!o || !tab || !/^Tab\.\d+\.\d+$/.test(tab) || !years.length) return null;
  const rows = arr(o["rows"]).flatMap((r) => {
    const x = obj(r);
    const labels = arr(x?.["labels"]).map((l) => (typeof l === "string" ? l : ""));
    const values = arr(x?.["values"]).map((v) => num(v));
    return x && values.length === years.length ? [{ labels, values }] : [];
  });
  return { tab, title: str(o["title"], 300), years, rows };
}

// -------------------------------------------------------------------------------- company panel

export type CompanyRegulatory = {
  /** The key used for exact-name matching; null when the company is unknown or its key is shared by another registrant. */
  nameKey: string | null;
  nameKeyNote: "unknown" | "shared" | null;
  fedSubject: FrbAction[];
  fedAffiliation: FrbAction[];
  brokerDealers: BrokerDealer[];
  advisers: Adviser[];
  totals: {
    fedSubject: number | null;
    fedAffiliation: number | null;
    brokerDealers: number | null;
    advisers: number | null;
  };
};

let profileCache: { at: number; rows: { id: string; title: string }[] } | null = null;

async function profileNames(): Promise<{ id: string; title: string }[]> {
  if (profileCache && Date.now() - profileCache.at < OVERVIEW_TTL) return profileCache.rows;
  const res = await restGet<{ id: unknown; title: unknown }[]>(
    "corpus_records?select=id,title&dataset=eq.company_sec_profiles&limit=2000",
  );
  const rows = res.rows.flatMap((r) => {
    const id = str(r.id, 20);
    const title = str(r.title, 300);
    return id && CIK.test(id) && title ? [{ id, title }] : [];
  });
  if (rows.length) profileCache = { at: Date.now(), rows };
  return rows;
}

/** Key for a company's exact-name match: null when the CIK has no profile or another profile has the same key. */
export function matchKeyFor(
  cik: string,
  profiles: { id: string; title: string }[],
): { key: string | null; note: "unknown" | "shared" | null } {
  const own = profiles.find((p) => p.id === cik);
  if (!own) return { key: null, note: "unknown" };
  const key = companyKey(own.title);
  if (!key) return { key: null, note: "unknown" };
  const sharers = profiles.filter((p) => companyKey(p.title) === key);
  return sharers.length > 1 ? { key: null, note: "shared" } : { key, note: null };
}

export function companyRegulatoryPaths(cik: string, key: string | null) {
  const base = (
    dataset: string,
    select: string,
    filter: Record<string, string[]>,
    order: string,
    limit: number,
  ) =>
    `corpus_records?select=${select}&dataset=eq.${dataset}&filters=cs.${cs(filter)}&order=${order}&limit=${limit}`;
  return {
    fedSubject: key
      ? base(
          "frb_enforcement_actions",
          "id,source_url,a:item->frb_action",
          { name_key: [key] },
          "ordinal.asc",
          100,
        )
      : null,
    fedAffiliation: key
      ? base(
          "frb_enforcement_actions",
          "id,source_url,a:item->frb_action",
          { affiliation_key: [key] },
          "ordinal.asc",
          100,
        )
      : null,
    brokerDealers: base(
      "sec_broker_dealers",
      "id,source_url,b:item->broker_dealer",
      { company: [cik] },
      "ordinal.asc",
      20,
    ),
    advisers: base(
      "sec_investment_advisers",
      "id,source_url,a:item->investment_adviser",
      { company: [cik] },
      "ordinal.asc",
      50,
    ),
  };
}

export const getCompanyRegulatory = createServerFn({ method: "GET" })
  .inputValidator((d: { cik: string }) => z.object({ cik: z.string().regex(CIK) }).parse(d))
  .handler(async ({ data }): Promise<CompanyRegulatory> => {
    const profiles = await profileNames();
    const { key, note } = matchKeyFor(data.cik, profiles);
    const paths = companyRegulatoryPaths(data.cik, key);
    const none = Promise.resolve({
      rows: [] as { id: unknown; source_url: unknown; a: unknown }[],
      total: 0,
    });
    const [subject, affiliation, bds, ias] = await Promise.all([
      paths.fedSubject
        ? restGet<{ id: unknown; source_url: unknown; a: unknown }[]>(paths.fedSubject, {
            count: true,
          })
        : none,
      paths.fedAffiliation
        ? restGet<{ id: unknown; source_url: unknown; a: unknown }[]>(paths.fedAffiliation, {
            count: true,
          })
        : none,
      restGet<{ id: unknown; source_url: unknown; b: unknown }[]>(paths.brokerDealers, {
        count: true,
      }),
      restGet<{ id: unknown; source_url: unknown; a: unknown }[]>(paths.advisers, { count: true }),
    ]);
    const frb = (rows: { id: unknown; source_url: unknown; a: unknown }[]) =>
      rows
        .flatMap((r) => {
          const p = parseFrbAction(r);
          return p ? [p] : [];
        })
        .sort((x, y) => y.effectiveDate.localeCompare(x.effectiveDate));
    return {
      nameKey: key,
      nameKeyNote: note,
      fedSubject: frb(subject.rows),
      fedAffiliation: frb(affiliation.rows),
      brokerDealers: bds.rows.flatMap((r) => {
        const p = parseBrokerDealer(r);
        return p ? [p] : [];
      }),
      advisers: ias.rows.flatMap((r) => {
        const p = parseAdviser(r);
        return p ? [p] : [];
      }),
      totals: {
        fedSubject: subject.total,
        fedAffiliation: affiliation.total,
        brokerDealers: bds.total,
        advisers: ias.total,
      },
    };
  });

// ------------------------------------------------------------------------ registration trends

export type RegistrationTrends = {
  bd: BdOverview | null;
  /** Tab.1.1 (Number of SEC-registered investment advisers and exempt reporting advisers, by year). */
  advisersByYear: AdviserTable | null;
  /** Tab.2.1 (Aggregate regulatory assets under management reported by registered advisers, $ trillions). */
  raumByYear: AdviserTable | null;
  /** Tab.11.1 (advisers with disciplinary events reported, by disclosure type). */
  disciplinaryByYear: AdviserTable | null;
};

export const getRegistrationTrends = createServerFn({ method: "GET" }).handler(
  async (): Promise<RegistrationTrends> => {
    const o = await cachedOverviews();
    return { bd: o.bd, advisersByYear: o.tab11, raumByYear: o.tab21, disciplinaryByYear: o.tab111 };
  },
);

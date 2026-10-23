/**
 * Reads behind the profile trend cards: one reader per kind. Each does compact read-only selects of one MDL's record,
 * validates the stored JSON with the shared validators, and hands the rows to a pure builder. A reader returns null when
 * the record holds nothing to plot; a failed read throws and the card shows its error state with a retry. A record whose
 * own MDL number differs from the requested one is never used. Results are cached per profile. Server-only.
 */
import { restGet } from "@/lib/external/rest.server";
import { readAllRows } from "@/lib/analytics/tally.server";
import {
  arr,
  integer,
  isoDate,
  nonNegative,
  obj,
  text,
  year as yearOf,
} from "@/lib/analytics/parse";
import { throughDate, type TrendBlockData } from "@/lib/analytics/trend";
import { buildDocketEntriesMonthly } from "./entries";
import {
  buildMdlFjcYears,
  buildMdlFyPending,
  buildMdlMonthlyPending,
  buildMdlRegistryYears,
  type FiscalYearCases,
  type FiscalYearPending,
  type MonthlyReport,
  type YearCount,
} from "./mdl";
import { keyedMemo, type ProfileKind } from "./profile";

const TTL_MS = 30 * 60 * 1000;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const memo = keyedMemo<TrendBlockData | null>(TTL_MS, 400);
const hierarchyMemo = keyedMemo<Hierarchy | null>(TTL_MS, 100);

const rec = (dataset: string, id: string, select: string) =>
  `corpus_records?select=${select}&dataset=eq.${dataset}&id=eq.${encodeURIComponent(id)}&limit=1`;

/** `updated_at` of a dataset: when it was last loaded, so no figure in it is newer than this. */
async function publishedAt(dataset: string): Promise<string | null> {
  const r = await restGet<{ u: unknown }[]>(
    `corpus_datasets?select=u:updated_at&id=eq.${dataset}&limit=1`,
  );
  const v = text(r.rows[0]?.u);
  return v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

async function monthlyPending(key: string): Promise<TrendBlockData | null> {
  const mdl = Number(key);
  const r = await restGet<{ h: unknown }[]>(
    rec("jpml_pending_history_mdls", key, "h:item->history"),
  );
  const h = obj(r.rows[0]?.h);
  if (!h || integer(h["mdl"]) !== mdl) return null;
  const reports = arr(h["series"]).flatMap((p): MonthlyReport[] => {
    const o = obj(p);
    const month = text(o?.["month"]);
    return o && month && MONTH.test(month)
      ? [{ month, pending: nonNegative(o["pending"]), total: nonNegative(o["total"]) }]
      : [];
  });
  return buildMdlMonthlyPending({ mdl, reports, lastReportDate: isoDate(h["last_report"]) });
}

async function fyPending(key: string): Promise<TrendBlockData | null> {
  const mdl = Number(key);
  const r = await restGet<{ h: unknown }[]>(
    rec("jpml_statistics_extra", `mdl:${key}`, "h:item->fy_history"),
  );
  const h = obj(r.rows[0]?.h);
  if (!h || integer(h["mdl"]) !== mdl) return null;
  const rows = arr(h["series"]).flatMap((p): FiscalYearPending[] => {
    const o = obj(p);
    const fy = yearOf(o?.["fy"]);
    return o && fy !== null ? [{ fy, pending: nonNegative(o["pending"]) }] : [];
  });
  return buildMdlFyPending({ mdl, rows, leftCensored: h["left_censored"] === true });
}

async function fjcYears(key: string): Promise<TrendBlockData | null> {
  const mdl = Number(key);
  const [r, snap] = await Promise.all([
    restGet<{ p: unknown }[]>(rec("fjc_civil_mdls", `mdl:${key}`, "p:item->profile")),
    restGet<{ s: unknown }[]>(
      "corpus_datasets?select=s:metadata->summary->>snapshot&id=eq.fjc_civil_mdls&limit=1",
    ),
  ]);
  const p = obj(r.rows[0]?.p);
  if (!p || integer(p["mdl"]) !== mdl) return null;
  const rows = arr(p["by_fy"]).flatMap((e): FiscalYearCases[] => {
    const o = obj(e);
    const fy = yearOf(o?.["fy"]);
    const cases = nonNegative(o?.["cases"]);
    return fy !== null && cases !== null ? [{ fy, cases }] : [];
  });
  return buildMdlFjcYears({ mdl, rows, through: throughDate(text(snap.rows[0]?.s)) });
}

type Hierarchy = {
  members: YearCount[];
  origin: YearCount[];
  actions: number | null;
  originDockets: number | null;
  publishedOn: string | null;
};

const yearCounts = (v: unknown, field: string): YearCount[] =>
  arr(v).flatMap((e): YearCount[] => {
    const o = obj(e);
    const y = yearOf(o?.["year"]);
    const n = nonNegative(o?.[field]);
    return y !== null && n !== null && Number.isInteger(n) ? [{ year: y, n }] : [];
  });

function readHierarchy(key: string): Promise<Hierarchy | null> {
  return hierarchyMemo(key, async () => {
    const mdl = Number(key);
    const [r, publishedOn] = await Promise.all([
      restGet<{ mdl: unknown; m: unknown; o: unknown; a: unknown; od: unknown }[]>(
        rec(
          "mdl_hierarchy",
          `mdl:${key}`,
          "mdl:item->profile->mdl,m:item->profile->members_by_year,o:item->profile->origin->by_year,a:item->profile->actions,od:item->profile->origin->dockets",
        ),
      ),
      publishedAt("mdl_hierarchy"),
    ]);
    const row = r.rows[0];
    if (!row || integer(row.mdl) !== mdl) return null;
    return {
      members: yearCounts(row.m, "actions"),
      origin: yearCounts(row.o, "dockets"),
      actions: nonNegative(row.a),
      originDockets: nonNegative(row.od),
      publishedOn,
    };
  });
}

const registryPath = (key: string) => `/records/mdl_hierarchy/mdl:${key}`;
const yearOfDate = (d: string | null) => (d ? Number(d.slice(0, 4)) : null);

async function membersYears(key: string): Promise<TrendBlockData | null> {
  const h = await readHierarchy(key);
  if (!h) return null;
  return buildMdlRegistryYears({
    id: "mdl-members-years",
    mdl: Number(key),
    rows: h.members,
    unit: "actions",
    seriesLabel: "Member actions",
    publishedYear: yearOfDate(h.publishedOn),
    publishedOn: h.publishedOn,
    sourcePath: registryPath(key),
    total: h.actions,
    totalLabel: "member actions",
    extraNotes: [
      "An action here is a registry docket that counts as an action; a transferor docket and its transferee docket can both be listed.",
    ],
  });
}

async function transferredYears(key: string): Promise<TrendBlockData | null> {
  const h = await readHierarchy(key);
  if (!h) return null;
  return buildMdlRegistryYears({
    id: "mdl-transferred-years",
    mdl: Number(key),
    rows: h.origin,
    unit: "dockets",
    seriesLabel: "Dockets first filed elsewhere",
    publishedYear: yearOfDate(h.publishedOn),
    publishedOn: h.publishedOn,
    sourcePath: registryPath(key),
    total: h.originDockets,
    totalLabel: "originating dockets",
    extraNotes: [
      "A docket counts here when it is a transferor docket (a JPML schedule or conditional transfer order) or an FJC-recorded docket of the MDL in a court other than the transferee court. Most member cases are filed directly in the transferee court and are not counted.",
    ],
  });
}

async function docketEntries(key: string): Promise<TrendBlockData | null> {
  const mdl = Number(key);
  const filter = encodeURIComponent(JSON.stringify({ mdl: key }));
  const [matter, rows, published] = await Promise.all([
    restGet<{ c: unknown }[]>(rec("sw_matters_v1", `sw-matter:${key}`, "c:item->cells")),
    readAllRows<{ d: unknown }>(
      `corpus_records?select=d:item->cells->>date_filed&dataset=eq.sw_docket_entries_v1&filters=cs.${filter}&order=ordinal.asc,id.asc`,
    ),
    publishedAt("sw_docket_entries_v1"),
  ]);
  const cells = obj(matter.rows[0]?.c);
  if (!cells || integer(cells["mdl_number"]) !== mdl || !rows.length) return null;
  return buildDocketEntriesMonthly({
    mdl,
    dates: rows.map((r) => isoDate(r.d)),
    coverage: { captured: rows.length, providerTotal: nonNegative(cells["entries_total"]) },
    publishedMonth: published ? published.slice(0, 7) : null,
    sourceUrl: `/records/sw_matters_v1/sw-matter:${key}`,
  });
}

const READERS: Record<ProfileKind, (key: string) => Promise<TrendBlockData | null>> = {
  "mdl-monthly-pending": monthlyPending,
  "mdl-fy-pending": fyPending,
  "mdl-fjc-years": fjcYears,
  "mdl-members-years": membersYears,
  "mdl-transferred-years": transferredYears,
  "matter-docket-entries": docketEntries,
};

/** One profile's trend, or null when the corpus holds nothing to plot for it. */
export function readProfileTrend(kind: ProfileKind, key: string): Promise<TrendBlockData | null> {
  return memo(`${kind}:${key}`, () => READERS[kind](key));
}

/** Why a card is empty, in the words the card shows. */
export const EMPTY_REASON: Record<ProfileKind, string> = {
  "mdl-monthly-pending":
    "The Panel's monthly pending-MDL reports held in this corpus have no row for this MDL.",
  "mdl-fy-pending":
    "The Panel's fiscal-year statistics held in this corpus have no validated row for this MDL.",
  "mdl-fjc-years":
    "No civil case in the Federal Judicial Center's file carries this MDL docket number.",
  "mdl-members-years":
    "The matter registry records no member docket of this MDL with a filing year.",
  "mdl-transferred-years":
    "The registry records no member docket of this MDL that was first filed in another court.",
  "matter-docket-entries": "The matter registry holds no dated master-docket entry for this MDL.",
};

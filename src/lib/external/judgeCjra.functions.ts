/**
 * Civil Justice Reform Act (CJRA) semiannual counts for one judge (dataset court_cjra_judges, built by
 * scripts/enrichment/uscourts_cjra from the U.S. Courts CJRA Appendix A reports), and a same-court comparison of
 * docket-flow measures for /judges/analytics.
 *
 * Linking is exact only: a CJRA row belongs to a judge page when the builder's unique match names that judges id
 * (filters.judge_profile once the builder adds it; item.match.profile until then). Zero rows, more than one row, or a
 * row whose match is not "unique" returns null: a judge listed twice is never merged or guessed. Null points stay null
 * (the judge was not listed in that report, or the value was not printed); they are never read as 0.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import { parseCrosswalk, parseJudgeActivity, JUDGE_ID } from "./judgeCourtListener.functions";

export const CJRA_SERIES = [
  "motions_6m",
  "civil_3y",
  "bench_trials_6m",
  "ss_appeals_6m",
  "bankruptcy_appeals_6m",
] as const;
export type CjraSeriesKey = (typeof CJRA_SERIES)[number];

export const CJRA_LABELS: Record<CjraSeriesKey, string> = {
  motions_6m: "Motions pending more than 6 months",
  civil_3y: "Civil cases pending more than 3 years",
  bench_trials_6m: "Bench trials submitted more than 6 months",
  ss_appeals_6m: "Social Security appeals pending more than 6 months",
  bankruptcy_appeals_6m: "Bankruptcy appeals pending more than 6 months",
};

export const CJRA_SOURCE = {
  label: "U.S. Courts, Civil Justice Reform Act reports (Appendix A)",
  url: "https://www.uscourts.gov/data-news/reports/statistical-reports/civil-justice-reform-act-report",
} as const;

export type CjraNote = { period: string; column: string; text: string };
export type JudgeCjra = {
  recordId: string;
  name: string;
  courtId: string | null;
  court: string | null;
  /** Roles the reports list this person under ("district", "magistrate"). */
  roles: string[];
  printedNames: string[];
  /** Report dates (period ends, YYYY-MM-DD), oldest first; every series has one value per period. */
  periods: string[];
  series: Record<CjraSeriesKey, (number | null)[]>;
  notes: CjraNote[];
  /** The latest report period in the dataset, and the last one that lists this judge. */
  latestPeriod: string | null;
  lastListed: string | null;
  sourceUrl: string | null;
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strs = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map(str).filter((s): s is string => !!s);
const PERIOD = /^\d{4}-\d{2}-\d{2}$/;
const COURT_ID = /^[a-z0-9]{2,12}$/;
const OFFICIAL_URL = /^https:\/\/www\.uscourts\.gov\//;

function point(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** One court_cjra_judges row for one judges id; null unless the row's unique match names exactly that id. */
export function parseCjraRow(
  row: { id: unknown; title?: unknown; source_url?: unknown; item: unknown },
  profileId: string,
): JudgeCjra | null {
  const it = obj(row.item);
  const recordId = str(row.id);
  if (!it || !recordId) return null;
  const match = obj(it["match"]);
  if (match?.["status"] !== "unique" || match["profile"] !== profileId) return null;
  const periods = strs(it["periods"]);
  if (!periods.length || periods.some((p) => !PERIOD.test(p))) return null;
  for (let i = 1; i < periods.length; i++) if (periods[i]! <= periods[i - 1]!) return null;
  const raw = obj(it["series"]);
  const series = {} as Record<CjraSeriesKey, (number | null)[]>;
  for (const key of CJRA_SERIES) {
    const s = Array.isArray(raw?.[key]) ? (raw[key] as unknown[]) : null;
    // a series that does not line up with the report dates is not drawn at all
    series[key] = s && s.length === periods.length ? s.map(point) : periods.map(() => null);
  }
  const listed = periods.filter((_, i) => CJRA_SERIES.some((k) => series[k][i] !== null));
  const cells = obj(it["cells"]);
  const courtId = str(it["court_id"]);
  const sourceUrl = str(row.source_url);
  return {
    recordId,
    name: str(row.title) ?? str(it["title"]) ?? str(cells?.["judge"]) ?? recordId,
    courtId: courtId && COURT_ID.test(courtId) ? courtId : null,
    court: str(cells?.["court"]),
    roles: strs(it["roles"]),
    printedNames: strs(it["printed_names"]).slice(0, 6),
    periods,
    series,
    notes: (Array.isArray(it["notes"]) ? it["notes"] : [])
      .map((n) => {
        const o = obj(n);
        const period = str(o?.["period"]);
        const column = str(o?.["column"]);
        const text = str(o?.["text"]);
        return period && column && text && periods.includes(period)
          ? { period, column, text: text.replace(/\s+/g, " ") }
          : null;
      })
      .filter((n): n is CjraNote => !!n),
    latestPeriod: periods.at(-1) ?? null,
    lastListed: listed.at(-1) ?? null,
    sourceUrl: sourceUrl && OFFICIAL_URL.test(sourceUrl) ? sourceUrl : null,
  };
}

/** The last recorded value of a series with its period; null when the judge is not listed. */
export function lastPoint(
  c: JudgeCjra,
  key: CjraSeriesKey,
): { period: string; value: number } | null {
  const s = c.series[key];
  for (let i = s.length - 1; i >= 0; i--) {
    const v = s[i];
    if (v !== null && v !== undefined) return { period: c.periods[i]!, value: v };
  }
  return null;
}

type CjraRow = { id: string; title: string | null; source_url: string | null; item: unknown };
const SELECT = "select=id,title,source_url,item";

export const getJudgeCjra = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(JUDGE_ID) }).parse(d))
  .handler(async ({ data }): Promise<JudgeCjra | null> => {
    const filter = encodeURIComponent(JSON.stringify({ judge_profile: [data.id] }));
    let rows = (
      await restGet<CjraRow[]>(
        `corpus_records?${SELECT}&dataset=eq.court_cjra_judges&filters=cs.${filter}&limit=2`,
      )
    ).rows;
    if (!rows.length)
      rows = (
        await restGet<CjraRow[]>(
          `corpus_records?${SELECT}&dataset=eq.court_cjra_judges&item->match->>profile=eq.${data.id}&limit=2`,
        )
      ).rows;
    return rows.length === 1 ? parseCjraRow(rows[0]!, data.id) : null;
  });

// ------------------------------------------------------------------ same-court comparison

export type BenchJudge = {
  recordId: string;
  /** Name as the CJRA row carries it (the FJC name when linked, else as printed). */
  name: string;
  /** judges id when the CJRA match is unique and no other row in the court claims it; else null. */
  profileId: string | null;
  motions6m: number | null;
  civil3y: number | null;
  medianDaysCivil: number | null;
  medianDaysN: number | null;
  productShare: number | null;
  /** True when the CourtListener person is linked through an exact crosswalk tier. */
  clLinked: boolean;
};
export type CourtBench = {
  courtId: string;
  court: string | null;
  period: string | null;
  judges: BenchJudge[];
  sourceUrl: string | null;
};

const at = (row: Json | null, key: CjraSeriesKey, i: number): number | null => {
  const s =
    row && Array.isArray(obj(row["series"])?.[key])
      ? (obj(row["series"])![key] as unknown[])
      : null;
  return s && i >= 0 && i < s.length ? point(s[i]) : null;
};

/** District judges listed in the latest CJRA report for one court, alphabetical by surname as printed. */
export function benchFromCjraRows(courtId: string, rows: readonly CjraRow[]): CourtBench {
  const profiles = new Map<string, number>();
  for (const r of rows) {
    const m = obj(obj(r.item)?.["match"]);
    if (m?.["status"] === "unique" && typeof m["profile"] === "string")
      profiles.set(m["profile"], (profiles.get(m["profile"]) ?? 0) + 1);
  }
  let period: string | null = null;
  let court: string | null = null;
  let sourceUrl: string | null = null;
  const judges: (BenchJudge & { sort: string })[] = [];
  for (const r of rows) {
    const it = obj(r.item);
    if (!it || str(it["court_id"]) !== courtId) continue;
    const periods = strs(it["periods"]);
    const last = periods.length - 1;
    if (last < 0) continue;
    const p = periods[last]!;
    if (period === null || p.localeCompare(period) > 0) period = p;
    const cells = obj(it["cells"]);
    court ??= str(cells?.["court"]);
    if (!sourceUrl && r.source_url && OFFICIAL_URL.test(r.source_url)) sourceUrl = r.source_url;
    const m = obj(it["match"]);
    const pid =
      m?.["status"] === "unique" && typeof m["profile"] === "string" ? m["profile"] : null;
    judges.push({
      recordId: r.id,
      name: str(r.title) ?? str(cells?.["judge"]) ?? r.id,
      profileId: pid && profiles.get(pid) === 1 && JUDGE_ID.test(pid) ? pid : null,
      motions6m: at(it, "motions_6m", last),
      civil3y: at(it, "civil_3y", last),
      medianDaysCivil: null,
      medianDaysN: null,
      productShare: null,
      clLinked: false,
      sort: strs(it["printed_names"])[0] ?? r.id,
    });
  }
  judges.sort((a, b) => a.sort.localeCompare(b.sort) || a.recordId.localeCompare(b.recordId));
  return {
    courtId,
    court,
    period,
    sourceUrl,
    judges: judges.map(({ sort: _sort, ...j }) => j),
  };
}

export const getCourtBench = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ court: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<CourtBench> => {
    const filter = encodeURIComponent(
      JSON.stringify({ court: [data.court], role: ["district"], active: ["yes"] }),
    );
    const cjra = await restGet<CjraRow[]>(
      `corpus_records?${SELECT}&dataset=eq.court_cjra_judges&filters=cs.${filter}&order=ordinal.asc&limit=120`,
    );
    const bench = benchFromCjraRows(data.court, cjra.rows);
    const ids = bench.judges.map((j) => j.profileId).filter((x): x is string => !!x);
    if (!ids.length) return bench;
    const cw = await restGet<{ id: string; p: unknown }[]>(
      `corpus_records?select=id,p:item->profile&dataset=eq.judge_cl_crosswalk&id=in.(${ids.join(",")})&limit=${ids.length + 1}`,
    );
    const person = new Map<string, number>();
    for (const r of cw.rows) {
      const c = parseCrosswalk(r.p, r.id);
      if (c?.linked && c.clDocketsRecord && c.clPersonId !== null) person.set(r.id, c.clPersonId);
    }
    const persons = [...new Set(person.values())];
    if (!persons.length) return bench;
    const act = await restGet<{ id: string; p: unknown }[]>(
      `corpus_records?select=id,p:item->profile&dataset=eq.clb_judge_dockets&id=in.(${persons.join(",")})&limit=${persons.length + 1}`,
    );
    const byPerson = new Map<number, ReturnType<typeof parseJudgeActivity>>();
    for (const r of act.rows) {
      const pid = Number(r.id);
      if (Number.isInteger(pid)) byPerson.set(pid, parseJudgeActivity(r.p, pid));
    }
    // a person linked to two judges ids is not shown for either
    const owners = new Map<number, number>();
    for (const p of person.values()) owners.set(p, (owners.get(p) ?? 0) + 1);
    return {
      ...bench,
      judges: bench.judges.map((j) => {
        const p = j.profileId ? person.get(j.profileId) : undefined;
        if (p === undefined || owners.get(p) !== 1) return j;
        const d = byPerson.get(p)?.dockets ?? null;
        return {
          ...j,
          clLinked: true,
          medianDaysCivil: d?.medianDaysCivil ?? null,
          medianDaysN: d?.medianDaysN ?? null,
          productShare: d?.productShare ?? null,
        };
      }),
    };
  });

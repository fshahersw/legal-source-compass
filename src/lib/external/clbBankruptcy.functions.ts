/**
 * Bankruptcy-court activity from CourtListener's bankruptcy-dockets bulk file (dataset clb_bankruptcy_courts, file dated
 * 2022-09-19), compiled by scripts/enrichment/courtlistener_rest. The file has no chapter, asset or liability columns, so those
 * stay "Not recorded". Judges are CourtListener person ids exactly as recorded; links are kept only when they name exactly that id.
 * Stored JSON is validated here; malformed values are dropped, never repaired. Read-only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
const count = (v: unknown) => {
  const n = num(v);
  return n != null && Number.isInteger(n) && n >= 0 ? n : null;
};
const pct = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 && n <= 100 ? n : null;
};
const days = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 && n < 200_000 ? n : null;
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown) => {
  const s = str(v, 10);
  return s && ISO_DAY.test(s) ? s : null;
};
const year = (v: unknown) => {
  const n = count(v);
  return n != null && n >= 1700 && n <= 2100 ? n : null;
};

export const BK_COURT_ID = /^[A-Za-z0-9]{2,24}$/;

export type BkDuration = {
  n: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
};
export type BkYear = {
  yr: number;
  dockets: number;
  terminated: number;
  /** Adversary proceedings (docket numbers with the ap code). */
  ap: number;
  /** Median days filing to termination for that filing year; null under 30 dockets with both dates. */
  medianDays: number | null;
};
export type BkCaseType = {
  code: string;
  label: string;
  dockets: number;
  sharePct: number | null;
  medianDays: number | null;
};
export type BkJudge = {
  personId: number;
  name: string;
  dockets: number;
  sharePct: number | null;
  firstFiled: string | null;
  lastFiled: string | null;
  medianDays: number | null;
  /** /records/cl_people/cl:people:<id>, only when it names exactly this person id. */
  record: string | null;
  /** /records/clb_judge_dockets/<id>, only when it names exactly this person id. */
  statsRecord: string | null;
};
export type BankruptcyProfile = {
  courtId: string;
  name: string;
  fileDate: string;
  dockets: number;
  firstFiled: string | null;
  lastFiled: string | null;
  /** Dockets with no usable filing date (missing or outside 1700 to the file date). */
  undated: number | null;
  terminated: number | null;
  terminatedPct: number | null;
  duration: BkDuration | null;
  byYear: BkYear[];
  /** Dockets filed before the first year of `byYear` (shown as a count, not plotted). */
  beforeSeries: number | null;
  caseTypes: BkCaseType[];
  judges: BkJudge[];
  /** People recorded as the assigned judge of at least one docket (all, not only the listed ones). */
  judgesWithId: number | null;
  withJudgeIdPct: number | null;
  judgeNameOnly: number | null;
  judgeNamesWithoutId: { name: string; dockets: number }[];
  blockedPct: number | null;
  inDocketFile: number | null;
  inDocketFilePct: number | null;
};

function duration(v: unknown): BkDuration | null {
  const o = obj(v);
  if (!o) return null;
  const n = count(o["n"]);
  const q = ["p10", "p25", "p50", "p75", "p90"].map((k) => days(o[k]));
  if (n == null || q.some((x) => x == null)) return null;
  const [p10, p25, p50, p75, p90] = q as number[];
  // quantiles must be ordered; anything else is a malformed row
  if (!(p10! <= p25! && p25! <= p50! && p50! <= p75! && p75! <= p90!)) return null;
  return { n, p10: p10!, p25: p25!, p50: p50!, p75: p75!, p90: p90! };
}

export function parseBankruptcyProfile(raw: unknown, courtId: string): BankruptcyProfile | null {
  const p = obj(raw);
  if (!p || p["court_id"] !== courtId) return null;
  const name = str(p["name"]);
  const dockets = count(p["dockets"]);
  const fileDate = day(p["file_date"]);
  if (!name || dockets == null || !fileDate) return null;
  const byYear: BkYear[] = [];
  const seen = new Set<number>();
  for (const y of arr(p["by_year"])) {
    const o = obj(y);
    const yr = year(o?.["yr"]);
    const n = count(o?.["dockets"]);
    const t = count(o?.["terminated"]);
    const ap = count(o?.["ap"]);
    if (yr == null || n == null || t == null || ap == null || t > n || ap > n || seen.has(yr))
      continue;
    seen.add(yr);
    byYear.push({ yr, dockets: n, terminated: t, ap, medianDays: days(o?.["median_days"]) });
  }
  byYear.sort((a, b) => a.yr - b.yr);
  const caseTypes: BkCaseType[] = arr(p["case_types"]).flatMap((t) => {
    const o = obj(t);
    const code = str(o?.["code"], 8);
    const label = str(o?.["label"], 80);
    const n = count(o?.["dockets"]);
    return code && label && n != null && n <= dockets
      ? [
          {
            code,
            label,
            dockets: n,
            sharePct: pct(o?.["share_pct"]),
            medianDays: days(o?.["median_days"]),
          },
        ]
      : [];
  });
  const judges: BkJudge[] = arr(p["judges"]).flatMap((j) => {
    const o = obj(j);
    const personId = count(o?.["person_id"]);
    const jname = str(o?.["name"]);
    const n = count(o?.["dockets"]);
    if (personId == null || !jname || n == null || n > dockets) return [];
    const record = str(o?.["record"]);
    const stats = str(o?.["stats_record"]);
    return [
      {
        personId,
        name: jname,
        dockets: n,
        sharePct: pct(o?.["share_pct"]),
        firstFiled: day(o?.["first_filed"]),
        lastFiled: day(o?.["last_filed"]),
        medianDays: days(o?.["median_days"]),
        record: record === `/records/cl_people/cl:people:${personId}` ? record : null,
        statsRecord: stats === `/records/clb_judge_dockets/${personId}` ? stats : null,
      },
    ];
  });
  const in2026 = obj(p["in_2026_docket_file"]);
  const dur = duration(p["duration_days"]);
  const noFiled = count(p["no_filed_date"]);
  const implausible = count(p["implausible_filed"]);
  return {
    courtId,
    name,
    fileDate,
    dockets,
    firstFiled: day(p["first_filed"]),
    lastFiled: day(p["last_filed"]),
    undated: noFiled != null && implausible != null ? noFiled + implausible : null,
    terminated: count(p["terminated"]),
    terminatedPct: pct(p["terminated_pct"]),
    duration: dur && dur.n <= dockets ? dur : null,
    byYear,
    beforeSeries: count(p["before_series"]),
    caseTypes,
    judges,
    judgesWithId: count(p["judges_with_id"]),
    withJudgeIdPct: pct(p["with_judge_id_pct"]),
    judgeNameOnly: count(p["judge_name_only"]),
    judgeNamesWithoutId: arr(p["judge_names_without_id"]).flatMap((x) => {
      const o = obj(x);
      const nm = str(o?.["name"], 80);
      const n = count(o?.["dockets"]);
      return nm && n != null ? [{ name: nm, dockets: n }] : [];
    }),
    blockedPct: pct(p["blocked_pct"]),
    inDocketFile: count(in2026?.["in_docket_file"]),
    inDocketFilePct: pct(in2026?.["in_docket_file_pct"]),
  };
}

export const getClbBankruptcyCourt = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(BK_COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<BankruptcyProfile | null> => {
    const r = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.clb_bankruptcy_courts&id=eq.${encodeURIComponent(data.id)}&limit=1`,
    );
    return r.rows.length === 1 ? parseBankruptcyProfile(r.rows[0]!.p, data.id) : null;
  });

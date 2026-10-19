/**
 * Oral-argument recordings of one court in CourtListener (dataset clb_oral_arguments, compiled by
 * scripts/enrichment/courtlistener_rest from the oral-arguments and dockets bulk files). Years are the docket's date argued;
 * lengths are the recordings' durations. Judge names are the recordings' own text, counted as written and never linked to a
 * person. Stored JSON is validated here; malformed values are dropped, never repaired. Read-only.
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
const minutes = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 && n < 100_000 ? n : null;
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

export const ORAL_COURT_ID = /^[A-Za-z0-9]{2,24}$/;

export type OralMinutes = {
  n: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number | null;
};
export type OralYear = {
  yr: number;
  recordings: number;
  /** Median length in minutes; null when fewer than 10 recordings carry a length. */
  medianMinutes: number | null;
  hours: number | null;
  withTranscript: number;
};
export type OralName = {
  /** The name as the recordings write it (most common spelling), not a linked person. */
  name: string;
  recordings: number;
  medianMinutes: number | null;
  firstYear: number | null;
  lastYear: number | null;
};
export type OralProfile = {
  courtId: string;
  name: string;
  recordings: number;
  dockets: number | null;
  withArgued: number | null;
  firstArgued: string | null;
  lastArgued: string | null;
  totalHours: number | null;
  minutes: OralMinutes | null;
  withTranscript: number | null;
  transcriptPct: number | null;
  /** Recordings whose judges text is filled in; the base of the name counts. */
  withJudgesText: number | null;
  judgesTextPct: number | null;
  byYear: OralYear[];
  names: OralName[];
};

function parseMinutes(v: unknown): OralMinutes | null {
  const o = obj(v);
  if (!o) return null;
  const n = count(o["n"]);
  const q = ["p10", "p25", "p50", "p75", "p90"].map((k) => minutes(o[k]));
  if (n == null || q.some((x) => x == null)) return null;
  const [p10, p25, p50, p75, p90] = q as number[];
  if (!(p10! <= p25! && p25! <= p50! && p50! <= p75! && p75! <= p90!)) return null;
  return { n, p10: p10!, p25: p25!, p50: p50!, p75: p75!, p90: p90!, max: minutes(o["max"]) };
}

export function parseOralProfile(raw: unknown, courtId: string): OralProfile | null {
  const p = obj(raw);
  if (!p || p["court_id"] !== courtId) return null;
  const name = str(p["name"]);
  const recordings = count(p["recordings"]);
  if (!name || recordings == null || recordings === 0) return null;
  const seen = new Set<number>();
  const byYear: OralYear[] = [];
  for (const y of arr(p["by_year"])) {
    const o = obj(y);
    const yr = year(o?.["yr"]);
    const n = count(o?.["recordings"]);
    const t = count(o?.["with_transcript"]);
    if (yr == null || n == null || t == null || t > n || n > recordings || seen.has(yr)) continue;
    seen.add(yr);
    byYear.push({
      yr,
      recordings: n,
      medianMinutes: minutes(o?.["median_minutes"]),
      hours: minutes(o?.["hours"]),
      withTranscript: t,
    });
  }
  byYear.sort((a, b) => a.yr - b.yr);
  const withJudgesText = count(p["with_judges_text"]);
  const names: OralName[] = arr(p["names"]).flatMap((x) => {
    const o = obj(x);
    const nm = str(o?.["name"], 80);
    const n = count(o?.["recordings"]);
    return nm && n != null && (withJudgesText == null || n <= withJudgesText)
      ? [
          {
            name: nm,
            recordings: n,
            medianMinutes: minutes(o?.["median_minutes"]),
            firstYear: year(o?.["first_year"]),
            lastYear: year(o?.["last_year"]),
          },
        ]
      : [];
  });
  const m = parseMinutes(p["duration_minutes"]);
  return {
    courtId,
    name,
    recordings,
    dockets: count(p["dockets"]),
    withArgued: count(p["with_argued_date"]),
    firstArgued: day(p["first_argued"]),
    lastArgued: day(p["last_argued"]),
    totalHours: minutes(p["total_hours"]),
    minutes: m && m.n <= recordings ? m : null,
    withTranscript: count(p["with_transcript"]),
    transcriptPct: pct(p["transcript_pct"]),
    withJudgesText,
    judgesTextPct: pct(p["judges_text_pct"]),
    byYear,
    names,
  };
}

export const getClbOralArguments = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(ORAL_COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<OralProfile | null> => {
    const r = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.clb_oral_arguments&id=eq.${encodeURIComponent(data.id)}&limit=1`,
    );
    return r.rows.length === 1 ? parseOralProfile(r.rows[0]!.p, data.id) : null;
  });

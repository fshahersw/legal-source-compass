/**
 * A judge page's CourtListener crosswalk (dataset judge_cl_crosswalk) and, when the crosswalk links a person, that person's docket and
 * opinion activity in CourtListener's collection (dataset clb_judge_dockets). Read-only; malformed values are dropped, never guessed.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

export const LINKED_TIERS = [
  "exact_id",
  "parent_profile_link",
  "exact_name_same_court",
  "exact_name_same_state",
] as const;
export type CrosswalkTier =
  | (typeof LINKED_TIERS)[number]
  | "compatible_name_same_court"
  | "ambiguous"
  | "fjc_conflict"
  | "date_conflict"
  | "withheld_for_review"
  | "no_cl_person_for_fjc_id"
  | "not_found";
const TIERS = new Set<string>([
  ...LINKED_TIERS,
  "compatible_name_same_court",
  "ambiguous",
  "fjc_conflict",
  "date_conflict",
  "withheld_for_review",
  "no_cl_person_for_fjc_id",
  "not_found",
]);

export type MatchedPosition = {
  courtId: string;
  court: string;
  start: string | null;
  end: string | null;
};
export type Crosswalk = {
  tier: CrosswalkTier;
  linked: boolean;
  needsReview: boolean;
  clPersonId: number | null;
  clName: string | null;
  positions: MatchedPosition[];
  candidates: number[];
  unresolvedCourts: string[];
  clRecord: string | null;
  clDocketsRecord: string | null;
};
export type YearCount = { yr: number; n: number };
export type CourtCount = { courtId: string; name: string; n: number; link: string | null };
export type JudgeActivity = {
  dockets: {
    assigned: number;
    terminatedPct: number | null;
    firstYear: number | null;
    lastYear: number | null;
    civil: number | null;
    criminal: number | null;
    medianDaysCivil: number | null;
    medianDaysN: number | null;
    courts: CourtCount[];
    byYear: YearCount[];
  } | null;
  referred: number | null;
  opinions: {
    authored: number;
    perCuriam: number | null;
    leadOrCombined: number | null;
    firstFiled: string | null;
    lastFiled: string | null;
    courts: CourtCount[];
    byYear: YearCount[];
    timesCitedTotal: number | null;
    timesCitedMedian: number | null;
    clustersWithLeadOpinion: number | null;
    excludedOutsideLifespan: number | null;
    beforeFirstPosition: number | null;
  } | null;
};
export type JudgeCourtListener = { crosswalk: Crosswalk; activity: JudgeActivity | null };

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n >= 0 && n <= 100 ? n : null;
};
const year = (v: unknown): number | null => {
  const n = count(v);
  return n !== null && n >= 1700 && n <= 2100 ? n : null;
};
const date = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s) ? s : null;
};
const COURT_LINK = /^\/courts\/[a-z0-9_-]{1,40}$/;

export function parseCrosswalk(raw: unknown, judgeId: string): Crosswalk | null {
  const p = obj(raw);
  if (!p || p["judges_id"] !== judgeId) return null;
  const tier = str(p["tier"]);
  if (!tier || !TIERS.has(tier)) return null;
  const linked = (LINKED_TIERS as readonly string[]).includes(tier);
  const clPersonId = count(p["cl_person_id"]);
  if (linked && clPersonId === null) return null;
  const positions = (Array.isArray(p["matched_positions"]) ? p["matched_positions"] : [])
    .map((m) => {
      const o = obj(m);
      const courtId = str(o?.["court_id"]);
      const court = str(o?.["court"]);
      return courtId && court
        ? { courtId, court, start: date(o?.["start"]), end: date(o?.["end"]) }
        : null;
    })
    .filter((m): m is MatchedPosition => !!m);
  const exactRecord = (v: unknown, prefix: string): string | null => {
    const s = str(v);
    return linked && s && clPersonId !== null && s === `${prefix}${clPersonId}` ? s : null;
  };
  return {
    tier: tier as CrosswalkTier,
    linked,
    needsReview: tier === "compatible_name_same_court",
    clPersonId,
    clName: str(p["cl_name"]),
    positions,
    candidates: (Array.isArray(p["candidates"]) ? p["candidates"] : [])
      .map(count)
      .filter((n): n is number => n !== null)
      .slice(0, 12),
    unresolvedCourts: (Array.isArray(p["unresolved_courts"]) ? p["unresolved_courts"] : [])
      .map(str)
      .filter((s): s is string => !!s),
    clRecord: exactRecord(p["cl_record"], "/records/cl_people/cl:people:"),
    clDocketsRecord: exactRecord(p["cl_dockets_record"], "/records/clb_judge_dockets/"),
  };
}

function years(raw: unknown, key: string): YearCount[] {
  const out: YearCount[] = [];
  const seen = new Set<number>();
  for (const r of Array.isArray(raw) ? raw : []) {
    const o = obj(r);
    const yr = year(o?.["yr"]);
    const n = count(o?.[key]);
    if (yr === null || n === null || seen.has(yr)) continue;
    seen.add(yr);
    out.push({ yr, n });
  }
  return out.sort((a, b) => a.yr - b.yr);
}

function courtCounts(raw: unknown, key: string, whole: number): CourtCount[] {
  const out: CourtCount[] = [];
  let sum = 0;
  for (const r of Array.isArray(raw) ? raw : []) {
    const o = obj(r);
    const courtId = str(o?.["court_id"]);
    const name = str(o?.["name"]);
    const n = count(o?.[key]);
    if (!courtId || !name || n === null || n > whole) continue;
    const link = str(o?.["link"]);
    out.push({
      courtId,
      name,
      n,
      link: link && link === `/courts/${courtId}` && COURT_LINK.test(link) ? link : null,
    });
    sum += n;
  }
  return sum <= whole ? out : [];
}

/** Compact activity from one clb_judge_dockets profile; sections that fail validation become null. */
export function parseJudgeActivity(raw: unknown, personId: number): JudgeActivity | null {
  const p = obj(raw);
  if (!p || p["person_id"] !== personId) return null;
  const d = obj(p["dockets"]);
  let dockets: JudgeActivity["dockets"] = null;
  const assigned = count(d?.["assigned"]);
  if (d && assigned !== null && assigned > 0) {
    const dur = obj(d["duration_civil"]);
    dockets = {
      assigned,
      terminatedPct: pct(d["terminated_pct"]),
      firstYear: year(d["first_year"]),
      lastYear: year(d["last_year"]),
      civil: count(d["civil_numbered"]),
      criminal: count(d["criminal_numbered"]),
      medianDaysCivil: num(dur?.["median_days"]),
      medianDaysN: count(dur?.["n"]),
      courts: courtCounts(d["courts"], "dockets", assigned),
      byYear: years(d["by_year"], "dockets"),
    };
  }
  const o = obj(p["opinions"]);
  let opinions: JudgeActivity["opinions"] = null;
  const authored = count(o?.["authored"]);
  if (o && authored !== null && authored > 0) {
    opinions = {
      authored,
      perCuriam: count(o["per_curiam"]),
      leadOrCombined: count(o["lead_or_combined"]),
      firstFiled: date(o["first_filed"]),
      lastFiled: date(o["last_filed"]),
      courts: courtCounts(o["courts"], "opinions", authored),
      byYear: years(o["by_year"], "opinions"),
      timesCitedTotal: count(o["times_cited_total"]),
      timesCitedMedian: num(o["times_cited_median"]),
      clustersWithLeadOpinion: count(o["clusters_with_lead_opinion"]),
      excludedOutsideLifespan: count(o["excluded_outside_lifespan"]),
      beforeFirstPosition: count(o["before_first_recorded_position"]),
    };
  }
  const ref = obj(p["referred"]);
  const referred = count(ref?.["dockets"]);
  if (!dockets && !opinions && !referred) return null;
  return { dockets, referred: referred && referred > 0 ? referred : null, opinions };
}

export const JUDGE_ID = /^[a-z0-9]{8,64}$/;

export const getJudgeCourtListener = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(JUDGE_ID) }).parse(d))
  .handler(async ({ data }): Promise<JudgeCourtListener | null> => {
    const x = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.judge_cl_crosswalk&id=eq.${data.id}&limit=1`,
    );
    const crosswalk = x.rows.length === 1 ? parseCrosswalk(x.rows[0]!.p, data.id) : null;
    if (!crosswalk) return null;
    let activity: JudgeActivity | null = null;
    if (crosswalk.linked && crosswalk.clDocketsRecord && crosswalk.clPersonId !== null) {
      const a = await restGet<{ p: unknown }[]>(
        `corpus_records?select=p:item->profile&dataset=eq.clb_judge_dockets&id=eq.${crosswalk.clPersonId}&limit=1`,
      );
      activity =
        a.rows.length === 1 ? parseJudgeActivity(a.rows[0]!.p, crosswalk.clPersonId) : null;
    }
    return { crosswalk, activity };
  });

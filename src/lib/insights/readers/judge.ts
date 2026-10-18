/** Judge analytics read: judge_cross_profiles (summary:overview) and judge_cross_districts (summary:national). */
import { restGet } from "@/lib/external/rest.server";
import type { JudgeDistrictLite, JudgeInput, JudgePointLite } from "../generators/judge";
import { memoAsync, READ_TTL_MS } from "./cache";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown) => num(v) ?? 0;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const counts = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(obj(v) ?? {})) if (num(x) != null) out[k] = x as number;
  return out;
};

export function parsePoint(v: unknown): JudgePointLite | null {
  const o = obj(v);
  const nid = str(o?.["nid"]);
  const name = str(o?.["name"]);
  if (!o || !nid || !name) return null;
  return {
    nid,
    name,
    courtId: str(o["court_id"]),
    party: str(o["party"]),
    pendingMdls: int(o["pending_mdl_count"]),
    pendingActions: int(o["pending_actions"]),
    historicalMdls: int(o["historical_mdl_count"]),
    totalActions: int(o["total_actions_handled"]),
    sharePct: num(o["pending_share_pct"]),
    profileId: str(o["judge_profile_id"]),
  };
}

export function parseDistrict(v: unknown): JudgeDistrictLite | null {
  const o = obj(v);
  const courtId = str(o?.["court_id"]);
  const name = str(o?.["name"]);
  if (!o || !courtId || !name) return null;
  return {
    courtId,
    name,
    pendingMdls: int(o["pending_mdls"]),
    pendingActions: int(o["pending_actions"]),
    judgeships: num(o["judgeships"]),
    sharePct: num(o["share_pending_pct"]),
  };
}

export function parseJudgeInput(summary: unknown, national: unknown): JudgeInput | null {
  const s = obj(summary);
  const asOf = str(s?.["as_of"]);
  if (!s || !asOf) return null;
  const points = arr(s["scatter"]).flatMap((p) => {
    const parsed = parsePoint(p);
    return parsed ? [parsed] : [];
  });
  if (!points.length) return null;
  const n = obj(national);
  const nAsOf = str(n?.["as_of"]);
  const circuits: NonNullable<JudgeInput["national"]>["circuits"] = {};
  for (const [key, value] of Object.entries(obj(n?.["circuits"]) ?? {})) {
    const c = obj(value);
    if (c && /^\d{1,2}$/.test(key))
      circuits[key] = {
        active: int(c["active"]),
        senior: int(c["senior"]),
        pendingMdls: int(c["pending_mdls"]),
        pendingActions: int(c["pending_actions"]),
      };
  }
  return {
    asOf,
    pendingMdls: int(s["pending_mdls"]),
    pendingActions: int(s["pending_actions"]),
    judges: int(s["judges"]),
    judgesWithPending: int(s["judges_with_pending"]),
    judgesHistoryOnly: int(s["judges_with_history_only"]),
    judgesMultiPending: int(s["judges_multi_pending"]),
    top10SharePct: num(s["top10_judge_share_pct"]),
    medianYearsPendingJudges: num(s["median_years_pending_judges"]),
    points,
    national:
      n && nAsOf
        ? {
            asOf: nAsOf,
            districts: int(n["districts"]),
            sitting: int(n["sitting"]),
            active: int(n["active"]),
            senior: int(n["senior"]),
            partyActive: counts(n["party_active"]),
            tenure: counts(n["tenure"]),
            medianYearsActive: num(n["median_years_active"]),
            districtsWithPending: int(n["districts_with_pending"]),
            top5DistrictSharePct: num(n["top5_district_share_pct"]),
            pendingActions: int(n["pending_actions"]),
            circuits,
            rows: arr(n["rows"]).flatMap((r) => {
              const parsed = parseDistrict(r);
              return parsed ? [parsed] : [];
            }),
          }
        : null,
  };
}

export const readJudges = memoAsync<JudgeInput | null>(READ_TTL_MS, async () => {
  const [profiles, national] = await Promise.all([
    restGet<{ item: unknown }[]>(
      "corpus_records?select=item:item->summary&dataset=eq.judge_cross_profiles&id=eq.summary:overview&limit=1",
    ),
    restGet<{ item: unknown }[]>(
      "corpus_records?select=item:item->national&dataset=eq.judge_cross_districts&id=eq.summary:national&limit=1",
    ),
  ]);
  return parseJudgeInput(profiles.rows[0]?.item, national.rows[0]?.item);
});

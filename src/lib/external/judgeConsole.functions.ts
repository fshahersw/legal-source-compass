/**
 * Read-only figures behind the judge profile console panels (src/components/judges/JudgeConsole.tsx):
 *
 * - getCourtBenchSeries: the CJRA "motions pending more than six months" series of every district judge a court's
 *   CJRA report lists (dataset court_cjra_judges), for the bench map. Values stay exactly as printed; a series that
 *   does not line up with its report dates is dropped, never realigned.
 * - getExpertRulingBaseline: every recorded expert-admissibility ruling attributed to exactly one judge (dataset
 *   judge_expert_rulings), for the "all other judges" comparison. Unattributed rulings are counted, never assigned.
 * - getJudgeCounsel: law-firm appearances on the master dockets of given MDLs (dataset firm_profiles, per_mdl rows as
 *   recorded). Firm names are kept as recorded; nothing is merged.
 * - getMdlEndingsBaseline: actions closed in the transferee court and actions remanded, summed over the JPML
 *   terminated-litigation history (dataset mdl_terminated_history), nationally and by transferee district as printed.
 *
 * Every reader goes through restGet (server only). Malformed rows are skipped; nothing is estimated.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import { parseRuling, RULINGS_DATASET, type ExpertRuling } from "./judgeRulings.functions";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
const COURT_ID = /^[a-z0-9]{2,12}$/;
const PERIOD = /^\d{4}-\d{2}-\d{2}$/;
const PROFILE = /^[0-9a-f]{32}$/;
const MDL = /^\d{1,5}$/;

/* ---------------------------------------------------------------- bench series */

export type BenchSeriesJudge = {
  recordId: string;
  name: string;
  /** One value per period of CourtBenchSeries.periods; null where the report does not list the judge. */
  motions6m: (number | null)[];
};
export type CourtBenchSeries = {
  court: string;
  /** The last report periods (ascending), at most BENCH_PERIODS. */
  periods: string[];
  judges: BenchSeriesJudge[];
};
export const BENCH_PERIODS = 8;

/** Lines one row's printed series up with the court's last periods; null when the row is malformed. */
export function benchSeriesRow(
  row: { id: unknown; title: unknown; ps: unknown; m: unknown },
  periods: readonly string[],
): BenchSeriesJudge | null {
  const id = str(row.id);
  const ps = Array.isArray(row.ps) ? row.ps.map(str) : null;
  const m = Array.isArray(row.m) ? row.m : null;
  if (!id || !ps || !m || ps.length !== m.length || ps.some((p) => !p || !PERIOD.test(p)))
    return null;
  const at = new Map<string, number | null>();
  ps.forEach((p, i) => at.set(p!, count(m[i])));
  return {
    recordId: id,
    name: str(row.title) ?? id,
    motions6m: periods.map((p) => at.get(p) ?? null),
  };
}

export const getCourtBenchSeries = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ court: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<CourtBenchSeries> => {
    const filter = encodeURIComponent(
      JSON.stringify({ court: [data.court], role: ["district"], active: ["yes"] }),
    );
    const res = await restGet<{ id: unknown; title: unknown; ps: unknown; m: unknown }[]>(
      `corpus_records?select=id,title,ps:item->periods,m:item->series->motions_6m&dataset=eq.court_cjra_judges&filters=cs.${filter}&order=ordinal.asc&limit=120`,
    );
    const all = new Set<string>();
    for (const r of res.rows)
      if (Array.isArray(r.ps))
        for (const p of r.ps) {
          const s = str(p);
          if (s && PERIOD.test(s)) all.add(s);
        }
    const periods = [...all].sort().slice(-BENCH_PERIODS);
    return {
      court: data.court,
      periods,
      judges: res.rows
        .map((r) => benchSeriesRow(r, periods))
        .filter((j): j is BenchSeriesJudge => !!j),
    };
  });

/* ---------------------------------------------------------------- expert rulings, all judges */

export type BaselineRuling = Pick<ExpertRuling, "movant" | "outcome" | "courtId"> & {
  profile: string;
};
export type ExpertRulingBaseline = {
  rulings: BaselineRuling[];
  /** Ruling rows not attributed to exactly one judge; left out of every rate. */
  unattributed: number;
};

export function baselineRuling(row: {
  id: unknown;
  source_url?: unknown;
  filters?: unknown;
  item: unknown;
}): BaselineRuling | "unattributed" | null {
  const it = obj(row.item);
  if (!it || str(it["kind"]) === "judge") return null;
  const linked = obj(row.filters)?.["judge_profile"];
  const profile =
    Array.isArray(linked) && linked.length === 1 && typeof linked[0] === "string"
      ? linked[0]
      : null;
  if (!profile || !PROFILE.test(profile)) return "unattributed";
  const r = parseRuling(row, profile);
  return r ? { profile, movant: r.movant, outcome: r.outcome, courtId: r.courtId } : null;
}

export const getExpertRulingBaseline = createServerFn({ method: "GET" }).handler(
  async (): Promise<ExpertRulingBaseline> => {
    const res = await restGet<
      { id: unknown; source_url: unknown; filters: unknown; item: unknown }[]
    >(
      `corpus_records?select=id,source_url,filters,item&dataset=eq.${RULINGS_DATASET}&order=ordinal.asc&limit=2000`,
    );
    const rulings: BaselineRuling[] = [];
    let unattributed = 0;
    for (const row of res.rows) {
      const r = baselineRuling(row);
      if (r === "unattributed") unattributed += 1;
      else if (r) rulings.push(r);
    }
    return { rulings, unattributed };
  },
);

/* ---------------------------------------------------------------- counsel */

export type CounselFirm = {
  id: string;
  firm: string;
  /** Appearances on the given MDLs' master dockets, by the side recorded for each MDL. */
  plaintiff: number;
  defense: number;
  other: number;
  mdls: string[];
};
export type JudgeCounsel = {
  /** The asked MDLs that have firm appearance records at all. */
  covered: string[];
  firms: CounselFirm[];
};

type CounselRow = { id: unknown; firm: unknown; per: unknown };

/** Sums each firm's per-MDL appearances over `mdls`; firms with none are dropped. Pure. */
export function counselFirms(rows: readonly CounselRow[], mdls: readonly string[]): CounselFirm[] {
  const want = new Set(mdls);
  const byId = new Map<string, CounselFirm>();
  for (const row of rows) {
    const id = str(row.id);
    const firm = str(row.firm);
    if (!id || !firm || byId.has(id)) continue;
    const f: CounselFirm = { id, firm, plaintiff: 0, defense: 0, other: 0, mdls: [] };
    for (const p of Array.isArray(row.per) ? row.per : []) {
      const o = obj(p);
      const mdl = o ? String(o["mdl"] ?? "") : "";
      const n = count(o?.["appearances"]);
      if (!o || !want.has(mdl) || !n) continue;
      const side = str(o["side"]);
      if (side === "plaintiff") f.plaintiff += n;
      else if (side === "defense") f.defense += n;
      else f.other += n;
      if (!f.mdls.includes(mdl)) f.mdls.push(mdl);
    }
    if (f.plaintiff + f.defense + f.other > 0) byId.set(id, f);
  }
  const total = (f: CounselFirm) => f.plaintiff + f.defense + f.other;
  return [...byId.values()].sort((a, b) => total(b) - total(a) || a.firm.localeCompare(b.firm));
}

export const getJudgeCounsel = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ mdls: z.array(z.string().regex(MDL)).min(1).max(40) }).parse(d))
  .handler(async ({ data }): Promise<JudgeCounsel> => {
    const mdls = [...new Set(data.mdls)];
    const per = await Promise.all(
      mdls.map((m) =>
        restGet<CounselRow[]>(
          `corpus_records?select=id,firm:item->cells->>firm,per:item->profile->per_mdl&dataset=eq.firm_profiles&filters=cs.${encodeURIComponent(JSON.stringify({ mdl: [m] }))}&order=id.asc&limit=1000`,
        ).then((r) => ({ mdl: m, rows: r.rows })),
      ),
    );
    const covered = per.filter((p) => p.rows.length > 0).map((p) => p.mdl);
    return {
      covered,
      firms: counselFirms(
        per.flatMap((p) => p.rows),
        mdls,
      ).slice(0, 40),
    };
  });

/* ---------------------------------------------------------------- MDL endings */

export type EndingTotals = { mdls: number; closed: number; remanded: number };
export type MdlEndingsBaseline = {
  all: EndingTotals;
  /** Keyed by the transferee district exactly as the JPML history prints it ("California Northern"). */
  byDistrict: Record<string, EndingTotals>;
};

type EndingRow = { c: unknown; r: unknown; d: unknown };

/** Sums closed and remanded actions; rows without both counts are skipped. Pure. */
export function endingTotals(rows: readonly EndingRow[]): MdlEndingsBaseline {
  const all: EndingTotals = { mdls: 0, closed: 0, remanded: 0 };
  const byDistrict: Record<string, EndingTotals> = {};
  for (const row of rows) {
    const c = count(row.c);
    const r = count(row.r);
    if (c === null || r === null) continue;
    all.mdls += 1;
    all.closed += c;
    all.remanded += r;
    const d = str(row.d);
    if (!d) continue;
    const t = (byDistrict[d] ??= { mdls: 0, closed: 0, remanded: 0 });
    t.mdls += 1;
    t.closed += c;
    t.remanded += r;
  }
  return { all, byDistrict };
}

export const getMdlEndingsBaseline = createServerFn({ method: "GET" }).handler(
  async (): Promise<MdlEndingsBaseline> => {
    const rows: EndingRow[] = [];
    const page = 1000;
    for (let offset = 0; offset < 20000; offset += page) {
      const res = await restGet<EndingRow[]>(
        `corpus_records?select=c:item->history->actions_closed,r:item->history->actions_remanded,d:item->history->>district_name&dataset=eq.mdl_terminated_history&order=id.asc&limit=${page}&offset=${offset}`,
      );
      rows.push(...res.rows);
      if (res.rows.length < page) break;
    }
    return endingTotals(rows);
  },
);

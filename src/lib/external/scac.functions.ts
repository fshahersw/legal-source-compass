/**
 * Federal securities class action statistics from the public pages of the Stanford Securities Class Action Clearinghouse
 * (datasets scac_statistics and scac_trend_alignment, built by scripts/enrichment/scac). SCAC is restructuring and its data
 * stop at 28 July 2025, so 2025 is a partial year. The alignment dataset sets each year beside market series (FRED VIX and
 * NASDAQ, Fama/French market return) and FJC IDB court counts by fiscal year; its correlations are associations only.
 *
 * Stored JSON is validated: unknown values become null, rows that cannot be read are dropped and counted, and court and firm
 * links are kept only in their exact shapes.
 */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "./rest.server";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const count = (v: unknown) => {
  const n = num(v);
  return n != null && Number.isInteger(n) && n >= 0 ? n : null;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const yr = (v: unknown) => {
  const n = count(v);
  return n != null && n >= 1990 && n <= 2100 ? n : null;
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown) => {
  const s = str(v);
  return s && ISO.test(s) ? s : null;
};
const COURT_ID = /^[a-z0-9]{2,24}$/;
const FIRM_RECORD = /^firm:[a-z0-9-]{1,140}$/;
const CASE_PAGE = /^https:\/\/securities\.stanford\.edu\/filings-case\.html\?id=\d{1,9}$/;

export type Labelled = { label: string; filings: number; rank: number | null };
export type ScacYear = {
  year: number;
  filings: number;
  partial: boolean;
  nos850Filings: number | null;
  nos850ClassActions: number | null;
};
export type TrendFiling = {
  name: string;
  filed: string | null;
  court: string;
  courtId: string | null;
  exchange: string | null;
  ticker: string | null;
  sector: string | null;
  casePage: string | null;
};
export type CurrentTrend = {
  name: string;
  filings: number;
  first: string | null;
  last: string | null;
  byYear: { year: number; filings: number }[];
  byCourt: { court: string; filings: number; courtId: string | null }[];
  bySector: { sector: string; filings: number }[];
  rows: TrendFiling[];
};
export type TopSettlement = {
  rank: number;
  entity: string;
  amountUsd: number | null;
  feesUsd: number | null;
  stage: string | null;
  settledOn: string | null;
  casePage: string | null;
};
export type TopDuration = {
  rank: number;
  entity: string;
  days: number | null;
  filed: string | null;
  lastStage: string | null;
  stage: string | null;
};
export type TopFirm = {
  rank: number;
  entity: string;
  filings: number | null;
  mdlProfile: string | null;
  mdl: { appearances: number | null; mdls: number | null } | null;
};
export type ScacStatistics = {
  total: number | null;
  through: string | null;
  keyStats: { label: string; value: string }[];
  settlementsUsd: number | null;
  status: Labelled[];
  years: ScacYear[];
  circuits: (Labelled & { courtId: string | null })[];
  sectors: Labelled[];
  industries: Labelled[];
  historical: Labelled[];
  current: CurrentTrend[];
  settlements: TopSettlement[];
  durations: TopDuration[];
  firms: TopFirm[];
  dropped: number;
};

const labelled = (p: Record<string, unknown>): Labelled | null => {
  const label = str(p["label"]);
  const filings = count(p["filings"]);
  return label && filings != null ? { label, filings, rank: count(p["rank"]) } : null;
};

export function parseCurrentTrend(p: Record<string, unknown>): CurrentTrend | null {
  const name = str(p["name"]);
  const filings = count(p["filings"]);
  if (!name || filings == null) return null;
  const rows = arr(p["rows"])
    .map((t): TrendFiling | null => {
      const r = obj(t);
      const nm = str(r?.["name"]);
      const court = str(r?.["court"]);
      if (!nm || !court) return null;
      const cid = str(r?.["court_id"]);
      const page = str(r?.["case_page"]);
      const na = (v: unknown) => {
        const s = str(v);
        return s && s !== "N/A" ? s : null;
      };
      return {
        name: nm,
        filed: day(r?.["filed"]),
        court,
        courtId: cid && COURT_ID.test(cid) && r?.["court_link"] === `/courts/${cid}` ? cid : null,
        exchange: na(r?.["exchange"]),
        ticker: na(r?.["ticker"]),
        sector: na(r?.["sector"]),
        casePage: page && CASE_PAGE.test(page) ? page : null,
      };
    })
    .filter((x): x is TrendFiling => !!x);
  return {
    name,
    filings,
    first: day(p["first"]),
    last: day(p["last"]),
    byYear: arr(p["by_year"])
      .map((t) => {
        const r = obj(t);
        const y = yr(r?.["year"]);
        const n = count(r?.["filings"]);
        return y != null && n != null && n <= filings ? { year: y, filings: n } : null;
      })
      .filter((x): x is { year: number; filings: number } => !!x)
      .sort((a, b) => a.year - b.year),
    byCourt: arr(p["by_court"])
      .map((t) => {
        const r = obj(t);
        const court = str(r?.["court"]);
        const n = count(r?.["filings"]);
        const cid = str(r?.["court_id"]);
        return court && n != null && n <= filings
          ? {
              court,
              filings: n,
              courtId: cid && COURT_ID.test(cid) && r?.["link"] === `/courts/${cid}` ? cid : null,
            }
          : null;
      })
      .filter((x): x is CurrentTrend["byCourt"][number] => !!x),
    bySector: arr(p["by_sector"])
      .map((t) => {
        const r = obj(t);
        const sector = str(r?.["sector"]);
        const n = count(r?.["filings"]);
        return sector && n != null && n <= filings ? { sector, filings: n } : null;
      })
      .filter((x): x is { sector: string; filings: number } => !!x),
    rows,
  };
}

export function parseStatistics(rows: { id: string; p: unknown }[]): ScacStatistics {
  const out: ScacStatistics = {
    total: null,
    through: null,
    keyStats: [],
    settlementsUsd: null,
    status: [],
    years: [],
    circuits: [],
    sectors: [],
    industries: [],
    historical: [],
    current: [],
    settlements: [],
    durations: [],
    firms: [],
    dropped: 0,
  };
  for (const row of rows) {
    const p = obj(row.p);
    const kind = str(p?.["kind"]);
    let ok = false;
    if (!p || !kind) {
      out.dropped++;
      continue;
    }
    if (kind === "overview" && row.id === "overview:all") {
      out.total = count(p["total"]);
      out.through = day(p["through"]);
      out.settlementsUsd = count(p["settlements_total_usd"]);
      out.keyStats = arr(p["key_stats"])
        .map((t) => {
          const r = obj(t);
          const label = str(r?.["label"]);
          const value = str(r?.["value"]);
          return label && value ? { label, value } : null;
        })
        .filter((x): x is { label: string; value: string } => !!x);
      ok = out.total != null;
    } else if (kind === "year") {
      const y = yr(p["year"]);
      const f = count(p["filings"]);
      const fjc = obj(p["fjc_nos850"]);
      if (y != null && f != null && row.id === `year:${y}`) {
        out.years.push({
          year: y,
          filings: f,
          partial: p["partial"] === true,
          nos850Filings: fjc && fjc["fy"] === y ? count(fjc["filings"]) : null,
          nos850ClassActions: fjc && fjc["fy"] === y ? count(fjc["class_action"]) : null,
        });
        ok = true;
      }
    } else if (kind === "circuit") {
      const l = labelled(p);
      const cid = str(p["court_id"]);
      if (l) {
        out.circuits.push({ ...l, courtId: cid && COURT_ID.test(cid) ? cid : null });
        ok = true;
      }
    } else if (
      kind === "status" ||
      kind === "sector" ||
      kind === "industry" ||
      kind === "historical_trend"
    ) {
      const l = labelled(p);
      if (l) {
        (kind === "status"
          ? out.status
          : kind === "sector"
            ? out.sectors
            : kind === "industry"
              ? out.industries
              : out.historical
        ).push(l);
        ok = true;
      }
    } else if (kind === "current_trend") {
      const t = parseCurrentTrend(p);
      if (t) {
        out.current.push(t);
        ok = true;
      }
    } else if (
      kind === "top_settlement" ||
      kind === "top_duration" ||
      kind === "top_plaintiff_firm"
    ) {
      const rank = count(p["rank"]);
      const entity = str(p["entity"]);
      if (rank != null && entity) {
        const caseId = count(p["case_id"]);
        const casePage =
          caseId != null ? `https://securities.stanford.edu/filings-case.html?id=${caseId}` : null;
        if (kind === "top_settlement") {
          const amount = count(p["amount_usd"]);
          const fees = count(p["fees_usd"]);
          out.settlements.push({
            rank,
            entity,
            amountUsd: amount,
            feesUsd: fees != null && amount != null && fees <= amount ? fees : null,
            stage: str(p["stage"]),
            settledOn: day(p["settled_on"]),
            casePage,
          });
        } else if (kind === "top_duration") {
          const d = obj(p["details"]);
          const iso = (v: unknown) => {
            const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str(v) ?? "");
            return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
          };
          out.durations.push({
            rank,
            entity,
            days: count(p["days"]),
            filed: iso(d?.["Filing Date"]),
            lastStage: iso(d?.["Last Stage of Litigation Recorded Date"]),
            stage: str(p["stage"]),
          });
        } else {
          const prof = str(p["mdl_profile"]);
          const mdl = obj(p["mdl"]);
          out.firms.push({
            rank,
            entity,
            filings: count(p["filings"]),
            mdlProfile: prof && FIRM_RECORD.test(prof) ? prof : null,
            mdl: mdl ? { appearances: count(mdl["appearances"]), mdls: count(mdl["mdls"]) } : null,
          });
        }
        ok = true;
      }
    }
    if (!ok) out.dropped++;
  }
  const byRank = (a: { rank: number | null }, b: { rank: number | null }) =>
    (a.rank ?? 1e9) - (b.rank ?? 1e9);
  out.years.sort((a, b) => a.year - b.year);
  out.circuits.sort((a, b) => b.filings - a.filings);
  for (const list of [out.status, out.sectors, out.industries, out.historical])
    list.sort((a, b) => b.filings - a.filings);
  out.current.sort((a, b) => b.filings - a.filings);
  out.settlements.sort(byRank);
  out.durations.sort(byRank);
  out.firms.sort(byRank);
  return out;
}

export const getScacStatistics = createServerFn({ method: "GET" }).handler(
  async (): Promise<ScacStatistics> => {
    const r = await restGet<{ id: string; p: unknown }[]>(
      "corpus_records?select=id,p:item->profile&dataset=eq.scac_statistics&limit=500",
    );
    return parseStatistics(r.rows);
  },
);

// ------------------------------------------------------------------------------------------------ alignment

export type AlignmentYear = {
  year: number;
  filings: number;
  partial: boolean;
  vixMean: number | null;
  vixMax: number | null;
  nasdaqReturn: number | null;
  nasdaqDrawdown: number | null;
  marketReturn: number | null;
  nos850ClassActions: number | null;
  civilClassActions: number | null;
};
export type AlignmentCorrelation = {
  id: string;
  label: string;
  lag: number;
  rho: number;
  n: number;
  low: number;
  high: number;
  strength: string | null;
  points: { year: number; x: number; y: number }[];
};
export type ScacAlignment = {
  years: AlignmentYear[];
  correlations: AlignmentCorrelation[];
  dropped: number;
};

const pctRange = (v: unknown, lo: number, hi: number) => {
  const n = num(v);
  return n != null && n >= lo && n <= hi ? n : null;
};

export function parseAlignment(rows: { id: string; p: unknown }[]): ScacAlignment {
  const years: AlignmentYear[] = [];
  const correlations: AlignmentCorrelation[] = [];
  let dropped = 0;
  for (const row of rows) {
    const p = obj(row.p);
    if (row.id.startsWith("year:")) {
      const y = yr(p?.["year"]);
      const f = count(p?.["filings"]);
      if (!p || y == null || f == null || row.id !== `year:${y}`) {
        dropped++;
        continue;
      }
      years.push({
        year: y,
        filings: f,
        partial: p["partial"] === true,
        vixMean: pctRange(p["vix_mean"], 0, 200),
        vixMax: pctRange(p["vix_max"], 0, 200),
        nasdaqReturn: pctRange(p["nasdaq_return_pct"], -100, 1000),
        nasdaqDrawdown: pctRange(p["nasdaq_max_drawdown_pct"], -100, 0),
        marketReturn: pctRange(p["market_return_pct"], -100, 1000),
        nos850ClassActions: count(p["fjc_nos850_class_actions"]),
        civilClassActions: count(p["fjc_civil_class_actions"]),
      });
    } else if (row.id.startsWith("corr:")) {
      const label = str(p?.["label"]);
      const rho = num(p?.["rho"]);
      const n = count(p?.["n"]);
      const ci = arr(p?.["ci"]).map(num);
      const [low, high] = ci;
      if (
        !p ||
        !label ||
        rho == null ||
        Math.abs(rho) > 1 ||
        n == null ||
        n < 4 ||
        low == null ||
        high == null ||
        low > rho ||
        high < rho
      ) {
        dropped++;
        continue;
      }
      correlations.push({
        id: row.id,
        label,
        lag: count(p["lag"]) ?? 0,
        rho,
        n,
        low,
        high,
        strength: str(p["strength"]),
        points: arr(p["points"])
          .map((t) => {
            const r = obj(t);
            const y = yr(r?.["year"]);
            const x = num(r?.["x"]);
            const v = num(r?.["y"]);
            return y != null && x != null && v != null ? { year: y, x, y: v } : null;
          })
          .filter((x): x is { year: number; x: number; y: number } => !!x),
      });
    }
  }
  years.sort((a, b) => a.year - b.year);
  correlations.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
  return { years, correlations, dropped };
}

export const getScacAlignment = createServerFn({ method: "GET" }).handler(
  async (): Promise<ScacAlignment> => {
    const r = await restGet<{ id: string; p: unknown }[]>(
      "corpus_records?select=id,p:item->profile&dataset=eq.scac_trend_alignment&limit=200",
    );
    return parseAlignment(r.rows);
  },
);

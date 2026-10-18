/**
 * Federal court statistics (datasets court_stats_*): types, defensive parsers for stored JSON, and
 * pure view helpers. Values come from U.S. Courts Judicial Business tables (fiscal years ending
 * September 30). A malformed row is dropped and an unparsed value stays null ("Not recorded").
 */

export type Series = (number | null)[];

export const FLAG_RULES = [
  "pl_surge",
  "pl_decline",
  "pl_concentration",
  "pl_share_cluster",
  "slow_disposition",
  "aging_backlog",
] as const;
export type FlagRule = (typeof FLAG_RULES)[number];

export type StatFlag = {
  year: number;
  rule: FlagRule;
  value: number | null;
  baseline: number | null;
  ratio: number | null;
  sharePct: number | null;
  nationalSharePct: number | null;
  national: number | null;
  count: number | null;
};

export type MdlLink = {
  pendingDockets: number | null;
  pendingActions: number | null;
  plDockets: number | null;
  plActions: number | null;
  asOf: string | null;
};

export type DistrictRow = {
  id: string;
  name: string;
  circuit: string | null;
  pl: Series;
  civil: Series;
  share: Series;
  natShare: Series;
  judgeships: Series;
  plPerJudgeship: Series;
  civilPerJudgeship: Series;
  median: Series;
  trial: Series;
  over3: Series;
  pending: Series;
  pl5: number | null;
  mdl: MdlLink | null;
  flags: StatFlag[];
};

export type SourceRef = { page: string; url: string | null; format: string | null };

export type NationalSummary = {
  years: number[];
  latest: number;
  series: Record<string, Series>;
  plParts: Record<string, Series>;
  nos: Record<string, Series>;
  composition: Record<string, Series>;
  rules: Partial<Record<FlagRule, string>>;
  rulesShort: Partial<Record<FlagRule, string>>;
  plPartsLabels: Record<string, string>;
  compositionLabels: Record<string, string>;
  mdlCorrelation: {
    rho: number | null;
    n: number | null;
    x: string;
    y: string;
    asOf: string | null;
  };
  sources: Record<string, Record<string, SourceRef>>;
  listing: string | null;
  checks: {
    total: number | null;
    passed: number | null;
    failed: { check: string; detail: string }[];
  };
  notes: string[];
  retrievedAt: string | null;
};

export type CircuitStats = {
  id: string;
  name: string;
  districts: string[];
  appealsFiled: Series;
  appealsTerminated: Series;
  appealsPending: Series;
  merits: Series;
  medianNoticeToFinal: Series;
  medianLowerToFinal: Series;
  civilAppeals: Series;
  diversityPiPl: Series;
  districtCivil: Series;
  districtPl: Series;
  districtShare: Series;
  districtPerJudgeship: Series;
  districtJudgeships: Series;
  districtMedian: Series;
  districtOver3: Series;
};

export type DistrictTimes = {
  median: Series;
  terminations: Series;
  trial: Series;
  pending: Series;
  over3: Series;
  over3Pct: Series;
  nationalMedian: Series;
  nationalOver3Pct: Series;
  flags: StatFlag[];
  fastestRank: number | null;
  rankOf: number | null;
};

export type DistrictPanel = {
  id: string;
  name: string;
  circuit: string | null;
  circuitName: string | null;
  years: number[];
  pl: Series;
  civil: Series;
  share: Series;
  natShare: Series;
  judgeships: Series;
  plPerJudgeship: Series;
  plParts: Record<string, Series>;
  componentsWithheldYears: number[];
  pl5: number | null;
  flags: StatFlag[];
  ranks: {
    pl: number | null;
    share: number | null;
    perJudgeship: number | null;
    of: number | null;
  };
  mdl: MdlLink | null;
  times: DistrictTimes | null;
};

export type CourtStatsOverview = {
  years: number[];
  national: NationalSummary;
  districts: DistrictRow[];
  circuits: CircuitStats[];
};

// ---------------------------------------------------------------- defensive readers

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** A series of exactly `length` values; anything that is not a finite number becomes null. */
export function series(v: unknown, length: number): Series {
  const arr = Array.isArray(v) ? v : [];
  return Array.from({ length }, (_, i) => num(arr[i]));
}

function seriesMap(v: unknown, length: number): Record<string, Series> {
  const out: Record<string, Series> = {};
  if (!isObj(v)) return out;
  for (const [key, value] of Object.entries(v))
    if (Array.isArray(value)) out[key] = series(value, length);
  return out;
}

function stringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [key, value] of Object.entries(v)) if (typeof value === "string") out[key] = value;
  return out;
}

export function parseYears(v: unknown): number[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const years = v.map(num);
  if (years.some((y) => y === null || !Number.isInteger(y) || y < 1990 || y > 2100)) return null;
  const ok = years as number[];
  for (let i = 1; i < ok.length; i++) if (ok[i]! !== ok[i - 1]! + 1) return null;
  return ok;
}

export function parseFlag(v: unknown): StatFlag | null {
  if (!isObj(v)) return null;
  const year = num(v["year"]);
  const rule = v["rule"];
  if (
    year === null ||
    typeof rule !== "string" ||
    !(FLAG_RULES as readonly string[]).includes(rule)
  )
    return null;
  return {
    year,
    rule: rule as FlagRule,
    value: num(v["value"]),
    baseline: num(v["baseline"]),
    ratio: num(v["ratio"]),
    sharePct: num(v["share_pct"]),
    nationalSharePct: num(v["national_share_pct"]),
    national: num(v["national"]),
    count: num(v["count"]),
  };
}

const flags = (v: unknown) =>
  (Array.isArray(v) ? v : []).map(parseFlag).filter((f): f is StatFlag => f !== null);

function parseMdl(v: unknown): MdlLink | null {
  if (!isObj(v)) return null;
  return {
    pendingDockets: num(v["pending_dockets"]),
    pendingActions: num(v["pending_actions"]),
    plDockets: num(v["pl_dockets"]),
    plActions: num(v["pl_actions"]),
    asOf: str(v["as_of"]),
  };
}

const COURT_ID = /^[a-z0-9]{2,12}$/;

export function parseDistrictRow(v: unknown, length: number): DistrictRow | null {
  if (!isObj(v)) return null;
  const id = str(v["id"]);
  const name = str(v["name"]);
  if (!id || !COURT_ID.test(id) || !name) return null;
  if (!Array.isArray(v["pl"]) || !Array.isArray(v["civil"])) return null;
  return {
    id,
    name,
    circuit: str(v["circuit"]),
    pl: series(v["pl"], length),
    civil: series(v["civil"], length),
    share: series(v["share"], length),
    natShare: series(v["nat_share"], length),
    judgeships: series(v["judgeships"], length),
    plPerJudgeship: series(v["pl_per_j"], length),
    civilPerJudgeship: series(v["civil_per_j"], length),
    median: series(v["median"], length),
    trial: series(v["trial"], length),
    over3: series(v["over3"], length),
    pending: series(v["pending"], length),
    pl5: num(v["pl5"]),
    mdl: parseMdl(v["mdl"]),
    flags: flags(v["flags"]),
  };
}

export function parseMatrix(v: unknown): { years: number[]; rows: DistrictRow[] } | null {
  if (!isObj(v)) return null;
  const years = parseYears(v["years"]);
  if (!years || !Array.isArray(v["rows"])) return null;
  const rows = v["rows"]
    .map((row) => parseDistrictRow(row, years.length))
    .filter((r): r is DistrictRow => r !== null);
  return { years, rows };
}

function parseSources(v: unknown): Record<string, Record<string, SourceRef>> {
  const out: Record<string, Record<string, SourceRef>> = {};
  if (!isObj(v)) return out;
  for (const [table, byYear] of Object.entries(v)) {
    if (!isObj(byYear)) continue;
    for (const [year, ref] of Object.entries(byYear)) {
      if (!isObj(ref)) continue;
      const page = str(ref["page"]);
      if (!page || !page.startsWith("https://www.uscourts.gov/")) continue;
      const url = str(ref["url"]);
      (out[table] ??= {})[year] = {
        page,
        url: url && url.startsWith("https://www.uscourts.gov/") ? url : null,
        format: str(ref["format"]),
      };
    }
  }
  return out;
}

export function parseNational(v: unknown): NationalSummary | null {
  if (!isObj(v)) return null;
  const years = parseYears(v["years"]);
  const latest = num(v["latest"]);
  const s = v["series"];
  if (!years || latest === null || !isObj(s)) return null;
  const n = years.length;
  const flat: Record<string, Series> = {};
  for (const [key, value] of Object.entries(s))
    if (Array.isArray(value)) flat[key] = series(value, n);
  const corr = isObj(v["mdl_correlation"]) ? v["mdl_correlation"] : {};
  const checks = isObj(v["checks"]) ? v["checks"] : {};
  const failed = (Array.isArray(checks["failed"]) ? checks["failed"] : [])
    .filter(isObj)
    .map((c) => ({ check: str(c["check"]) ?? "", detail: str(c["detail"]) ?? "" }))
    .filter((c) => c.check);
  const rules = stringMap(v["rules"]);
  const rulesShort = stringMap(v["rules_short"]);
  return {
    years,
    latest,
    series: flat,
    plParts: seriesMap(s["pl_parts"], n),
    nos: seriesMap(s["nos"], n),
    composition: seriesMap(s["composition"], n),
    rules: Object.fromEntries(FLAG_RULES.filter((r) => rules[r]).map((r) => [r, rules[r]!])),
    rulesShort: Object.fromEntries(
      FLAG_RULES.filter((r) => rulesShort[r]).map((r) => [r, rulesShort[r]!]),
    ),
    plPartsLabels: stringMap(v["pl_parts_labels"]),
    compositionLabels: stringMap(v["composition_labels"]),
    mdlCorrelation: {
      rho: num(corr["spearman_rho"]),
      n: num(corr["n"]),
      x: str(corr["x"]) ?? "",
      y: str(corr["y"]) ?? "",
      asOf: str(corr["as_of"]),
    },
    sources: parseSources(v["sources"]),
    listing: str(v["listing"]),
    checks: { total: num(checks["total"]), passed: num(checks["passed"]), failed },
    notes: (Array.isArray(v["notes"]) ? v["notes"] : []).filter(
      (x): x is string => typeof x === "string",
    ),
    retrievedAt: str(v["retrieved_at"]),
  };
}

export function parseCircuit(v: unknown): CircuitStats | null {
  if (!isObj(v)) return null;
  const id = str(v["circuit_id"]);
  const name = str(v["name"]);
  const years = parseYears(v["years"]);
  if (!id || !/^ca(dc|\d{1,2})$/.test(id) || !name || !years) return null;
  const n = years.length;
  return {
    id,
    name,
    districts: (Array.isArray(v["districts"]) ? v["districts"] : []).filter(
      (d): d is string => typeof d === "string" && COURT_ID.test(d),
    ),
    appealsFiled: series(v["appeals_filed"], n),
    appealsTerminated: series(v["appeals_terminated"], n),
    appealsPending: series(v["appeals_pending"], n),
    merits: series(v["merits_terminations"], n),
    medianNoticeToFinal: series(v["median_notice_to_final"], n),
    medianLowerToFinal: series(v["median_lower_court_to_final"], n),
    civilAppeals: series(v["civil_appeals"], n),
    diversityPiPl: series(v["diversity_pi_pl_appeals"], n),
    districtCivil: series(v["district_civil_filed"], n),
    districtPl: series(v["district_pl_total"], n),
    districtShare: series(v["district_pl_share_pct"], n),
    districtPerJudgeship: series(v["district_pl_per_judgeship"], n),
    districtJudgeships: series(v["district_judgeships"], n),
    districtMedian: series(v["district_median_total"], n),
    districtOver3: series(v["district_over_3y_pct"], n),
  };
}

export function parseDistrictPanel(stats: unknown, times: unknown): DistrictPanel | null {
  if (!isObj(stats)) return null;
  const id = str(stats["court_id"]);
  const name = str(stats["name"]);
  const years = parseYears(stats["years"]);
  if (!id || !COURT_ID.test(id) || !name || !years || !Array.isArray(stats["pl_total"]))
    return null;
  const n = years.length;
  const ranks = isObj(stats["ranks"]) ? stats["ranks"] : {};
  let t: DistrictTimes | null = null;
  if (isObj(times) && str(times["court_id"]) === id && parseYears(times["years"])?.length === n) {
    const tr = isObj(times["ranks"]) ? times["ranks"] : {};
    t = {
      median: series(times["median_total"], n),
      terminations: series(times["terminations_measured"], n),
      trial: series(times["median_trial"], n),
      pending: series(times["pending"], n),
      over3: series(times["pending_over_3y"], n),
      over3Pct: series(times["pending_over_3y_pct"], n),
      nationalMedian: series(times["national_median_total"], n),
      nationalOver3Pct: series(times["national_over_3y_pct"], n),
      flags: flags(times["flags"]),
      fastestRank: num(tr["median_total_fastest"]),
      rankOf: num(tr["of"]),
    };
  }
  return {
    id,
    name,
    circuit: str(stats["circuit"]),
    circuitName: str(stats["circuit_name"]),
    years,
    pl: series(stats["pl_total"], n),
    civil: series(stats["civil_filed"], n),
    share: series(stats["pl_share_pct"], n),
    natShare: series(stats["pl_national_share_pct"], n),
    judgeships: series(stats["judgeships"], n),
    plPerJudgeship: series(stats["pl_per_judgeship"], n),
    plParts: seriesMap(stats["pl_parts"], n),
    componentsWithheldYears: (Array.isArray(stats["pl_components_withheld_years"])
      ? stats["pl_components_withheld_years"]
      : []
    ).filter((y): y is number => typeof y === "number" && Number.isInteger(y)),
    pl5: num(stats["pl_5y_median"]),
    flags: flags(stats["flags"]),
    ranks: {
      pl: num(ranks["pl_total"]),
      share: num(ranks["pl_share_pct"]),
      perJudgeship: num(ranks["pl_per_judgeship"]),
      of: num(ranks["of"]),
    },
    mdl: parseMdl(stats["mdl"]),
    times: t,
  };
}

// ---------------------------------------------------------------- view helpers

/** Recharts axis and tooltip styling shared by the court statistics charts (tokens only). */
export const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
export const tooltipStyle = {
  fontSize: 12,
  borderRadius: 4,
  borderColor: "var(--border)",
  backgroundColor: "var(--surface)",
};

export const NOT_RECORDED = "Not recorded";

export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return NOT_RECORDED;
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  return typeof v === "number" && Number.isFinite(v) ? `${fmtNum(v, digits)}%` : NOT_RECORDED;
}

export function compactNum(v: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    v,
  );
}

/** Percent change between two published values; null unless both exist and the base is non-zero. */
export function change(current: number | null | undefined, base: number | null | undefined) {
  if (typeof current !== "number" || typeof base !== "number" || base === 0) return null;
  return (100 * (current - base)) / base;
}

export function median(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

export function at(s: Series | undefined, i: number): number | null {
  return s?.[i] ?? null;
}

/** Background intensity 0..1 for a heat cell: square-root scale against the row's own maximum. */
export function heat(value: number | null, rowMax: number): number {
  if (value === null || rowMax <= 0) return 0;
  return Math.sqrt(Math.max(0, value) / rowMax);
}

export const CIRCUIT_ORDER = [
  "cadc",
  "ca1",
  "ca2",
  "ca3",
  "ca4",
  "ca5",
  "ca6",
  "ca7",
  "ca8",
  "ca9",
  "ca10",
  "ca11",
];
export const CIRCUIT_SHORT: Record<string, string> = {
  cadc: "D.C.",
  ca1: "1st",
  ca2: "2nd",
  ca3: "3rd",
  ca4: "4th",
  ca5: "5th",
  ca6: "6th",
  ca7: "7th",
  ca8: "8th",
  ca9: "9th",
  ca10: "10th",
  ca11: "11th",
};

export const RULE_FALLBACK_SHORT: Record<FlagRule, string> = {
  pl_surge: "Product liability surge",
  pl_decline: "Product liability drop",
  pl_concentration: "National PL concentration",
  pl_share_cluster: "PL-heavy civil docket",
  slow_disposition: "Slow civil disposition",
  aging_backlog: "Aging civil backlog",
};

/** One-line, source-stated explanation of why a flag fired. */
export function flagDetail(f: StatFlag): string {
  switch (f.rule) {
    case "pl_surge":
    case "pl_decline":
      return `${fmtNum(f.value)} filings vs prior five-year median ${fmtNum(f.baseline)}${
        f.ratio !== null ? ` (${fmtNum(f.ratio, f.rule === "pl_decline" ? 2 : 1)}x)` : ""
      }`;
    case "pl_concentration":
      return `${fmtNum(f.value)} filings, ${fmtPct(f.sharePct)} of national product liability filings`;
    case "pl_share_cluster":
      return `${fmtPct(f.sharePct)} of civil filings vs ${fmtPct(f.nationalSharePct)} nationally`;
    case "slow_disposition":
      return `${fmtNum(f.value, 1)} months vs national median ${fmtNum(f.national, 1)}`;
    case "aging_backlog":
      return `${fmtPct(f.value)} pending 3+ years (${fmtNum(f.count)} cases) vs ${fmtPct(f.national)} nationally`;
  }
}

export type SortKey =
  | "name"
  | "pl"
  | "share"
  | "natShare"
  | "perJudgeship"
  | "civil"
  | "median"
  | "over3"
  | "change"
  | "flags";

/** Value used to sort a district row for fiscal-year index i (fiscal year `year`); nulls sort last. */
export function sortValue(
  row: DistrictRow,
  key: SortKey,
  i: number,
  year: number,
): number | string | null {
  switch (key) {
    case "name":
      return row.name;
    case "pl":
      return at(row.pl, i);
    case "share":
      return at(row.share, i);
    case "natShare":
      return at(row.natShare, i);
    case "perJudgeship":
      return at(row.plPerJudgeship, i);
    case "civil":
      return at(row.civil, i);
    case "median":
      return at(row.median, i);
    case "over3":
      return at(row.over3, i);
    case "change":
      return i > 0 ? change(at(row.pl, i), at(row.pl, i - 1)) : null;
    case "flags":
      return row.flags.filter((f) => f.year === year).length;
  }
}

export function sortRows(
  rows: DistrictRow[],
  key: SortKey,
  i: number,
  year: number,
  desc: boolean,
) {
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key, i, year);
    const vb = sortValue(b, key, i, year);
    if (va === null && vb === null) return a.name.localeCompare(b.name);
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp =
      typeof va === "string" || typeof vb === "string"
        ? String(va).localeCompare(String(vb))
        : va - vb;
    return (desc ? -cmp : cmp) || a.name.localeCompare(b.name);
  });
}

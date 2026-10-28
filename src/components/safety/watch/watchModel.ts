/**
 * Product watch model: every product's last 12 complete months of FDA reports (FAERS drugs, MAUDE device product codes,
 * MDL product groups, NHTSA vehicle groups) against the 12 months before, scaled by the change in all reports from the
 * same system, so a product only reads as rising when it outpaces its source as a whole.
 *
 *   expected = prior 12 months × (all reports, last 12 ÷ all reports, prior 12)
 *   ratio    = last 12 ÷ expected, with an approximate 95% interval for the last-12 count (Byar's approximation to the
 *              exact Poisson limits)
 *   sharp    = the interval's lower end is at least 1.5 × expected
 *   rising   = the lower end is above expected
 *   falling  = the upper end is below expected
 *   new      = at least 50 reports in the last 12 months against fewer than 10 before
 *   low      = fewer than 50 reports in the last 12 months (not rated)
 *
 * MDL status joins two recorded sources only: the product's own MDL links (safety.mdl_subjects, MDL product groups) and
 * the emerging-tort radar's links (exact names, Drugs@FDA brand to ingredient, the class a title names, the reviewed
 * class list). "No MDL linked" means none of those keys links it, not that no litigation exists. Device product codes
 * carry no MDL keys of their own (MDLs are linked to device groups, not FDA product codes), so a device code without a
 * recorded link is "MDL links not keyed", never "No MDL linked".
 */
import { z } from "zod";

export type WatchSource = "faers" | "maude" | "nhtsa";
export type WatchSignal = "sharp" | "rising" | "steady" | "falling" | "new" | "low";
export type MdlStatus = "pending" | "closed" | "none" | "unkeyed";

export const MIN_RATED = 50;
export const MIN_BASELINE = 10;
const Z = 1.96;

export const SIGNAL_LABEL: Record<WatchSignal, string> = {
  sharp: "Rising sharply",
  rising: "Rising",
  steady: "In line",
  falling: "Falling",
  new: "Newly reported",
  low: "Too few to rate",
};
export const STATUS_LABEL: Record<MdlStatus, string> = {
  pending: "Pending MDL",
  closed: "Closed MDL only",
  none: "No MDL linked",
  unkeyed: "MDL links not keyed",
};
export const SOURCE_LABEL: Record<WatchSource, string> = {
  faers: "FAERS drug reports",
  maude: "MAUDE device reports",
  nhtsa: "NHTSA complaints",
};

export type WatchMdl = { mdl: number; title: string | null; status: string; basis: string | null };
export type WatchTerm = { term: string; prior: number; recent: number };
export type WatchRadar = {
  unit: string;
  status: string | null;
  links: WatchMdl[];
  brands: string[];
  sponsors: string[];
  points: number | null;
  rank: number | null;
  terms: WatchTerm[];
};

export type WatchRow = {
  id: string;
  label: string;
  type: string;
  kind: string;
  source: WatchSource;
  end: string;
  recent: number | null;
  prior: number | null;
  deaths: number | null;
  deathsPrior: number | null;
  severe: number | null;
  severePrior: number | null;
  mdls: number[];
  pending: number[];
  actionsPending: number | null;
  tail: number[];
  radar: WatchRadar | null;
};

const num = z.number().finite().nullable();
const rowSchema = z.tuple([
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.enum(["faers", "maude", "nhtsa"]),
  z.string().regex(/^\d{4}-\d{2}$/),
  num,
  num,
  num,
  num,
  num,
  num,
  z.array(z.number().int()),
  z.array(z.number().int()),
  num,
  z.array(z.number().nullable()),
  z.unknown(),
]);
const payloadSchema = z.object({
  asOf: z.record(z.string(), z.string()).nullable(),
  national: z.record(z.string(), z.tuple([num, num, z.string().nullable()])),
  rows: z.array(z.unknown()),
});

export type WatchPayload = {
  asOf: Partial<Record<WatchSource, string>>;
  national: Record<string, { recent: number | null; prior: number | null; end: string | null }>;
  rows: WatchRow[];
  dropped: number;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const strs = (v: unknown) =>
  Array.isArray(v) ? [...new Set(v.map(str).filter((s): s is string => !!s))] : [];
const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseRadar(v: unknown): WatchRadar | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const unit = str(o["unit"]);
  if (!unit) return null;
  const seen = new Set<number>();
  const links: WatchMdl[] = [];
  for (const raw of Array.isArray(o["links"]) ? o["links"] : []) {
    if (!raw || typeof raw !== "object") continue;
    const l = raw as Record<string, unknown>;
    const mdl = finite(l["mdl"]);
    if (mdl === null || !Number.isInteger(mdl) || seen.has(mdl)) continue;
    seen.add(mdl);
    links.push({
      mdl,
      title: str(l["title"]),
      status: str(l["status"]) ?? "unknown",
      basis: str(l["basis"]),
    });
  }
  const terms: WatchTerm[] = [];
  for (const raw of Array.isArray(o["terms"]) ? o["terms"] : []) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const term = str(t["term"]);
    const prior = finite(t["prior"]);
    const recent = finite(t["recent"]);
    if (term && prior !== null && recent !== null) terms.push({ term, prior, recent });
  }
  return {
    unit,
    status: str(o["status"]),
    links,
    brands: strs(o["brands"]),
    sponsors: strs(o["sponsors"]),
    points: finite(o["points"]),
    rank: finite(o["rank"]),
    terms,
  };
}

/** Reads the RPC payload; a malformed row is dropped and counted, never repaired. */
export function parseWatchPayload(raw: unknown): WatchPayload {
  const p = payloadSchema.parse(raw);
  const rows: WatchRow[] = [];
  let dropped = 0;
  for (const r of p.rows) {
    const t = rowSchema.safeParse(r);
    if (!t.success) {
      dropped++;
      continue;
    }
    const [
      id,
      label,
      type,
      kind,
      source,
      end,
      recent,
      prior,
      deaths,
      deathsPrior,
      severe,
      severePrior,
    ] = t.data;
    rows.push({
      id,
      label,
      type,
      kind,
      source,
      end,
      recent,
      prior,
      deaths,
      deathsPrior,
      severe,
      severePrior,
      mdls: t.data[12],
      pending: t.data[13],
      actionsPending: t.data[14],
      tail: t.data[15].map((v) => (typeof v === "number" ? v : 0)),
      radar: parseRadar(t.data[16]),
    });
  }
  const asOf: Partial<Record<WatchSource, string>> = {};
  for (const [k, v] of Object.entries(p.asOf ?? {}))
    if (k === "faers" || k === "maude" || k === "nhtsa") asOf[k] = v;
  const national: WatchPayload["national"] = {};
  for (const [k, [recent, prior, end]] of Object.entries(p.national))
    national[k] = { recent, prior, end };
  return { asOf, national, rows, dropped };
}

/** Approximate 95% limits of a Poisson count (Byar). Exact enough for counts of 10 or more; 0 has lower limit 0. */
export function poissonLimits(observed: number): { lower: number; upper: number } {
  if (!(observed >= 0) || !Number.isFinite(observed)) return { lower: NaN, upper: NaN };
  const lower =
    observed === 0
      ? 0
      : observed * Math.pow(1 - 1 / (9 * observed) - Z / (3 * Math.sqrt(observed)), 3);
  const o1 = observed + 1;
  const upper = o1 * Math.pow(1 - 1 / (9 * o1) + Z / (3 * Math.sqrt(o1)), 3);
  return { lower: Math.max(0, lower), upper };
}

export type NationalFactors = Record<
  WatchSource,
  { reports: number; deaths: number; severe: number }
>;

const factor = (n: WatchPayload["national"], key: string) => {
  const v = n[key];
  return v && v.recent !== null && v.prior !== null && v.prior > 0 ? v.recent / v.prior : 1;
};

export function nationalFactors(n: WatchPayload["national"]): NationalFactors {
  return {
    faers: {
      reports: factor(n, "faers:faers_reports"),
      deaths: factor(n, "faers:faers_death"),
      severe: factor(n, "faers:faers_serious"),
    },
    maude: {
      reports: factor(n, "maude:maude_reports"),
      deaths: factor(n, "maude:maude_death"),
      severe: factor(n, "maude:maude_injury"),
    },
    // NHTSA publishes no national complaint series here; vehicle groups are compared with their own past
    nhtsa: { reports: 1, deaths: 1, severe: 1 },
  };
}

export type Rated = {
  signal: WatchSignal;
  expected: number | null;
  ratio: number | null;
  lower: number | null;
  upper: number | null;
  excess: number | null;
};

/** Last-12 count against the expected count from the prior 12 and the source-wide change. */
export function rate(
  recent: number | null,
  prior: number | null,
  scale: number,
  min = MIN_RATED,
): Rated {
  const none = { expected: null, ratio: null, lower: null, upper: null, excess: null };
  if (recent === null || prior === null) return { signal: "low", ...none };
  if (recent < min) return { signal: "low", ...none };
  if (prior < MIN_BASELINE) return { signal: "new", ...none };
  const expected = prior * scale;
  const { lower, upper } = poissonLimits(recent);
  const lo = lower / expected;
  const hi = upper / expected;
  return {
    signal: lo >= 1.5 ? "sharp" : lo > 1 ? "rising" : hi < 1 ? "falling" : "steady",
    expected,
    ratio: recent / expected,
    lower: lo,
    upper: hi,
    excess: recent - expected,
  };
}

export type ScoredRow = WatchRow &
  Rated & {
    change: number | null;
    deathsRated: Rated;
    severeShare: number | null;
    severeSharePrior: number | null;
    status: MdlStatus;
    mdlLinks: WatchMdl[];
  };

export function mdlStatus(row: Pick<WatchRow, "type" | "mdls" | "pending" | "radar">): {
  status: MdlStatus;
  links: WatchMdl[];
} {
  const links = new Map<number, WatchMdl>();
  for (const l of row.radar?.links ?? []) links.set(l.mdl, l);
  for (const mdl of row.mdls)
    if (!links.has(mdl))
      links.set(mdl, {
        mdl,
        title: null,
        status: row.pending.includes(mdl) ? "pending" : "terminated",
        basis: "recorded_link",
      });
  const list = [...links.values()].sort((a, b) => a.mdl - b.mdl);
  const pending =
    row.pending.length > 0 ||
    row.radar?.status === "pending_mdl" ||
    list.some((l) => l.status === "pending");
  return {
    status: pending
      ? "pending"
      : list.length || row.radar?.status === "terminated_mdl"
        ? "closed"
        : row.type === "device_code"
          ? "unkeyed"
          : "none",
    links: list,
  };
}

export function scoreRow(row: WatchRow, f: NationalFactors): ScoredRow {
  const scale = f[row.source];
  const rated = rate(row.recent, row.prior, scale.reports);
  const { status, links } = mdlStatus(row);
  return {
    ...row,
    ...rated,
    change:
      row.recent !== null && row.prior !== null && row.prior > 0
        ? ((row.recent - row.prior) / row.prior) * 100
        : null,
    deathsRated: rate(row.deaths, row.deathsPrior, scale.deaths, 10),
    severeShare: row.severe !== null && row.recent ? (100 * row.severe) / row.recent : null,
    severeSharePrior:
      row.severePrior !== null && row.prior ? (100 * row.severePrior) / row.prior : null,
    status,
    mdlLinks: links,
  };
}

/** Months of a tail ending at `end` (YYYY-MM), oldest first. */
export function tailMonths(end: string, length: number): string[] {
  const y = Number(end.slice(0, 4));
  const m = Number(end.slice(5, 7));
  return Array.from({ length }, (_, i) => {
    const t = y * 12 + (m - 1) - (length - 1 - i);
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  });
}

const rankOrder = (a: ScoredRow, b: ScoredRow) =>
  (b.lower ?? 0) - (a.lower ?? 0) || (b.excess ?? 0) - (a.excess ?? 0);

/** A point on the momentum map (no tail, to keep the payload small). */
export type WatchPoint = {
  id: string;
  label: string;
  kind: string;
  source: WatchSource;
  recent: number;
  ratio: number;
  signal: WatchSignal;
  status: MdlStatus;
};

export type WatchCard = {
  id: string;
  label: string;
  kind: string;
  type: string;
  source: WatchSource;
  end: string;
  recent: number | null;
  prior: number | null;
  expected: number | null;
  ratio: number | null;
  lower: number | null;
  change: number | null;
  signal: WatchSignal;
  deaths: number | null;
  deathsPrior: number | null;
  deathsExpected: number | null;
  deathsRatio: number | null;
  deathsSignal: WatchSignal;
  severeShare: number | null;
  severeSharePrior: number | null;
  status: MdlStatus;
  mdls: WatchMdl[];
  actionsPending: number | null;
  tail: number[];
  brands: string[];
  sponsors: string[];
  terms: WatchTerm[];
  radarPoints: number | null;
  /** Other subjects with exactly the same counts (spellings or strengths of one product), folded into this card. */
  aliases: string[];
  /** Subjects in the same list whose counts agree within 0.5% (likely the same reports under another name). */
  near: string[];
  /** Share of the last 12 months' reports that fall in one month, with that month (possible batch filing). */
  peakMonth: { month: string; share: number } | null;
  /** True when the prior 12 months hold under a fifth of the last 12: typical of a newly launched product. */
  uptake: boolean;
};

export type WatchView = {
  asOf: Partial<Record<WatchSource, string>>;
  factors: NationalFactors;
  national: WatchPayload["national"];
  counts: {
    monitored: number;
    rated: number;
    bySignal: Record<WatchSignal, number>;
    risingNoMdl: number;
    risingDevices: number;
    risingPending: number;
    deathsRising: number;
    pendingMdls: number;
    bySource: Record<WatchSource, number>;
  };
  emerging: WatchCard[];
  devices: WatchCard[];
  litigated: WatchCard[];
  deaths: WatchCard[];
  points: WatchPoint[];
  dropped: number;
};

/** The month holding the largest share of the last 12 months, when one month holds at least 40% of them. */
export function peakMonth(tail: readonly number[], end: string): WatchCard["peakMonth"] {
  const last = tail.slice(-12);
  const total = last.reduce((a, b) => a + b, 0);
  if (total < MIN_RATED || last.length < 12) return null;
  let best = 0;
  for (let i = 1; i < last.length; i++) if ((last[i] ?? 0) > (last[best] ?? 0)) best = i;
  const share = (100 * (last[best] ?? 0)) / total;
  if (share < 40) return null;
  const months = tailMonths(end, 12);
  return { month: months[best]!, share };
}

/** The prior 12 months hold under a fifth of the last 12: a launch, rapid uptake or a jump from a low base. */
export function isUptake(r: Pick<WatchRow, "recent" | "prior">): boolean {
  return r.recent !== null && r.prior !== null && r.recent >= MIN_RATED && r.prior * 5 < r.recent;
}

function card(r: ScoredRow & { aliases?: string[] }): WatchCard {
  return {
    id: r.id,
    label: r.label,
    kind: r.kind,
    type: r.type,
    source: r.source,
    end: r.end,
    recent: r.recent,
    prior: r.prior,
    expected: r.expected,
    ratio: r.ratio,
    lower: r.lower,
    change: r.change,
    signal: r.signal,
    deaths: r.deaths,
    deathsPrior: r.deathsPrior,
    deathsExpected: r.deathsRated.expected,
    deathsRatio: r.deathsRated.ratio,
    deathsSignal: r.deathsRated.signal,
    severeShare: r.severeShare,
    severeSharePrior: r.severeSharePrior,
    status: r.status,
    mdls: r.mdlLinks,
    actionsPending: r.actionsPending,
    tail: r.tail,
    brands: r.radar?.brands ?? [],
    sponsors: r.radar?.sponsors ?? [],
    terms: r.radar?.terms ?? [],
    radarPoints: r.radar?.points ?? null,
    aliases: r.aliases ?? [],
    near: [],
    peakMonth: peakMonth(r.tail, r.end),
    uptake:
      r.recent !== null && r.prior !== null && r.recent >= MIN_RATED && r.prior * 5 < r.recent,
  };
}

const TYPE_PREFERENCE: Record<string, number> = { mdl_group: 0, product: 1, device_code: 2 };

/**
 * Subjects whose every count is identical (one product under several spellings or strengths, an MDL group and the one
 * product it names) are one card: the preferred subject (an MDL group, then the shortest label) keeps the others as
 * aliases. Counts are never added together.
 */
export function foldDuplicates(rows: readonly ScoredRow[]): (ScoredRow & { aliases: string[] })[] {
  const groups = new Map<string, ScoredRow[]>();
  for (const r of rows) {
    const key = [
      r.source,
      r.recent,
      r.prior,
      r.deaths,
      r.deathsPrior,
      r.severe,
      r.severePrior,
    ].join("|");
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const out: (ScoredRow & { aliases: string[] })[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort(
      (a, b) =>
        (TYPE_PREFERENCE[a.type] ?? 9) - (TYPE_PREFERENCE[b.type] ?? 9) ||
        a.label.length - b.label.length ||
        a.label.localeCompare(b.label),
    );
    const [head, ...rest] = sorted;
    if (!head) continue;
    // links found for any spelling hold for the product
    const links = new Map(head.mdlLinks.map((l) => [l.mdl, l] as const));
    for (const r of rest) for (const l of r.mdlLinks) if (!links.has(l.mdl)) links.set(l.mdl, l);
    const status: MdlStatus = [head, ...rest].some((r) => r.status === "pending")
      ? "pending"
      : [head, ...rest].some((r) => r.status === "closed")
        ? "closed"
        : head.status;
    out.push({
      ...head,
      status,
      mdlLinks: [...links.values()].sort((a, b) => a.mdl - b.mdl),
      radar: head.radar ?? rest.find((r) => r.radar)?.radar ?? null,
      aliases: rest.map((r) => r.label),
    });
  }
  return out;
}

const RISING = new Set<WatchSignal>(["sharp", "rising", "new"]);

const close = (a: number | null, b: number | null) =>
  a !== null && b !== null && Math.abs(a - b) <= Math.max(2, 0.005 * Math.max(a, b));

/**
 * Builds a list's cards, folding a card whose report and death counts agree within 0.5% with one already listed from
 * the same source into that card's `near` names. Nothing is added together; the first card keeps its own counts.
 */
export function listCards(
  rows: readonly (ScoredRow & { aliases: string[] })[],
  limit: number,
): WatchCard[] {
  const out: WatchCard[] = [];
  for (const r of rows) {
    const twin = out.find(
      (c) =>
        c.source === r.source &&
        close(c.recent, r.recent) &&
        close(c.prior, r.prior) &&
        close(c.deaths, r.deaths),
    );
    if (twin) {
      if (r.type === "mdl_group" && twin.type !== "mdl_group") {
        // an MDL product group names the product as the litigation does: it leads, the generic name follows
        const lead = card(r);
        lead.near = [twin.label, ...twin.near];
        out[out.indexOf(twin)] = lead;
      } else twin.near.push(r.label);
      continue;
    }
    if (out.length < limit) out.push(card(r));
  }
  return out;
}

/** The whole watch: counts, the three ranked lists with their monthly tails, and the map points. */
export function buildWatch(
  payload: WatchPayload,
  limits = { emerging: 12, devices: 8, litigated: 10, deaths: 10, points: 1500 },
): WatchView {
  const factors = nationalFactors(payload.national);
  const scored = foldDuplicates(payload.rows.map((r) => scoreRow(r, factors)));
  const bySignal = { sharp: 0, rising: 0, steady: 0, falling: 0, new: 0, low: 0 } as Record<
    WatchSignal,
    number
  >;
  const bySource = { faers: 0, maude: 0, nhtsa: 0 } as Record<WatchSource, number>;
  for (const r of scored) {
    bySignal[r.signal]++;
    bySource[r.source]++;
  }
  // an MDL product group repeats the products it groups; the emerging list keeps single products only
  // qualifiers sort a rise later, never out: a newly reported product, then rapid uptake (reports rising with use), then
  // a year whose reports sit mostly in one month (batch filing) come after rises without them
  const caveats = (r: ScoredRow) =>
    (r.signal === "new" ? 4 : 0) + (isUptake(r) ? 2 : 0) + (peakMonth(r.tail, r.end) ? 1 : 0);
  const byCaveats = (a: ScoredRow, b: ScoredRow) => caveats(a) - caveats(b) || rankOrder(a, b);
  const emerging = scored
    .filter((r) => r.type !== "mdl_group" && r.status === "none" && RISING.has(r.signal))
    .sort(byCaveats);
  const devices = scored
    .filter((r) => r.status === "unkeyed" && (r.signal === "sharp" || r.signal === "rising"))
    .sort(byCaveats);
  const litigated = scored
    .filter((r) => r.status === "pending" && (r.signal === "sharp" || r.signal === "rising"))
    .sort(rankOrder);
  const deaths = scored
    .filter(
      (r) =>
        r.type !== "mdl_group" &&
        (r.deathsRated.signal === "sharp" || r.deathsRated.signal === "rising"),
    )
    .sort((a, b) => (b.deathsRated.excess ?? 0) - (a.deathsRated.excess ?? 0));
  const pendingMdls = new Set<number>();
  for (const r of scored)
    for (const l of r.mdlLinks) if (l.status === "pending") pendingMdls.add(l.mdl);
  const points: WatchPoint[] = scored
    .flatMap((r): WatchPoint[] =>
      r.type !== "mdl_group" && r.recent !== null && r.ratio !== null && r.ratio > 0
        ? [
            {
              id: r.id,
              label: r.label,
              kind: r.kind,
              source: r.source,
              recent: r.recent,
              ratio: r.ratio,
              signal: r.signal,
              status: r.status,
            },
          ]
        : [],
    )
    .sort((a, b) => b.recent - a.recent)
    .slice(0, limits.points);
  return {
    asOf: payload.asOf,
    factors,
    national: payload.national,
    counts: {
      monitored: scored.length,
      rated: scored.filter((r) => r.signal !== "low").length,
      bySignal,
      risingNoMdl: emerging.length,
      risingDevices: devices.length,
      risingPending: litigated.length,
      deathsRising: deaths.length,
      pendingMdls: pendingMdls.size,
      bySource,
    },
    emerging: listCards(emerging, limits.emerging),
    devices: listCards(devices, limits.devices),
    litigated: listCards(litigated, limits.litigated),
    deaths: listCards(deaths, limits.deaths),
    points,
    dropped: payload.dropped,
  };
}

/** One subject's card, scored against the same source-wide factors as the watch; null when it is not on the watch. */
export function cardFor(payload: WatchPayload, id: string): WatchCard | null {
  const row = payload.rows.find((r) => r.id === id);
  if (!row) return null;
  const factors = nationalFactors(payload.national);
  // fold with its exact twins, so a spelling of a product reports the same aliases as the watch
  const twins = foldDuplicates(
    payload.rows
      .filter(
        (r) =>
          r.source === row.source &&
          r.recent === row.recent &&
          r.prior === row.prior &&
          r.deaths === row.deaths &&
          r.deathsPrior === row.deathsPrior,
      )
      .map((r) => scoreRow(r, factors)),
  );
  const own = twins[0];
  if (!own) return null;
  const c = card(own);
  // the page's own subject leads its card, whatever the folding preferred
  if (own.id !== id) {
    const self = scoreRow(row, factors);
    return {
      ...c,
      id: self.id,
      label: self.label,
      type: self.type,
      aliases: [own.label, ...own.aliases.filter((a) => a !== self.label)],
    };
  }
  return c;
}

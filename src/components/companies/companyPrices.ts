/**
 * Share-price history of a registrant (company_price_history, src/lib/ingest/sources/companyPrices.ts) and the dated
 * events drawn on it. Pure: parsing of stored rows, windows, close-to-close moves around an event, and the events
 * themselves (MDL centralization and closing dates from the JPML records of the company's MDL links; SEC, FTC and DOJ
 * actions linked to the company by CIK). A move around an event is measured, never attributed to it.
 */

export type PricePoint = readonly [string, number];

export type PriceSeries = {
  id: string;
  ticker: string;
  exchange: string;
  currency: string;
  points: PricePoint[];
  first: string;
  last: string;
  splits: { date: string; ratio: string }[];
  /** The listing exchange's quote page (or the SEC filing index for other venues). */
  listingUrl: string;
};

export type EventKind = "mdl_centralized" | "mdl_closed" | "sec" | "ftc" | "doj";

export type PriceEvent = {
  id: string;
  date: string;
  kind: EventKind;
  label: string;
  /** MDL link evidence tier (A/B read as defendant; C names the company only by subject). */
  tier?: "A" | "B" | "C" | null | undefined;
  url?: string | null | undefined;
  mdl?: number | undefined;
};

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  mdl_centralized: "MDL centralized",
  mdl_closed: "MDL closed",
  sec: "SEC action",
  ftc: "FTC action",
  doj: "DOJ release",
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 300) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

function httpUrl(v: unknown): string | null {
  const s = str(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A stored company_price_history row, or null when it is malformed. Points must be dated, positive and ascending. */
export function parsePriceRow(id: string, item: unknown, sourceUrl: unknown): PriceSeries | null {
  if (!/^px:\d{10}$/.test(id) || !isObj(item) || !isObj(item["prices"])) return null;
  const p = item["prices"] as Obj;
  const ticker = str(p["ticker"], 16);
  const exchange = str(p["exchange"], 40);
  const listing = httpUrl(sourceUrl);
  if (!ticker || !exchange || !listing || !Array.isArray(p["points"])) return null;
  const points: PricePoint[] = [];
  let prev = "";
  for (const raw of p["points"] as unknown[]) {
    if (!Array.isArray(raw)) continue;
    const d = raw[0];
    const v = raw[1];
    if (typeof d !== "string" || !ISO.test(d) || typeof v !== "number" || !Number.isFinite(v))
      continue;
    if (v <= 0 || d <= prev) continue;
    points.push([d, v]);
    prev = d;
  }
  if (points.length < 2) return null;
  const splits = Array.isArray(p["splits"])
    ? (p["splits"] as unknown[]).flatMap((s) => {
        if (!isObj(s)) return [];
        const date = str(s["date"], 10);
        const ratio = str(s["ratio"], 20);
        return date && ISO.test(date) && ratio ? [{ date, ratio }] : [];
      })
    : [];
  return {
    id,
    ticker,
    exchange,
    currency: str(p["currency"], 8) ?? "USD",
    points,
    first: points[0]![0],
    last: points[points.length - 1]![0],
    splits,
    listingUrl: listing,
  };
}

/** Index of the first point on or after `date` (points.length when none). */
export function firstOnOrAfter(points: readonly PricePoint[], date: string): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]![0] < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Points inside [from, to] (inclusive dates). */
export function windowPoints(
  points: readonly PricePoint[],
  from: string,
  to: string,
): PricePoint[] {
  const a = firstOnOrAfter(points, from);
  const b = firstOnOrAfter(points, `${to}~`);
  return points.slice(a, b);
}

export type Reaction = {
  /** Close of the last trading day before the event. */
  base: PricePoint;
  /** First close on or after the event date, and its change against the base (fraction). */
  day1: PricePoint;
  change1: number;
  /** Fifth close on or after the event date, and its change against the base; null when not yet traded. */
  day5: PricePoint | null;
  change5: number | null;
};

/**
 * Close-to-close moves around an event: the close before the event date against the first and the fifth close on or
 * after it. Null when the event falls outside the recorded closes (no close before it, or none on or after it).
 */
export function reaction(points: readonly PricePoint[], date: string): Reaction | null {
  const i = firstOnOrAfter(points, date);
  if (i <= 0 || i >= points.length) return null;
  const base = points[i - 1]!;
  const day1 = points[i]!;
  const day5 = points[i + 4] ?? null;
  return {
    base,
    day1,
    change1: day1[1] / base[1] - 1,
    day5,
    change5: day5 ? day5[1] / base[1] - 1 : null,
  };
}

export type Preset = { id: string; label: string; days: number | null };
export const PRESETS: Preset[] = [
  { id: "6m", label: "6M", days: 183 },
  { id: "1y", label: "1Y", days: 365 },
  { id: "3y", label: "3Y", days: 3 * 365 },
  { id: "5y", label: "5Y", days: 5 * 365 },
  { id: "max", label: "10Y", days: null },
];

const DAY = 86_400_000;
export const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** The window a preset shows, ending at the latest close. */
export function presetWindow(s: PriceSeries, preset: Preset): [string, string] {
  if (preset.days === null) return [s.first, s.last];
  const from = shiftDate(s.last, -preset.days);
  return [from < s.first ? s.first : from, s.last];
}

/** Change from the first to the last close of a window (fraction), or null with fewer than two closes. */
export function windowChange(points: readonly PricePoint[]): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1]![1] / points[0]![1] - 1;
}

export type MdlLinkInput = {
  mdl: number;
  tier: string | null;
  role: string | null;
  dismissed: boolean;
  title: string | null;
  dateTransferred: string | null;
  dateClosed: string | null;
};

/**
 * MDL dates for the company's linked MDLs: the JPML transfer order that centralized the MDL and, for a closed MDL,
 * its closing date. Dismissed links are left out; a tier C link (the evidence names the company only by the MDL's
 * subject) is kept and labelled as such.
 */
export function mdlEvents(links: readonly MdlLinkInput[]): PriceEvent[] {
  const out: PriceEvent[] = [];
  const seen = new Set<number>();
  for (const l of links) {
    if (l.dismissed || seen.has(l.mdl)) continue;
    seen.add(l.mdl);
    const tier = l.tier === "A" || l.tier === "B" || l.tier === "C" ? l.tier : null;
    const name = l.title ? shortMdlTitle(l.title) : `MDL ${l.mdl}`;
    if (l.dateTransferred && ISO.test(l.dateTransferred))
      out.push({
        id: `mdl-${l.mdl}-c`,
        date: l.dateTransferred,
        kind: "mdl_centralized",
        label: `MDL ${l.mdl} centralized: ${name}`,
        tier,
        mdl: l.mdl,
        url: null,
      });
    if (l.dateClosed && ISO.test(l.dateClosed))
      out.push({
        id: `mdl-${l.mdl}-x`,
        date: l.dateClosed,
        kind: "mdl_closed",
        label: `MDL ${l.mdl} closed: ${name}`,
        tier,
        mdl: l.mdl,
        url: null,
      });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** "IN RE: Johnson & Johnson Talcum Powder Products Marketing, ... Litigation" → "Johnson & Johnson Talcum Powder Products". */
export function shortMdlTitle(title: string): string {
  let t = title.replace(/^\s*in\s+re:?\s*/i, "").trim();
  t = t.replace(
    /\s+(marketing|sales practices|products liability|product liability|litigation|liability)\b.*$/i,
    "",
  );
  t = t.replace(/[,\s]+$/, "");
  return t.length > 70 ? `${t.slice(0, 69).trimEnd()}…` : t || title.slice(0, 70);
}

/** Events inside the recorded closes, one per kind and date (the first label kept), sorted by date. */
export function eventsInRange(
  events: readonly PriceEvent[],
  first: string,
  last: string,
): PriceEvent[] {
  const seen = new Set<string>();
  return events
    .filter((e) => e.date > first && e.date <= last)
    .filter((e) => {
      const k = `${e.kind}|${e.date}|${e.mdl ?? e.label}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export const signedPct = (v: number, digits = 1) =>
  `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(digits)}%`;

export function moneyText(v: number, currency: string): string {
  const n = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "USD" ? `$${n}` : `${n} ${currency}`;
}

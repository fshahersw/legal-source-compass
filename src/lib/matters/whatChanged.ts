/**
 * Pure: what changed recently in one MDL, from server-computed figures only. It feeds the "What changed" section and
 * its AI summary context, so every value here is one the page also shows.
 *
 *  - JPML: actions added between two reports = the difference of the two published totals, with both report dates
 *    and the interval in days. A negative difference is kept as printed and flagged (JPML re-counts), never read as
 *    dismissals.
 *  - Orders issued in the last 30 and 90 days, by kind, with their printed labels ("CMO No. 36 (2026-07-23)").
 *  - Court-page orders dated after the last collected docket entry (the court page can be newer).
 *  - Trial and deadline settings docketed in the window, and the ones the text says were vacated.
 */
import type { DatedEntry } from "./docketDates";
import { ORDER_KIND_LABEL, orderLabel, type ClassifiedEntry, type CourtPageMatch, type OrderKind } from "./orders";

export type JpmlPoint = { date: string; pending: number; total: number };

export type JpmlDelta = {
  from: string;
  to: string;
  days: number;
  totalFrom: number;
  totalTo: number;
  /** totalTo - totalFrom, as published. */
  added: number;
  pendingFrom: number;
  pendingTo: number;
  pendingChange: number;
  /** The published total fell between the two reports (a re-count); shown as printed with a note. */
  negative: boolean;
};

const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

/** Report-to-report changes, oldest first. Points with bad dates are dropped; duplicates keep the last. */
export function jpmlDeltas(points: readonly JpmlPoint[]): JpmlDelta[] {
  const byDate = new Map<string, JpmlPoint>();
  for (const p of points)
    if (ISO.test(p.date) && Number.isFinite(p.total) && Number.isFinite(p.pending)) byDate.set(p.date, p);
  const sorted = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const out: JpmlDelta[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const added = b.total - a.total;
    out.push({
      from: a.date,
      to: b.date,
      days: Math.round(dayNumber(b.date) - dayNumber(a.date)),
      totalFrom: a.total,
      totalTo: b.total,
      added,
      pendingFrom: a.pending,
      pendingTo: b.pending,
      pendingChange: b.pending - a.pending,
      negative: added < 0,
    });
  }
  return out;
}

export function isoMinusDays(iso: string, days: number): string {
  return new Date((dayNumber(iso) - days) * DAY_MS).toISOString().slice(0, 10);
}

export type ChangedOrder = {
  entryId: string;
  date: string;
  kind: OrderKind;
  /** "CMO No. 36 (2026-07-23)" for numbered orders; the kind label and date otherwise. */
  printed: string;
  sourceUrl: string | null;
};

export type ChangeWindow = {
  days: 30 | 90;
  /** Inclusive start (yyyy-mm-dd); the window ends on `asOf`. */
  from: string;
  /** Entries per kind (an entry counts once per kind). */
  byKind: { kind: OrderKind; entries: number }[];
  orders: ChangedOrder[];
  settings: { set: number; vacated: number };
};

/** A figure in the shape the AI kit's buildSectionContext takes (label, value, unit, period, note). */
export type ChangeFigure = {
  label: string;
  value: number | string | null;
  unit?: string | undefined;
  period?: string | undefined;
  note?: string | undefined;
};

export type WhatChanged = {
  asOf: string;
  /** Latest filing date in the collected docket text. */
  collectedThrough: string | null;
  jpml: { latest: JpmlDelta | null; previous: JpmlDelta | null };
  windows: ChangeWindow[];
  /** Court-page numbered orders dated after `collectedThrough` (newest first). */
  courtPageNewer: { printed: string; date: string; url: string; title: string }[];
  figures: ChangeFigure[];
};

/** Kinds that are orders the court issued (motions and party notices are left out of "orders issued"). */
const ISSUED_KINDS: ReadonlySet<OrderKind> = new Set<OrderKind>([
  "cmo",
  "pto",
  "rule702",
  "pfs",
  "bellwether",
  "leadership",
  "common_benefit",
  "special_master",
  "settlement",
  "cto",
  "verdict",
]);

function printedFor(e: ClassifiedEntry, kind: OrderKind): string {
  const date = e.date ?? "date not recorded";
  if (kind === "cmo" || kind === "pto") {
    const t = e.tags.find((x) => x.kind === kind);
    if (t?.number != null) return `${orderLabel(kind, t.number, t.suffix)} (${date})`;
  }
  return `${ORDER_KIND_LABEL[kind]} (${date})`;
}

function windowOf(
  days: 30 | 90,
  asOf: string,
  entries: readonly ClassifiedEntry[],
  dates: readonly DatedEntry[],
): ChangeWindow {
  const from = isoMinusDays(asOf, days - 1);
  const inside = (d: string | null) => !!d && d >= from && d <= asOf;
  const counts = new Map<OrderKind, Set<string>>();
  const orders: ChangedOrder[] = [];
  for (const e of entries) {
    if (e.role !== "order" || !inside(e.date)) continue;
    // One row per entry, named by its most specific issued kind (numbered orders first).
    let named = false;
    for (const t of e.tags) {
      if (!ISSUED_KINDS.has(t.kind)) continue;
      counts.set(t.kind, (counts.get(t.kind) ?? new Set()).add(e.id));
      if (!named) {
        orders.push({ entryId: e.id, date: e.date!, kind: t.kind, printed: printedFor(e, t.kind), sourceUrl: e.sourceUrl });
        named = true;
      }
    }
  }
  orders.sort((a, b) => b.date.localeCompare(a.date) || a.entryId.localeCompare(b.entryId));
  const settingsIn = dates.filter((d) => inside(d.entryDate));
  return {
    days,
    from,
    byKind: [...counts.entries()].map(([kind, ids]) => ({ kind, entries: ids.size })),
    orders,
    settings: {
      set: settingsIn.filter((d) => !d.vacated).length,
      vacated: settingsIn.filter((d) => d.vacated).length,
    },
  };
}

export function whatChanged(input: {
  /** The page's reference date (yyyy-mm-dd), normally today. */
  asOf: string;
  collectedThrough: string | null;
  jpml: readonly JpmlPoint[];
  entries: readonly ClassifiedEntry[];
  dates: readonly DatedEntry[];
  courtPage: readonly CourtPageMatch[];
}): WhatChanged {
  const deltas = jpmlDeltas(input.jpml);
  const latest = deltas.at(-1) ?? null;
  const previous = deltas.at(-2) ?? null;
  const windows = [
    windowOf(30, input.asOf, input.entries, input.dates),
    windowOf(90, input.asOf, input.entries, input.dates),
  ];
  const cut = input.collectedThrough;
  const courtPageNewer = input.courtPage
    .filter((o) => !!o.date && !!cut && o.date > cut)
    .map((o) => ({
      printed: `${orderLabel(o.kind, o.number, o.suffix)} (${o.date})`,
      date: o.date!,
      url: o.url,
      title: o.title,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const figures: ChangeFigure[] = [];
  if (latest) {
    figures.push(
      { label: "Actions pending (JPML)", value: latest.pendingTo, unit: "actions", period: `report of ${latest.to}` },
      { label: "Actions pending at the prior report", value: latest.pendingFrom, unit: "actions", period: `report of ${latest.from}` },
      {
        label: "Actions added between the two reports (difference of published totals)",
        value: latest.added,
        unit: "actions",
        period: `${latest.from} to ${latest.to} (${latest.days} days)`,
        note: latest.negative ? "total fell: JPML re-count, not dismissals" : undefined,
      },
    );
  }
  if (previous)
    figures.push({
      label: "Actions added in the interval before",
      value: previous.added,
      unit: "actions",
      period: `${previous.from} to ${previous.to} (${previous.days} days)`,
      note: previous.negative ? "total fell: JPML re-count, not dismissals" : undefined,
    });
  for (const w of windows) {
    const issued = new Set(w.orders.map((o) => o.entryId)).size;
    figures.push({
      label: `Orders entered in the last ${w.days} days (collected docket text)`,
      value: issued,
      unit: "entries",
      period: `${w.from} to ${input.asOf}`,
      note: cut && cut < input.asOf ? `docket text collected through ${cut}` : undefined,
    });
  }
  for (const o of windows[1]!.orders.slice(0, 8))
    figures.push({ label: "Order entered", value: o.printed, period: o.date });
  for (const c of courtPageNewer.slice(0, 5))
    figures.push({ label: "Court-page order newer than the collected docket", value: c.printed, period: c.date });
  const w90 = windows[1]!;
  figures.push(
    { label: "Settings docketed in the last 90 days", value: w90.settings.set, unit: "dates" },
    { label: "Settings docketed as vacated in the last 90 days", value: w90.settings.vacated, unit: "dates" },
  );
  return {
    asOf: input.asOf,
    collectedThrough: cut,
    jpml: { latest, previous },
    windows,
    courtPageNewer,
    figures,
  };
}

/**
 * Pure view model of the MDL command page (/matters/$id): the headline figures, chart rows, swimlanes and ledger
 * rows, all computed from the command payload the server returned. No I/O; tested in commandView.test.ts.
 *
 * Rules carried from the server modules:
 *  - JPML "actions added" is the difference of two published totals, with both report dates and the interval.
 *  - Numbered-order gaps read "Not in collected docket text"; nothing is assumed about a missing number.
 *  - Counts of classified entries cover the collected master-docket text only, which stops at `collectedThrough`.
 */
import type { SwimEvent, SwimGroup, SwimLane } from "@/components/charts/Swimlanes";
import type { StackRow } from "@/components/charts/d3/maths";
import type { FigureInput } from "@/components/kit/ai/buildSectionContext";
import {
  NOT_IN_COLLECTED_TEXT,
  ORDER_KIND_LABEL,
  OUTCOME_NOT_STATED,
  orderLabel,
  type ClassifiedEntry,
  type KindCount,
  type LedgerSequence,
  type OrderKind,
  type OrderOutcome,
} from "@/lib/matters/orders";
import { jpmlDeltas, type JpmlPoint } from "@/lib/matters/whatChanged";
import type { MdlCommandPayload } from "@/lib/matters/types";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ JPML */

/** Valid report points, one per date (the last wins), oldest first. */
export function sortedPoints(points: readonly JpmlPoint[]): JpmlPoint[] {
  const by = new Map<string, JpmlPoint>();
  for (const p of points)
    if (ISO.test(p.date) && Number.isFinite(p.pending) && Number.isFinite(p.total))
      by.set(p.date, p);
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Actions added between consecutive reports (difference of published totals), one row per later report. */
export function addedRows(points: readonly JpmlPoint[]) {
  return jpmlDeltas(points).map((d) => ({
    report: d.to,
    from: d.from,
    days: d.days,
    added: d.added,
    negative: d.negative,
  }));
}

const monthOf = (iso: string) => iso.slice(0, 7);
function monthsBefore(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 - n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

export type Momentum = {
  months: 1 | 3 | 12;
  /** The report compared against (the latest report in the calendar month N months before); null when none. */
  from: string | null;
  to: string | null;
  /** Change in actions pending between the two reports; null when the earlier report is not in the series. */
  change: number | null;
};

/**
 * Change in actions pending over 1, 3 and 12 months: latest report against the report of the calendar month N months
 * earlier. A month with no report gives "Not recorded" (null), never an interpolated value.
 */
export function momentum(points: readonly JpmlPoint[]): Momentum[] {
  const pts = sortedPoints(points);
  const latest = pts.at(-1) ?? null;
  return ([1, 3, 12] as const).map((months) => {
    if (!latest) return { months, from: null, to: null, change: null };
    const target = monthsBefore(monthOf(latest.date), months);
    const base = [...pts].reverse().find((p) => monthOf(p.date) === target) ?? null;
    return {
      months,
      from: base?.date ?? null,
      to: latest.date,
      change: base ? latest.pending - base.pending : null,
    };
  });
}

/* ------------------------------------------------------------------ headline */

export type Headline = {
  pending: { value: number; date: string; prior: { value: number; date: string } | null } | null;
  added: { value: number; from: string; to: string; days: number; negative: boolean } | null;
  numbered: {
    distinct: number;
    issuedEntries: number;
    latest: { label: string; date: string | null } | null;
  } | null;
  next: { date: string; label: string | null; entryDate: string | null } | null;
  members: number | null;
  rule702: { rulings: number; motions: number } | null;
  collectedThrough: string | null;
};

/** The figures of the page's KPI row; each null field prints "Not recorded" or is left out. */
export function headline(cmd: MdlCommandPayload): Headline {
  const pts = sortedPoints(cmd.jpmlPoints);
  const last = pts.at(-1) ?? null;
  const prev = pts.at(-2) ?? null;
  const d = cmd.whatChanged.jpml.latest;
  const o = cmd.orders;
  const cmo = o?.ledger.cmo;
  const pto = o?.ledger.pto;
  const distinct = (cmo?.distinctNumbers ?? 0) + (pto?.distinctNumbers ?? 0);
  const latest = [cmo?.latest, pto?.latest]
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => (b.entry.date ?? "").localeCompare(a.entry.date ?? ""))[0];
  const next = cmd.datesSummary?.next ?? null;
  const reg = cmd.overview?.registry ?? null;
  return {
    pending: last
      ? {
          value: last.pending,
          date: last.date,
          prior: prev ? { value: prev.pending, date: prev.date } : null,
        }
      : cmd.overview?.overview.actions.pending != null && cmd.overview.overview.asOf
        ? {
            value: cmd.overview.overview.actions.pending,
            date: cmd.overview.overview.asOf,
            prior: null,
          }
        : null,
    added: d
      ? { value: d.added, from: d.from, to: d.to, days: d.days, negative: d.negative }
      : null,
    numbered: o
      ? {
          distinct,
          issuedEntries: (cmo?.issuedEntries ?? 0) + (pto?.issuedEntries ?? 0),
          latest: latest
            ? {
                label: orderLabel(latest.kind, latest.number, latest.suffix),
                date: latest.entry.date,
              }
            : null,
        }
      : null,
    next: next ? { date: next.date, label: next.label, entryDate: next.entryDate } : null,
    members: reg?.members.rows ?? null,
    rule702:
      o && (o.rule702.rulings > 0 || o.rule702.motions > 0)
        ? { rulings: o.rule702.rulings, motions: o.rule702.motions }
        : null,
    collectedThrough: o?.coverage.collectedThrough ?? cmd.dates?.collectedThrough ?? null,
  };
}

/* ------------------------------------------------------------------ ledger */

export type LedgerTableRow = {
  key: string;
  label: string;
  number: number;
  date: string | null;
  subject: string;
  entryNumber: number | null;
  sourceUrl: string | null;
  entryId: string | null;
  /** No collected entry starts with this number. */
  missing: boolean;
};

/** Ledger rows in number order with every gap between 1 and the highest number as a "Not in collected docket text" row. */
export function ledgerRows(seq: LedgerSequence): LedgerTableRow[] {
  const out: LedgerTableRow[] = [];
  if (seq.highest === null) return out;
  const by = new Map<number, LedgerSequence["rows"]>();
  for (const r of seq.rows) by.set(r.number, [...(by.get(r.number) ?? []), r]);
  for (let n = 1; n <= seq.highest; n++) {
    const rows = by.get(n);
    if (!rows?.length) {
      out.push({
        key: `${seq.kind}-${n}-missing`,
        label: orderLabel(seq.kind, n, null),
        number: n,
        date: null,
        subject: NOT_IN_COLLECTED_TEXT,
        entryNumber: null,
        sourceUrl: null,
        entryId: null,
        missing: true,
      });
      continue;
    }
    for (const r of rows)
      out.push({
        key: `${seq.kind}-${n}-${r.suffix ?? ""}-${r.entry.id}`,
        label: `${r.amended ? `${r.amended} ` : ""}${orderLabel(seq.kind, n, r.suffix)}`,
        number: n,
        date: r.entry.date,
        subject: r.subject ?? "Subject not printed",
        entryNumber: r.entry.entryNumber,
        sourceUrl: r.entry.sourceUrl,
        entryId: r.entry.id,
        missing: false,
      });
  }
  return out;
}

/* ------------------------------------------------------------------ kinds */

export const OUTCOME_LABEL: Record<NonNullable<OrderOutcome>, string> = {
  granted: "Granted",
  denied: "Denied",
  granted_in_part: "Granted in part, denied in part",
  set: "Set",
  vacated: "Vacated",
  continued: "Continued",
  for_plaintiff: "For plaintiffs",
  for_defendant: "For defendants",
};

export const outcomeText = (o: OrderOutcome): string => (o ? OUTCOME_LABEL[o] : OUTCOME_NOT_STATED);

export type KindRow = {
  id: string;
  date: string | null;
  title: string;
  outcome: string;
  entryNumber: number | null;
  sourceUrl: string | null;
};

/** Entries carrying one of `kinds`, newest first, with their printed title and the outcome the text states. */
export function kindRows(
  entries: readonly ClassifiedEntry[],
  kinds: readonly OrderKind[],
): KindRow[] {
  const want = new Set(kinds);
  const out: KindRow[] = [];
  for (const e of entries) {
    const tag = e.tags.find((t) => want.has(t.kind));
    if (!tag) continue;
    out.push({
      id: e.id,
      date: e.date,
      title: e.title ?? tag.subject ?? ORDER_KIND_LABEL[tag.kind],
      outcome: outcomeText(tag.outcome),
      entryNumber: e.entryNumber,
      sourceUrl: e.sourceUrl,
    });
  }
  return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
}

/** Entries per kind for a ranked bar chart (the classifier's counts; motions and notices keep their own labels). */
export function kindItems(counts: readonly KindCount[]) {
  return counts.map((c) => ({ id: c.kind, label: ORDER_KIND_LABEL[c.kind], value: c.entries }));
}

/** Stack groups of the "orders entered per year" chart; an entry counts once, in its first group. */
export const YEAR_GROUPS = [
  { key: "numbered", label: "CMOs and PTOs", kinds: ["cmo", "pto"] },
  { key: "cto", label: "Conditional transfer orders", kinds: ["cto"] },
  {
    key: "trial",
    label: "Bellwether, trial and Rule 702",
    kinds: ["bellwether", "trial_setting", "rule702", "verdict"],
  },
  {
    key: "other",
    label: "Other key orders",
    kinds: [
      "pfs",
      "leadership",
      "common_benefit",
      "special_master",
      "settlement",
      "bankruptcy_stay",
    ],
  },
] as const satisfies readonly { key: string; label: string; kinds: readonly OrderKind[] }[];

/**
 * Court-entered key orders per calendar year, stacked by group. Years between the first and last collected order with
 * no classified order count 0 (the classifier read every candidate entry). The year of `collectedThrough` is partial.
 */
export function ordersPerYear(
  entries: readonly ClassifiedEntry[],
  collectedThrough: string | null,
): StackRow[] {
  const by = new Map<string, Record<string, number>>();
  for (const e of entries) {
    if (e.role !== "order" || !e.date) continue;
    const group = YEAR_GROUPS.find((g) =>
      e.tags.some((t) => (g.kinds as readonly OrderKind[]).includes(t.kind)),
    );
    if (!group) continue;
    const y = e.date.slice(0, 4);
    const row = by.get(y) ?? {};
    row[group.key] = (row[group.key] ?? 0) + 1;
    by.set(y, row);
  }
  const years = [...by.keys()].sort();
  if (!years.length) return [];
  const first = Number(years[0]);
  const last = Number(years.at(-1));
  const partialYear =
    collectedThrough && !collectedThrough.endsWith("-12-31") ? collectedThrough.slice(0, 4) : null;
  const out: StackRow[] = [];
  for (let y = first; y <= last; y++) {
    const row = by.get(String(y)) ?? {};
    out.push({
      period: String(y),
      values: Object.fromEntries(YEAR_GROUPS.map((g) => [g.key, row[g.key] ?? 0])),
      ...(partialYear === String(y) ? { partial: true } : {}),
    });
  }
  return out;
}

/**
 * Conditional transfer orders entered on the master docket per month (explicit CTO text only), zero-filled between
 * the first and last such month; the month of `collectedThrough` is marked partial.
 */
export function ctoPerMonth(entries: readonly ClassifiedEntry[], collectedThrough: string | null) {
  const by = new Map<string, number>();
  for (const e of entries)
    if (e.date && e.tags.some((t) => t.kind === "cto"))
      by.set(e.date.slice(0, 7), (by.get(e.date.slice(0, 7)) ?? 0) + 1);
  const months = [...by.keys()].sort();
  if (!months.length) return [];
  const out: { month: string; count: number; partial: boolean }[] = [];
  const cut = collectedThrough?.slice(0, 7) ?? null;
  for (let m = months[0]!; m <= months.at(-1)!; m = monthsBefore(m, -1))
    out.push({ month: m, count: by.get(m) ?? 0, partial: m === cut });
  return out;
}

/* ------------------------------------------------------------------ swimlanes */

const LANES: readonly { id: string; group: string; label: string; kinds: readonly OrderKind[] }[] =
  [
    { id: "cmo", group: "numbered", label: "Case management orders", kinds: ["cmo"] },
    { id: "pto", group: "numbered", label: "Pretrial orders", kinds: ["pto"] },
    { id: "leadership", group: "key", label: "Leadership", kinds: ["leadership"] },
    { id: "pfs", group: "key", label: "Fact sheets", kinds: ["pfs"] },
    { id: "bellwether", group: "key", label: "Bellwether", kinds: ["bellwether"] },
    { id: "rule702", group: "key", label: "Rule 702 rulings", kinds: ["rule702"] },
    {
      id: "settlement",
      group: "key",
      label: "Settlement and common benefit",
      kinds: ["settlement", "common_benefit"],
    },
    { id: "trial", group: "trial", label: "Trial settings", kinds: ["trial_setting"] },
    { id: "verdict", group: "trial", label: "Verdicts", kinds: ["verdict"] },
    { id: "stay", group: "trial", label: "Bankruptcy and stays", kinds: ["bankruptcy_stay"] },
  ];

export const SWIM_GROUPS: readonly SwimGroup[] = [
  { id: "numbered", label: "Numbered orders", slot: 0 },
  { id: "key", label: "Key orders", slot: 1 },
  { id: "trial", label: "Trials, verdicts and stays", slot: 2 },
];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One lane per order family over the collected docket window; lanes with no entry are left out. */
export function orderSwimlanes(
  entries: readonly ClassifiedEntry[],
): { lanes: SwimLane[]; domain: [string, string] } | null {
  const lanes: SwimLane[] = [];
  let lo: string | null = null;
  let hi: string | null = null;
  for (const spec of LANES) {
    const events: SwimEvent[] = [];
    for (const e of entries) {
      if (!e.date) continue;
      const tag = e.tags.find((t) => spec.kinds.includes(t.kind));
      if (!tag) continue;
      const label =
        (tag.kind === "cmo" || tag.kind === "pto") && tag.number !== null
          ? `${orderLabel(tag.kind, tag.number, tag.suffix)}${tag.subject ? `: ${clip(tag.subject, 90)}` : ""}`
          : clip(e.title ?? ORDER_KIND_LABEL[tag.kind], 110);
      events.push({
        id: `${spec.id}-${e.id}`,
        date: e.date,
        label,
        detail: [
          e.entryNumber !== null ? `Docket entry ${e.entryNumber}` : null,
          tag.outcome ? outcomeText(tag.outcome) : null,
        ]
          .filter(Boolean)
          .join(" · "),
        href: e.sourceUrl,
      });
      if (!lo || e.date < lo) lo = e.date;
      if (!hi || e.date > hi) hi = e.date;
    }
    if (events.length) lanes.push({ id: spec.id, group: spec.group, label: spec.label, events });
  }
  if (!lanes.length || !lo || !hi) return null;
  if (lo === hi) {
    const d = new Date(`${lo}T00:00:00Z`);
    lo = new Date(d.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    hi = new Date(d.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  }
  return { lanes, domain: [lo, hi] };
}

/** The figures behind the headline AI context (pure; every one is printed in the KPI row). */
export function headlineFigures(cmd: MdlCommandPayload, h: Headline): FigureInput[] {
  const figures: FigureInput[] = [];
  if (h.pending)
    figures.push({
      label: "Actions pending (JPML)",
      value: h.pending.value,
      unit: "actions",
      period: `report of ${h.pending.date}`,
    });
  if (h.added)
    figures.push({
      label: "Actions added between the last two JPML reports (difference of published totals)",
      value: h.added.value,
      unit: "actions",
      period: `${h.added.from} to ${h.added.to} (${h.added.days} days)`,
      note: h.added.negative ? "total fell: JPML re-count, not dismissals" : undefined,
    });
  if (h.numbered) {
    figures.push({
      label: "Distinct CMO and PTO numbers in the collected docket text",
      value: h.numbered.distinct,
      unit: "order numbers",
      note: h.collectedThrough ? `docket text collected through ${h.collectedThrough}` : undefined,
    });
    if (h.numbered.latest)
      figures.push({
        label: "Latest numbered order",
        value: h.numbered.latest.label,
        period: h.numbered.latest.date ?? undefined,
      });
  }
  if (h.next)
    figures.push({
      label: `Next date set on the docket${h.next.label ? ` (${h.next.label})` : ""}`,
      value: h.next.date,
      note: h.next.entryDate ? `as docketed on ${h.next.entryDate}` : undefined,
    });
  if (cmd.mode === "registry" && h.members !== null)
    figures.push({
      label: "Member dockets with evidence in the matter registry",
      value: h.members,
      unit: "dockets",
      note: "partial count, not the size of the MDL",
    });
  if (h.rule702)
    figures.push(
      { label: "Rule 702 rulings (order entries)", value: h.rule702.rulings, unit: "orders" },
      { label: "Rule 702 motions (counted apart)", value: h.rule702.motions, unit: "motions" },
    );
  return figures;
}

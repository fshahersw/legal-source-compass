/**
 * Pure explanatory text for the company and Open Payments views: why a chart is empty, which
 * filter produced no rows, and the full text behind clamped KPI tiles. Every sentence is derived
 * from the record it describes, so it can never claim more (or less) than the data shows.
 */
import type { CompanyMdl, Role, SeriesPoint } from "./companyData";

/* ---------- pending-actions trend (company page) ---------- */

/** A pending MDL linked to the company that the defendant-only trend leaves out, with why. */
export type UncountedMdl = { mdl: number; pending: number | null; reasons: string[] };

export type PendingTrendView =
  /** Two or more monthly reports for the counted MDLs: draw the line. */
  | { kind: "chart"; uncounted: UncountedMdl[] }
  /** Counted MDLs exist but only one monthly report covers them. */
  | {
      kind: "single_report";
      date: string;
      pending: number;
      /** How many counted MDLs appear in that report (null when the report does not say). */
      mdls: number | null;
      /** How many pending MDLs are counted as defendant in all. */
      counted: number;
      uncounted: UncountedMdl[];
    }
  /** Counted MDLs exist but no monthly JPML count is recorded for any of them. */
  | { kind: "no_series"; counted: number[]; uncounted: UncountedMdl[] }
  /** Linked MDLs are pending, but none is read as a defendant link, so nothing is charted. */
  | { kind: "none_counted"; uncounted: UncountedMdl[] }
  /** Literally no linked MDL is pending. */
  | { kind: "none_pending"; linked: number };

const ROLE_REASON: Record<Exclude<Role, "defendant">, string> = {
  unclear: "the evidence excerpts from the company's filings do not state its role",
  not_named: "the evidence excerpt says the company is not named",
  plaintiff: "the evidence excerpt describes the company as a claimant",
};
const DISMISSED_REASON =
  "the latest evidence excerpt reports a dismissal or that the company is not sued";
const REVIEW_REASON = "the link is flagged for review";
const FALLBACK_REASON = "the published dataset does not count it toward the company's exposure";

/**
 * Why a linked MDL is not counted as defendant exposure. Mirrors the builder rule
 * (build_company_sec.py: role is "defendant", not dismissed, no review note); the dataset's own
 * counts_toward_exposure flag stays authoritative, so an unexplained exclusion says so.
 */
export function uncountedReasons(m: Pick<CompanyMdl, "role" | "dismissed" | "review">) {
  const out: string[] = [];
  if (m.role !== "defendant") out.push(ROLE_REASON[m.role]);
  if (m.dismissed) out.push(DISMISSED_REASON);
  if (m.review) out.push(REVIEW_REASON);
  return out.length ? out : [FALLBACK_REASON];
}

export function pendingTrendView(
  mdls: Pick<
    CompanyMdl,
    "mdl" | "status" | "pending" | "role" | "dismissed" | "review" | "countsTowardExposure"
  >[],
  series: SeriesPoint[],
): PendingTrendView {
  const pending = mdls.filter((m) => m.status === "pending");
  if (!pending.length) return { kind: "none_pending", linked: mdls.length };
  const counted = pending.filter((m) => m.countsTowardExposure);
  const uncounted = pending
    .filter((m) => !m.countsTowardExposure)
    .sort((a, b) => (b.pending ?? -1) - (a.pending ?? -1) || a.mdl - b.mdl)
    .map((m) => ({ mdl: m.mdl, pending: m.pending, reasons: uncountedReasons(m) }));
  if (!counted.length) return { kind: "none_counted", uncounted };
  if (series.length >= 2) return { kind: "chart", uncounted };
  const only = series[0];
  if (only)
    return {
      kind: "single_report",
      date: only.date,
      pending: only.pending,
      mdls: only.mdls ?? null,
      counted: counted.length,
      uncounted,
    };
  return { kind: "no_series", counted: counted.map((m) => m.mdl).sort((a, b) => a - b), uncounted };
}

const n = (v: number) => v.toLocaleString("en-US");
const plural = (k: number, one: string, many = `${one}s`) => (k === 1 ? one : many);
const actions = (v: number | null) =>
  v === null ? "pending actions not recorded" : `${n(v)} pending ${plural(v, "action")}`;
const list = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/**
 * Uncounted MDLs grouped by identical reason lists, so a reason is said once per group. Groups
 * keep the input order of their first member (largest first); members are listed by MDL number.
 */
export function groupUncounted(u: UncountedMdl[]) {
  const groups = new Map<string, { reasons: string[]; mdls: UncountedMdl[] }>();
  for (const m of u) {
    const key = JSON.stringify(m.reasons);
    const g = groups.get(key);
    if (g) g.mdls.push(m);
    else groups.set(key, { reasons: m.reasons, mdls: [m] });
  }
  return [...groups.values()].map((g) => ({
    reasons: g.reasons,
    mdls: [...g.mdls].sort((a, b) => a.mdl - b.mdl),
  }));
}

/** "MDL 2740, 2924 and 3006" (numbers only after the first "MDL"). */
const mdlList = (ms: Pick<UncountedMdl, "mdl">[]) => `MDL ${list(ms.map((m) => String(m.mdl)))}`;

/** Pending actions of a group: its total, naming any MDL whose count is not recorded. */
function groupActions(ms: UncountedMdl[]) {
  if (ms.length === 1) return actions(ms[0]!.pending);
  const known = ms.filter((m) => m.pending !== null);
  const missing = ms.filter((m) => m.pending === null);
  if (!known.length) return "pending actions not recorded";
  const sum = known.reduce((a, m) => a + m.pending!, 0);
  const total = `${n(sum)} pending ${plural(sum, "action")} in total`;
  return missing.length ? `${total}; not recorded for ${mdlList(missing)}` : total;
}

/**
 * "MDL 3047 (3,824 pending actions): the evidence excerpts ... do not state its role"; MDLs that
 * share a reason list are grouped: "MDL 2740 and 2924 (5,100 pending actions in total): ...".
 */
export function describeUncounted(u: UncountedMdl[]) {
  return groupUncounted(u)
    .map((g) => `${mdlList(g.mdls)} (${groupActions(g.mdls)}): ${list(g.reasons)}`)
    .join("; ");
}

const DEFENDANT_ONLY =
  "This chart counts only MDLs whose evidence excerpt reads the company as a defendant.";

/** The empty-state sentence for every non-chart view; null when the line chart is drawn. */
export function pendingTrendMessage(v: PendingTrendView): string | null {
  switch (v.kind) {
    case "chart":
      return null;
    case "none_pending":
      return v.linked
        ? v.linked === 1
          ? "This company's linked MDL is not pending in the JPML monthly reports."
          : `None of this company's ${v.linked} linked MDLs is pending in the JPML monthly reports.`
        : "No MDL is linked to this company.";
    case "none_counted": {
      const [only] = v.uncounted;
      if (v.uncounted.length === 1 && only)
        return `MDL ${only.mdl} is pending ${
          only.pending === null
            ? "(action count not recorded)"
            : `with ${n(only.pending)} ${plural(only.pending, "action")}`
        } but is not charted because ${list(only.reasons)}. ${DEFENDANT_ONLY}`;
      const groups = groupUncounted(v.uncounted);
      const [one] = groups;
      if (groups.length === 1 && one)
        return `${mdlList(one.mdls)} are pending (${groupActions(one.mdls)}) but are not charted because ${list(one.reasons)}. ${DEFENDANT_ONLY}`;
      return `${v.uncounted.length} linked MDLs are pending but none is charted: ${describeUncounted(v.uncounted)}. ${DEFENDANT_ONLY}`;
    }
    case "single_report": {
      const k = v.mdls;
      const c = v.counted;
      // The series is built only from counted MDLs, so with one counted MDL the report covers it.
      const scope =
        k !== null && k < c
          ? `${k} of the ${c} MDLs counted as defendant`
          : k === null && c > 1
            ? `some or all of the ${c} MDLs counted as defendant`
            : `the ${k ?? c} ${plural(k ?? c, "MDL")} counted as defendant`;
      return `Only one JPML monthly report (${v.date}) covers ${scope}: ${actions(v.pending)}. A trend needs two or more reports.${uncountedTail(v.uncounted)}`;
    }
    case "no_series":
      return `No JPML monthly pending counts are recorded for ${list(v.counted.map((m) => `MDL ${m}`))}, counted as defendant, so no trend can be drawn.${uncountedTail(v.uncounted)}`;
  }
}

function uncountedTail(u: UncountedMdl[]) {
  return u.length ? ` Not charted: ${describeUncounted(u)}.` : "";
}

/** Footnote addition when the chart is drawn but some pending linked MDLs are left out. */
export function pendingTrendFootnote(v: PendingTrendView): string | null {
  return v.kind === "chart" && v.uncounted.length
    ? `Not charted: ${describeUncounted(v.uncounted)}.`
    : null;
}

/**
 * "1 pending · 0 of them counted as defendant" for the Linked MDLs tile. The second number is a
 * subset of the pending links (exposure.pending_mdls), so the wording ties it to them.
 */
export function linkedMdlNote(mdls: Pick<CompanyMdl, "status">[], countedPending: number) {
  const pending = mdls.filter((m) => m.status === "pending").length;
  if (!pending) return "none pending";
  return `${n(pending)} pending · ${n(countedPending)} of them counted as defendant`;
}

/**
 * Value for the "Pending actions (defendant)" tile. With no pending MDL read as defendant the sum
 * is not unknown, there is simply nothing counted, so it says so instead of "Not recorded".
 */
export function pendingActionsValue(e: { pendingMdls: number; pendingActions: number | null }) {
  if (!e.pendingMdls) return "None counted";
  return e.pendingActions === null ? "Not recorded" : n(e.pendingActions);
}

/** "2025-07-31 → 2026-07-30"; one date when both ends agree; missing ends read "Not recorded". */
export function dateSpan(first: string | null, last: string | null) {
  if (!first && !last) return "Not recorded";
  if (first === last) return first!;
  return `${first ?? "Not recorded"} → ${last ?? "Not recorded"}`;
}

/* ---------- KPI tiles ---------- */

/** One tooltip carrying every line of a tile (label, value, note, detail) plus its explanation,
 * so text clamped at narrow widths is never lost. */
export function kpiTooltip(parts: {
  label: string;
  value: string;
  note?: string | undefined;
  detail?: string | undefined;
  title?: string | undefined;
}) {
  const head = `${parts.label}: ${parts.value}`;
  const extra = [parts.note, parts.detail].filter((s): s is string => !!s && !!s.trim());
  const body = extra.length ? `${head} · ${extra.join(" · ")}` : head;
  return parts.title?.trim() ? `${body}\n${parts.title.trim()}` : body;
}

/* ---------- Open Payments ranking filters ---------- */

/** Empty-state text for the manufacturer ranking and every card built from it. */
export function paymentsNoMatchText(query: string, deviceOnly: boolean) {
  const q = query.trim();
  const scope = deviceOnly
    ? " among device-linked entities (device or supply share of 10% or more)"
    : "";
  if (q) return `No top-300 reporting entity has a name containing “${q}”${scope}.`;
  return deviceOnly
    ? "No top-300 reporting entity has a device or supply share of 10% or more."
    : "No reporting entity is listed.";
}

/* ---------- axis ticks ---------- */

const TICK_UNITS = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
] as const;

/** Compact dollar tick for chart axes: $0, $940, $40K, $2.5M, $1B, $12B (no trailing ".0"). */
export function usdTick(v: number) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  const short = (x: number) => (x >= 10 ? Math.round(x) : Number(x.toFixed(1)));
  for (let i = 0; i < TICK_UNITS.length; i++) {
    const [div, suf] = TICK_UNITS[i]!;
    if (a < div) continue;
    const x = short(a / div);
    // 999,960 rounds to "1000K": promote to the next unit instead ("$1M").
    const up = TICK_UNITS[i - 1];
    if (x >= 1000 && up) return `${sign}$${short(a / up[0])}${up[1]}`;
    return `${sign}$${x}${suf}`;
  }
  return `${sign}$${Math.round(a)}`;
}

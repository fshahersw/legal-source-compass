/**
 * Settlements confirmed on official pages, read for the page: typed amounts (fund total vs per claimant), deadline
 * status against today, MDL links verified against the MDL registry by the retype, and the figures behind the KPIs
 * and charts.
 * Pure; no I/O. Rules mirror scripts/enrichment/enforcement_actions/settle_types.py.
 */
import type {
  OfficialSettlement,
  SettlementAmountRole,
} from "@/lib/external/enforcementActions.functions";
import { daysUntil } from "./format";

export type DeadlineState = "within_30_days" | "upcoming" | "past" | "none";
export type Amount = OfficialSettlement["amounts"][number];

export const ROLE_LABEL: Record<SettlementAmountRole, string> = {
  fund_total: "Settlement fund total",
  per_claimant: "Per claimant",
  cap: "Aggregate cap",
  other: "Other figure",
};
export const OTHER_DETAIL_LABEL: Record<string, string> = {
  fees_costs: "Fees, costs or administration",
  service_award: "Service award",
  penalty: "Penalty or disgorgement",
  distribution: "Agency distribution round",
  estimate: "Estimate or alleged loss",
  threshold: "Eligibility threshold",
  fund_addition: "Addition to a fund",
  order_total: "Order total including a penalty",
  unclear: "Role not stated near the figure",
};
export const DEADLINE_LABEL: Record<DeadlineState, string> = {
  within_30_days: "Closes within 30 days",
  upcoming: "Open, more than 30 days left",
  past: "Past",
  none: "No deadline confirmed",
};

/** "Settlement fund total", "Per claimant", "Other figure: Service award"; "Role not typed yet" before the retype. */
export function roleLabel(a: Amount): string {
  if (!a.role) return "Role not typed yet";
  if (a.role !== "other") return ROLE_LABEL[a.role];
  const detail = OTHER_DETAIL_LABEL[a.detail ?? "unclear"] ?? OTHER_DETAIL_LABEL["unclear"];
  return `${ROLE_LABEL.other}: ${detail}`;
}

/** MDL number from a case number in MDL docket form ("2:19-ml-02905-JAK-JPR" -> 2905); never from other text. */
export function mdlFromCaseNumber(caseNumber: string | null | undefined): number | null {
  const m = /^\s*\d{1,2}:\d{2}-(?:md|ml|mn)-0*(\d{1,5})\b/i.exec(caseNumber ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? n : null;
}

/** MDL links as the retype stored them: only where a case number on the page is that MDL's own master docket in the
 * MDL registry (and its court, when named). A docket-form number alone never links here, and nothing links before the
 * dataset is retyped; the case number still shows as written. */
export function mdlLinks(s: Pick<OfficialSettlement, "mdlLinks">): { mdl: number; caseNumber: string }[] {
  const seen = new Set<number>();
  const out: { mdl: number; caseNumber: string }[] = [];
  for (const l of s.mdlLinks ?? []) {
    if (mdlFromCaseNumber(l.caseNumber) !== l.mdl || seen.has(l.mdl)) continue;
    seen.add(l.mdl);
    out.push(l);
  }
  return out;
}

export function deadlineState(deadline: string | null, today: string): DeadlineState {
  if (!deadline) return "none";
  const d = daysUntil(today, deadline);
  if (!Number.isFinite(d)) return "none";
  if (d < 0) return "past";
  return d <= 30 ? "within_30_days" : "upcoming";
}

/** The largest typed fund total, or null. A per-claimant, cap or other figure is never the headline. */
export function fundTotal(s: Pick<OfficialSettlement, "amounts">): Amount | null {
  let best: Amount | null = null;
  for (const a of s.amounts) {
    if (a.role !== "fund_total" || a.valueUsd == null) continue;
    if (!best || a.valueUsd > (best.valueUsd ?? -1)) best = a;
  }
  return best;
}

export function perClaimant(s: Pick<OfficialSettlement, "amounts">): Amount[] {
  return s.amounts.filter((a) => a.role === "per_claimant");
}

export type SettlementView = OfficialSettlement & {
  state: DeadlineState;
  daysLeft: number | null;
  fund: Amount | null;
  perClaimant: Amount[];
  mdls: { mdl: number; caseNumber: string }[];
};

/** Rows with their deadline status, typed headline and MDL links; open deadlines first (soonest first), then past
 * deadlines (latest first), then rows with no confirmed deadline. */
export function viewRows(rows: readonly OfficialSettlement[], today: string): SettlementView[] {
  const order: Record<DeadlineState, number> = { within_30_days: 0, upcoming: 0, past: 1, none: 2 };
  return rows
    .map((r) => ({
      ...r,
      state: deadlineState(r.deadline, today),
      daysLeft: r.deadline ? daysUntil(today, r.deadline) : null,
      fund: fundTotal(r),
      perClaimant: perClaimant(r),
      mdls: mdlLinks(r),
    }))
    .sort((a, b) => {
      const o = order[a.state] - order[b.state];
      if (o) return o;
      if (a.state === "past") return (b.deadline ?? "").localeCompare(a.deadline ?? "");
      return (a.deadline ?? "").localeCompare(b.deadline ?? "") || a.name.localeCompare(b.name);
    });
}

export type Summary = {
  total: number;
  open: number;
  within30: number;
  past: number;
  noDeadline: number;
  /** Null until the amounts are typed (a count of 0 would read as "none have a fund total"). */
  withFund: number | null;
  perClaimantOnly: number | null;
  withMdl: number;
  typed: boolean;
};

export function summarize(rows: readonly SettlementView[]): Summary {
  const typed = rows.some((r) => r.amounts.some((a) => a.role != null));
  const count = (f: (r: SettlementView) => boolean) => rows.filter(f).length;
  return {
    total: rows.length,
    open: count((r) => r.state === "within_30_days" || r.state === "upcoming"),
    within30: count((r) => r.state === "within_30_days"),
    past: count((r) => r.state === "past"),
    noDeadline: count((r) => r.state === "none"),
    withFund: typed ? count((r) => r.fund != null) : null,
    perClaimantOnly: typed ? count((r) => r.fund == null && r.perClaimant.length > 0) : null,
    withMdl: count((r) => r.mdls.length > 0),
    typed,
  };
}

/** Open claim deadlines per calendar month from today's month, `months` long; months with none count 0 (a count of
 * confirmed deadlines, which is known to be zero), and the current month is flagged partial (days already gone). */
export function deadlinesByMonth(
  rows: readonly SettlementView[],
  today: string,
  months = 6,
): { month: string; label: string; count: number; partial: boolean }[] {
  const y0 = Number(today.slice(0, 4));
  const m0 = Number(today.slice(5, 7)) - 1;
  const out: { month: string; label: string; count: number; partial: boolean }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(y0, m0 + i, 1));
    const month = d.toISOString().slice(0, 7);
    out.push({
      month,
      label: d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
      count: 0,
      partial: i === 0,
    });
  }
  for (const r of rows) {
    if ((r.state !== "within_30_days" && r.state !== "upcoming") || !r.deadline) continue;
    const slot = out.find((o) => o.month === r.deadline!.slice(0, 7));
    if (slot) slot.count += 1;
  }
  return out;
}

/** Open settlements with a typed fund total, largest first (each settlement on its own; never summed). */
export function largestOpenFunds(rows: readonly SettlementView[], limit = 8): SettlementView[] {
  return rows
    .filter((r) => (r.state === "within_30_days" || r.state === "upcoming") && r.fund?.valueUsd != null)
    .sort((a, b) => (b.fund!.valueUsd ?? 0) - (a.fund!.valueUsd ?? 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** How many confirmed dollar figures carry each role ("Other" split by its detail); untyped figures counted apart. */
export function roleMix(rows: readonly SettlementView[]): { id: string; label: string; count: number }[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const r of rows)
    for (const a of r.amounts) {
      const id = a.role ? (a.role === "other" ? `other:${a.detail ?? "unclear"}` : a.role) : "untyped";
      const cur = counts.get(id) ?? { label: roleLabel(a), count: 0 };
      cur.count += 1;
      counts.set(id, cur);
    }
  return [...counts.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

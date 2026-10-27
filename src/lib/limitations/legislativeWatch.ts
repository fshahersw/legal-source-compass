/**
 * Time Limits legislative change watch (pure model). Current-session state bills (Open States public-domain bulk
 * data, dataset state_bills) whose title, summary or subject contains one of WATCH_PHRASES. A text match is a review
 * prompt, never a legal classification: nothing here reads or changes a Time Limits rule.
 */
export const WATCH_DATASET = "state_bills";
export const WATCH_PHRASES = [
  "statute of limitations",
  "statutes of limitations",
  "statute of limitation",
  "statutes of limitation",
  "statute of repose",
  "statutes of repose",
  "limitation of actions",
  "limitations of actions",
] as const;

export type WatchBill = {
  id: string;
  state: string;
  identifier: string;
  session: string;
  title: string;
  outcome: "enacted" | "vetoed" | "pending";
  statusLabel: string;
  latestAction: string | null;
  latestActionDate: string | null;
  sourceUrl: string | null;
  /** Which of the phrases the printed title or subjects show ("repose" wins when both appear). */
  mentions: "repose" | "limitations" | "subject or summary";
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
const str = (v: unknown, max = 600): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const day = (v: unknown): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(str(v, 40) ?? "");
  return m ? m[1]! : null;
};
const httpUrl = (v: unknown): string | null => {
  const s = str(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
};
const first = (v: unknown): string | null => (Array.isArray(v) ? str(v[0], 40) : str(v, 40));

/** PostgREST path: current-session bills matching any watch phrase (phrase full-text search, GIN-indexed). */
export function watchPath(limit = 500): string {
  const or = WATCH_PHRASES.map(
    (p) => `search_vector.phfts(simple).${encodeURIComponent(p)}`,
  ).join(",");
  const current = encodeURIComponent(JSON.stringify({ session_role: ["current"] }));
  return `corpus_records?select=id,source_url,c:item->cells,f:filters&dataset=eq.${WATCH_DATASET}&filters=cs.${current}&or=(${or})&order=ordinal.asc&limit=${limit}`;
}

export function parseWatchRow(row: unknown): WatchBill | null {
  const r = obj(row);
  const c = obj(r?.["c"]);
  const f = obj(r?.["f"]);
  const id = str(r?.["id"], 120);
  const state = str(c?.["state"], 2);
  const identifier = str(c?.["identifier"], 60);
  if (!id || !c || !state || !/^[A-Z]{2}$/.test(state) || !identifier) return null;
  const outcomeRaw = first(f?.["outcome"]);
  const outcome = outcomeRaw === "enacted" ? "enacted" : outcomeRaw === "vetoed" ? "vetoed" : "pending";
  const title = str(c["title"], 1200) ?? "Title not recorded";
  const subjects = Array.isArray(f?.["subject"]) ? (f!["subject"] as unknown[]).join(" ") : "";
  const printed = `${title} ${subjects}`.toLowerCase();
  const mentions = /repose/.test(printed)
    ? "repose"
    : /limitation/.test(printed)
      ? "limitations"
      : "subject or summary";
  return {
    id,
    state,
    identifier,
    session: str(c["session_name"], 120) ?? str(c["session"], 60) ?? "Not recorded",
    title,
    outcome,
    statusLabel: str(c["status_label"], 80) ?? "Not recorded",
    latestAction: str(c["latest_action"], 400),
    latestActionDate: day(c["latest_action_date"]),
    sourceUrl: httpUrl(r?.["source_url"]),
    mentions,
  };
}

export type WatchSummary = {
  bills: number;
  states: number;
  enacted: number;
  enactedStates: number;
  vetoed: number;
  pending: number;
  byState: { state: string; total: number; enacted: number }[];
  /** Bills by month of their latest recorded action (not the effective date). */
  byMonth: { month: string; enacted: number; other: number; partial: boolean }[];
  latestActionDate: string | null;
};

/** Months between first and last, inclusive ("2025-01" … "2026-07"). */
function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Counts for the section. A month with no matched bill is a recorded zero inside the range; the month of the data's
 * as-of date is flagged partial.
 */
export function summarizeWatch(bills: readonly WatchBill[], asOf: string | null): WatchSummary {
  const states = new Map<string, { total: number; enacted: number }>();
  for (const b of bills) {
    const s = states.get(b.state) ?? { total: 0, enacted: 0 };
    s.total += 1;
    if (b.outcome === "enacted") s.enacted += 1;
    states.set(b.state, s);
  }
  const dates = bills.map((b) => b.latestActionDate).filter((d): d is string => !!d).sort();
  const firstMonth = dates[0]?.slice(0, 7);
  const lastMonth = dates.at(-1)?.slice(0, 7);
  const asOfMonth = asOf?.slice(0, 7) ?? null;
  const byMonth =
    firstMonth && lastMonth
      ? monthRange(firstMonth, lastMonth).map((month) => {
          const inMonth = bills.filter((b) => b.latestActionDate?.startsWith(month));
          return {
            month,
            enacted: inMonth.filter((b) => b.outcome === "enacted").length,
            other: inMonth.filter((b) => b.outcome !== "enacted").length,
            partial: asOfMonth !== null && month >= asOfMonth,
          };
        })
      : [];
  return {
    bills: bills.length,
    states: states.size,
    enacted: bills.filter((b) => b.outcome === "enacted").length,
    enactedStates: [...states.values()].filter((s) => s.enacted > 0).length,
    vetoed: bills.filter((b) => b.outcome === "vetoed").length,
    pending: bills.filter((b) => b.outcome === "pending").length,
    byState: [...states.entries()]
      .map(([state, s]) => ({ state, ...s }))
      .sort((a, b) => b.total - a.total || b.enacted - a.enacted || a.state.localeCompare(b.state)),
    byMonth,
    latestActionDate: dates.at(-1) ?? null,
  };
}

export const OUTCOME_LABEL: Record<WatchBill["outcome"], string> = {
  enacted: "Enacted",
  vetoed: "Vetoed",
  pending: "No final outcome recorded",
};

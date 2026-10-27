/**
 * Civil-justice legislation watch and congressional attention to mass torts (pure).
 *
 * Membership is a text match on a bill's or hearing's title and summary (the only text the search index holds), never
 * a legal classification; every view says "title or summary mentions". Bills reviewed as plainly off-topic are listed
 * in EXCLUDED_STATE_BILLS with the reason, so the exclusion is visible and reversible.
 *
 * Rules:
 *  - A state bill counts once: the same identifier, first action date and title in two sessions (Open States lists
 *    some carried-over bills twice, e.g. ok-2025-hb2619 / ok-2026-hb2619) is one bill, kept under its current session.
 *  - A latest action dated after today (scheduled "Effective Date" actions) is shown as scheduled and never sorts as
 *    the most recent action.
 *  - The current Congress and the current state sessions are in progress; counts for them are partial.
 */

export type WatchTopic = { id: string; label: string; query: string };

/** State civil-justice topics (websearch syntax, 'simple' config, quoted phrases). */
export const STATE_TOPICS: readonly WatchTopic[] = [
  {
    id: "funding",
    label: "Litigation funding",
    query:
      '"litigation funding" OR "litigation financing" OR "litigation finance" OR "third party litigation" OR "consumer legal funding" OR "litigation investment"',
  },
  {
    id: "damages",
    label: "Damages limits",
    query: '"punitive damages" OR "noneconomic damages" OR "non-economic damages"',
  },
  { id: "product", label: "Product liability", query: '"product liability" OR "products liability"' },
  { id: "asbestos", label: "Asbestos trust claims", query: '"asbestos trust"' },
];

/** Federal litigation-funding bills in the current Congress. */
export const FEDERAL_FUNDING_QUERY =
  '"litigation funding" OR "litigation financing" OR "litigation finance" OR "third party litigation" OR "litigation transparency"';

/** Bills whose title mentions a watched phrase but which are plainly about something else (reviewed 2026-10-27). */
export const EXCLUDED_STATE_BILLS: Readonly<Record<string, string>> = {
  "wy-2025-hb233": "State funding of natural-resource litigation, not third-party funding",
  "ks-2025-2026-hb2378": "Squatter removal act",
  "ks-2023-2024-hb2301": "Age verification for online material",
  "ks-2023-2024-sb160": "Age verification for online material",
  "id-2026-h851": "Libel and slander",
  "mn-2023-2024-hf4021": "Human rights act changes",
  "nj-221-s1128": "Corporate tax deduction for punitive damages",
  "nj-222-s2295": "Corporate tax deduction for punitive damages",
  "ok-2025-sb624": "Searches and seizures",
  "ok-2026-sb624": "Searches and seizures",
  "ok-2026-sb1321": "Searches and seizures",
  "ok-2026-hb3130": "Health services for minors",
  "tn-114-hb221": "Obscenity",
  "tn-114-sb467": "Obscenity",
  "va-2025-sb1421": "Use of a person's voice or likeness",
  "va-2026-hb581": "Use of a person's voice or likeness",
  "va-2026-sb753": "Use of a person's voice or likeness",
};

export type BillStage = "enacted" | "vetoed" | "pending" | "not_passed";
export const STAGE_LABEL: Record<BillStage, string> = {
  enacted: "Enacted",
  vetoed: "Vetoed",
  pending: "Pending",
  not_passed: "Not passed (session ended)",
};

export type WatchBill = {
  id: string;
  state: string;
  identifier: string;
  title: string;
  session: string | null;
  current: boolean;
  stage: BillStage;
  statusLabel: string | null;
  sponsor: string | null;
  firstAction: string | null;
  latestAction: string | null;
  latestActionDate: string | null;
  /** The latest action is dated after today (a scheduled action as printed). */
  scheduled: boolean;
  url: string | null;
  topics: string[];
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const first = (v: unknown): string | null => (Array.isArray(v) ? str(v[0]) : str(v));
const day = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** One state_bills row (select id,title,source_url,filters,cells:item->cells) as a watch bill. */
export function toWatchBill(raw: unknown, topic: string, today: string): WatchBill | null {
  const r = obj(raw);
  const id = str(r["id"]);
  if (!id || id in EXCLUDED_STATE_BILLS) return null;
  const f = obj(r["filters"]);
  const c = obj(r["cells"]);
  const outcome = first(f["outcome"]);
  const current = first(f["session_role"]) === "current";
  const stage: BillStage =
    outcome === "enacted" ? "enacted" : outcome === "vetoed" ? "vetoed" : current ? "pending" : "not_passed";
  const latest = day(c["latest_action_date"]);
  return {
    id,
    state: first(f["state"]) ?? str(c["state"]) ?? "Not recorded",
    identifier: str(c["identifier"]) ?? id,
    title: (str(c["title"]) ?? str(r["title"]) ?? id).replace(/\s+/g, " "),
    session: str(c["session_name"]) ?? first(f["session"]),
    current,
    stage,
    statusLabel: str(c["status_label"]),
    sponsor: str(c["sponsor"]),
    firstAction: day(c["first_action_date"]),
    latestAction: str(c["latest_action"]),
    latestActionDate: latest,
    scheduled: latest !== null && latest > today,
    url: str(r["source_url"]),
    topics: [topic],
  };
}

/**
 * Merge the per-topic matches: one bill per id (topics joined), then one bill per carried-over pair (same state,
 * identifier, first action date and title), keeping the current-session record.
 */
export function mergeBills(lists: readonly (readonly WatchBill[])[]): WatchBill[] {
  const byId = new Map<string, WatchBill>();
  for (const list of lists)
    for (const b of list) {
      const had = byId.get(b.id);
      if (had) had.topics = [...new Set([...had.topics, ...b.topics])];
      else byId.set(b.id, { ...b, topics: [...b.topics] });
    }
  const byKey = new Map<string, WatchBill>();
  for (const b of byId.values()) {
    const key = b.firstAction ? `${b.state}|${b.identifier}|${b.firstAction}|${b.title}` : `id|${b.id}`;
    const had = byKey.get(key);
    if (!had) byKey.set(key, b);
    else {
      const keep = b.current && !had.current ? b : had;
      keep.topics = [...new Set([...had.topics, ...b.topics])];
      byKey.set(key, keep);
    }
  }
  return sortByLatestAction([...byKey.values()]);
}

/** Latest action first; scheduled (future-dated) actions and undated bills after every dated past action. */
export function sortByLatestAction<T extends { latestActionDate: string | null; scheduled: boolean; id: string }>(
  rows: readonly T[],
): T[] {
  const rank = (b: T) => (b.latestActionDate && !b.scheduled ? 0 : b.scheduled ? 1 : 2);
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 0 ? (b.latestActionDate as string).localeCompare(a.latestActionDate as string) : 0) ||
      a.id.localeCompare(b.id),
  );
}

export type StageCounts = Record<BillStage, number>;
const zero = (): StageCounts => ({ enacted: 0, vetoed: 0, pending: 0, not_passed: 0 });

export function stageCounts(rows: readonly WatchBill[]): StageCounts {
  const out = zero();
  for (const b of rows) out[b.stage] += 1;
  return out;
}

export function byState(rows: readonly WatchBill[]): { state: string; counts: StageCounts; total: number }[] {
  const m = new Map<string, WatchBill[]>();
  for (const b of rows) m.set(b.state, [...(m.get(b.state) ?? []), b]);
  return [...m.entries()]
    .map(([state, list]) => ({ state, counts: stageCounts(list), total: list.length }))
    .sort((a, b) => b.total - a.total || a.state.localeCompare(b.state));
}

export function byTopic(
  rows: readonly WatchBill[],
  topics: readonly WatchTopic[] = STATE_TOPICS,
): { topic: WatchTopic; counts: StageCounts; total: number }[] {
  return topics.map((topic) => {
    const list = rows.filter((b) => b.topics.includes(topic.id));
    return { topic, counts: stageCounts(list), total: list.length };
  });
}

// ------------------------------------------------------------------------------------------------ federal

export type FederalWatchBill = {
  id: string;
  citation: string;
  title: string;
  sponsor: string | null;
  bioguide: string | null;
  cosponsors: number | null;
  status: string | null;
  becameLaw: boolean;
  introduced: string | null;
  latestAction: string | null;
  latestActionDate: string | null;
  url: string | null;
};

export function toFederalBill(raw: unknown): FederalWatchBill | null {
  const r = obj(raw);
  const id = str(r["id"]);
  if (!id) return null;
  const f = obj(r["filters"]);
  const c = obj(r["cells"]);
  const co = c["cosponsors"];
  return {
    id,
    citation: str(c["citation"]) ?? id,
    title: (str(c["title"]) ?? str(r["title"]) ?? id).replace(/\s+/g, " "),
    sponsor: str(c["sponsor"]),
    bioguide: first(f["sponsor"]),
    cosponsors: typeof co === "number" && Number.isFinite(co) && co >= 0 ? co : null,
    status: str(c["status_label"]),
    becameLaw: first(f["has_law"]) === "yes",
    introduced: day(c["introduced"]),
    latestAction: str(c["latest_action"]),
    latestActionDate: day(c["latest_action_date"]),
    url: str(r["source_url"]),
  };
}

/** The Congress in session on a date (a new Congress starts on January 3 of each odd year). */
export function congressOn(today: string): number {
  const y = Number(today.slice(0, 4));
  const year = y % 2 === 1 && today.slice(5) < "01-03" ? y - 1 : y;
  return Math.floor((year - 1789) / 2) + 1;
}

// ------------------------------------------------------------------------------------------------ Congress attention

export const ATTENTION_TOPICS: readonly WatchTopic[] = [
  { id: "pfas", label: "PFAS", query: "PFAS OR perfluoroalkyl OR polyfluoroalkyl" },
  { id: "opioids", label: "Opioids", query: "opioid OR opioids OR fentanyl OR oxycontin" },
  { id: "talc", label: "Talc and asbestos", query: "talc OR asbestos" },
  { id: "lejeune", label: "Camp Lejeune", query: '"Camp Lejeune"' },
  { id: "funding", label: "Litigation funding", query: FEDERAL_FUNDING_QUERY },
];

/** First Congress the bill collection covers (GovInfo Bill Status). */
export const FIRST_CONGRESS = 108;

export type Hearing = { id: string; title: string; congress: number | null; held: string | null; url: string | null };

/** A govinfo_hearings row; the publisher's "Not stated" for the date is a missing date, never a date. */
export function toHearing(raw: unknown): Hearing | null {
  const r = obj(raw);
  const id = str(r["id"]);
  if (!id) return null;
  const congress = Number(r["congress"]);
  return {
    id,
    title: (str(r["title"]) ?? id).replace(/\s+/g, " "),
    congress: Number.isInteger(congress) && congress > 0 ? congress : null,
    held: day(r["held"]),
    url: str(r["source_url"]),
  };
}

/** Latest held date among hearings, ignoring missing dates (max over the "Not stated" sentinel is not a date). */
export function latestHeld(rows: readonly { held: string | null }[]): string | null {
  return rows.reduce<string | null>((m, h) => (h.held && (m === null || h.held > m) ? h.held : m), null);
}

export type AttentionCell = { congress: number; bills: number; hearings: number };
export type AttentionTopic = {
  topic: WatchTopic;
  cells: AttentionCell[];
  bills: number;
  billsBecameLaw: number;
  hearings: Hearing[];
};

export function attentionMatrix(
  topic: WatchTopic,
  bills: readonly { congress: number | null; becameLaw: boolean }[],
  hearings: readonly Hearing[],
  current: number,
): AttentionTopic {
  const cells: AttentionCell[] = [];
  for (let c = FIRST_CONGRESS; c <= current; c++)
    cells.push({
      congress: c,
      bills: bills.filter((b) => b.congress === c).length,
      hearings: hearings.filter((h) => h.congress === c).length,
    });
  const inRange = (c: number | null) => c !== null && c >= FIRST_CONGRESS && c <= current;
  const kept = bills.filter((b) => inRange(b.congress));
  return {
    topic,
    cells,
    bills: kept.length,
    billsBecameLaw: kept.filter((b) => b.becameLaw).length,
    hearings: hearings
      .filter((h) => inRange(h.congress))
      .sort((a, b) => (b.held ?? "").localeCompare(a.held ?? "") || a.id.localeCompare(b.id)),
  };
}

export type LegislationWatch = {
  today: string;
  congress: number;
  stateBills: WatchBill[];
  federal: FederalWatchBill[];
  attention: AttentionTopic[];
  readAt: string;
};

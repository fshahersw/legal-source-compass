/**
 * In-force state law (state-law-inforce/1): shapes returned by the public.state_law_* RPCs
 * (database/contracts/state-law-inforce-v1.sql) and pure helpers for the /law/codes pages.
 * Everything here is defensive parsing: a missing value stays null and is shown as "Not recorded".
 */

export const STATE_LAW_STATUSES = [
  "in_force",
  "future_effective",
  "repealed",
  "expired",
  "reserved",
  "renumbered",
  "transferred",
  "not_recorded",
] as const;
export type StateLawStatus = (typeof STATE_LAW_STATUSES)[number];

export const STATUS_LABEL: Record<StateLawStatus, string> = {
  in_force: "In force",
  future_effective: "Not yet in effect",
  repealed: "Repealed",
  expired: "Expired",
  reserved: "Reserved",
  renumbered: "Renumbered",
  transferred: "Transferred",
  not_recorded: "Status not recorded",
};

export const STATUS_BASIS_LABEL: Record<string, string> = {
  publisher_marker: "Set by the publisher's own marker",
  current_compilation:
    "Printed as operative text in the publisher's current compilation (no repeal or other marker)",
  not_recorded: "The publisher's markers do not establish a status",
};

export type StateLawCode = { code: string; name: string; citationTemplate: string | null };

export type StateLawEdition = {
  editionId: string;
  state: string;
  codeName: string;
  publisher: string | null;
  publisherUrl: string | null;
  officialSource: boolean;
  editionLabel: string | null;
  currencyStatement: string | null;
  currencySourceUrl: string | null;
  currencyThrough: string | null;
  sourceLastModified: string | null;
  sourceMode: string | null;
  retrievedFrom: string | null;
  retrievedTo: string | null;
  activatedAt: string | null;
  sections: number | null;
  byStatus: Partial<Record<StateLawStatus, number>>;
  updateCadence: string | null;
  termsNote: string | null;
  codes: StateLawCode[];
};

export type StateLawNode = {
  nodeId: string;
  level: string;
  label: string;
  number: string | null;
  heading: string | null;
  sections: number | null;
};

export type StateLawSectionBrief = {
  sectionId: string;
  code: string | null;
  number: string | null;
  citation: string;
  heading: string | null;
  status: StateLawStatus;
  version: string | null;
};

export type StateLawTree =
  | { available: false; reason: string }
  | {
      available: true;
      edition: StateLawEdition | null;
      node: StateLawNode | null;
      breadcrumb: StateLawNode[];
      children: StateLawNode[];
      sections: StateLawSectionBrief[];
      totalSections: number;
      offset: number;
      truncated: boolean;
    };

export type StateLawSection =
  | { available: false; reason: string; edition: StateLawEdition | null }
  | {
      available: true;
      edition: StateLawEdition | null;
      section: StateLawSectionBrief & {
        text: string;
        history: string | null;
        statusBasis: string | null;
        statusMarker: string | null;
        effectiveStart: string | null;
        effectiveEnd: string | null;
        effectiveNote: string | null;
        nodeId: string | null;
        sourceUrl: string | null;
        sourceSha256: string | null;
        sourceMethod: string | null;
        retrievedAt: string | null;
        textSha256: string | null;
      };
      breadcrumb: StateLawNode[];
      prev: StateLawSectionBrief | null;
      next: StateLawSectionBrief | null;
      otherVersions: StateLawSectionBrief[];
    };

export type StateLawSearchHit = StateLawSectionBrief & { snippet: string | null };
export type StateLawSearch =
  | { available: false; reason: string }
  | {
      available: true;
      total: number;
      totalCapped: boolean;
      hits: StateLawSearchHit[];
      exact: {
        result: string;
        sectionId: string | null;
        citation: string | null;
        candidates: StateLawSectionBrief[];
      } | null;
    };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && /^\d+$/.test(v)
      ? Number(v)
      : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function asStatus(v: unknown): StateLawStatus {
  return (STATE_LAW_STATUSES as readonly string[]).includes(v as string)
    ? (v as StateLawStatus)
    : "not_recorded";
}

export function parseEdition(v: unknown): StateLawEdition | null {
  const o = obj(v);
  const editionId = str(o?.["edition_id"]);
  const state = str(o?.["state"]);
  if (!o || !editionId || !state) return null;
  const byStatus: Partial<Record<StateLawStatus, number>> = {};
  const raw = obj(o["by_status"]);
  if (raw)
    for (const [k, n] of Object.entries(raw)) {
      const count = num(n);
      if (count != null && (STATE_LAW_STATUSES as readonly string[]).includes(k))
        byStatus[k as StateLawStatus] = count;
    }
  return {
    editionId,
    state,
    codeName: str(o["code_name"]) ?? `${state} statutes`,
    publisher: str(o["publisher"]),
    publisherUrl: safeHttps(o["publisher_url"]),
    officialSource: o["official_source"] === true,
    editionLabel: str(o["edition_label"]),
    currencyStatement: str(o["currency_statement"]),
    currencySourceUrl: safeHttps(o["currency_source_url"]),
    currencyThrough: str(o["currency_through"]),
    sourceLastModified: str(o["source_last_modified"]),
    sourceMode: str(o["source_mode"]),
    retrievedFrom: str(o["retrieved_from"]),
    retrievedTo: str(o["retrieved_to"]),
    activatedAt: str(o["activated_at"]),
    sections: num(o["sections"]),
    byStatus,
    updateCadence: str(o["update_cadence"]),
    termsNote: str(o["terms_note"]),
    codes: arr(o["codes"]).flatMap((c) => {
      const co = obj(c);
      const code = str(co?.["code"]);
      return code
        ? [
            {
              code,
              name: str(co?.["name"]) ?? code,
              citationTemplate: str(co?.["citation_template"]),
            },
          ]
        : [];
    }),
  };
}

export function parseStates(v: unknown): StateLawEdition[] {
  return arr(v).flatMap((e) => {
    const parsed = parseEdition(e);
    return parsed ? [parsed] : [];
  });
}

function parseNode(v: unknown): StateLawNode | null {
  const o = obj(v);
  const nodeId = str(o?.["node_id"]);
  if (!o || !nodeId) return null;
  return {
    nodeId,
    level: str(o["level"]) ?? "other",
    label: str(o["label"]) ?? "",
    number: str(o["number"]),
    heading: str(o["heading"]),
    sections: num(o["sections"]),
  };
}

function nodes(v: unknown): StateLawNode[] {
  return arr(v).flatMap((n) => {
    const parsed = parseNode(n);
    return parsed ? [parsed] : [];
  });
}

export function parseBrief(v: unknown): StateLawSectionBrief | null {
  const o = obj(v);
  const sectionId = str(o?.["section_id"]);
  if (!o || !sectionId) return null;
  return {
    sectionId,
    code: str(o["code"]),
    number: str(o["number"]),
    citation: str(o["citation"]) ?? sectionId,
    heading: str(o["heading"]),
    status: asStatus(o["status"]),
    version: str(o["version"]),
  };
}

function briefs(v: unknown): StateLawSectionBrief[] {
  return arr(v).flatMap((b) => {
    const parsed = parseBrief(b);
    return parsed ? [parsed] : [];
  });
}

export function parseTree(v: unknown): StateLawTree {
  const o = obj(v);
  if (!o || o["available"] !== true)
    return { available: false, reason: str(o?.["reason"]) ?? "not_installed" };
  return {
    available: true,
    edition: parseEdition(o["edition"]),
    node: parseNode(o["node"]),
    breadcrumb: nodes(o["breadcrumb"]),
    children: nodes(o["children"]),
    sections: briefs(o["sections"]),
    totalSections: num(o["total_sections"]) ?? 0,
    offset: num(o["offset"]) ?? 0,
    truncated: o["truncated"] === true,
  };
}

export function parseSection(v: unknown): StateLawSection {
  const o = obj(v);
  if (!o || o["available"] !== true)
    return {
      available: false,
      reason: str(o?.["reason"]) ?? "not_installed",
      edition: parseEdition(o?.["edition"]),
    };
  const s = obj(o["section"]);
  const brief = parseBrief(s);
  if (!s || !brief)
    return { available: false, reason: "unknown_section", edition: parseEdition(o["edition"]) };
  const eff = obj(s["effective"]);
  const src = obj(s["source"]);
  return {
    available: true,
    edition: parseEdition(o["edition"]),
    section: {
      ...brief,
      text: typeof s["text"] === "string" ? (s["text"] as string) : "",
      history: str(s["history"]),
      statusBasis: str(s["status_basis"]),
      statusMarker: str(s["status_marker"]),
      effectiveStart: str(eff?.["start"]),
      effectiveEnd: str(eff?.["end"]),
      effectiveNote: str(eff?.["note"]),
      nodeId: str(s["node_id"]),
      sourceUrl: safeHttps(src?.["url"]),
      sourceSha256: str(src?.["sha256"]),
      sourceMethod: str(src?.["method"]),
      retrievedAt: str(src?.["retrieved_at"]),
      textSha256: str(s["text_sha256"]),
    },
    breadcrumb: nodes(o["breadcrumb"]),
    prev: parseBrief(o["prev"]),
    next: parseBrief(o["next"]),
    otherVersions: briefs(o["other_versions"]),
  };
}

export function parseSearch(v: unknown): StateLawSearch {
  const o = obj(v);
  if (!o || o["available"] !== true)
    return { available: false, reason: str(o?.["reason"]) ?? "not_installed" };
  const ex = obj(o["exact"]);
  return {
    available: true,
    total: num(o["total"]) ?? 0,
    totalCapped: o["total_capped"] === true,
    hits: arr(o["hits"]).flatMap((h) => {
      const b = parseBrief(h);
      return b ? [{ ...b, snippet: str(obj(h)?.["snippet"]) }] : [];
    }),
    exact: ex
      ? {
          result: str(ex["result"]) ?? "unresolved",
          sectionId: str(ex["section_id"]),
          citation: str(ex["citation"]),
          candidates: briefs(ex["candidates"]),
        }
      : null,
  };
}

/** Only https links leave the page; anything else is not shown. */
export function safeHttps(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const url = new URL(s);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Split a ts_headline snippet (⟦match⟧ markers) into plain/highlight segments; markup never passes through. */
export function snippetSegments(snippet: string | null): { text: string; hit: boolean }[] {
  if (!snippet) return [];
  const out: { text: string; hit: boolean }[] = [];
  const re = /⟦([^⟧]*)⟧/g;
  let last = 0;
  for (let m = re.exec(snippet); m; m = re.exec(snippet)) {
    if (m.index > last) out.push({ text: snippet.slice(last, m.index), hit: false });
    out.push({ text: m[1] ?? "", hit: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), hit: false });
  return out.filter((s) => s.text.length > 0);
}

/** "Oct 6, 2026" for an ISO timestamp/date; null stays null. */
export function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * One line for an index row, in order of what the publisher itself states: its currency sentence (verbatim), a
 * current-through date it states without a sentence, its edition label, what its source files state about their
 * age, else "Not recorded". Nothing is inferred.
 */
export function currencyLine(
  e: Pick<StateLawEdition, "currencyStatement" | "editionLabel"> &
    Partial<Pick<StateLawEdition, "currencyThrough" | "sourceLastModified">>,
): string {
  if (e.currencyStatement) return e.currencyStatement;
  const through = shortDate(e.currencyThrough ?? null);
  if (through) return `Publisher states the text is current through ${through}`;
  if (e.editionLabel) return e.editionLabel;
  if (e.sourceLastModified) return `No currency statement · source files: ${e.sourceLastModified}`;
  return "Not recorded";
}

/** Node label as printed: "Chapter 95", "Title VIII", or the heading for unnumbered groups. */
export function nodeLabel(n: Pick<StateLawNode, "label" | "number" | "heading" | "level">): string {
  if (n.level === "code") return n.heading ?? n.label;
  if (n.number) return `${n.label || n.level} ${n.number}`.trim();
  return n.heading ?? n.label ?? n.level;
}

export const NODE_ID_MAX = 600;
export const SECTION_ID_MAX = 320;

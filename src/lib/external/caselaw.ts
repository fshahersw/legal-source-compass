/**
 * Case law (CourtListener bulk data, snapshot 2026-09-30): pure parsing and text layout shared by the server functions
 * (caselaw.functions.ts) and the /cases pages. Nothing here touches the network.
 *
 * Data contract (scripts/enrichment/caselaw, database/contracts/caselaw-read-v1.sql):
 *  - caselaw_case_v1 returns one case row with its opinions' byte pointers into the private reading store;
 *  - each opinion is one gzip member holding a "caselaw-read/1" record: text, star pages
 *    [label, citation_index, offset] and citation anchors [start, end, cluster_id|null, opinion_id, held];
 *  - the citator member ("caselaw-citator/1") holds cited-by counts, citing cases, parentheticals and authorities.
 * Offsets in stored records are Unicode code points; JavaScript strings index UTF-16 units, so they are converted here.
 * Malformed values are dropped, never repaired; unknown values stay null (the page says "Not recorded").
 */

export const SNAPSHOT = "2026-09-30";
export const READ_KEY = /^caselaw\/read\/2026-09-30\/[a-z0-9_./-]+\.jsonl\.gz$/;
export const CITATOR_KEY = /^caselaw\/citator\/2026-09-30\/[a-z0-9_./-]+\.jsonl\.gz$/;
export const COURT_ID = /^[a-z0-9_-]{1,40}$/;
export const MAX_RANGE_BYTES = 12_000_000;

// ---------------------------------------------------------------------------------------------- primitives
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = num(v);
  return n != null && Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const str = (v: unknown, max = 100_000) =>
  typeof v === "string" && v.trim() && v.length <= max ? v : null;
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export function isoDay(v: unknown): string | null {
  const s = str(v, 10);
  if (!s || !ISO_DAY.test(s)) return null;
  const t = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== s ? null : s;
}
const courtId = (v: unknown) => {
  const s = str(v, 40);
  return s && COURT_ID.test(s) ? s : null;
};
const clusterId = (v: unknown) => int(v, 1, 2_000_000_000);

// ---------------------------------------------------------------------------------------------- labels
export const TIER_LABEL: Record<number, string> = {
  1: "Supreme Court",
  2: "Federal appellate",
  3: "State highest court",
};
const TYPE_LABEL: Record<string, string> = {
  "010combined": "Combined opinion",
  "015unamimous": "Unanimous opinion",
  "020lead": "Majority opinion",
  "025plurality": "Plurality opinion",
  "030concurrence": "Concurrence",
  "035concurrenceinpart": "Concurrence in part",
  "040dissent": "Dissent",
  "050addendum": "Addendum",
  "060remittitur": "Remittitur",
  "070rehearing": "Rehearing",
  "080onthemerits": "On the merits",
  "090onmotiontostrike": "On motion to strike",
  "100trialcourt": "Trial court document",
};
export const opinionTypeLabel = (t: string | null) =>
  (t && TYPE_LABEL[t]) ?? (t ? `Opinion (${t})` : "Opinion");
/** SCDB decisionDirection codes as documented in the SCDB codebook (1 conservative, 2 liberal, 3 unspecifiable). */
export const SCDB_DIRECTION: Record<number, string> = {
  1: "Conservative",
  2: "Liberal",
  3: "Unspecifiable",
};

/** A CourtListener page for a cluster (the slug is ignored by CourtListener; it only makes the link readable). */
export function courtListenerCaseUrl(id: number, name?: string | null): string {
  const slug =
    (name ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 75)
      .replace(/-+$/, "") || "case";
  return `https://www.courtlistener.com/opinion/${id}/${slug}/`;
}

// ---------------------------------------------------------------------------------------------- case row
export type OpinionRef = {
  id: number;
  type: string | null;
  label: string;
  author: string | null;
  perCuriam: boolean | null;
  pointer: { key: string; offset: number; length: number } | null;
};
export type CaseRecord = {
  clusterId: number;
  tier: 1 | 2 | 3;
  tierLabel: string;
  courtId: string;
  court: string;
  courtShort: string | null;
  dateFiled: string | null;
  dateApprox: boolean;
  caseName: string;
  caseNameFull: string | null;
  docketNumber: string | null;
  precedentialStatus: string | null;
  citationCount: number | null;
  citedBy: number;
  citedByCases: number;
  parentheticals: number;
  authorities: number;
  citations: string[];
  judges: string | null;
  panel: string[];
  disposition: string | null;
  scdb: {
    id: string;
    decisionDirection: number | null;
    votesMajority: number | null;
    votesMinority: number | null;
  } | null;
  opinions: OpinionRef[];
  citator: { key: string; offset: number; length: number } | null;
  authoritiesRef: { key: string; offset: number; length: number } | null;
  courtListenerUrl: string;
};

function pointer(
  o: Record<string, unknown> | null,
  keyRe: RegExp,
  k = "key",
  s = "offset",
  n = "length",
) {
  if (!o) return null;
  const key = str(o[k], 300);
  const offset = int(o[s], 0);
  const length = int(o[n], 1, MAX_RANGE_BYTES);
  return key && keyRe.test(key) && offset != null && length != null
    ? { key, offset, length }
    : null;
}

export function parseCaseRow(raw: unknown, expectedId: number): CaseRecord | null {
  const r = obj(raw);
  if (!r) return null;
  const id = clusterId(r["cluster_id"]);
  const tier = int(r["tier"], 1, 3) as 1 | 2 | 3 | null;
  const cid = courtId(r["court_id"]);
  const name = str(r["case_name"], 5000);
  if (id !== expectedId || !tier || !cid || !name) return null;
  const court = obj(r["court"]);
  const scdbRaw = obj(r["scdb"]);
  const scdbId = str(scdbRaw?.["id"], 40);
  const opinions: OpinionRef[] = [];
  const seen = new Set<number>();
  for (const x of arr(r["opinions"])) {
    const o = obj(x);
    const oid = int(o?.["id"], 1, 2_000_000_000);
    if (!o || oid == null || seen.has(oid)) continue;
    seen.add(oid);
    const type = str(o["type"], 40);
    opinions.push({
      id: oid,
      type,
      label: opinionTypeLabel(type),
      author: str(o["author"], 300),
      perCuriam: typeof o["per_curiam"] === "boolean" ? o["per_curiam"] : null,
      pointer: pointer(o, READ_KEY, "key", "s", "n"),
    });
  }
  const full = str(r["case_name_full"], 20000);
  return {
    clusterId: id,
    tier,
    tierLabel: TIER_LABEL[tier]!,
    courtId: cid,
    court: str(court?.["full_name"], 300) ?? cid,
    courtShort: str(court?.["short_name"], 200),
    dateFiled: isoDay(r["date_filed"]),
    dateApprox: r["date_approx"] === true,
    caseName: name,
    caseNameFull: full && full !== name ? full : null,
    docketNumber: str(r["docket_number"], 500),
    precedentialStatus: str(r["precedential_status"], 40),
    citationCount: int(r["citation_count"]),
    citedBy: int(r["cited_by"]) ?? 0,
    citedByCases: int(r["cited_by_cases"]) ?? 0,
    parentheticals: int(r["parentheticals"]) ?? 0,
    authorities: int(r["authorities"]) ?? 0,
    citations: arr(r["citations"])
      .map((c) => str(c, 120))
      .filter((c): c is string => !!c),
    judges: str(r["judges"], 2000),
    panel: arr(r["panel"])
      .map((c) => str(c, 200))
      .filter((c): c is string => !!c),
    disposition: str(r["disposition"], 2000),
    scdb: scdbId
      ? {
          id: scdbId,
          decisionDirection: int(scdbRaw?.["decision_direction"], 1, 3),
          votesMajority: int(scdbRaw?.["votes_majority"], 0, 9),
          votesMinority: int(scdbRaw?.["votes_minority"], 0, 9),
        }
      : null,
    opinions,
    citator: pointer(obj(r["citator"]), CITATOR_KEY),
    authoritiesRef: pointer(obj(r["authorities_ref"]), CITATOR_KEY),
    courtListenerUrl: courtListenerCaseUrl(id, name),
  };
}

/** Tab order: majority/lead and the other split opinions first, a combined text last when split opinions exist. */
export function orderOpinions(ops: OpinionRef[]): OpinionRef[] {
  const split = ops.some((o) => o.type !== "010combined");
  const rank = (o: OpinionRef) => (o.type === "010combined" && split ? 1 : 0);
  return [...ops].sort((a, b) => rank(a) - rank(b));
}

/** One byte range covering every pointer (all of a case's opinions sit next to each other in one object). */
export function coveringRange(
  ptrs: { key: string; offset: number; length: number }[],
): { key: string; start: number; end: number } | null {
  if (!ptrs.length) return null;
  const key = ptrs[0]!.key;
  if (ptrs.some((p) => p.key !== key)) return null;
  const start = Math.min(...ptrs.map((p) => p.offset));
  const end = Math.max(...ptrs.map((p) => p.offset + p.length));
  return end - start <= MAX_RANGE_BYTES ? { key, start, end } : null;
}

// ---------------------------------------------------------------------------------------------- reading record
export type PageMark = { label: string; index: number | null; offset: number };
export type CiteAnchor = {
  start: number;
  end: number;
  clusterId: number | null;
  opinionId: number | null;
  held: boolean;
};
export type OpinionText = {
  opinionId: number;
  clusterId: number;
  type: string | null;
  author: string | null;
  joinedBy: string | null;
  perCuriam: boolean;
  text: string;
  pagesSource: string | null;
  pages: PageMark[];
  paginatedText: string | null;
  citations: CiteAnchor[];
  sourceUrl: string | null;
  downloadUrl: string | null;
  textSha256: string | null;
};

/** UTF-16 index for each code-point offset of `text` (identity when the text has no astral characters). */
export function codePointMapper(text: string): (cp: number) => number {
  if (!/[\uD800-\uDFFF]/.test(text)) return (cp) => Math.min(cp, text.length);
  const idx: number[] = [];
  for (let i = 0; i < text.length; i++) {
    idx.push(i);
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) i++;
  }
  idx.push(text.length);
  return (cp) => (cp < idx.length ? idx[cp]! : text.length);
}

export function parseReadingRecord(raw: unknown, expectedOpinionId: number): OpinionText | null {
  const r = obj(raw);
  if (!r || r["format"] !== "caselaw-read/1") return null;
  const oid = int(r["opinion_id"], 1);
  const cid = clusterId(r["cluster_id"]);
  const text = typeof r["text"] === "string" ? r["text"] : null;
  if (oid !== expectedOpinionId || cid == null || text == null) return null;
  const pag = typeof r["text_paginated"] === "string" ? r["text_paginated"] : null;
  const pagesSource = str(r["pages_source"], 40);
  const pageText = pagesSource === "xml_harvard_text" && pag ? pag : text;
  const mapPages = codePointMapper(pageText);
  const pages: PageMark[] = [];
  for (const p of arr(r["pages"])) {
    const a = arr(p);
    const label = str(a[0], 40);
    const off = int(a[2], 0);
    if (!label || off == null) continue;
    pages.push({ label, index: int(a[1], 0, 99), offset: mapPages(off) });
  }
  const map = codePointMapper(text);
  const citations: CiteAnchor[] = [];
  for (const c of arr(r["citations"])) {
    const a = arr(c);
    const s = int(a[0], 0);
    const e = int(a[1], 0);
    if (s == null || e == null || e <= s) continue;
    // held 2: the cited case is blocked in CourtListener; its citation stays plain text, linked nowhere
    citations.push({
      start: map(s),
      end: map(e),
      clusterId: a[4] === 2 ? null : clusterId(a[2]),
      opinionId: a[4] === 2 ? null : int(a[3], 1),
      held: a[4] === 1,
    });
  }
  const url = (v: unknown) => {
    const s = str(v, 2000);
    return s && /^https?:\/\//.test(s) ? s : null;
  };
  return {
    opinionId: oid,
    clusterId: cid,
    type: str(r["type"], 40),
    author: str(r["author_str"], 300),
    joinedBy: str(r["joined_by_str"], 2000),
    perCuriam: r["per_curiam"] === true,
    text,
    pagesSource,
    pages: pages.sort((a, b) => a.offset - b.offset),
    paginatedText: pagesSource === "xml_harvard_text" ? pag : null,
    citations: citations.sort((a, b) => a.start - b.start),
    sourceUrl: url(r["source_url"]),
    downloadUrl: url(r["download_url"]),
    textSha256: str(r["text_sha256"], 64),
  };
}

// ---------------------------------------------------------------------------------------------- text layout
export type Segment =
  | { kind: "text"; text: string }
  | { kind: "page"; label: string; index: number | null }
  | { kind: "cite"; text: string; clusterId: number | null; held: boolean };

/**
 * Split an opinion into text, star-page labels and citation links. A page marker whose text ("*232") sits at its
 * offset is replaced by the label; otherwise the label is inserted at the offset. Citation anchors that overlap a
 * marker are split around it. Every character of `text` other than a replaced marker appears exactly once.
 */
export function segmentOpinion(text: string, pages: PageMark[], cites: CiteAnchor[]): Segment[] {
  type Ev = { at: number; kind: "page"; label: string; index: number | null; consume: number };
  const evs: Ev[] = [];
  for (const p of pages) {
    if (p.offset < 0 || p.offset > text.length) continue;
    const marker = `*${p.label}`;
    const consume = text.startsWith(marker, p.offset) ? marker.length : 0;
    evs.push({ at: p.offset, kind: "page", label: p.label, index: p.index, consume });
  }
  evs.sort((a, b) => a.at - b.at);
  const anchors = cites.filter((c) => c.start >= 0 && c.end <= text.length && c.end > c.start);
  const out: Segment[] = [];
  let pos = 0;
  let ai = 0;
  const pushText = (from: number, to: number) => {
    if (to <= from) return;
    // citation parts inside [from, to)
    let cur = from;
    while (cur < to) {
      while (ai < anchors.length && anchors[ai]!.end <= cur) ai++;
      const a = anchors[ai];
      if (!a || a.start >= to) {
        out.push({ kind: "text", text: text.slice(cur, to) });
        return;
      }
      if (a.start > cur) {
        out.push({ kind: "text", text: text.slice(cur, a.start) });
        cur = a.start;
      }
      const end = Math.min(a.end, to);
      out.push({ kind: "cite", text: text.slice(cur, end), clusterId: a.clusterId, held: a.held });
      cur = end;
    }
  };
  for (const e of evs) {
    if (e.at < pos) {
      out.push({ kind: "page", label: e.label, index: e.index });
      continue;
    }
    pushText(pos, e.at);
    out.push({ kind: "page", label: e.label, index: e.index });
    pos = e.at + e.consume;
  }
  pushText(pos, text.length);
  // merge adjacent text segments
  const merged: Segment[] = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (s.kind === "text" && last?.kind === "text") last.text += s.text;
    else merged.push(s.kind === "text" ? { ...s } : s);
  }
  return merged.filter((s) => s.kind !== "text" || s.text.length > 0);
}

// ---------------------------------------------------------------------------------------------- citator
export type CitingCase = {
  clusterId: number;
  name: string;
  courtId: string | null;
  date: string | null;
  citation: string | null;
  citationCount: number | null;
  depth: number | null;
  opinions: number | null;
  held: boolean;
};
export type Parenthetical = {
  text: string;
  score: number | null;
  clusterId: number;
  name: string;
  courtId: string | null;
  date: string | null;
  citation: string | null;
  held: boolean;
};
export type Authority = {
  clusterId: number | null;
  name: string | null;
  courtId: string | null;
  date: string | null;
  citation: string | null;
  anchors: number;
  firstText: string | null;
  held: boolean;
};
export type Citator = {
  clusterId: number;
  citedByOpinions: number;
  citedByCases: number;
  byCourt: { courtId: string; n: number }[];
  byDecade: { decade: number | null; n: number }[];
  byCourtDecade: { courtId: string; decade: number | null; n: number }[];
  citing: CitingCase[];
  citingRank: string | null;
  parentheticals: Parenthetical[];
  parentheticalsTotal: number;
  courts: Record<string, string>;
};
export type Authorities = {
  clusterId: number;
  authorities: Authority[];
  courts: Record<string, string>;
};

function courtNames(v: unknown): Record<string, string> {
  const courts: Record<string, string> = {};
  for (const [k, x] of Object.entries(obj(v) ?? {})) {
    const name = str(x, 300);
    if (COURT_ID.test(k) && name) courts[k] = name;
  }
  return courts;
}

export function parseAuthorities(raw: unknown, expectedId: number): Authorities | null {
  const r = obj(raw);
  if (!r || r["format"] !== "caselaw-authorities/1" || clusterId(r["cluster_id"]) !== expectedId)
    return null;
  const authorities: Authority[] = [];
  for (const x of arr(r["authorities"])) {
    const o = obj(x);
    if (!o) continue;
    authorities.push({
      clusterId: clusterId(o["cluster_id"]),
      name: str(o["name"], 5000),
      courtId: courtId(o["court_id"]),
      date: isoDay(o["date"]),
      citation: str(o["citation"], 120),
      anchors: int(o["anchors"], 1) ?? 1,
      firstText: str(o["first_text"], 200),
      held: o["held"] === 1,
    });
  }
  return { clusterId: expectedId, authorities, courts: courtNames(r["courts"]) };
}

export function parseCitator(raw: unknown, expectedId: number): Citator | null {
  const r = obj(raw);
  if (!r || r["format"] !== "caselaw-citator/1" || clusterId(r["cluster_id"]) !== expectedId)
    return null;
  const cb = obj(r["cited_by"]);
  const courts = courtNames(r["courts"]);
  const citing: CitingCase[] = [];
  for (const x of arr(r["citing"])) {
    const o = obj(x);
    const id = clusterId(o?.["cluster_id"]);
    if (!o || id == null) continue;
    citing.push({
      clusterId: id,
      name: str(o["name"], 5000) ?? "Not recorded",
      courtId: courtId(o["court_id"]),
      date: isoDay(o["date"]),
      citation: str(o["citation"], 120),
      citationCount: int(o["citation_count"]),
      depth: int(o["depth"]),
      opinions: int(o["opinions"]),
      held: o["held"] === 1,
    });
  }
  const parentheticals: Parenthetical[] = [];
  for (const x of arr(r["parentheticals"])) {
    const o = obj(x);
    const id = clusterId(o?.["cluster_id"]);
    const text = str(o?.["text"], 20000);
    if (!o || id == null || !text) continue;
    parentheticals.push({
      text,
      score: num(o["score"]),
      clusterId: id,
      name: str(o["name"], 5000) ?? "Not recorded",
      courtId: courtId(o["court_id"]),
      date: isoDay(o["date"]),
      citation: str(o["citation"], 120),
      held: o["held"] === 1,
    });
  }
  const pair = (v: unknown) => arr(v).map(arr);
  return {
    clusterId: expectedId,
    citedByOpinions: int(cb?.["opinions"]) ?? 0,
    citedByCases: int(cb?.["cases"]) ?? 0,
    byCourt: pair(r["by_court"])
      .map((a) => ({ courtId: courtId(a[0]), n: int(a[1]) }))
      .filter((x): x is { courtId: string; n: number } => !!x.courtId && x.n != null),
    byDecade: pair(r["by_decade"])
      .map((a) => ({ decade: a[0] == null ? null : int(a[0], 1600, 2100), n: int(a[1]) }))
      .filter((x): x is { decade: number | null; n: number } => x.n != null),
    byCourtDecade: pair(r["by_court_decade"])
      .map((a) => ({
        courtId: courtId(a[0]),
        decade: a[1] == null ? null : int(a[1], 1600, 2100),
        n: int(a[2]),
      }))
      .filter(
        (x): x is { courtId: string; decade: number | null; n: number } =>
          !!x.courtId && x.n != null,
      ),
    citing,
    citingRank: str(r["citing_rank"], 300),
    parentheticals,
    parentheticalsTotal: int(r["parentheticals_total"]) ?? parentheticals.length,
    courts,
  };
}

// ---------------------------------------------------------------------------------------------- search rows
export type CaseHit = {
  clusterId: number;
  tier: 1 | 2 | 3;
  courtId: string;
  court: string | null;
  dateFiled: string | null;
  caseName: string;
  citations: string[];
  precedentialStatus: string | null;
  citationCount: number | null;
  citedBy: number | null;
  docketNumber: string | null;
  hasText: boolean;
  rank: number | null;
  matched: { opinionId: number; type: string | null; label: string }[];
};

export function parseCaseHit(raw: unknown): CaseHit | null {
  const r = obj(raw);
  const id = clusterId(r?.["cluster_id"]);
  const tier = int(r?.["tier"], 1, 3) as 1 | 2 | 3 | null;
  const cid = courtId(r?.["court_id"]);
  const name = str(r?.["case_name"], 5000);
  if (!r || id == null || !tier || !cid || !name) return null;
  return {
    clusterId: id,
    tier,
    courtId: cid,
    court: str(r["court"], 300),
    dateFiled: isoDay(r["date_filed"]),
    caseName: name,
    citations: arr(r["citations"])
      .map((c) => str(c, 120))
      .filter((c): c is string => !!c),
    precedentialStatus: str(r["precedential_status"], 40),
    citationCount: int(r["citation_count"]),
    citedBy: int(r["cited_by"]),
    docketNumber: str(r["docket_number"], 500),
    hasText: r["has_text"] === true,
    rank: num(r["rank"]),
    matched: arr(r["matched"])
      .map(obj)
      .map((m) => {
        const oid = int(m?.["opinion_id"], 1);
        const type = str(m?.["type"], 40);
        return oid == null ? null : { opinionId: oid, type, label: opinionTypeLabel(type) };
      })
      .filter((m): m is { opinionId: number; type: string | null; label: string } => !!m),
  };
}

// ---------------------------------------------------------------------------------------------- CourtListener live search
export type LiveHit = {
  clusterId: number;
  caseName: string;
  courtId: string | null;
  court: string | null;
  dateFiled: string | null;
  citations: string[];
  docketNumber: string | null;
  status: string | null;
  citeCount: number | null;
  snippet: string | null;
  courtListenerUrl: string;
  held: boolean;
};

const ABS_URL = /^\/opinion\/\d+\/[^\s"'<>]*$/;

/** Plain text of a CourtListener snippet: <mark> tags become ⟦ ⟧ markers for the page to highlight; other tags dropped. */
export function snippetText(v: unknown): string | null {
  const s = str(v, 5000);
  if (!s) return null;
  const t = s
    .replace(/<mark>/gi, "⟦")
    .replace(/<\/mark>/gi, "⟧")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}

/** A field CourtListener returns with highlighting on (`<mark>` around matched words) as plain text. */
export function unhighlighted(v: unknown, max: number): string | null {
  const s = str(v, max * 2);
  if (!s) return null;
  const t = s
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return t || null;
}

export function parseLiveHit(raw: unknown): Omit<LiveHit, "held"> | null {
  const r = obj(raw);
  const id = clusterId(r?.["cluster_id"]);
  const name = unhighlighted(r?.["caseName"], 5000);
  if (!r || id == null || !name) return null;
  const abs = str(r["absolute_url"], 500);
  const ops = arr(r["opinions"]).map(obj);
  return {
    clusterId: id,
    caseName: name,
    courtId: courtId(r["court_id"]),
    court: unhighlighted(r["court"], 300),
    dateFiled: isoDay(typeof r["dateFiled"] === "string" ? r["dateFiled"].slice(0, 10) : null),
    citations: arr(r["citation"])
      .map((c) => unhighlighted(c, 120))
      .filter((c): c is string => !!c),
    docketNumber: unhighlighted(r["docketNumber"], 500),
    status: str(r["status"], 40),
    citeCount: int(r["citeCount"]),
    snippet: snippetText(ops.find((o) => str(o?.["snippet"]))?.["snippet"] ?? null),
    courtListenerUrl:
      abs && ABS_URL.test(abs)
        ? `https://www.courtlistener.com${abs}`
        : courtListenerCaseUrl(id, name),
  };
}

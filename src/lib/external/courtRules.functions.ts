/**
 * Rules of court that govern practice in one court (datasets court_rule_documents, court_rule_sections,
 * court_rule_insights): the federal rules and the court's own local rules for federal courts, and the state's rules
 * of court for state courts, each from its official publisher. Practice points are requirements read from the rule
 * text, each shown with the words it rests on. Read-only; malformed values are dropped, never repaired.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

export const RULE_CATEGORIES = {
  response_deadline: "Response deadline",
  reply_deadline: "Reply deadline",
  other_deadline: "Other deadline",
  page_limit: "Page limit",
  word_limit: "Word or line limit",
  formatting: "Formatting",
  filing: "Filing and service",
  meet_and_confer: "Meet and confer",
  pro_hac_vice: "Pro hac vice and admission",
  adr: "ADR and mediation",
  judge_practice: "Judges' own practices",
} as const;
export type RuleCategory = keyof typeof RULE_CATEGORIES;
export const isRuleCategory = (v: unknown): v is RuleCategory =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(RULE_CATEGORIES, v);

export type CourtLevel = "district" | "appellate" | "bankruptcy" | "trial" | "supreme";
export type CourtRulesScope = {
  courtId: string;
  system: "federal" | "state";
  level: CourtLevel | null;
  state: string | null;
  /** A state judiciary as a whole (court_spine "REG:ST" entries): every level's rules apply. */
  allLevels?: boolean;
};
export type RuleScope = "federal_national" | "federal_local" | "state";
export type RuleDocument = {
  id: string;
  title: string;
  scope: RuleScope;
  publisher: string | null;
  url: string | null;
  foundOn: string | null;
  format: string | null;
  status: string;
  statusLabel: string;
  note: string | null;
  sections: number;
  insights: number;
  categories: Partial<Record<RuleCategory, number>>;
  pages: number | null;
  retrievedAt: string | null;
};
export type CourtRules = {
  scope: CourtRulesScope;
  documents: RuleDocument[];
  dropped: number;
};
export type RuleInsight = {
  id: string;
  category: RuleCategory;
  appliesTo: string | null;
  value: string;
  quote: string;
  quoteMatch: "exact" | "spacing_normalized";
  sectionId: string;
  sectionLabel: string;
  sectionTitle: string | null;
  page: number | null;
  sourceUrl: string;
  doc: string;
  docTitle: string;
};
export type RuleInsightPage = { insights: RuleInsight[]; total: number | null; dropped: number };
export type RuleSectionHit = {
  id: string;
  title: string;
  doc: string;
  page: number | null;
  sourceUrl: string;
  snippet: string;
  chars: number | null;
};
export type RuleSectionHits = { hits: RuleSectionHit[]; total: number | null };
export type RuleSectionText = {
  id: string;
  title: string;
  doc: string;
  page: number | null;
  sourceUrl: string;
  text: string;
  truncated: boolean;
};

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown, max = 2000) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const int = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e7 ? v : null;
const first = (v: unknown) => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);

/** court_spine ids: CourtListener ids ("cand"), county registry ids ("cty-48001-…") and registry entries ("reg-ST-mn_state"). */
export const COURT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{1,95}$/;
export const DOC_ID = /^[a-z0-9][a-z0-9-]{1,60}$/;
export const SECTION_ID = /^[a-z0-9][a-z0-9-]{1,60}:[0-9a-z-]{1,16}$/;
const STATE = /^[A-Z]{2}$/;

/** An official address: http(s), never a code-hosting mirror. */
export function officialUrl(v: unknown): string | null {
  const s = str(v, 1000);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (/(^|\.)github(usercontent)?\.com$/i.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Which rules apply, from the court's own record (court_spine filters): federal district, appellate and bankruptcy
 * courts take the national rules for their level plus their own local rules; state courts take their state's rules
 * of court for trial, appellate or supreme courts (county registry courts are trial courts).
 */
export function courtScope(raw: unknown, courtId: string): CourtRulesScope | null {
  const o = obj(raw);
  const f = obj(o?.["filters"]);
  if (!o || !f) return null;
  const system = first(f["system"]);
  const type = first(f["type"]) ?? "";
  const st = str(o["state"]) ?? first(f["state"]);
  const state = st && STATE.test(st) ? st : null;
  if (system === "federal") {
    const level: CourtLevel | null =
      type === "FD"
        ? "district"
        : type === "F"
          ? "appellate"
          : type.startsWith("FB")
            ? "bankruptcy"
            : null;
    return { courtId, system: "federal", level, state };
  }
  if (system === "state") {
    if (type === "REG:ST") return { courtId, system: "state", level: null, state, allLevels: true };
    const level: CourtLevel | null =
      type === "S"
        ? "supreme"
        : type === "SA"
          ? "appellate"
          : type === "ST" || type.startsWith("CR:")
            ? "trial"
            : null;
    return { courtId, system: "state", level, state };
  }
  return null;
}

const enc = encodeURIComponent;
const cs = (v: Record<string, string[]>) => enc(JSON.stringify(v));

/** The rule documents that apply to a court, in the publisher's order; null when none can apply. */
export function documentsPath(s: CourtRulesScope): string | null {
  const parts = ["select=id,title,d:item->rule_document", "dataset=eq.court_rule_documents"];
  if (s.system === "federal") {
    const or = [`filters.cs.${cs({ court: [s.courtId] })}`];
    if (s.level) or.push(`filters.cs.${cs({ scope: ["federal_national"], level: [s.level] })}`);
    parts.push(`or=(${or.join(",")})`);
  } else {
    if (!s.state || (!s.level && !s.allLevels)) return null;
    const containment: Record<string, string[]> = { scope: ["state"], state: [s.state] };
    if (s.level) containment["level"] = [s.level];
    parts.push(`filters=cs.${cs(containment)}`);
  }
  parts.push("order=ordinal.asc", "limit=200");
  return `corpus_records?${parts.join("&")}`;
}

const SCOPES: RuleScope[] = ["federal_national", "federal_local", "state"];

export function parseRuleDocument(id: unknown, title: unknown, raw: unknown): RuleDocument | null {
  const d = obj(raw);
  const docId = str(id, 80);
  const name = str(title, 400);
  if (!d || !docId || !DOC_ID.test(docId) || !name) return null;
  const scope = d["scope"];
  if (typeof scope !== "string" || !SCOPES.includes(scope as RuleScope)) return null;
  const status = str(d["status"], 40);
  if (!status) return null;
  const categories: Partial<Record<RuleCategory, number>> = {};
  const cats = obj(d["insight_categories"]);
  for (const [k, v] of Object.entries(cats ?? {})) {
    const n = int(v);
    if (isRuleCategory(k) && n) categories[k] = n;
  }
  return {
    id: docId,
    title: name,
    scope: scope as RuleScope,
    publisher: str(d["publisher"], 200),
    url: officialUrl(d["url"]),
    foundOn: officialUrl(d["found_on"]),
    format: str(d["format"], 20),
    status,
    statusLabel: str(d["status_label"], 120) ?? status,
    note: str(d["note"], 600) ?? str(d["retrieval_note"], 600),
    sections: int(d["sections"]) ?? 0,
    insights: int(d["insights"]) ?? 0,
    categories,
    pages: int(d["pages"]),
    retrievedAt: str(d["retrieved_at"], 40),
  };
}

/** The or=(...) clause that limits a query to the given documents (ids already validated). */
const docsClause = (docs: string[]) =>
  `or=(${docs.map((d) => `filters.cs.${cs({ doc: [d] })}`).join(",")})`;

export function insightsPath(docs: string[], category: RuleCategory | null): string {
  const parts = [
    "select=id,i:item->rule_insight",
    "dataset=eq.court_rule_insights",
    docsClause(docs),
  ];
  if (category) parts.push(`filters=cs.${cs({ category: [category] })}`);
  parts.push("order=ordinal.asc");
  return `corpus_records?${parts.join("&")}`;
}

export function parseInsight(
  id: unknown,
  raw: unknown,
  docs: ReadonlySet<string>,
): RuleInsight | null {
  const i = obj(raw);
  const iid = str(id, 100);
  if (!i || !iid) return null;
  const category = i["category"];
  const value = str(i["value"], 300);
  const quote = str(i["quote"], 700);
  const sectionId = str(i["section_id"], 80);
  const sectionLabel = str(i["section_label"], 120);
  const sourceUrl = officialUrl(i["source_url"]);
  const doc = str(i["doc"], 80);
  const docTitle = str(i["doc_title"], 400);
  const match = i["quote_match"];
  if (!isRuleCategory(category) || !value || !quote || !sectionId || !SECTION_ID.test(sectionId))
    return null;
  if (!sectionLabel || !sourceUrl || !doc || !docs.has(doc) || !docTitle) return null;
  if (match !== "exact" && match !== "spacing_normalized") return null;
  // the value must be inside its quote (the build checked this; a stored row that fails it is not shown)
  const squash = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
  if (!squash(quote).includes(squash(value))) return null;
  return {
    id: iid,
    category,
    appliesTo: str(i["applies_to"], 160),
    value,
    quote,
    quoteMatch: match,
    sectionId,
    sectionLabel,
    sectionTitle: str(i["section_title"], 300),
    page: int(i["page"]),
    sourceUrl,
    doc,
    docTitle,
  };
}

/** Prefix terms for the simple full-text configuration: letters and digits only, at most 8 terms. */
export function ftsQuery(q: string): string | null {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = words.slice(0, 8).map((w) => w.slice(0, 40));
  return terms.length ? terms.map((t) => `${t}:*`).join("&") : null;
}

export function sectionSearchPath(docs: string[], q: string): string | null {
  const fts = ftsQuery(q);
  if (!fts) return null;
  return `corpus_records?${[
    "select=id,title,s:item->rule_section,text",
    "dataset=eq.court_rule_sections",
    docsClause(docs),
    // front matter and contents pages would match most searches through their lists of rule titles
    `title=not.like.${enc("Front matter*")}`,
    `search_vector=fts(simple).${enc(fts)}`,
    "order=ordinal.asc",
  ].join("&")}`;
}

/** A short passage around the first word of the query (or the start), on one line. */
export function snippet(text: string, q: string, width = 260): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const terms = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);
  const lower = flat.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u");
    const m = re.exec(lower);
    if (m && (at < 0 || m.index < at)) at = m.index + m[1]!.length;
  }
  if (at < 0) return flat.slice(0, width) + (flat.length > width ? "…" : "");
  const start = Math.max(0, at - 80);
  const end = Math.min(flat.length, start + width);
  return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
}

export function parseSectionHit(row: unknown, q: string): RuleSectionHit | null {
  const r = obj(row);
  const s = obj(r?.["s"]);
  const id = str(r?.["id"], 100);
  const title = str(r?.["title"], 400);
  const text = typeof r?.["text"] === "string" ? (r["text"] as string) : null;
  const doc = str(s?.["doc"], 80);
  const sourceUrl = officialUrl(s?.["source_url"]);
  if (!r || !s || !id || !SECTION_ID.test(id) || !title || !text || !doc || !sourceUrl) return null;
  return {
    id,
    title,
    doc,
    page: int(s["page"]),
    sourceUrl,
    snippet: snippet(text, q),
    chars: int(s["chars"]),
  };
}

export const MAX_SECTION_CHARS = 60_000;

export function parseSectionText(row: unknown): RuleSectionText | null {
  const r = obj(row);
  const s = obj(r?.["s"]);
  const id = str(r?.["id"], 100);
  const title = str(r?.["title"], 400);
  const doc = str(s?.["doc"], 80);
  const sourceUrl = officialUrl(s?.["source_url"]);
  const text = typeof r?.["text"] === "string" ? (r["text"] as string) : null;
  if (!r || !s || !id || !SECTION_ID.test(id) || !title || !doc || !sourceUrl || !text?.trim())
    return null;
  return {
    id,
    title,
    doc,
    page: int(s["page"]),
    sourceUrl,
    text: text.slice(0, MAX_SECTION_CHARS),
    truncated: text.length > MAX_SECTION_CHARS,
  };
}

const docsInput = z.array(z.string().regex(DOC_ID)).min(1).max(80);

export const getCourtRules = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<CourtRules | null> => {
    const court = await restGet<{ state: unknown; filters: unknown }[]>(
      `corpus_records?select=state,filters&dataset=eq.court_spine&id=eq.${enc(data.id)}&limit=1`,
    );
    const scope = court.rows.length === 1 ? courtScope(court.rows[0], data.id) : null;
    if (!scope) return null;
    const path = documentsPath(scope);
    if (!path) return { scope, documents: [], dropped: 0 };
    const r = await restGet<{ id: unknown; title: unknown; d: unknown }[]>(path);
    const documents = r.rows
      .map((row) => parseRuleDocument(row.id, row.title, row.d))
      .filter((d): d is RuleDocument => !!d);
    return { scope, documents, dropped: r.rows.length - documents.length };
  });

export const getCourtRuleInsights = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        docs: docsInput,
        category: z.string().nullable(),
        offset: z.number().int().min(0).max(20_000),
        limit: z.number().int().min(1).max(60).default(40),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<RuleInsightPage> => {
    const category = isRuleCategory(data.category) ? data.category : null;
    const docs = new Set(data.docs);
    const limit = data.limit;
    const r = await restGet<{ id: unknown; i: unknown }[]>(insightsPath([...docs], category), {
      count: true,
      range: [data.offset, data.offset + limit - 1],
    });
    const insights = r.rows
      .map((row) => parseInsight(row.id, row.i, docs))
      .filter((i): i is RuleInsight => !!i);
    return { insights, total: r.total, dropped: r.rows.length - insights.length };
  });

export const searchCourtRuleSections = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        docs: docsInput,
        q: z.string().min(2).max(200),
        offset: z.number().int().min(0).max(5000),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<RuleSectionHits> => {
    const path = sectionSearchPath(data.docs, data.q);
    if (!path) return { hits: [], total: 0 };
    const limit = 12;
    const r = await restGet<unknown[]>(path, {
      count: true,
      range: [data.offset, data.offset + limit - 1],
    });
    const hits = r.rows
      .map((row) => parseSectionHit(row, data.q))
      .filter((h): h is RuleSectionHit => !!h);
    return { hits, total: r.total };
  });

export const getCourtRuleSection = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(SECTION_ID) }).parse(d))
  .handler(async ({ data }): Promise<RuleSectionText | null> => {
    const r = await restGet<unknown[]>(
      `corpus_records?select=id,title,s:item->rule_section,text&dataset=eq.court_rule_sections&id=eq.${enc(data.id)}&limit=1`,
    );
    return r.rows.length === 1 ? parseSectionText(r.rows[0]) : null;
  });

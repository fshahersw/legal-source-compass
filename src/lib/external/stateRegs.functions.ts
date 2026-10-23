/**
 * State administrative codes v2 (database/contracts/state-regs-v1.sql): coverage of the 51 jurisdictions, the official
 * table-of-contents tree, rule text with its exact-text check, search within a state, citation resolution, and the
 * state register issue index (corpus dataset state_register_issues, refreshed weekly by ingest-state-registers).
 * Read-only. Every RPC is optional: until the lead applies the contract the functions return null and the pages fall
 * back to the v1 index (state_regulation_index). Malformed values are dropped, never repaired.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet, rpcPostOptional } from "./rest.server";

export const STATE = /^[A-Z]{2}$/;
export const NODE_ID = /^[a-z]{2}:[A-Za-z0-9][A-Za-z0-9.:_()/-]{0,120}$/;
export const RULE_ID = NODE_ID;

export type Acquisition =
  "acquired" | "sample" | "parser_ready" | "index_only" | "deferred" | "blocked" | "not_started";

export type RegCode = {
  state: string;
  codeName: string;
  citeForm: string | null;
  publisher: string;
  codeUrl: string;
  access: string;
  status: string;
  blockedReason: string | null;
  acquisition: Acquisition;
  acquisitionReason: string | null;
  sampleRules: number | null;
  indexNodes: number;
  textRules: number;
  robotsAllowed: boolean | null;
  crawlDelay: number | null;
  probeResult: string | null;
  probeAt: string | null;
  termsUrl: string | null;
  currency: string | null;
  edition: string | null;
  registerName: string | null;
  registerUrl: string | null;
  registerFreq: string | null;
  registerNote: string | null;
};

export type RegNode = {
  id: string;
  parentId: string | null;
  level: string;
  num: string | null;
  heading: string | null;
  agency: string | null;
  citation: string | null;
  sourceUrl: string;
  ruleCount: number | null;
  rulesLoaded: number;
  children: number;
};
export type PathStep = { id: string; level: string; num: string | null; heading: string | null };
export type RegRuleHead = {
  id: string;
  state: string;
  number: string;
  citation: string;
  heading: string | null;
  status: string;
  emergency: boolean | null;
  effectiveDate: string | null;
  sourceUrl: string;
  nodeId: string | null;
  chars: number | null;
};
export type RegTree = {
  state: string;
  parent: RegNode | null;
  path: PathStep[];
  total: number;
  nodes: RegNode[];
  rules: RegRuleHead[];
};
export type TextCheck = {
  method: string | null;
  text: string | null;
  heading: string | null;
  history: string | null;
};
export type RegRule = RegRuleHead & {
  text: string | null;
  history: string | null;
  authority: string | null;
  agency: string | null;
  adoptedDate: string | null;
  registerCitation: string | null;
  edition: string | null;
  currency: string | null;
  retrievedAt: string | null;
  rawSha256: string | null;
  textCheck: TextCheck | null;
};
export type RegRuleView = {
  rule: RegRule;
  path: PathStep[];
  prev: RegRuleHead | null;
  next: RegRuleHead | null;
  codeName: string | null;
  publisher: string | null;
  codeUrl: string | null;
};
export type RegHit = RegRuleHead & { snippet: string | null };
export type RegSearch = { total: number; hits: RegHit[]; exact: RegRuleHead | null };
export type RegisterIssue = {
  id: string;
  state: string;
  publication: string;
  date: string | null;
  period: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  label: string;
  url: string;
};
export type ResolveResult = {
  status: "resolved" | "ambiguous" | "unresolved" | "not_covered" | "invalid";
  key: string | null;
  ruleId: string | null;
  reason: string | null;
};

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown, max = 4000) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const int = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null;
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
const iso = (v: unknown) => {
  const s = str(v, 40);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
/** Only http(s) addresses are kept (an official link never carries a script or data URL). */
export const httpUrl = (v: unknown) => {
  const s = str(v, 2000);
  return s && /^https?:\/\/[^\s"'<>]+$/.test(s) ? s : null;
};
const ACQ: Acquisition[] = [
  "acquired",
  "sample",
  "parser_ready",
  "index_only",
  "deferred",
  "blocked",
  "not_started",
];

export function parseCode(raw: unknown): RegCode | null {
  const c = obj(raw);
  const state = str(c?.["state"], 2);
  const codeName = str(c?.["code_name"], 200);
  const publisher = str(c?.["publisher"], 300);
  const codeUrl = httpUrl(c?.["code_url"]);
  if (!c || !state || !STATE.test(state) || !codeName || !publisher || !codeUrl) return null;
  const acq = obj(c["acquisition"]);
  const text = acq?.["text"];
  const robots = obj(c["robots"]);
  const sample = obj(acq?.["sample"]);
  return {
    state,
    codeName,
    citeForm: str(c["cite_form"], 80),
    publisher,
    codeUrl,
    access: str(c["access"], 20) ?? "none",
    status: str(c["status"], 40) ?? "official_free",
    blockedReason: str(c["blocked_reason"], 600),
    acquisition: ACQ.includes(text as Acquisition) ? (text as Acquisition) : "not_started",
    acquisitionReason: str(acq?.["reason"], 600),
    sampleRules: int(sample?.["rules"]),
    indexNodes: int(c["index_nodes"]) ?? 0,
    textRules: int(c["text_rules"]) ?? 0,
    robotsAllowed: bool(robots?.["allowed"]),
    crawlDelay:
      typeof robots?.["crawl_delay"] === "number" ? (robots["crawl_delay"] as number) : null,
    probeResult: str(c["probe_result"], 40),
    probeAt: str(c["probe_at"], 40),
    termsUrl: httpUrl(c["terms_url"]),
    currency: str(c["currency"], 300),
    edition: str(c["edition"], 400),
    registerName: str(c["register_name"], 200),
    registerUrl: httpUrl(c["register_url"]),
    registerFreq: str(c["register_freq"], 40),
    registerNote: str(c["register_note"], 600),
  };
}

export function parseNode(raw: unknown): RegNode | null {
  const n = obj(raw);
  const id = str(n?.["id"], 140);
  const level = str(n?.["level"], 40);
  const sourceUrl = httpUrl(n?.["source_url"]);
  if (!n || !id || !NODE_ID.test(id) || !level || !sourceUrl) return null;
  return {
    id,
    parentId: str(n["parent_id"], 140),
    level,
    num: str(n["num"], 80),
    heading: str(n["heading"], 500),
    agency: str(n["agency"], 300),
    citation: str(n["citation"], 200),
    sourceUrl,
    ruleCount: int(n["rule_count"]),
    rulesLoaded: int(n["rules_loaded"]) ?? 0,
    children: int(n["children"]) ?? 0,
  };
}

function parseStep(raw: unknown): PathStep | null {
  const p = obj(raw);
  const id = str(p?.["id"], 140);
  const level = str(p?.["level"], 40);
  if (!p || !id || !NODE_ID.test(id) || !level) return null;
  return { id, level, num: str(p["num"], 80), heading: str(p["heading"], 500) };
}

export function parseRuleHead(raw: unknown): RegRuleHead | null {
  const r = obj(raw);
  const id = str(r?.["id"], 140);
  const state = str(r?.["state"], 2);
  const number = str(r?.["number"], 80);
  const citation = str(r?.["citation"], 200);
  const sourceUrl = httpUrl(r?.["source_url"]);
  if (
    !r ||
    !id ||
    !RULE_ID.test(id) ||
    !state ||
    !STATE.test(state) ||
    !number ||
    !citation ||
    !sourceUrl
  )
    return null;
  return {
    id,
    state,
    number,
    citation,
    heading: str(r["heading"], 500),
    status: str(r["status"], 40) ?? "active",
    emergency: bool(r["emergency"]),
    effectiveDate: iso(r["effective_date"]),
    sourceUrl,
    nodeId: str(r["node_id"], 140),
    chars: int(r["chars"]),
  };
}

export function parseTree(raw: unknown, state: string): RegTree | null {
  const t = obj(raw);
  if (!t || t["state"] !== state) return null;
  const list = <T>(v: unknown, f: (x: unknown) => T | null) =>
    (Array.isArray(v) ? v : []).map(f).filter((x): x is T => !!x);
  return {
    state,
    parent: t["parent"] ? parseNode(t["parent"]) : null,
    path: list(t["path"], parseStep),
    total: int(t["total"]) ?? 0,
    nodes: list(t["nodes"], parseNode),
    rules: list(t["rules"], parseRuleHead).filter((r) => r.state === state),
  };
}

function parseCheck(raw: unknown): TextCheck | null {
  const c = obj(raw);
  if (!c) return null;
  return {
    method: str(c["method"], 300),
    text: str(c["text"], 40),
    heading: str(c["heading"], 40),
    history: str(c["history"], 40),
  };
}

export function parseRuleView(raw: unknown): RegRuleView | null {
  const v = obj(raw);
  const r = obj(v?.["rule"]);
  if (!v || !r) return null;
  const head = parseRuleHead({
    ...r,
    chars: typeof r["text"] === "string" ? (r["text"] as string).length : null,
  });
  if (!head) return null;
  const sha = str(r["raw_sha256"], 64);
  const code = obj(v["code"]);
  return {
    rule: {
      ...head,
      text:
        typeof r["text"] === "string" && r["text"].trim()
          ? (r["text"] as string).slice(0, 2_000_000)
          : null,
      history: str(r["history"], 20000),
      authority: str(r["authority"], 4000),
      agency: str(r["agency"], 300),
      adoptedDate: iso(r["adopted_date"]),
      registerCitation: str(r["register_citation"], 200),
      edition: str(r["edition"], 400),
      currency: str(r["currency"], 400),
      retrievedAt: str(r["retrieved_at"], 40),
      rawSha256: sha && /^[0-9a-f]{64}$/.test(sha) ? sha : null,
      textCheck: parseCheck(r["text_check"]),
    },
    path: (Array.isArray(v["path"]) ? v["path"] : [])
      .map(parseStep)
      .filter((s): s is PathStep => !!s),
    prev: v["prev"] ? parseRuleHead(v["prev"]) : null,
    next: v["next"] ? parseRuleHead(v["next"]) : null,
    codeName: str(code?.["code_name"], 200),
    publisher: str(code?.["publisher"], 300),
    codeUrl: httpUrl(code?.["code_url"]),
  };
}

export function parseSearch(raw: unknown, state: string): RegSearch | null {
  const s = obj(raw);
  if (!s) return null;
  const hits = (Array.isArray(s["hits"]) ? s["hits"] : [])
    .map((h) => {
      const head = parseRuleHead(h);
      return head && head.state === state
        ? { ...head, snippet: str(obj(h)?.["snippet"], 600) }
        : null;
    })
    .filter((h): h is RegHit => !!h);
  const exact = s["exact"] ? parseRuleHead(s["exact"]) : null;
  return {
    total: int(s["total"]) ?? hits.length,
    hits,
    exact: exact && exact.state === state ? exact : null,
  };
}

export function parseIssue(id: unknown, raw: unknown, state: string): RegisterIssue | null {
  const r = obj(raw);
  const rid = str(id, 80);
  const url = httpUrl(r?.["url"]);
  const publication = str(r?.["publication"], 200);
  if (!r || !rid || !url || !publication || r["state"] !== state) return null;
  const date = iso(r["date"]);
  const period = str(r["period"], 7);
  if (!date && !(period && /^\d{4}-\d{2}$/.test(period))) return null;
  return {
    id: rid,
    state,
    publication,
    date,
    period: period && /^\d{4}-\d{2}$/.test(period) ? period : null,
    volume: str(r["volume"], 24),
    issue: str(r["issue"], 24),
    pages: str(r["pages"], 40),
    label: str(r["label"], 200) ?? publication,
    url,
  };
}

export function parseResolve(raw: unknown): ResolveResult | null {
  const r = obj(raw);
  const status = r?.["status"];
  if (
    !r ||
    !["resolved", "ambiguous", "unresolved", "not_covered", "invalid"].includes(status as string)
  )
    return null;
  const ruleId = str(r["rule_id"], 140);
  return {
    status: status as ResolveResult["status"],
    key: str(r["key"], 120),
    ruleId: status === "resolved" && ruleId && RULE_ID.test(ruleId) ? ruleId : null,
    reason: str(r["reason"], 300),
  };
}

const stateOnly = z.object({ state: z.string().regex(STATE) });

/** null: the v2 contract is not applied yet. */
export const listStateRegCodes = createServerFn({ method: "GET" }).handler(
  async (): Promise<RegCode[] | null> => {
    const r = await rpcPostOptional<unknown[]>("state_reg_codes_v1", {});
    if (r === null) return null;
    return (Array.isArray(r) ? r : []).map(parseCode).filter((c): c is RegCode => !!c);
  },
);

export const getStateRegTree = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        state: z.string().regex(STATE),
        parent: z.string().regex(NODE_ID).nullable(),
        offset: z.number().int().min(0).max(100_000),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<RegTree | null> => {
    const r = await rpcPostOptional<unknown>("state_reg_tree_v1", {
      p_state: data.state,
      p_parent: data.parent,
      p_limit: 300,
      p_offset: data.offset,
    });
    return r === null ? null : parseTree(r, data.state);
  });

export const getStateRegRule = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(RULE_ID) }).parse(d))
  .handler(async ({ data }): Promise<RegRuleView | null> => {
    const r = await rpcPostOptional<unknown>("state_reg_rule_v1", { p_id: data.id });
    return r === null ? null : parseRuleView(r);
  });

export const searchStateRegs = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        state: z.string().regex(STATE),
        q: z.string().min(2).max(200),
        offset: z.number().int().min(0).max(5000),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<RegSearch | null> => {
    const r = await rpcPostOptional<unknown>("state_reg_search_v1", {
      p_state: data.state,
      p_q: data.q,
      p_limit: 25,
      p_offset: data.offset,
    });
    return r === null ? null : parseSearch(r, data.state);
  });

export const resolveStateRegCitation = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({ state: z.string().regex(STATE), citation: z.string().min(2).max(300) }).parse(d),
  )
  .handler(async ({ data }): Promise<ResolveResult | null> => {
    const r = await rpcPostOptional<unknown>("state_reg_resolve_v1", {
      p_state: data.state,
      p_citation: data.citation,
    });
    return r === null ? null : parseResolve(r);
  });

export const listStateRegisterIssues = createServerFn({ method: "GET" })
  .inputValidator((d) => stateOnly.parse(d))
  .handler(
    async ({
      data,
    }): Promise<{ issues: RegisterIssue[]; total: number | null; dropped: number }> => {
      const r = await restGet<{ id: unknown; r: unknown }[]>(
        `corpus_records?select=id,r:item->register_issue&dataset=eq.state_register_issues&state=eq.${data.state}&order=ordinal.asc`,
        { count: true, range: [0, 199] },
      );
      const issues = r.rows
        .map((row) => parseIssue(row.id, row.r, data.state))
        .filter((i): i is RegisterIssue => !!i);
      return { issues, total: r.total, dropped: r.rows.length - issues.length };
    },
  );

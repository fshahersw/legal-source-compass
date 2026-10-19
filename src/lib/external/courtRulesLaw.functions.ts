/**
 * State constitutions (datasets state_constitutions, state_constitution_sections) and the tables of contents of state
 * administrative codes (state_regulation_codes, state_regulation_index), each from the state's official publisher.
 * Read-only; malformed values are dropped, never repaired.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ftsQuery, officialUrl, snippet } from "./courtRules.functions";
import { restGet } from "./rest.server";

export type ConstitutionStatus = "text" | "not_retrieved" | "not_located" | "no_text";
export type Constitution = {
  state: string;
  name: string;
  title: string;
  publisher: string | null;
  url: string | null;
  status: ConstitutionStatus;
  statusLabel: string;
  note: string | null;
  edition: string | null;
  structure: "section" | "article" | "document" | null;
  articles: number;
  sections: number;
  units: number;
  retrievedAt: string | null;
};
export type TextCheck = "confirmed" | "mostly_confirmed" | "partly_confirmed" | "not_checked";
export type ProvisionHead = {
  id: string;
  title: string;
  article: string | null;
  articleTitle: string | null;
  section: string | null;
  sectionTitle: string | null;
  sourceUrl: string;
  chars: number | null;
  textCheck: TextCheck;
};
export type Provision = ProvisionHead & { text: string };
export type ConstitutionOutline = {
  constitution: Constitution;
  provisions: ProvisionHead[];
  dropped: number;
};
export type ProvisionHit = {
  id: string;
  state: string;
  title: string;
  sourceUrl: string;
  snippet: string;
  article: string | null;
};
export type ProvisionHits = { hits: ProvisionHit[]; total: number | null };

export type RegulationCode = {
  state: string;
  code: string;
  publisher: string | null;
  url: string | null;
  status: "indexed" | "blocked" | "not_indexed";
  statusLabel: string;
  entries: number;
  levels: { level: string; count: number }[];
  retrievedAt: string | null;
  error: string | null;
};
export type RegulationEntry = {
  id: string;
  state: string;
  level: string;
  citation: string;
  heading: string | null;
  agency: string | null;
  parent: string | null;
  status: string | null;
  url: string;
};
export type RegulationPage = { entries: RegulationEntry[]; total: number | null; dropped: number };

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown, max = 2000) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const int = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e8 ? v : null;
const enc = encodeURIComponent;
const cs = (v: Record<string, string[]>) => enc(JSON.stringify(v));

export const STATE = /^[A-Z]{2}$/;
export const PROVISION_ID = /^[a-z]{2}-const:\d{4,5}$/;
export const ENTRY_ID = /^[a-z]{2}-reg:\d{5}$/;
const STATUSES: ConstitutionStatus[] = ["text", "not_retrieved", "not_located", "no_text"];
const STRUCTURES = ["section", "article", "document"] as const;
const CHECKS: TextCheck[] = ["confirmed", "mostly_confirmed", "partly_confirmed", "not_checked"];

export function parseConstitution(title: unknown, raw: unknown): Constitution | null {
  const c = obj(raw);
  const state = str(c?.["state"], 2);
  const name = str(c?.["name"], 60);
  const t = str(title, 200);
  const status = c?.["status"];
  if (!c || !state || !STATE.test(state) || !name || !t) return null;
  if (typeof status !== "string" || !STATUSES.includes(status as ConstitutionStatus)) return null;
  const structure = STRUCTURES.find((s) => s === c["structure"]) ?? null;
  return {
    state,
    name,
    title: t,
    publisher: str(c["publisher"], 200),
    url: officialUrl(c["url"]),
    status: status as ConstitutionStatus,
    statusLabel: str(c["status_label"], 120) ?? status,
    note: str(c["note"], 600),
    edition: str(c["edition_note"], 300),
    structure,
    articles: int(c["articles"]) ?? 0,
    sections: int(c["sections"]) ?? 0,
    units: int(c["units"]) ?? 0,
    retrievedAt: str(c["retrieved_at"], 40),
  };
}

export function parseProvisionHead(
  id: unknown,
  title: unknown,
  raw: unknown,
  state: string,
): ProvisionHead | null {
  const s = obj(raw);
  const pid = str(id, 40);
  const t = str(title, 400);
  const sourceUrl = officialUrl(s?.["source_url"]);
  if (!s || !pid || !PROVISION_ID.test(pid) || !t || !sourceUrl || s["state"] !== state)
    return null;
  const check = CHECKS.find((c) => c === s["text_check"]) ?? "not_checked";
  return {
    id: pid,
    title: t,
    article: str(s["article"], 40),
    // a title without letters is a page number the text rendering carried onto the heading line
    articleTitle: /[A-Za-z]{2}/.test(String(s["article_title"] ?? ""))
      ? str(s["article_title"], 200)
      : null,
    section: str(s["section"], 40),
    sectionTitle: str(s["section_title"], 200),
    sourceUrl,
    chars: int(s["chars"]),
    textCheck: check,
  };
}

export function parseProvision(row: unknown, state: string): Provision | null {
  const r = obj(row);
  const head = parseProvisionHead(r?.["id"], r?.["title"], r?.["c"], state);
  const text = typeof r?.["text"] === "string" ? (r["text"] as string) : null;
  if (!head || !text?.trim()) return null;
  return { ...head, text: text.slice(0, 120_000) };
}

/** Articles in printed order with their provisions; units before the first article are "Front matter". */
export function groupByArticle(
  provisions: ProvisionHead[],
): { key: string; article: string | null; title: string | null; provisions: ProvisionHead[] }[] {
  const out: {
    key: string;
    article: string | null;
    title: string | null;
    provisions: ProvisionHead[];
  }[] = [];
  for (const p of provisions) {
    const last = out[out.length - 1];
    if (last && last.article === p.article) {
      last.provisions.push(p);
      last.title = last.title ?? p.articleTitle;
    } else {
      out.push({
        key: `${out.length}:${p.article ?? "front"}`,
        article: p.article,
        title: p.articleTitle,
        provisions: [p],
      });
    }
  }
  return out;
}

export function parseRegulationCode(raw: unknown): RegulationCode | null {
  const c = obj(raw);
  const state = str(c?.["state"], 2);
  const code = str(c?.["code"], 200);
  const status = c?.["status"];
  if (!c || !state || !STATE.test(state) || !code) return null;
  if (status !== "indexed" && status !== "blocked" && status !== "not_indexed") return null;
  const levels = Object.entries(obj(c["levels"]) ?? {})
    .map(([level, n]) => ({ level, count: int(n) ?? 0 }))
    .filter((l) => l.count > 0 && /^[a-z ]{2,30}$/.test(l.level));
  const errors = Array.isArray(c["errors"]) ? c["errors"] : [];
  return {
    state,
    code,
    publisher: str(c["publisher"], 200),
    url: officialUrl(c["url"]),
    status,
    statusLabel: str(c["status_label"], 120) ?? status,
    entries: int(c["entries"]) ?? 0,
    levels,
    retrievedAt: str(obj(c["acquisition"])?.["at"], 40),
    error: errors.length ? "The publisher's server did not answer the automated request." : null,
  };
}

export function parseRegulationEntry(id: unknown, raw: unknown): RegulationEntry | null {
  const e = obj(raw);
  const eid = str(id, 40);
  const state = str(e?.["state"], 2);
  const level = str(e?.["level"], 30);
  const citation = str(e?.["citation"], 200);
  const url = officialUrl(e?.["url"]);
  if (
    !e ||
    !eid ||
    !ENTRY_ID.test(eid) ||
    !state ||
    !STATE.test(state) ||
    !level ||
    !citation ||
    !url
  )
    return null;
  const heading = str(e["heading"], 400);
  return {
    id: eid,
    state,
    level,
    citation,
    heading: heading && heading !== citation ? heading : null,
    agency: str(e["agency"], 200),
    parent: str(e["parent"], 200),
    status: str(e["status"], 80),
    url,
  };
}

export function regulationIndexPath(state: string, level: string | null, q: string): string {
  const containment: Record<string, string[]> = { state: [state] };
  if (level) containment["level"] = [level];
  const parts = [
    "select=id,e:item->regulation_entry",
    "dataset=eq.state_regulation_index",
    `filters=cs.${cs(containment)}`,
  ];
  const fts = ftsQuery(q);
  if (fts) parts.push(`search_vector=fts(simple).${enc(fts)}`);
  parts.push("order=ordinal.asc");
  return `corpus_records?${parts.join("&")}`;
}

export function provisionSearchPath(q: string, state: string | null): string | null {
  const fts = ftsQuery(q);
  if (!fts) return null;
  const parts = [
    "select=id,title,c:item->constitution_section,text",
    "dataset=eq.state_constitution_sections",
  ];
  if (state) parts.push(`filters=cs.${cs({ state: [state] })}`);
  parts.push(`search_vector=fts(simple).${enc(fts)}`, "order=ordinal.asc");
  return `corpus_records?${parts.join("&")}`;
}

export function parseProvisionHit(row: unknown, q: string): ProvisionHit | null {
  const r = obj(row);
  const c = obj(r?.["c"]);
  const state = str(c?.["state"], 2);
  if (!r || !c || !state || !STATE.test(state)) return null;
  const head = parseProvisionHead(r["id"], r["title"], c, state);
  const text = typeof r["text"] === "string" ? (r["text"] as string) : null;
  if (!head || !text) return null;
  return {
    id: head.id,
    state,
    title: head.title,
    sourceUrl: head.sourceUrl,
    snippet: snippet(text, q),
    article: head.article,
  };
}

const stateInput = z.object({ state: z.string().regex(STATE) });

export const listStateConstitutions = createServerFn({ method: "GET" }).handler(
  async (): Promise<Constitution[]> => {
    const r = await restGet<{ title: unknown; c: unknown }[]>(
      "corpus_records?select=title,c:item->constitution&dataset=eq.state_constitutions&order=ordinal.asc&limit=60",
    );
    return r.rows
      .map((row) => parseConstitution(row.title, row.c))
      .filter((c): c is Constitution => !!c);
  },
);

export const getConstitutionOutline = createServerFn({ method: "GET" })
  .inputValidator((d) => stateInput.parse(d))
  .handler(async ({ data }): Promise<ConstitutionOutline | null> => {
    const [head, units] = await Promise.all([
      restGet<{ title: unknown; c: unknown }[]>(
        `corpus_records?select=title,c:item->constitution&dataset=eq.state_constitutions&id=eq.${data.state}&limit=1`,
      ),
      restGet<{ id: unknown; title: unknown; c: unknown }[]>(
        `corpus_records?select=id,title,c:item->constitution_section&dataset=eq.state_constitution_sections&filters=cs.${cs({ state: [data.state] })}&order=ordinal.asc&limit=1500`,
      ),
    ]);
    const constitution =
      head.rows.length === 1 ? parseConstitution(head.rows[0]!.title, head.rows[0]!.c) : null;
    if (!constitution || constitution.state !== data.state) return null;
    const provisions = units.rows
      .map((row) => parseProvisionHead(row.id, row.title, row.c, data.state))
      .filter((p): p is ProvisionHead => !!p);
    return { constitution, provisions, dropped: units.rows.length - provisions.length };
  });

export const getConstitutionProvisions = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        state: z.string().regex(STATE),
        ids: z.array(z.string().regex(PROVISION_ID)).min(1).max(60),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<Provision[]> => {
    const r = await restGet<unknown[]>(
      `corpus_records?select=id,title,c:item->constitution_section,text&dataset=eq.state_constitution_sections&id=in.(${data.ids
        .map((i) => enc(`"${i}"`))
        .join(",")})&order=ordinal.asc`,
    );
    return r.rows.map((row) => parseProvision(row, data.state)).filter((p): p is Provision => !!p);
  });

export const searchConstitutions = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        q: z.string().min(2).max(200),
        state: z.string().regex(STATE).nullable(),
        offset: z.number().int().min(0).max(5000),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<ProvisionHits> => {
    const path = provisionSearchPath(data.q, data.state);
    if (!path) return { hits: [], total: 0 };
    const r = await restGet<unknown[]>(path, {
      count: true,
      range: [data.offset, data.offset + 19],
    });
    return {
      hits: r.rows
        .map((row) => parseProvisionHit(row, data.q))
        .filter((h): h is ProvisionHit => !!h),
      total: r.total,
    };
  });

export const listRegulationCodes = createServerFn({ method: "GET" }).handler(
  async (): Promise<RegulationCode[]> => {
    const r = await restGet<{ c: unknown }[]>(
      "corpus_records?select=c:item->regulation_code&dataset=eq.state_regulation_codes&order=ordinal.asc&limit=60",
    );
    return r.rows.map((row) => parseRegulationCode(row.c)).filter((c): c is RegulationCode => !!c);
  },
);

export const getRegulationIndex = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        state: z.string().regex(STATE),
        level: z
          .string()
          .regex(/^[a-z ]{2,30}$/)
          .nullable(),
        q: z.string().max(200),
        offset: z.number().int().min(0).max(20_000),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<RegulationPage> => {
    const r = await restGet<{ id: unknown; e: unknown }[]>(
      regulationIndexPath(data.state, data.level, data.q),
      {
        count: true,
        range: [data.offset, data.offset + 99],
      },
    );
    const entries = r.rows
      .map((row) => parseRegulationEntry(row.id, row.e))
      .filter((e): e is RegulationEntry => !!e && e.state === data.state);
    return { entries, total: r.total, dropped: r.rows.length - entries.length };
  });

export const searchRegulationIndex = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ q: z.string().min(2).max(200) }).parse(d))
  .handler(async ({ data }): Promise<RegulationPage> => {
    const fts = ftsQuery(data.q);
    if (!fts) return { entries: [], total: 0, dropped: 0 };
    const r = await restGet<{ id: unknown; e: unknown }[]>(
      `corpus_records?select=id,e:item->regulation_entry&dataset=eq.state_regulation_index&search_vector=fts(simple).${enc(fts)}&order=ordinal.asc`,
      { count: true, range: [0, 29] },
    );
    const entries = r.rows
      .map((row) => parseRegulationEntry(row.id, row.e))
      .filter((e): e is RegulationEntry => !!e);
    return { entries, total: r.total, dropped: r.rows.length - entries.length };
  });

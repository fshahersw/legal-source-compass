/**
 * Server functions for the statute <-> regulation links and the eCFR finding aids. Read-only corpus reads
 * (ecfr_parallel_authorities, ecfr_subject_index, ecfr_agencies) plus exact-id lookups of the stored U.S. Code sections
 * and CFR parts they point at. A page asks for one exact U.S. Code section or one exact CFR part; nothing is matched by
 * range, prefix or similar name.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  AUTHORITIES_DATASET,
  AUTHORITY_SELECT,
  PART_TOKEN,
  inList,
  parseAuthorityRows,
  parseTableMeta,
  partHeading,
  partIds,
  sectionKeyId,
  type AuthorityRow,
  type TableMeta,
} from "./ecfrAuthorities";
import {
  AGENCIES_DATASET,
  AGENCY_SELECT,
  SUBJECTS_DATASET,
  SUBJECT_SELECT,
  entriesForPart,
  parseAgencyRow,
  parsePreparedRow,
  parseSubjectRow,
  type AgencyNode,
  type PreparedIndex,
  type SubjectMatch,
} from "./ecfrFindingAids";
import { CFR_PART, CFR_TITLE, SECTIONS_DATASET } from "./ecfrFull";
import { restGet } from "./rest.server";

const enc = encodeURIComponent;
const cs = (v: Record<string, string[]>) => enc(JSON.stringify(v));
const ROW_LIMIT = 400;
const ID_CHUNK = 120;
const MAX_IDS = 480;

const EMPTY_META: TableMeta = { edition: null, revisedAsOf: null, retrievedAt: null };

async function catalog(dataset: string): Promise<{ ready: boolean; meta: TableMeta }> {
  const r = await restGet<{ ready: unknown; metadata: unknown }[]>(
    `corpus_datasets?select=ready,metadata&id=eq.${dataset}&limit=1`,
  );
  const row = r.rows[0];
  if (!row || row.ready !== true) return { ready: false, meta: EMPTY_META };
  return { ready: true, meta: parseTableMeta(row.metadata) };
}

async function byIds<T>(dataset: string, ids: string[], select: string): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const r = await restGet<T[]>(
      `corpus_records?${select}&dataset=eq.${dataset}&id=${enc(inList(chunk))}&limit=${chunk.length}`,
    );
    out.push(...r.rows);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ section -> regulations
export type SectionRegulations = {
  status: "ok" | "unavailable";
  meta: TableMeta;
  /** Rows whose printed authority is this section (or the note to it). */
  exact: AuthorityRow[];
  /** Rows printed as a range or "et seq." that begins or ends at this section (never expanded). */
  edge: AuthorityRow[];
  /** "<CFR title>:<part>" -> heading of the stored part; absent when the part is not stored. */
  headings: Record<string, string | null>;
  dropped: number;
  truncated: boolean;
};

const sectionInput = z.object({
  title: z.string().regex(/^(?:[1-9]|[1-4][0-9]|5[0-4])a?$/),
  key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._~+-]{0,119}$/),
});

/** The CFR parts that cite one U.S. Code section as rulemaking authority, from the Parallel Table of Authorities. */
export const getRegulationsUnderSection = createServerFn({ method: "GET" })
  .inputValidator((d) => sectionInput.parse(d))
  .handler(async ({ data }): Promise<SectionRegulations> => {
    const sid = sectionKeyId(data.title, data.key);
    const cat = await catalog(AUTHORITIES_DATASET);
    if (!sid || !cat.ready)
      return {
        status: "unavailable",
        meta: cat.meta,
        exact: [],
        edge: [],
        headings: {},
        dropped: 0,
        truncated: false,
      };
    const q = (field: "usc" | "usc_edge") =>
      restGet<unknown[]>(
        `corpus_records?${AUTHORITY_SELECT}&dataset=eq.${AUTHORITIES_DATASET}&filters=cs.${cs({ [field]: [sid] })}&order=ordinal.asc&limit=${ROW_LIMIT}`,
      );
    const [a, b] = await Promise.all([q("usc"), q("usc_edge")]);
    const exact = parseAuthorityRows(a.rows);
    const edge = parseAuthorityRows(b.rows);
    const keys: string[] = [];
    for (const r of [...exact.rows, ...edge.rows])
      for (const p of r.cfr.partsStored) keys.push(`${r.cfr.title}:${p}`);
    const ids = partIds(keys).slice(0, MAX_IDS);
    const found = ids.length
      ? await byIds<{ id: unknown; title: unknown }>(SECTIONS_DATASET, ids, "select=id,title")
      : [];
    const headings: Record<string, string | null> = {};
    for (const f of found) {
      const m = typeof f.id === "string" ? /^cfr:(\d{1,2}):part-(.+)$/.exec(f.id) : null;
      if (m && CFR_TITLE.test(m[1]!) && PART_TOKEN.test(m[2]!))
        headings[`${m[1]}:${m[2]}`] = partHeading(typeof f.title === "string" ? f.title : null);
    }
    return {
      status: "ok",
      meta: cat.meta,
      exact: exact.rows,
      edge: edge.rows,
      headings,
      dropped: exact.dropped + edge.dropped,
      truncated: a.rows.length >= ROW_LIMIT || b.rows.length >= ROW_LIMIT || ids.length >= MAX_IDS,
    };
  });

// ------------------------------------------------------------------------------------------------ part -> authorities
export type StoredSection = {
  citation: string | null;
  heading: string | null;
  status: string | null;
};
export type PartAuthorities = {
  status: "ok" | "unavailable";
  meta: TableMeta;
  rows: AuthorityRow[];
  /** "<title>:<key>" -> stored U.S. Code section, for authorities that resolved. */
  sections: Record<string, StoredSection>;
  dropped: number;
  truncated: boolean;
};

const partInput = z.object({
  title: z.string().regex(CFR_TITLE),
  part: z.string().regex(CFR_PART),
});

const text = (v: unknown, max = 300) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/** The authorities one CFR part rests on, from the Parallel Table of Authorities (exact title + part). */
export const getAuthoritiesForPart = createServerFn({ method: "GET" })
  .inputValidator((d) => partInput.parse(d))
  .handler(async ({ data }): Promise<PartAuthorities> => {
    const cat = await catalog(AUTHORITIES_DATASET);
    if (!cat.ready || !PART_TOKEN.test(data.part))
      return {
        status: cat.ready ? "ok" : "unavailable",
        meta: cat.meta,
        rows: [],
        sections: {},
        dropped: 0,
        truncated: false,
      };
    const r = await restGet<unknown[]>(
      `corpus_records?${AUTHORITY_SELECT}&dataset=eq.${AUTHORITIES_DATASET}&filters=cs.${cs({ cfr_part: [`${data.title}:${data.part}`] })}&order=ordinal.asc&limit=${ROW_LIMIT}`,
    );
    const parsed = parseAuthorityRows(r.rows);
    const ids = [
      ...new Set(
        parsed.rows
          .filter((x) => x.link.state === "resolved" || x.link.state === "resolved_note")
          .map((x) => x.link.id)
          .filter((x): x is string => !!x),
      ),
    ].slice(0, MAX_IDS);
    const found = ids.length
      ? await byIds<{ id: unknown; c: unknown }>("us_code_sections", ids, "select=id,c:item->cells")
      : [];
    const sections: Record<string, StoredSection> = {};
    for (const f of found) {
      if (typeof f.id !== "string" || !ids.includes(f.id)) continue;
      const c = (f.c && typeof f.c === "object" ? f.c : {}) as Record<string, unknown>;
      sections[f.id] = {
        citation: text(c["citation"]),
        heading: text(c["heading"], 400),
        status: text(c["status"], 40),
      };
    }
    return {
      status: "ok",
      meta: cat.meta,
      rows: parsed.rows,
      sections,
      dropped: parsed.dropped,
      truncated: r.rows.length >= ROW_LIMIT,
    };
  });

// ------------------------------------------------------------------------------------------------ agencies
export type CfrAgencies = {
  status: "ok" | "unavailable";
  agencies: AgencyNode[];
  prepared: PreparedIndex[];
  retrievedAt: string | null;
  dropped: number;
};

const agencyRows = async (extra: string) => {
  const r = await restGet<unknown[]>(
    `corpus_records?${AGENCY_SELECT}&dataset=eq.${AGENCIES_DATASET}${extra}&order=ordinal.asc&limit=1000`,
  );
  const agencies = r.rows.map(parseAgencyRow);
  const prepared = r.rows.map(parsePreparedRow);
  return {
    agencies: agencies.filter((x): x is AgencyNode => x !== null),
    prepared: prepared.filter((x): x is PreparedIndex => x !== null),
    dropped: r.rows.filter((_, i) => !agencies[i] && !prepared[i]).length,
  };
};

const agencyCatalogDate = async () => {
  const r = await restGet<{ ready: unknown; metadata: unknown }[]>(
    `corpus_datasets?select=ready,metadata&id=eq.${AGENCIES_DATASET}&limit=1`,
  );
  const row = r.rows[0];
  if (!row || row.ready !== true) return null;
  const ra = (row.metadata as { summary?: { retrieved_at?: { agencies?: unknown } } } | null)
    ?.summary?.retrieved_at?.agencies;
  return { retrievedAt: typeof ra === "string" ? ra.slice(0, 40) : null };
};

/** Every agency node as the eCFR lists it, with the agency-prepared index rows. */
export const getCfrAgencies = createServerFn({ method: "GET" }).handler(
  async (): Promise<CfrAgencies> => {
    const cat = await agencyCatalogDate();
    if (!cat)
      return { status: "unavailable", agencies: [], prepared: [], retrievedAt: null, dropped: 0 };
    const r = await agencyRows("");
    return { status: "ok", ...r, retrievedAt: cat.retrievedAt };
  },
);

/** The agencies whose references name one CFR title (exact title), with their child agencies' own references. */
export const getAgenciesForTitle = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ title: z.string().regex(CFR_TITLE) }).parse(d))
  .handler(async ({ data }): Promise<CfrAgencies> => {
    const cat = await agencyCatalogDate();
    if (!cat)
      return { status: "unavailable", agencies: [], prepared: [], retrievedAt: null, dropped: 0 };
    const r = await agencyRows(`&filters=cs.${cs({ cfr_title: [data.title] })}`);
    return { status: "ok", ...r, retrievedAt: cat.retrievedAt };
  });

// ------------------------------------------------------------------------------------------------ subject index
export type SubjectsForPart = {
  status: "ok" | "unavailable";
  headings: { id: string; heading: string; page: number | null; entries: SubjectMatch[] }[];
  dropped: number;
  truncated: boolean;
};

/** Subject headings that index one CFR part, with only the entries that carry exactly that title + part. */
export const getSubjectsForPart = createServerFn({ method: "GET" })
  .inputValidator((d) => partInput.parse(d))
  .handler(async ({ data }): Promise<SubjectsForPart> => {
    const r0 = await restGet<{ ready: unknown }[]>(
      `corpus_datasets?select=ready&id=eq.${SUBJECTS_DATASET}&limit=1`,
    );
    if (!r0.rows[0] || r0.rows[0].ready !== true)
      return { status: "unavailable", headings: [], dropped: 0, truncated: false };
    if (!PART_TOKEN.test(data.part))
      return { status: "ok", headings: [], dropped: 0, truncated: false };
    const r = await restGet<unknown[]>(
      `corpus_records?${SUBJECT_SELECT}&dataset=eq.${SUBJECTS_DATASET}&filters=cs.${cs({ cfr_part: [`${data.title}:${data.part}`] })}&order=ordinal.asc&limit=200`,
    );
    const parsed = r.rows.map(parseSubjectRow);
    const title = Number(data.title);
    const headings = parsed
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .map((row) => ({
        id: row.id,
        heading: row.heading,
        page: row.pages ? row.pages[0] : null,
        entries: entriesForPart(row, title, data.part),
      }))
      .filter((h) => h.entries.length);
    return {
      status: "ok",
      headings,
      dropped: parsed.filter((x) => x === null).length,
      truncated: r.rows.length >= 200,
    };
  });

/**
 * Code of Federal Regulations pages: full current text (ecfr_sections_full), change history (ecfr_section_versions)
 * and the text "as of" a past date read live from the eCFR Versioner API. Corpus reads are read-only; when the full
 * text dataset has no row the older partial datasets are used (ecfr_section_text, then federal_regulations_sections)
 * and the page says so. The only live host is www.ecfr.gov (fixed URL shape, validated inputs, timeout, size cap).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  CFR_IDENTIFIER,
  CFR_PART,
  CFR_TITLE,
  SECTIONS_DATASET,
  VERSIONS_DATASET,
  asOfUrl,
  decodeBody,
  ecfrUrl,
  parseListRow,
  parseNotes,
  parsePartRow,
  parseSectionRow,
  parseVersionsRow,
  partRecordId,
  recordId,
  scopedPartNotes,
  str,
  validAsOfDate,
  type CfrBlock,
  type CfrHistory,
  type CfrListItem,
  type CfrNote,
  type CfrPart,
  type CfrSection,
} from "./ecfrFull";
import { parseEcfrDocument } from "./ecfrXml";
import { restGet } from "./rest.server";

const enc = encodeURIComponent;
const cs = (v: Record<string, string[]>) => enc(JSON.stringify(v));
const PAGE = 1000;
const MAX_ROWS = 6000;
const SECTION_SELECT = "select=id,title,source_url,text,detail";

async function pagedRows<T>(path: string): Promise<{ rows: T[]; truncated: boolean }> {
  const out: T[] = [];
  for (let start = 0; start < MAX_ROWS; start += PAGE) {
    const r = await restGet<T[]>(path, { range: [start, start + PAGE - 1] });
    out.push(...r.rows);
    if (r.rows.length < PAGE) return { rows: out, truncated: false };
  }
  return { rows: out, truncated: true };
}

async function oneRow(
  dataset: string,
  id: string,
  select = SECTION_SELECT,
): Promise<unknown | null> {
  const r = await restGet<unknown[]>(
    `corpus_records?${select}&dataset=eq.${dataset}&id=eq.${enc(id)}&limit=2`,
  );
  return r.rows.length === 1 ? r.rows[0]! : null;
}

export type CfrFallback = {
  dataset: "ecfr_section_text" | "federal_regulations_sections";
  title: string;
  text: string;
  asOf: string | null;
  ecfrUrl: string | null;
};
export type CfrSectionResult =
  | { status: "ok"; section: CfrSection; history: CfrHistory | null; partNotes: CfrNote[] }
  | { status: "fallback"; fallback: CfrFallback; history: CfrHistory | null }
  | { status: "not_found"; history: CfrHistory | null };

const sectionInput = z.object({
  title: z.string().regex(CFR_TITLE),
  identifier: z.string().regex(CFR_IDENTIFIER),
  part: z.string().regex(CFR_PART).nullable().default(null),
});

async function fallbackText(title: string, identifier: string): Promise<CfrFallback | null> {
  const old = await restGet<{ title: unknown; text: unknown; detail: unknown }[]>(
    `corpus_records?select=title,text,detail&dataset=eq.ecfr_section_text&filters=cs.${enc(
      JSON.stringify({ title_number: title, section_number: identifier }),
    )}&limit=2`,
  );
  if (old.rows.length === 1 && typeof old.rows[0]!.text === "string" && old.rows[0]!.text.trim()) {
    const row = old.rows[0]!;
    const facts = (row.detail as { facts?: unknown } | null)?.facts;
    const asOf = Array.isArray(facts)
      ? (facts.find((f) => Array.isArray(f) && f[0] === "Text as of")?.[1] as string | undefined)
      : undefined;
    return {
      dataset: "ecfr_section_text",
      title: str(row.title, 800) ?? `${title} CFR ${identifier}`,
      text: row.text as string,
      asOf: typeof asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null,
      ecfrUrl: `https://www.ecfr.gov/current/title-${title}/section-${enc(identifier)}`,
    };
  }
  const frs = await restGet<{ title: unknown; text: unknown; source_url: unknown }[]>(
    `corpus_records?select=title,text,source_url&dataset=eq.federal_regulations_sections&id=eq.${enc(`cfr:${title}:${identifier}`)}&limit=2`,
  );
  const f = frs.rows.length === 1 ? frs.rows[0]! : null;
  if (f && typeof f.text === "string" && f.text.trim())
    return {
      dataset: "federal_regulations_sections",
      title: str(f.title, 800) ?? `${title} CFR ${identifier}`,
      text: f.text,
      asOf: null,
      ecfrUrl: ecfrUrl(f.source_url),
    };
  return null;
}

/** One section or appendix: stored full text, its change history, or the older partial text as a fallback. */
export const getCfrSection = createServerFn({ method: "GET" })
  .inputValidator((d) => sectionInput.parse(d))
  .handler(async ({ data }): Promise<CfrSectionResult> => {
    const ids = data.part
      ? [recordId(data.title, data.identifier, data.part), recordId(data.title, data.identifier)]
      : [recordId(data.title, data.identifier)];
    const [rows, histRows] = await Promise.all([
      Promise.all(ids.map((id) => oneRow(SECTIONS_DATASET, id))),
      Promise.all(ids.map((id) => oneRow(VERSIONS_DATASET, id, "select=id,detail"))),
    ]);
    const row = rows.find((r) => r !== null) ?? null;
    const hist = histRows.find((r) => r !== null) ?? null;
    const history = hist ? parseVersionsRow(hist) : null;
    const section = row ? parseSectionRow(row) : null;
    if (section) {
      let partNotes: CfrNote[] = [];
      if (section.part) {
        const p = await oneRow(
          SECTIONS_DATASET,
          partRecordId(data.title, section.part),
          "select=id,detail->notes",
        );
        partNotes = scopedPartNotes(
          parseNotes((p as { notes?: unknown } | null)?.notes),
          section.subpart,
        );
      }
      return { status: "ok", section, history, partNotes };
    }
    const fallback = await fallbackText(data.title, data.identifier);
    if (fallback) return { status: "fallback", fallback, history };
    return { status: "not_found", history };
  });

export type CfrPartResult = {
  part: CfrPart | null;
  items: CfrListItem[];
  dropped: number;
  truncated: boolean;
};

/** One part: its notes (authority, source ...) and every section and appendix with its heading, in printed order. */
export const getCfrPart = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({ title: z.string().regex(CFR_TITLE), part: z.string().regex(CFR_PART) }).parse(d),
  )
  .handler(async ({ data }): Promise<CfrPartResult> => {
    const [partRow, list] = await Promise.all([
      oneRow(
        SECTIONS_DATASET,
        partRecordId(data.title, data.part),
        "select=id,title,source_url,text,detail",
      ),
      pagedRows<unknown>(
        `corpus_records?select=id,title,c:item->cells,s:filters->subpart,p:detail->path&dataset=eq.${SECTIONS_DATASET}&filters=cs.${cs({ title: [data.title], part: [data.part] })}&order=ordinal.asc`,
      ),
    ]);
    const parsed = list.rows.map(parseListRow);
    const items = parsed.filter((x): x is CfrListItem => !!x && x.kind !== "part");
    return {
      part: partRow ? parsePartRow(partRow) : null,
      items,
      dropped: parsed.filter((x) => !x).length,
      truncated: list.truncated,
    };
  });

/** Parts of one title, in printed order, with their section counts. */
export const getCfrTitleParts = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ title: z.string().regex(CFR_TITLE) }).parse(d))
  .handler(
    async ({ data }): Promise<{ parts: CfrListItem[]; dropped: number; truncated: boolean }> => {
      const list = await pagedRows<unknown>(
        `corpus_records?select=id,title,c:item->cells&dataset=eq.${SECTIONS_DATASET}&filters=cs.${cs({ title: [data.title], kind: ["part"] })}&order=ordinal.asc`,
      );
      const parsed = list.rows.map(parseListRow);
      return {
        parts: parsed.filter((x): x is CfrListItem => !!x && x.kind === "part"),
        dropped: parsed.filter((x) => !x).length,
        truncated: list.truncated,
      };
    },
  );

export type CfrTitleEntry = { title: string; name: string; rows: number };
export type CfrCollection = {
  titles: CfrTitleEntry[];
  upToDateAsOf: string[];
  ready: boolean | null;
} | null;

/** The CFR titles in the collection (catalog listing of ecfr_sections_full). Null when it is not published. */
export const getCfrCollection = createServerFn({ method: "GET" }).handler(
  async (): Promise<CfrCollection> => {
    const r = await restGet<{ ready: unknown; metadata: unknown }[]>(
      `corpus_datasets?select=ready,metadata&id=eq.${SECTIONS_DATASET}&limit=1`,
    );
    const row = r.rows[0];
    if (!row) return null;
    const md = (row.metadata ?? {}) as {
      listing?: { filters?: unknown[] };
      summary?: { up_to_date_as_of?: unknown };
    };
    const filter = (md.listing?.filters ?? []).find(
      (f): f is { name: string; options: unknown[] } =>
        !!f && typeof f === "object" && (f as { name?: unknown }).name === "title",
    );
    const titles: CfrTitleEntry[] = [];
    for (const o of filter?.options ?? []) {
      const opt = (o ?? {}) as { value?: unknown; label?: unknown; count?: unknown };
      const value = typeof opt.value === "string" && CFR_TITLE.test(opt.value) ? opt.value : null;
      const label = str(opt.label, 200);
      if (!value || !label) continue;
      titles.push({
        title: value,
        name: label.replace(/^Title \d+\s*[—-]\s*/, ""),
        rows:
          typeof opt.count === "number" && Number.isInteger(opt.count) && opt.count >= 0
            ? opt.count
            : 0,
      });
    }
    titles.sort((a, b) => Number(a.title) - Number(b.title));
    const asOf = md.summary?.up_to_date_as_of;
    return {
      titles,
      upToDateAsOf: Array.isArray(asOf)
        ? asOf.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x))
        : [],
      ready: typeof row.ready === "boolean" ? row.ready : null,
    };
  },
);

export type CfrAsOfResult =
  | {
      status: "ok";
      date: string;
      url: string;
      heading: string;
      blocks: CfrBlock[];
      notes: CfrNote[];
      partNotes: CfrNote[];
      pieces: number;
    }
  | {
      status: "not_found" | "unavailable" | "too_large";
      date: string;
      url: string;
      message: string;
    };

const MAX_BYTES = 20 * 1024 * 1024;
const NOTE_LABELS: Record<string, string> = {
  source: "Source",
  authority: "Authority",
  omb: "OMB approval",
  editorial: "Editorial note",
  effective_date: "Effective date note",
  amendment: "Pending amendment",
  cross_reference: "Cross reference",
};
const today = () => new Date().toISOString().slice(0, 10);

/** Fetch with timeout and size cap; injectable for tests. */
export async function fetchEcfrXml(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<{ status: number; body: string }> {
  const res = await fetcher(url, {
    headers: {
      Accept: "application/xml",
      "User-Agent": "LegalSourceAtlas/1.0 (research; contact: notreelai@gmail.com)",
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) return { status: res.status, body: "" };
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) return { status: 413, body: "" };
  const body = await res.text();
  if (body.length > MAX_BYTES) return { status: 413, body: "" };
  return { status: res.status, body };
}

export async function readAsOf(
  a: {
    title: string;
    identifier: string;
    kind: "section" | "appendix";
    part: string | null;
    date: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<CfrAsOfResult> {
  const url = asOfUrl(a);
  let got: { status: number; body: string };
  try {
    got = await fetchEcfrXml(url, fetcher);
  } catch {
    return {
      status: "unavailable",
      date: a.date,
      url,
      message: "The eCFR did not answer in time. Try again shortly.",
    };
  }
  if (got.status === 404)
    return {
      status: "not_found",
      date: a.date,
      url,
      message: "The eCFR has no text for this provision on that date.",
    };
  if (got.status === 413)
    return {
      status: "too_large",
      date: a.date,
      url,
      message: "This text is too large to show here; open it on ecfr.gov.",
    };
  if (got.status !== 200)
    return {
      status: "unavailable",
      date: a.date,
      url,
      message: `The eCFR could not provide this text (HTTP ${got.status}).`,
    };
  const doc = parseEcfrDocument(got.body);
  if (!doc.items.length)
    return {
      status: "not_found",
      date: a.date,
      url,
      message: "The eCFR has no text for this provision on that date.",
    };
  const lines = doc.items.flatMap((i) => i.lines);
  const layout = doc.items.flatMap((i) => i.layout);
  const note = ([kind, text]: [string, string]): CfrNote => ({
    kind: kind as CfrNote["kind"],
    label: NOTE_LABELS[kind] ?? kind,
    text,
    scope: null,
  });
  return {
    status: "ok",
    date: a.date,
    url,
    heading: doc.items[0]!.heading,
    blocks: decodeBody(lines.join("\n"), layout).blocks,
    notes: doc.items.flatMap((i) => i.notes).map(note),
    partNotes: doc.partNotes.map(note),
    pieces: doc.items.length,
  };
}

/** The text of one section or appendix as of a date (2017-01-03 onward), read live from the eCFR Versioner API. */
export const getCfrAsOf = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        title: z.string().regex(CFR_TITLE),
        identifier: z.string().regex(CFR_IDENTIFIER),
        kind: z.enum(["section", "appendix"]),
        part: z.string().regex(CFR_PART).nullable().default(null),
        date: z
          .string()
          .refine(
            (s) => validAsOfDate(s, today()),
            "date must be 2017-01-03 or later and not in the future",
          ),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<CfrAsOfResult> => readAsOf(data));

/**
 * Federal Register documents → federal_register_history (insert-only, newest first).
 *
 * Port of the continuation pipeline in scripts/ingest/federal-register/ (lib.mjs projectRecord, run.mjs project and
 * updateDatasetMetadata), which this source replaces once scheduled:
 *   - reads every document the FederalRegister.gov API v1 lists per publication day (all agencies and types), the last
 *     three held days again (late additions), at most 10 days per run;
 *   - a document already held (same https://www.federalregister.gov/d/<number>) is never rewritten;
 *   - a document published before the newest held day is not ordered into history: it is held and reported;
 *   - ids and ordinals follow the collection: ordinal = first ordinal - n + i (lower = newer), id = base - ordinal where
 *     base = id + ordinal of the current first row;
 *   - the record shape is projectRecord's, byte for byte (tested against lib.mjs on the same documents).
 */
import { BudgetExhausted, RateLimited } from "../http.ts";
import { canonical, diffPaths, rowContent } from "../rows.ts";
import type {
  Collected,
  CollectContext,
  CorpusRow,
  HeldRecord,
  Json,
  JsonObject,
  ParityReport,
  SourceAdapter,
  StoredRow,
} from "../types.ts";

export const DATASET = "federal_register_history";
export const API_ORIGIN = "https://www.federalregister.gov";
export const HISTORY_FIRST_DAY = "1994-01-03";
export const HISTORY_COLLECTED = "2026-08-20";
export const FIELDS = [
  "document_number",
  "title",
  "type",
  "publication_date",
  "effective_on",
  "dates",
  "citation",
  "html_url",
  "pdf_url",
  "raw_text_url",
  "agencies",
  "cfr_references",
  "related_documents",
  "correction_of",
  "corrections",
  "regulation_id_numbers",
  "docket_ids",
  "start_page",
  "end_page",
] as const;
export const MAX_DOCKETS_PRINTED = 12;
export const MAX_CFR_CELL = 4;
export const MAX_CFR_LINKS = 6;
export const MAX_SUBTITLE_AGENCIES = 3;
export const MAX_TITLE_CHARS = 600;
export const GOVINFO_LABEL = "Official GovInfo edition (not downloaded)";
const MAX_DAYS = 10;
const RECHECK_DAYS = 3;

type Agency = { id?: number | null; name?: string | null; raw_name?: string | null };
type CfrRef = {
  title: number | string;
  part?: string | number | null;
  chapter?: string | number | null;
};
export type FrDoc = {
  document_number: string;
  title: string;
  type: string;
  publication_date: string;
  citation?: string | null;
  start_page?: number | null;
  end_page?: number | null;
  raw_text_url?: string | null;
  pdf_url?: string | null;
  agencies?: Agency[] | null;
  cfr_references?: CfrRef[] | null;
  regulation_id_numbers?: string[] | null;
  docket_ids?: string[] | null;
  correction_of?: string | null;
  corrections?: string[] | null;
  [key: string]: unknown;
};

export const isoDay = (d: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))
    throw new Error(`Invalid ISO date: ${d}`);
  return d;
};
export const addDays = (d: string, n: number): string =>
  new Date(Date.parse(isoDay(d)) + n * 86400000).toISOString().slice(0, 10);

export function dayUrl(day: string, page: number, perPage = 1000): string {
  const u = new URL(`${API_ORIGIN}/api/v1/documents.json`);
  u.searchParams.set("per_page", String(perPage));
  u.searchParams.set("page", String(page));
  u.searchParams.set("order", "oldest");
  u.searchParams.set("conditions[publication_date][gte]", day);
  u.searchParams.set("conditions[publication_date][lte]", day);
  for (const f of FIELDS) u.searchParams.append("fields[]", f);
  return u.href;
}

/** Keep only the retained fields, preserving the API's values exactly (lib.mjs pickFields). */
export function pickFields(row: Record<string, unknown>): FrDoc {
  const data: Record<string, unknown> = {};
  for (const f of FIELDS) data[f] = row[f] === undefined ? null : row[f];
  return data as FrDoc;
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];
const names = (agencies: Agency[] | null | undefined): string[] =>
  uniq((agencies ?? []).map((a) => a.name ?? a.raw_name).filter((x): x is string => Boolean(x)));
const cfrLabel = (r: CfrRef): string =>
  r.part != null
    ? `${r.title} CFR ${r.part}`
    : r.chapter != null
      ? `${r.title} CFR chapter ${r.chapter}`
      : `${r.title} CFR`;
const citationWithPages = (d: FrDoc): string | null | undefined => {
  if (!d.citation || d.start_page == null || d.end_page == null) return d.citation;
  return `${d.citation} (pages ${d.start_page === d.end_page ? d.start_page : `${d.start_page}-${d.end_page}`})`;
};

/** Newest first: publication date, then first page, then document number, all descending. */
export function compareNewestFirst(a: FrDoc, b: FrDoc): number {
  return (
    Number(a.publication_date < b.publication_date) -
      Number(a.publication_date > b.publication_date) ||
    (b.start_page ?? 0) - (a.start_page ?? 0) ||
    Number(a.document_number < b.document_number) - Number(a.document_number > b.document_number)
  );
}

export function govinfoLink(d: FrDoc): { url: string; label: string } | null {
  const url = d.pdf_url;
  if (typeof url !== "string" || !url) return null;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (host !== "www.govinfo.gov") return null;
  return { url, label: GOVINFO_LABEL };
}

export function qualification(from: string, through: string, collected: string): string {
  return `Federal Register documents published ${from} to ${through} as listed by the federalregister.gov API and GovInfo when the index was collected on ${collected}. Later publication days are added from daily collections; each document's own "Index collected" fact gives its collection date. CFR parts, agencies, docket identifiers and RINs are the ones the API lists for each document; a correction issued after a document's collection date is not included in it. A document that cites a CFR part may propose, amend, correct or merely discuss it: read the document.`;
}

/** The listing qualification run.mjs writes after a continuation (catalog). */
export function listingQualification(through: string, collected: string): string {
  const tail =
    " CFR parts, agencies, docket identifiers and RINs are the ones the API lists for each document; documents published later, and any later correction, are not included. A document that cites a CFR part may propose, amend, correct or merely discuss it: read the document.";
  return `Federal Register documents published ${HISTORY_FIRST_DAY} to ${through} as listed by the federalregister.gov API and GovInfo. The historical index was collected on ${HISTORY_COLLECTED}; later publication days are added by daily continuation runs from the same API (latest collection ${collected}, each document records its own collection date).${tail}`;
}

/** lib.mjs projectRecord: the corpus_records row of one document. */
export function projectRecord(
  d: FrDoc,
  ctx: {
    id: string;
    ordinal: number;
    collected: string;
    coverage: { from: string; through: string };
  },
): CorpusRow {
  const num = d.document_number;
  const cfr = d.cfr_references ?? [];
  const cfrText = uniq(cfr.map(cfrLabel));
  const subtitle = names(d.agencies).slice(0, MAX_SUBTITLE_AGENCIES).join(" · ");
  const rins = d.regulation_id_numbers ?? [];
  const dockets = (d.docket_ids ?? []).slice(0, MAX_DOCKETS_PRINTED);
  const url = `${API_ORIGIN}/d/${num}`;
  const cells = {
    cfr:
      cfrText.length > MAX_CFR_CELL
        ? `${cfrText.slice(0, MAX_CFR_CELL).join(", ")} …`
        : cfrText.join(", "),
    type: d.type,
    citation: d.citation,
    published: d.publication_date,
  };
  const badges = [
    d.type,
    ...rins.slice(0, 1).map((r) => `RIN ${r}`),
    ...(d.correction_of ? ["Correction"] : []),
  ];
  const title = d.title.slice(0, MAX_TITLE_CHARS);
  const facts: [string, unknown][] = [
    ["Document number", num],
    ["Published in the Federal Register", d.publication_date],
    ["Type", d.type],
    ["Citation", citationWithPages(d)],
  ];
  if (names(d.agencies).length)
    facts.push(["Agencies (as listed by the API)", names(d.agencies).join("; ")]);
  if (cfrText.length) facts.push(["CFR parts cited", cfrText.join("; ")]);
  if (rins.length) facts.push(["Regulation Identifier Numbers (RIN)", rins.join("; ")]);
  if (dockets.length) facts.push(["Docket identifiers (as printed)", dockets.join("; ")]);
  if (d.correction_of) facts.push(["Corrects document", d.correction_of]);
  if (d.corrections?.length) facts.push(["Corrected by", d.corrections.join("; ")]);
  facts.push(["Index collected", `${ctx.collected} (federalregister.gov API and GovInfo)`]);
  const links: { url: string; label: string }[] = [{ url, label: "Open on federalregister.gov" }];
  if (d.raw_text_url)
    links.push({ url: d.raw_text_url, label: "Plain text (federalregister.gov)" });
  const linked = uniq(
    cfr.filter((x) => x.part != null).map((x) => `${x.title}\u0000${x.part}`),
  ).slice(0, MAX_CFR_LINKS);
  for (const key of linked) {
    const [t, part] = key.split("\u0000");
    const r = { title: t!, part: part! };
    links.push({
      url: `#federal-register?cfr_title=${r.title}&cfr_part=${r.part}`,
      label: `Other documents citing ${cfrLabel(r)}`,
    });
  }
  const qual = qualification(ctx.coverage.from, ctx.coverage.through, ctx.collected);
  // JavaScript's Array.prototype.join renders null/undefined as "" (lib.mjs builds `text` the same way)
  const text = [title, subtitle, ...facts.flat(), "", ...links.map((l) => l.label), qual].join(" ");
  const govinfo = govinfoLink(d);
  if (govinfo) links.push(govinfo);
  const item = { id: ctx.id, cells, links: [links[0]!], title, badges, subtitle };
  const detail = { facts, links, title, sections: [], subtitle, qualification: qual };
  const filters = {
    type: [d.type],
    year: [d.publication_date.slice(0, 4)],
    agency: uniq((d.agencies ?? []).filter((a) => a.id != null).map((a) => String(a.id))),
    _listing: ["yes"],
    cfr_pair: uniq(cfr.filter((r) => r.part != null).map((r) => `${r.title}:${r.part}`)),
    cfr_title: uniq(cfr.filter((r) => r.part != null).map((r) => String(r.title))),
  };
  return JSON.parse(
    JSON.stringify({
      dataset: DATASET,
      id: ctx.id,
      category: DATASET,
      state: "",
      county_geoids: [],
      title,
      source_url: url,
      ordinal: ctx.ordinal,
      item,
      detail,
      text,
      filters,
    }),
  ) as CorpusRow;
}

/** The projection context a stored continuation row was written with (its id, ordinal, collection date and coverage). */
export function ctxFromStored(row: StoredRow): {
  id: string;
  ordinal: number;
  collected: string;
  coverage: { from: string; through: string };
} | null {
  const facts = (row.detail["facts"] ?? []) as unknown as [string, string][];
  const collected = facts
    .find((f) => f[0] === "Index collected")?.[1]
    ?.match(/^(\d{4}-\d{2}-\d{2}) \(/)?.[1];
  const q = String(row.detail["qualification"] ?? "").match(
    /^Federal Register documents published (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2}) as listed/,
  );
  if (!collected || !q) return null;
  return {
    id: row.id,
    ordinal: Number(row.ordinal),
    collected,
    coverage: { from: q[1]!, through: q[2]! },
  };
}

type DayRead = { day: string; count: number; docs: { d: FrDoc; retrievedAt: string }[] };

/** One publication day, every page; throws on any inconsistency (count changes, out-of-day or duplicate rows). */
async function readDay(ctx: CollectContext, day: string): Promise<DayRead> {
  let expected: number | null = null;
  const seen = new Set<string>();
  const docs: DayRead["docs"] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await ctx.http.getText(dayUrl(day, page));
    if (res.status !== 200) throw new Error(`Federal Register HTTP ${res.status}`);
    const data = JSON.parse(res.text) as { count?: number; results?: Record<string, unknown>[] };
    if (data.count === 0 && data.results === undefined) data.results = [];
    if (!Array.isArray(data.results) || !Number.isSafeInteger(data.count))
      throw new Error("Unexpected Federal Register result shape");
    if (expected !== null && expected !== data.count)
      throw new Error(`Publisher count changed while reading ${day}`);
    expected = data.count!;
    if (expected > 9000) throw new Error(`Day ${day} exceeds the bounded API window`);
    for (const row of data.results) {
      if (
        typeof row["document_number"] !== "string" ||
        !row["document_number"].trim() ||
        row["publication_date"] !== day ||
        seen.has(row["document_number"])
      ) {
        throw new Error(`Duplicate or out-of-day record in ${day}`);
      }
      seen.add(row["document_number"]);
      docs.push({ d: pickFields(row), retrievedAt: res.record.retrieved_at });
    }
    if (docs.length >= expected) break;
    if (!data.results.length) throw new Error(`Pagination does not reconcile for ${day}`);
  }
  if (docs.length !== expected)
    throw new Error(`Day ${day}: received ${docs.length} of ${expected}`);
  return { day, count: expected!, docs };
}

export type FrPlan = {
  rows: CorpusRow[];
  held: HeldRecord[];
  alreadyHeld: number;
  newest: string | null;
  collected: string | null;
};

/** run.mjs project(): which documents to add and their ids/ordinals. Pure. */
export function planProjection(
  docs: { d: FrDoc; retrievedAt: string }[],
  head: { id: string; ordinal: number; publishedThrough: string },
  heldUrls: Set<string>,
): FrPlan {
  const unique = new Map<string, { d: FrDoc; retrievedAt: string }>();
  for (const x of docs) unique.set(x.d.document_number, x);
  const candidates = [...unique.values()];
  const fresh = candidates.filter((x) => !heldUrls.has(`${API_ORIGIN}/d/${x.d.document_number}`));
  const held: HeldRecord[] = fresh
    .filter((x) => x.d.publication_date < head.publishedThrough)
    .map((x) => ({
      key: x.d.document_number,
      reason: "published before the newest held day; history is never reordered",
    }));
  const addable = fresh
    .filter((x) => x.d.publication_date >= head.publishedThrough)
    .sort((a, b) => compareNewestFirst(a.d, b.d));
  if (!addable.length)
    return {
      rows: [],
      held,
      alreadyHeld: candidates.length - fresh.length,
      newest: null,
      collected: null,
    };
  const base = Number(head.id) + Number(head.ordinal);
  const newest = addable[0]!.d.publication_date;
  const collected = addable
    .map((x) => x.retrievedAt.slice(0, 10))
    .sort()
    .at(-1)!;
  const coverage = { from: HISTORY_FIRST_DAY, through: newest };
  const n = addable.length;
  const rows = addable.map((x, i) => {
    const ordinal = head.ordinal - n + i;
    return projectRecord(x.d, { id: String(base - ordinal), ordinal, collected, coverage });
  });
  return { rows, held, alreadyHeld: candidates.length - fresh.length, newest, collected };
}

export const federalRegister: SourceAdapter = {
  source: "federal_register",
  dataset: DATASET,
  mode: "insert_only",
  ordinalPolicy: "prepend",
  functionName: "ingest-federal-register",
  limits: { maxRequests: 30, minIntervalMs: 1100 },
  secrets: [],

  async collect(ctx: CollectContext): Promise<Collected> {
    const [head] = (await ctx.corpus.edge(DATASET, "asc", "id,ordinal,item", 1)) as {
      id: string;
      ordinal: number;
      item: { cells?: { published?: string } };
    }[];
    if (!head?.item?.cells?.published)
      throw new Error("federal_register_history has no first row to continue from");
    const publishedThrough = head.item.cells.published;
    const today = ctx.now.toISOString().slice(0, 10);
    const from = addDays(publishedThrough, -(RECHECK_DAYS - 1));
    let through = today < from ? from : today;
    let complete = true;
    if (Date.parse(through) - Date.parse(from) > (MAX_DAYS - 1) * 86400000) {
      through = addDays(from, MAX_DAYS - 1);
      complete = false;
    }
    const days: DayRead[] = [];
    let stopped: string | null = null;
    for (let day = from; day <= through; day = addDays(day, 1)) {
      try {
        days.push(await readDay(ctx, day));
      } catch (error) {
        if (error instanceof BudgetExhausted || error instanceof RateLimited) {
          complete = false;
          stopped = error.message;
          break;
        }
        throw error;
      }
    }
    const docs = days.flatMap((d) => d.docs);
    const urls = docs.map((x) => `${API_ORIGIN}/d/${x.d.document_number}`);
    const held = urls.length
      ? await ctx.corpus.rowsBy(DATASET, "source_url", urls, "id,source_url")
      : [];
    const plan = planProjection(
      docs,
      { id: head.id, ordinal: Number(head.ordinal), publishedThrough },
      new Set(held.map((r: StoredRow) => r.source_url)),
    );
    const lastDay = days.at(-1)?.day ?? null;
    // already-held documents of the window, rebuilt with the id, ordinal, collection date and coverage of their stored rows
    const rebuildHeld = async () => {
      const stored = urls.length ? await ctx.corpus.rowsBy(DATASET, "source_url", urls) : [];
      const byUrl = new Map(docs.map((x) => [`${API_ORIGIN}/d/${x.d.document_number}`, x.d]));
      const out: { key: string; built: CorpusRow; stored: StoredRow }[] = [];
      for (const row of stored) {
        const d = byUrl.get(row.source_url);
        const c = ctxFromStored(row);
        if (d && c) out.push({ key: row.source_url, built: projectRecord(d, c), stored: row });
      }
      return out;
    };
    const notes: JsonObject = {
      window: { from, through: lastDay },
      days: days.map((d) => ({ day: d.day, listed: d.count })) as Json,
      newest_held_before: publishedThrough,
      ...(plan.newest ? { newest_added: plan.newest, collected: plan.collected } : {}),
      ...(stopped ? { stopped } : {}),
    };
    return {
      rows: plan.rows,
      fetched: docs.length,
      held: plan.held,
      cursorAfter: { last_day_read: lastDay, newest_published: plan.newest ?? publishedThrough },
      complete: complete && lastDay === through,
      notes,
      matchBy: "source_url",
      preUnchanged: plan.alreadyHeld,
      rebuildHeld,
      verifyHeld: async () => {
        const report: ParityReport = { compared: 0, identical: 0, mismatches: [] };
        for (const { key, built, stored } of await rebuildHeld()) {
          report.compared++;
          const a = { ...rowContent(built), id: built.id, ordinal: built.ordinal ?? null };
          const b = { ...rowContent(stored), id: stored.id, ordinal: Number(stored.ordinal) };
          if (canonical(a) === canonical(b)) report.identical++;
          else if (report.mismatches.length < 20)
            report.mismatches.push({ key, paths: diffPaths(b, a, 8) });
        }
        return report;
      },
    };
  },

  // insert-only: an existing document is never compared for an update (ids derive from ordinals)
  comparable(content) {
    return { ...(content as unknown as JsonObject), id: null };
  },

  /** run.mjs updateDatasetMetadata: listing qualification and a continuation entry, when rows were added. */
  catalogNote(c: Collected, runId: string, now: Date) {
    const newest = c.notes["newest_added"];
    const collected = c.notes["collected"];
    if (typeof newest !== "string" || typeof collected !== "string" || !c.rows.length) return null;
    const published = c.rows
      .map((r) => String((r.item["cells"] as JsonObject)["published"]))
      .sort();
    return {
      qualification: listingQualification(newest, collected),
      continuation: {
        contract: "ingest/1",
        schema_version: "federal-register-metadata/2",
        source: "FederalRegister.gov API v1",
        published_from: published[0]!,
        published_through: newest,
        records_added: c.rows.length,
        collected,
        runs: [runId],
        applied_at: now.toISOString(),
      },
    };
  },
};

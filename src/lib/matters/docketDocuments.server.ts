import { restGet } from "@/lib/external/rest.server";
import {
  DOCKET_DOCUMENTS_DATASET,
  casesFromMetadata,
  caseBelongsToMdl,
  entriesExact,
  exactSum,
  parseDocketDocument,
  unlistedTotal,
  type DocketDocument,
  type DocketDocumentsCase,
  type DocketDocumentsOverview,
  type ExactCount,
  type MatterDocketDocumentsSummary,
} from "./docketDocuments";
import { isObj, safeUint, str } from "./values";

const enc = encodeURIComponent;
const cell = (name: string) => enc(`item->cells->>${name}`);

let overviewCache: { at: number; value: DocketDocumentsOverview | null } | null = null;

/** Counts from the dataset's own metadata plus one row per case for its docket key, title and MDL label; null while held. */
export async function loadDocketDocumentsOverview(): Promise<DocketDocumentsOverview | null> {
  if (overviewCache && Date.now() - overviewCache.at < 5 * 60_000) return overviewCache.value;
  const meta = await restGet<
    {
      ready: boolean | null;
      imported_records: number | null;
      coverage: unknown;
      withheld: unknown;
      filters: unknown;
    }[]
  >(
    `corpus_datasets?select=ready,imported_records,coverage:metadata->coverage,withheld:metadata->withheld_counts,filters:metadata->listing->filters&id=eq.${DOCKET_DOCUMENTS_DATASET}&limit=1`,
  );
  const row = meta.rows[0];
  let value: DocketDocumentsOverview | null = null;
  if (row?.ready === true) {
    const coverage = isObj(row.coverage) ? row.coverage : {};
    const cases: DocketDocumentsCase[] = await Promise.all(
      casesFromMetadata(row.coverage, row.filters).map(async (c) => {
        const first = await restGet<{ item: unknown }[]>(
          `corpus_records?select=item&dataset=eq.${DOCKET_DOCUMENTS_DATASET}&${cell("native_case_id")}=eq.${enc(c.caseId)}&limit=1`,
        ).catch(() => null);
        const item = first?.rows[0]?.item;
        const cells = isObj(item) && isObj(item["cells"]) ? item["cells"] : {};
        return {
          ...c,
          docketKey: str(cells["docket_key"]),
          mdl: str(cells["mdl"]),
          title: str(cells["case_title"]),
        };
      }),
    );
    const withheld = isObj(row.withheld) ? safeUint(row.withheld["not_projected"]) : null;
    value = {
      total: row.imported_records,
      stored: safeUint(coverage["stored"]),
      providerNotDownloaded: safeUint(coverage["provider_not_downloaded"]),
      withheld,
      cases: cases.sort((a, b) => b.rows - a.rows),
    };
  }
  overviewCache = { at: Date.now(), value };
  return value;
}

/** Exact HEAD count. Null when the corpus does not return a count — that is too large to count, not zero. */
async function liveCount(path: string): Promise<number | null> {
  try {
    const r = await restGet<unknown[]>(path, { count: true, range: [0, 0] });
    return typeof r.total === "number" && Number.isSafeInteger(r.total) ? r.total : null;
  } catch {
    return null;
  }
}

const NOT_RECORDED: ExactCount = { value: null, gap: "not-recorded" };

/** Listable rows: restricted and seal-coded descriptions are not part of the count or the list. */
const listable = `&${cell("restricted")}=eq.false&or=${enc("(item->cells->>description_withheld.is.null,item->cells->>description_withheld.eq.contact_or_access_data)")}`;

async function countEntriesByMdl(mdl: string): Promise<ExactCount> {
  const value = await liveCount(
    `corpus_records?select=id&dataset=eq.sw_docket_entries_v1&${cell("mdl")}=eq.${enc(mdl)}`,
  );
  return value === null ? { value: null, gap: "too-large" } : { value, gap: "exact" };
}

const summaryCache = new Map<string, { at: number; value: MatterDocketDocumentsSummary }>();

/**
 * Live counts for one matter. Document rows are the cases that belong (MDL label or the MDL number in the exact case
 * id). Entries are those cases' docket keys, or the MDL cell on sw_docket_entries_v1 when the matter has no document
 * cases. A missing piece stays not-recorded or too large to count; nothing is summed from a partial result.
 */
export async function loadMatterDocketDocumentsSummary(
  mdl: string,
): Promise<MatterDocketDocumentsSummary> {
  const hit = summaryCache.get(mdl);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
  const overview = await loadDocketDocumentsOverview();
  const cases = overview ? overview.cases.filter((c) => caseBelongsToMdl(c, mdl)) : [];
  let value: MatterDocketDocumentsSummary;
  if (!overview) {
    value = {
      listed: NOT_RECORDED,
      stored: NOT_RECORDED,
      entries: await countEntriesByMdl(mdl),
      withheld: null,
      cases: [],
      unlisted: null,
    };
  } else if (!cases.length) {
    value = {
      listed: { value: 0, gap: "exact" },
      stored: { value: 0, gap: "exact" },
      entries: await countEntriesByMdl(mdl),
      withheld: null,
      cases: [],
      unlisted: 0,
    };
  } else {
    const perCase = await Promise.all(
      cases.map(async (c) => {
        const base = `corpus_records?select=id&dataset=eq.${DOCKET_DOCUMENTS_DATASET}&${cell("native_case_id")}=eq.${enc(c.caseId)}${listable}`;
        const [rows, stored, entries] = await Promise.all([
          liveCount(base),
          liveCount(`${base}&${cell("availability")}=eq.stored`),
          c.docketKey
            ? liveCount(
                `corpus_records?select=id&dataset=eq.sw_docket_entries_v1&${cell("docket_key")}=eq.${enc(c.docketKey)}`,
              )
            : Promise.resolve(null),
        ]);
        const unnumbered =
          entries !== null && entries > 0
            ? await liveCount(`${base}&${cell("entry_number")}=is.null`)
            : entries === 0
              ? 0
              : null;
        return { c, rows, stored, entries, unnumbered };
      }),
    );
    const withheld = cases.some((c) => c.withheld === null)
      ? null
      : cases.reduce((n, c) => n + (c.withheld ?? 0), 0);
    value = {
      listed: exactSum(perCase.map((x) => x.rows)),
      stored: exactSum(perCase.map((x) => x.stored)),
      entries: entriesExact(perCase.map((x) => ({ docketKey: x.c.docketKey, count: x.entries }))),
      withheld,
      cases: perCase.map((x) => ({
        caseId: x.c.caseId,
        docketKey: x.c.docketKey,
        rows: x.rows,
        entries: x.entries,
      })),
      unlisted: unlistedTotal(
        perCase.map((x) => ({ rows: x.rows, entries: x.entries, unnumbered: x.unnumbered })),
      ),
    };
  }
  if (summaryCache.size > 100) summaryCache.clear();
  summaryCache.set(mdl, { at: Date.now(), value });
  return value;
}

export type MatterDocketDocuments = {
  total: number | null;
  documents: DocketDocument[];
  offset: number;
  pageSize: number;
};

/**
 * Documents of the cases that belong to an MDL, by entry number. `unlisted` keeps only the cases without registry
 * entries (the documents that cannot appear under an entry).
 */
export async function loadMatterDocketDocuments(
  mdl: string,
  offset: number,
  scope: "all" | "unlisted" = "all",
): Promise<MatterDocketDocuments> {
  const pageSize = 50;
  const summary = await loadMatterDocketDocumentsSummary(mdl);
  const all = summary.cases;
  if (!all.length)
    return {
      total: summary.listed.gap === "exact" ? summary.listed.value : null,
      documents: [],
      offset,
      pageSize,
    };
  const quote = (list: typeof all) => list.map((c) => `"${c.caseId.replace(/"/g, "")}"`).join(",");
  // `unlisted`: every row of a case with no registry entries, plus the unnumbered rows of the other cases.
  const noEntries = all.filter((c) => c.entries === 0);
  const scopeOr =
    scope === "unlisted"
      ? `,or(item->cells->>entry_number.is.null${noEntries.length ? `,item->cells->>native_case_id.in.(${quote(noEntries)})` : ""})`
      : "";
  const andFilter = `&and=${enc(`(item->cells->>restricted.eq.false,or(item->cells->>description_withheld.is.null,item->cells->>description_withheld.eq.contact_or_access_data)${scopeOr})`)}`;
  const r = await restGet<{ item: unknown; facts: unknown }[]>(
    `corpus_records?select=item,facts:detail->facts&dataset=eq.${DOCKET_DOCUMENTS_DATASET}&${cell("native_case_id")}=in.(${enc(quote(all))})${andFilter}&order=${enc("item->cells->entry_number")}.asc.nullslast,id.asc`,
    { count: true, range: [offset, offset + pageSize - 1] },
  );
  const documents = r.rows
    .map((row) => parseDocketDocument(row.item, row.facts))
    .filter((d): d is DocketDocument => !!d);
  return { total: r.total, documents, offset, pageSize };
}

let readyCache: { at: number; ready: boolean } | null = null;

/** Whether the dataset is released; the entry join needs nothing else, so no case list is read. */
async function documentsReleased(): Promise<boolean> {
  if (readyCache && Date.now() - readyCache.at < 60_000) return readyCache.ready;
  const r = await restGet<{ ready: boolean | null }[]>(
    `corpus_datasets?select=ready&id=eq.${DOCKET_DOCUMENTS_DATASET}&limit=1`,
  );
  const ready = r.rows[0]?.ready === true;
  readyCache = { at: Date.now(), ready };
  return ready;
}

export type EntryDocumentQuery = {
  id: string;
  docketKey: string | null;
  entryNumber: number | null;
};

/** The documents of the given entries, joined on the exact docket key and entry number; keyed by timeline entry id. */
export async function loadEntryDocuments(
  items: EntryDocumentQuery[],
): Promise<Record<string, DocketDocument[]>> {
  if (!(await documentsReleased())) return {};
  const byKey = new Map<string, Set<number>>();
  for (const it of items) {
    if (!it.docketKey || it.entryNumber === null) continue;
    const set = byKey.get(it.docketKey) ?? new Set<number>();
    set.add(it.entryNumber);
    byKey.set(it.docketKey, set);
  }
  const found = new Map<string, DocketDocument[]>();
  await Promise.all(
    [...byKey].map(async ([docketKey, numbers]) => {
      const r = await restGet<{ item: unknown; facts: unknown }[]>(
        `corpus_records?select=item,facts:detail->facts&dataset=eq.${DOCKET_DOCUMENTS_DATASET}&${cell("docket_key")}=eq.${enc(docketKey)}&${cell("entry_number")}=in.(${[...numbers].join(",")})${listable}&order=id.asc&limit=1000`,
      );
      for (const row of r.rows) {
        const d = parseDocketDocument(row.item, row.facts);
        if (!d || d.entryNumber === null) continue;
        const key = `${docketKey}#${d.entryNumber}`;
        found.set(key, [...(found.get(key) ?? []), d]);
      }
    }),
  );
  const out: Record<string, DocketDocument[]> = {};
  for (const it of items) {
    if (!it.docketKey || it.entryNumber === null) continue;
    const docs = found.get(`${it.docketKey}#${it.entryNumber}`);
    if (docs?.length) out[it.id] = docs;
  }
  return out;
}

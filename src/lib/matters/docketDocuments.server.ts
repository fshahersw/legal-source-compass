import { restGet } from "@/lib/external/rest.server";
import {
  DOCKET_DOCUMENTS_DATASET,
  caseBelongsToMdl,
  parseDocketDocument,
  type DocketDocument,
  type DocketDocumentsCase,
  type DocketDocumentsOverview,
} from "./docketDocuments";
import { isObj, safeUint, str } from "./values";

const enc = encodeURIComponent;
const cell = (name: string) => enc(`item->cells->>${name}`);

let overviewCache: { at: number; value: DocketDocumentsOverview | null } | null = null;

/** Counts from the dataset's own metadata plus one row per case for its title and MDL label; null while held. */
export async function loadDocketDocumentsOverview(): Promise<DocketDocumentsOverview | null> {
  if (overviewCache && Date.now() - overviewCache.at < 5 * 60_000) return overviewCache.value;
  const meta = await restGet<
    {
      ready: boolean | null;
      imported_records: number | null;
      coverage: unknown;
      withheld: unknown;
    }[]
  >(
    `corpus_datasets?select=ready,imported_records,coverage:metadata->coverage,withheld:metadata->withheld_counts&id=eq.${DOCKET_DOCUMENTS_DATASET}&limit=1`,
  );
  const row = meta.rows[0];
  let value: DocketDocumentsOverview | null = null;
  if (row?.ready === true) {
    const coverage = isObj(row.coverage) ? row.coverage : {};
    const byCase = isObj(coverage["by_case"]) ? coverage["by_case"] : {};
    const cases: DocketDocumentsCase[] = await Promise.all(
      Object.entries(byCase).map(async ([caseId, raw]) => {
        const c = isObj(raw) ? raw : {};
        const first = await restGet<{ item: unknown }[]>(
          `corpus_records?select=item&dataset=eq.${DOCKET_DOCUMENTS_DATASET}&${cell("native_case_id")}=eq.${enc(caseId)}&limit=1`,
        ).catch(() => null);
        const cells =
          first &&
          isObj(first.rows[0]?.item) &&
          isObj((first.rows[0]!.item as Record<string, unknown>)["cells"])
            ? ((first.rows[0]!.item as Record<string, unknown>)["cells"] as Record<string, unknown>)
            : {};
        return {
          caseId,
          rows: safeUint(c["rows"]) ?? 0,
          sheetDocuments: safeUint(c["sheet_documents"]),
          withheld: safeUint(c["withheld_no_row"]),
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

export type MatterDocketDocuments = {
  total: number | null;
  documents: DocketDocument[];
  offset: number;
  pageSize: number;
};

/** Documents of the cases that belong to an MDL (by MDL label or the MDL number in the exact case id), by entry. */
export async function loadMatterDocketDocuments(
  mdl: string,
  offset: number,
): Promise<MatterDocketDocuments> {
  const pageSize = 50;
  const overview = await loadDocketDocumentsOverview();
  const cases = overview ? overview.cases.filter((c) => caseBelongsToMdl(c, mdl)) : [];
  if (!cases.length) return { total: 0, documents: [], offset, pageSize };
  const ids = cases.map((c) => `"${c.caseId.replace(/"/g, "")}"`).join(",");
  const r = await restGet<{ item: unknown }[]>(
    `corpus_records?select=item&dataset=eq.${DOCKET_DOCUMENTS_DATASET}&${cell("native_case_id")}=in.(${enc(ids)})&order=${enc("item->cells->entry_number")}.asc.nullslast,id.asc`,
    { count: true, range: [offset, offset + pageSize - 1] },
  );
  const documents = r.rows
    .map((row) => parseDocketDocument(row.item))
    .filter((d): d is DocketDocument => !!d);
  return { total: r.total, documents, offset, pageSize };
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
  const overview = await loadDocketDocumentsOverview();
  if (!overview) return {};
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
      const r = await restGet<{ item: unknown }[]>(
        `corpus_records?select=item&dataset=eq.${DOCKET_DOCUMENTS_DATASET}&${cell("docket_key")}=eq.${enc(docketKey)}&${cell("entry_number")}=in.(${[...numbers].join(",")})&order=id.asc&limit=1000`,
      );
      for (const row of r.rows) {
        const d = parseDocketDocument(row.item);
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

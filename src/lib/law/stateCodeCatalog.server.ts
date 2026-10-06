import { stateByUsps } from "@/lib/corpus/geo";
import { ilikeTerm, restGet } from "@/lib/external/rest.server";
import { STATE_DATASETS } from "@/lib/external/lawTree";
import { listSnapshotNames, readPrivateSnapshot } from "@/lib/private-data/snapshot.server";
import {
  classifyDataset,
  matchesCitationOrHeading,
  parseListing,
  sectionFieldsFromRecord,
  snapshotReleasePaths,
  summarizeBrowseRoot,
  type CodeIndexRow,
  type DatasetCandidate,
  type SectionFields,
  type StateCodeHit,
  type StateCodeListing,
} from "./stateCodeContract";

const CATALOG_TTL = 60_000;
const SCAN_CAP = 100_000;
const SEARCH_LIMIT = 30;

type SnapshotEntry = {
  code: string;
  chapterId: string;
  id: string;
  citation: string | null;
  heading: string;
};

let catalogCache: { at: number; value: StateCodeListing[] } | null = null;
const snapshotIndexes = new Map<string, SnapshotEntry[]>();
const snapshotBuilds = new Map<string, Promise<SnapshotEntry[]>>();

function encGt(value: string): string {
  return value.replaceAll(">", "%3E");
}

function postgrestEq(value: string): string {
  return `eq.${encodeURIComponent(value)}`;
}

function containsValue(field: string, value: string): string {
  return `filters=cs.${encodeURIComponent(JSON.stringify({ [field]: [value] }))}`;
}

function datasetIdOk(id: string): boolean {
  return /^[a-z0-9_]{1,80}$/.test(id);
}

async function readSnapshotJson(file: string): Promise<unknown> {
  const bytes = await readPrivateSnapshot(file);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function factValue(detail: { facts?: unknown } | null, label: string): string | null {
  if (!detail || !Array.isArray(detail.facts)) return null;
  for (const fact of detail.facts) {
    if (
      !Array.isArray(fact) ||
      fact.length < 2 ||
      typeof fact[0] !== "string" ||
      typeof fact[1] !== "string"
    )
      continue;
    if (fact[0].trim().toLowerCase() === label.toLowerCase() && fact[1].trim())
      return fact[1].trim();
  }
  return null;
}

async function codeIndex(): Promise<CodeIndexRow[]> {
  const rows = await restGet<
    { title: string | null; state: string | null; detail: { facts?: unknown } | null }[]
  >("corpus_records?select=title,state,detail&dataset=eq.state_codes&order=ordinal.asc&limit=200");
  return rows.rows.map((row) => ({
    title: row.title,
    state: row.state,
    edition: factValue(row.detail, "Edition"),
    currency: factValue(row.detail, "Currency"),
  }));
}

async function snapshotListings(): Promise<StateCodeListing[]> {
  const found = listSnapshotNames().flatMap((file) => {
    const match = /^state-codes\/([a-z]{2})\/browse-v1\/codes\.json$/.exec(file);
    return match ? [{ state: match[1]!.toUpperCase(), file }] : [];
  });
  const listings: StateCodeListing[] = [];
  for (const item of found) {
    const place = stateByUsps.get(item.state);
    if (!place) continue;
    const summary = summarizeBrowseRoot(await readSnapshotJson(item.file), item.state);
    if (!summary) throw new Error(`State code index for ${item.state} has an unsupported format.`);
    listings.push({
      state: item.state,
      name: place.name,
      kind: "snapshot",
      codeName: `${place.name} code`,
      sectionCount: summary.sectionCount,
      edition: summary.edition,
      currency: summary.currency,
      sourceUrl: null,
      note: summary.note,
      datasetId: null,
      hasSnapshot: true,
      titleFilter: null,
      chapterField: null,
    });
  }
  return listings;
}

async function datasetListings(index: CodeIndexRow[]): Promise<StateCodeListing[]> {
  const rows = await restGet<
    {
      id: string;
      label: string | null;
      ready: boolean | null;
      imported_records: number | null;
      full_code: unknown;
      listing: unknown;
      qualification: unknown;
    }[]
  >(
    "corpus_datasets?select=id,label,ready,imported_records,full_code:metadata->full_code,listing:metadata->listing,qualification:metadata->qualification&ready=eq.true&order=id.asc",
  );
  return rows.rows.flatMap((row) => {
    const candidate: DatasetCandidate = {
      id: row.id,
      label: row.label,
      ready: row.ready ?? null,
      importedRecords: row.imported_records,
      fullCode: row.full_code,
      listing: row.listing,
      qualification: row.qualification,
    };
    const classified = classifyDataset(candidate, index, STATE_DATASETS);
    if (!classified || !datasetIdOk(classified.datasetId)) return [];
    const place = stateByUsps.get(classified.state);
    if (!place) return [];
    return [
      {
        state: classified.state,
        name: place.name,
        kind: "dataset" as const,
        codeName: classified.codeName,
        sectionCount: classified.sectionCount,
        edition: classified.edition,
        currency: classified.currency,
        sourceUrl: classified.sourceUrl,
        note: classified.note,
        datasetId: classified.datasetId,
        hasSnapshot: false,
        titleFilter: classified.titleFilter,
        chapterField: classified.chapterField,
      },
    ];
  });
}

function mergeListings(rows: StateCodeListing[]): StateCodeListing[] {
  const snapshots = new Map<string, StateCodeListing>();
  const datasets = new Map<string, StateCodeListing[]>();
  for (const row of rows) {
    if (row.hasSnapshot && row.kind === "snapshot") snapshots.set(row.state, row);
    else {
      const list = datasets.get(row.state) ?? [];
      list.push(row);
      datasets.set(row.state, list);
    }
  }
  const states = new Set([...snapshots.keys(), ...datasets.keys()]);
  const merged: StateCodeListing[] = [];
  for (const state of states) {
    const snapshot = snapshots.get(state);
    const sets = datasets.get(state) ?? [];
    if (snapshot && sets.length === 1) {
      const dataset = sets[0]!;
      merged.push({
        ...snapshot,
        datasetId: dataset.datasetId,
        titleFilter: dataset.titleFilter,
        chapterField: dataset.chapterField,
        sectionCount: snapshot.sectionCount ?? dataset.sectionCount,
        edition: snapshot.edition ?? dataset.edition,
        currency: snapshot.currency ?? dataset.currency,
        sourceUrl: snapshot.sourceUrl ?? dataset.sourceUrl,
        note: snapshot.note ?? dataset.note,
      });
    } else {
      if (snapshot) merged.push(snapshot);
      merged.push(...sets);
    }
  }
  return merged.sort(
    (a, b) => a.name.localeCompare(b.name) || a.codeName.localeCompare(b.codeName),
  );
}

export async function listFullStateCodes(): Promise<StateCodeListing[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL) return catalogCache.value;
  const index = await codeIndex();
  const [snapshots, datasets] = await Promise.all([snapshotListings(), datasetListings(index)]);
  const value = mergeListings([...snapshots, ...datasets]);
  catalogCache = { at: Date.now(), value };
  return value;
}

async function listingFor(state: string): Promise<StateCodeListing | null> {
  const rows = await listFullStateCodes();
  return rows.find((row) => row.state === state) ?? null;
}

export async function stateCodeTitles(
  state: string,
): Promise<{ value: string; label: string; count: number | null }[]> {
  const listing = await listingFor(state);
  if (!listing?.datasetId || !listing.titleFilter) return [];
  const meta = await restGet<{ listing: unknown }[]>(
    `corpus_datasets?select=listing:metadata->listing&id=eq.${listing.datasetId}&limit=1`,
  );
  const parsed = parseListing(meta.rows[0]?.listing);
  const filter = parsed.filters.find(
    (item) => item.type === "select" && item.name === listing.titleFilter,
  );
  return (filter?.options ?? []).map((option) => ({
    value: option.value,
    label: option.label,
    count: option.count ?? null,
  }));
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await run(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export async function stateCodeChapters(
  state: string,
  title: string,
): Promise<{ chapters: { label: string; count: number }[]; truncated: boolean }> {
  const listing = await listingFor(state);
  if (!listing?.datasetId || !listing.titleFilter || !listing.chapterField)
    return { chapters: [], truncated: false };
  const counts = new Map<string, number>();
  let offset = 0;
  let truncated = false;
  const select = encGt(`chapter:item->cells->>${listing.chapterField}`);
  while (offset < SCAN_CAP) {
    const path = `corpus_records?select=${select}&dataset=eq.${listing.datasetId}&${containsValue(listing.titleFilter, title)}&order=ordinal.asc`;
    const page = await restGet<{ chapter: string | null }[]>(path, {
      range: [offset, offset + 999],
    });
    for (const row of page.rows)
      counts.set(row.chapter?.trim() ?? "", (counts.get(row.chapter?.trim() ?? "") ?? 0) + 1);
    if (page.rows.length < 1000)
      return { chapters: [...counts].map(([label, count]) => ({ label, count })), truncated };
    offset += 1000;
  }
  truncated = true;
  return { chapters: [...counts].map(([label, count]) => ({ label, count })), truncated };
}

export async function stateCodeSectionList(
  state: string,
  title: string,
  chapter: string,
): Promise<{
  sections: { id: string; title: string; status: string | null }[];
  truncated: boolean;
}> {
  const listing = await listingFor(state);
  if (!listing?.datasetId || !listing.titleFilter || !listing.chapterField)
    return { sections: [], truncated: false };
  const chapterFilter =
    chapter === ""
      ? encGt(`item->cells->>${listing.chapterField}=is.null`)
      : `${encGt(`item->cells->>${listing.chapterField}`)}=${postgrestEq(chapter)}`;
  const select = encGt("id,title,status:item->cells->>status");
  const sections: { id: string; title: string; status: string | null }[] = [];
  let offset = 0;
  while (offset < SCAN_CAP) {
    const path = `corpus_records?select=${select}&dataset=eq.${listing.datasetId}&${containsValue(listing.titleFilter, title)}&${chapterFilter}&order=ordinal.asc`;
    const page = await restGet<{ id: string; title: string | null; status: string | null }[]>(
      path,
      {
        range: [offset, offset + 999],
      },
    );
    for (const row of page.rows)
      sections.push({ id: row.id, title: row.title?.trim() || row.id, status: row.status });
    if (page.rows.length < 1000) return { sections, truncated: false };
    offset += 1000;
  }
  return { sections, truncated: true };
}

export async function stateCodeSection(
  state: string,
  id: string,
): Promise<(SectionFields & { id: string; datasetId: string }) | null> {
  const listing = await listingFor(state);
  if (!listing?.datasetId || !datasetIdOk(listing.datasetId)) return null;
  const rows = await restGet<
    {
      id: string;
      title: string | null;
      source_url: string | null;
      detail: unknown;
      item: { cells?: Record<string, unknown> } | null;
    }[]
  >(
    `corpus_records?select=id,title,source_url,detail,item&dataset=eq.${listing.datasetId}&id=${postgrestEq(id)}&limit=2`,
  );
  const row = rows.rows[0];
  if (!row || rows.rows.length !== 1) return null;
  return { id: row.id, datasetId: listing.datasetId, ...sectionFieldsFromRecord(row) };
}

async function snapshotIndex(state: string): Promise<SnapshotEntry[]> {
  const ready = snapshotIndexes.get(state);
  if (ready) return ready;
  const running = snapshotBuilds.get(state);
  if (running) return running;
  const build = buildSnapshotIndex(state)
    .then((rows) => {
      snapshotIndexes.set(state, rows);
      return rows;
    })
    .finally(() => snapshotBuilds.delete(state));
  snapshotBuilds.set(state, build);
  return build;
}

async function buildSnapshotIndex(state: string): Promise<SnapshotEntry[]> {
  const root = snapshotReleasePaths(state).root;
  const files = listSnapshotNames().filter(
    (name) => name.startsWith(`${root}sections/`) && name.endsWith(".json"),
  );
  const shards = await mapPool(files, 6, async (file) => {
    const data = (await readSnapshotJson(file)) as {
      code?: unknown;
      sections?: { chapter_id?: unknown; id?: unknown; title?: unknown; citation?: unknown }[];
    };
    if (!Array.isArray(data.sections) || typeof data.code !== "string") {
      throw new Error(`State code section index for ${state} could not be read.`);
    }
    return data.sections.map((section) => {
      if (
        typeof section.id !== "string" ||
        typeof section.title !== "string" ||
        typeof section.chapter_id !== "string"
      ) {
        throw new Error(`State code section index for ${state} is missing a citation row.`);
      }
      return {
        code: data.code as string,
        chapterId: section.chapter_id,
        id: section.id,
        citation: typeof section.citation === "string" ? section.citation : null,
        heading: section.title,
      };
    });
  });
  return shards.flat();
}

function filterValue(filters: unknown, field: string): string | null {
  if (!filters || typeof filters !== "object") return null;
  const value = (filters as Record<string, unknown>)[field];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.length === 1) {
    const only = value[0];
    if (typeof only === "string" || typeof only === "number") return String(only);
  }
  return null;
}

async function searchDataset(
  listing: StateCodeListing,
  q: string,
): Promise<{ hits: StateCodeHit[]; total: number }> {
  if (!listing.datasetId || !listing.titleFilter || !listing.chapterField)
    return { hits: [], total: 0 };
  const select = encGt(`id,title,filters,chapter:item->cells->>${listing.chapterField}`);
  const path = `corpus_records?select=${select}&dataset=eq.${listing.datasetId}&title=ilike.${ilikeTerm(q)}&order=ordinal.asc`;
  const rows = await restGet<
    { id: string; title: string | null; filters: unknown; chapter: string | null }[]
  >(path, {
    count: true,
    range: [0, SEARCH_LIMIT - 1],
  });
  return {
    total: rows.total ?? rows.rows.length,
    hits: rows.rows.map((row) => ({
      state: listing.state,
      kind: "dataset" as const,
      id: row.id,
      citation: null,
      heading: row.title?.trim() || row.id,
      code: null,
      chapterId: null,
      titleValue: filterValue(row.filters, listing.titleFilter!),
      chapterLabel: row.chapter,
      datasetId: listing.datasetId,
    })),
  };
}

export async function searchFullStateCodes(
  q: string,
  state?: string,
): Promise<{ hits: StateCodeHit[]; total: number }> {
  const listings = (await listFullStateCodes()).filter((row) => !state || row.state === state);
  const groups = await Promise.all(
    listings.map(async (listing) => {
      const hits: StateCodeHit[] = [];
      let total = 0;
      if (listing.hasSnapshot) {
        const index = await snapshotIndex(listing.state);
        for (const row of index) {
          if (!matchesCitationOrHeading(q, row.citation, row.heading)) continue;
          total += 1;
          if (hits.length < SEARCH_LIMIT) {
            hits.push({
              state: listing.state,
              kind: "snapshot",
              id: row.id,
              citation: row.citation,
              heading: row.heading,
              code: row.code,
              chapterId: row.chapterId,
              titleValue: null,
              chapterLabel: null,
              datasetId: listing.datasetId,
            });
          }
        }
      }
      if (listing.datasetId) {
        const found = await searchDataset(listing, q);
        total += found.total;
        hits.push(...found.hits);
      }
      return { hits, total };
    }),
  );
  return {
    hits: groups.flatMap((group) => group.hits).slice(0, SEARCH_LIMIT),
    total: groups.reduce((sum, group) => sum + group.total, 0),
  };
}

import { STATES, stateByUsps } from "@/lib/corpus/geo";
import { ilikeTerm, restGet, rpcPost, rpcPostOptional } from "@/lib/external/rest.server";
import { STATE_DATASETS } from "@/lib/external/lawTree";
import { listSnapshotNames, readPrivateSnapshot } from "@/lib/private-data/snapshot.server";
import {
  exactCitationPaths,
  storedHierarchyNumbers,
  storedSectionNumbers,
  tokenEqualsStoredSection,
} from "./exactCitationPath";
import {
  classifyDataset,
  coverageStatus,
  matchesCitationOrHeading,
  parseListing,
  projectedCurrency,
  projectedEdition,
  publishedSectionBody,
  sectionFieldsFromRecord,
  snapshotReleasePaths,
  summarizeBrowseRoot,
  type CodeIndexRow,
  type DatasetCandidate,
  type HierarchyStep,
  type ProjectedOutline,
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
      levels: null,
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
        levels: null,
      },
    ];
  });
}

function mergeListings(rows: StateCodeListing[]): StateCodeListing[] {
  const projections = new Map<string, StateCodeListing>();
  const snapshots = new Map<string, StateCodeListing>();
  const datasets = new Map<string, StateCodeListing[]>();
  for (const row of rows) {
    if (row.kind === "projection") projections.set(row.state, row);
    else if (row.hasSnapshot && row.kind === "snapshot") snapshots.set(row.state, row);
    else {
      const list = datasets.get(row.state) ?? [];
      list.push(row);
      datasets.set(row.state, list);
    }
  }
  const states = new Set([...projections.keys(), ...snapshots.keys(), ...datasets.keys()]);
  const merged: StateCodeListing[] = [];
  for (const state of states) {
    const projection = projections.get(state);
    if (projection) {
      merged.push(projection);
      continue;
    }
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

async function publishedListings(): Promise<StateCodeListing[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL) return catalogCache.value;
  const index = await codeIndex();
  const [snapshots, datasets] = await Promise.all([snapshotListings(), datasetListings(index)]);
  const value = mergeListings([...snapshots, ...datasets]);
  catalogCache = { at: Date.now(), value };
  return value;
}

type ProjectedStateRow = {
  jurisdiction?: unknown;
  code_title?: unknown;
  publisher?: unknown;
  publisher_url?: unknown;
  sections?: unknown;
  currency?: unknown;
  structure_levels?: unknown;
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function projectedListings(): Promise<StateCodeListing[]> {
  const rows = await rpcPostOptional<ProjectedStateRow[]>(
    "corpus_publisher_code_projected_states_v2",
    {},
  );
  if (!rows) return [];
  return rows.flatMap((row) => {
    const state = asText(row.jurisdiction)?.toUpperCase() ?? "";
    const place = stateByUsps.get(state);
    if (!place) return [];
    const levels = Array.isArray(row.structure_levels)
      ? row.structure_levels.filter((level): level is string => typeof level === "string")
      : [];
    return [
      {
        state,
        name: place.name,
        kind: "projection" as const,
        codeName: asText(row.code_title) ?? `${place.name} code`,
        sectionCount: typeof row.sections === "number" ? row.sections : null,
        edition: projectedEdition(row.currency),
        currency: projectedCurrency(row.currency),
        sourceUrl: asText(row.publisher_url),
        note: asText(row.publisher),
        datasetId: null,
        hasSnapshot: false,
        titleFilter: null,
        chapterField: null,
        levels,
      },
    ];
  });
}

export async function listFullStateCodes(): Promise<StateCodeListing[]> {
  const [published, projected] = await Promise.all([publishedListings(), projectedListings()]);
  return mergeListings([...published, ...projected]);
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
): Promise<(SectionFields & { id: string; datasetId: string | null }) | null> {
  const listing = await listingFor(state);
  if (listing?.kind === "projection") {
    const section = await projectedSection(state, id);
    return section ? { ...section, datasetId: null } : null;
  }
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

async function searchProjection(
  q: string,
  state?: string,
): Promise<{ hits: StateCodeHit[]; total: number }> {
  const result = await rpcPostOptional<{
    total?: unknown;
    hits?: { jurisdiction?: unknown; native_id?: unknown; citation?: unknown; heading?: unknown }[];
  }>("corpus_publisher_code_projected_search_v2", {
    p_q: q,
    p_jurisdiction: state ?? null,
    p_limit: SEARCH_LIMIT,
  });
  if (!result || !Array.isArray(result.hits)) return { hits: [], total: 0 };
  return {
    total: typeof result.total === "number" ? result.total : result.hits.length,
    hits: result.hits.flatMap((hit) => {
      const jurisdiction = asText(hit.jurisdiction)?.toUpperCase() ?? "";
      const id = asText(hit.native_id);
      if (!stateByUsps.has(jurisdiction) || !id) return [];
      return [
        {
          state: jurisdiction,
          kind: "projection" as const,
          id,
          citation: asText(hit.citation),
          heading: asText(hit.heading) ?? id,
          code: null,
          chapterId: null,
          titleValue: null,
          chapterLabel: null,
          datasetId: null,
        },
      ];
    }),
  };
}

function parseOutlineSections(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const section = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const id = section ? asText(section["native_id"]) : null;
    if (!section || !id) return [];
    return [
      {
        native_id: id,
        citation: asText(section["citation"]),
        heading: asText(section["heading"]),
        status_note: asText(section["status_note"]),
      },
    ];
  });
}

function parseOutline(value: unknown): ProjectedOutline {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!row || row["available"] !== true) return { available: false };
  if (row["kind"] === "sections" && Array.isArray(row["sections"])) {
    const sections = parseOutlineSections(row["sections"]);
    return {
      available: true,
      kind: "sections",
      level: "section",
      total: typeof row["total"] === "number" ? row["total"] : sections.length,
      truncated: row["truncated"] === true,
      sections,
    };
  }
  if (
    row["kind"] === "groups" &&
    Array.isArray(row["groups"]) &&
    typeof row["level"] === "string"
  ) {
    const directSections = parseOutlineSections(row["direct_sections"]);
    return {
      available: true,
      kind: "groups",
      level: row["level"],
      total: typeof row["total"] === "number" ? row["total"] : row["groups"].length,
      truncated: row["truncated"] === true,
      groups: row["groups"].flatMap((item) => {
        const group = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
        if (!group || typeof group["count"] !== "number") return [];
        return [
          {
            number: asText(group["number"]),
            heading: asText(group["heading"]),
            count: group["count"],
          },
        ];
      }),
      directSections,
      directTotal:
        typeof row["direct_total"] === "number" ? row["direct_total"] : directSections.length,
      directTruncated: row["direct_truncated"] === true,
    };
  }
  return { available: false };
}

export async function projectedOutline(
  state: string,
  path: HierarchyStep[],
): Promise<ProjectedOutline> {
  const value = await rpcPostOptional<unknown>("corpus_publisher_code_projected_outline_v2", {
    p_jurisdiction: state,
    p_path: path.map((step) => ({ level: step.level, number: step.number })),
  });
  return parseOutline(value);
}

export async function projectedSection(
  state: string,
  id: string,
): Promise<(SectionFields & { id: string }) | null> {
  const row = await rpcPostOptional<Record<string, unknown> | null>(
    "corpus_publisher_code_projected_section_v2",
    { p_jurisdiction: state, p_native_id: id },
  );
  if (!row || typeof row["native_id"] !== "string") return null;
  const fields = sectionFieldsFromRecord({
    title: asText(row["citation"]),
    source_url: asText(row["source_url"]),
    detail: {
      citation: row["citation"],
      heading: row["heading"],
      text: row["text"],
      history: row["history"],
      status_note: row["status_note"],
      currency: row["currency"],
    },
  });
  return { id: row["native_id"], ...fields };
}

export type PublicStatuteSection = {
  nativeId: string;
  citationPath: string;
  heading: string | null;
  text: string | null;
  sourceUrl: string | null;
  currency: string | null;
  status: string | null;
};

let publicStatesCache: { at: number; states: Set<string> } | null = null;

async function publicProjectionStates(): Promise<Set<string>> {
  if (publicStatesCache && Date.now() - publicStatesCache.at < CATALOG_TTL)
    return publicStatesCache.states;
  const rows = await rpcPostOptional<{ jurisdiction?: unknown }[]>(
    "corpus_publisher_code_projected_states_v2",
    {},
  );
  const states = new Set<string>();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const state = asText(row?.jurisdiction)?.toUpperCase();
      if (state) states.add(state);
    }
  }
  publicStatesCache = { at: Date.now(), states };
  return states;
}

function projectedStatuteSection(
  usps: string,
  row: Record<string, unknown> | null,
  accept: (citationPath: string) => boolean,
): PublicStatuteSection | null {
  if (!row) return null;
  const citationPath = asText(row["citation_path"]);
  const nativeId = asText(row["native_id"]);
  if (!citationPath || !nativeId || nativeId !== `${usps}:${citationPath}`) return null;
  if (!accept(citationPath)) return null;
  const fields = sectionFieldsFromRecord({
    title: asText(row["citation"]),
    source_url: asText(row["source_url"]),
    detail: {
      citation: row["citation"],
      heading: row["heading"],
      text: row["text"],
      history: row["history"],
      status_note: row["status_note"],
      currency: row["currency"],
    },
  });
  return {
    nativeId,
    citationPath,
    heading: fields.heading,
    text: publishedSectionBody(fields),
    sourceUrl: fields.sourceUrl,
    currency: fields.currency,
    status: fields.status,
  };
}

/**
 * Public sections named by a limitations citation.
 * A token whose native id is `ST:<token>` is that section.
 * Any other token links only when it equals the last path segment after `sec_`,
 * the final hyphen segment, or the stored section number, and exactly one published section matches.
 */
export async function publicStatuteSections(
  state: string,
  citation: string,
): Promise<PublicStatuteSection[]> {
  const usps = state.toUpperCase();
  const paths = exactCitationPaths(usps, citation);
  if (!paths?.length) return [];
  if (!(await publicProjectionStates()).has(usps)) return [];
  const sections: PublicStatuteSection[] = [];
  for (const token of paths) {
    const nativeId = `${usps}:${token}`;
    const direct = projectedStatuteSection(
      usps,
      await rpcPostOptional<Record<string, unknown> | null>(
        "corpus_publisher_code_projected_section_v2",
        { p_jurisdiction: usps, p_native_id: nativeId },
      ),
      (citationPath) => citationPath === token,
    );
    if (direct) {
      sections.push(direct);
      continue;
    }
    const numberedRow = await rpcPostOptional<Record<string, unknown> | null>(
      "corpus_publisher_code_projected_section_for_token_v2",
      { p_jurisdiction: usps, p_token: token },
    );
    const numberedPath = numberedRow ? asText(numberedRow["citation_path"]) : null;
    if (
      !numberedPath ||
      !tokenEqualsStoredSection(
        token,
        numberedPath,
        storedSectionNumbers(numberedRow?.["hierarchy"]),
        storedHierarchyNumbers(numberedRow?.["hierarchy"], "title"),
      )
    ) {
      continue;
    }
    const numbered = projectedStatuteSection(usps, numberedRow, () => true);
    if (numbered) sections.push(numbered);
  }
  return sections;
}

export type StateCodeCoverageRow = {
  state: string;
  name: string;
  status: ReturnType<typeof coverageStatus>;
  reviewStatus: string | null;
  sections: number | null;
  publisher: string | null;
  edition: string | null;
  currency: string | null;
  contract: string | null;
};

export async function stateCodeCoverage(): Promise<StateCodeCoverageRow[]> {
  const payload = await rpcPost<{ states?: unknown }>("corpus_publisher_code_coverage_v2", {
    p_recount: false,
  });
  const landed = new Map<string, Record<string, unknown>>();
  if (Array.isArray(payload.states)) {
    for (const item of payload.states) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const state = asText(row["jurisdiction"])?.toUpperCase();
      if (state) landed.set(state, row);
    }
  }
  const known = new Set(STATES.map((item) => item.usps));
  const extras = [...landed.keys()].filter((state) => !known.has(state)).sort();
  return [...STATES.map((item) => item.usps), ...extras].map((state) => {
    const row = landed.get(state);
    const place = stateByUsps.get(state);
    return {
      state,
      name: place?.name ?? state,
      status: coverageStatus(
        row ? { public_projection_allowed: row["public_projection_allowed"] === true } : null,
      ),
      reviewStatus: row ? asText(row["review_status"]) : null,
      sections: row && typeof row["sections"] === "number" ? row["sections"] : null,
      publisher: row ? asText(row["publisher"]) : null,
      edition: row ? projectedEdition(row["currency"]) : null,
      currency: row ? projectedCurrency(row["currency"]) : null,
      contract: row ? asText(row["contract"]) : null,
    };
  });
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
  const projected = await searchProjection(q, state);
  return {
    hits: [...projected.hits, ...groups.flatMap((group) => group.hits)].slice(0, SEARCH_LIMIT),
    total: projected.total + groups.reduce((sum, group) => sum + group.total, 0),
  };
}

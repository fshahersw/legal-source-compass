/**
 * Server-only data access for matter pages. ONE module reads the corpus; the UI never touches REST directly.
 *
 * Sources: the public read model (`mdls`, `mdl_case_inventory`, `mdl_docket_activity`, `mdl_docket_documents`,
 * `mdl_counsel`, `mdl_appearances`, `cl_master_entries`, `cl_docket_metadata`, `jpml_html_reference`), the verified PDF
 * registry through `corpus_matter_pdf_*_v1`, and the Seeger Weiss matter registry projection (`sw_matters_v1`,
 * `sw_matter_dockets_v1`; contract in _work/contracts/sw-matter-registry.md) which supplies explicit provider case ids
 * and evidence-backed member dockets for the matters it covers. A matter the registry does not cover keeps working
 * from the derived keys, labelled "derived". Datasets that are not published (`corpus_datasets.ready = false`) are
 * never read.
 */
import { restGet, rpcPost } from "@/lib/external/rest.server";
import {
  CASE_PAGE_SIZE,
  computeFacets,
  masterCase,
  mergeCases,
  pageCases,
  parseFjcCase,
  parseInventoryCase,
  type CaseFilter,
  type CaseRow,
  type CaseSort,
  type RegistryLabels,
} from "./cases";
import { matterCaseKeys } from "./docketKeys";
import {
  deduplicateDocuments,
  describeDocument,
  documentCopies,
  pageDocuments,
  parseRegistryDocument,
  parseRegistrySummary,
  type DocumentFilter,
  type DocumentSort,
  type MatterDocument,
  type RegistrySummary,
} from "./documents";
import { pageFromEnd, parseActivityEntry, parseClEntry, type DocketEntry } from "./entries";
import { parseMdlDetail } from "./overview";
import {
  parseAppearanceRow,
  parseCounselRow,
  type AppearanceRow,
  type CounselRow,
  type PartyKind,
} from "./parties";
import {
  caseIdPlan,
  isRegistryRowOf,
  newerJpmlCounts,
  parseRegistryDocket,
  parseRegistryDocketDetail,
  pdfLookupCaseIds,
  overviewFromRegistry,
  parseRegistryLabels,
  parseRegistryRecord,
  registryMetrics,
  withRegistryJpml,
  type CaseIdPlanEntry,
  type RegistryDocketDetail,
  type RegistryMatter,
} from "./registry";
import {
  buildArchiveIndex,
  matchEntryDocuments,
  parseRegistryEntry,
  timelinePath,
  type ArchiveIndex,
  type EntryArchive,
  type EntryWithheld,
  type TimelineFilter,
} from "./timeline";
import {
  buildPartiesModel,
  groupParties,
  parseRegistryPartyRow,
  pickFirms,
  pickParties,
  type ParsedPartyRow,
  type PartiesModel,
} from "./registryParties";
import { SW_MATTERS } from "./tiers";
import type {
  AppearancesPayload,
  CaseDocumentsPayload,
  CasesScope,
  EntriesPayload,
  FjcCasesPage,
  HubRow,
  JpmlReference,
  LegacyDocument,
  MasterDocketMeta,
  MatterCasesPageResponse,
  MatterOverviewPayload,
  PartiesPayload,
  RegistryCounselList,
  RegistryDocumentsPayload,
  RegistryPartiesList,
  RegistryDocumentsPageResponse,
  RegistryPartiesSummary,
  TimelineArchivePayload,
  TimelinePayload,
} from "./types";

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/* ------------------------------------------------------------------ publication */

const MATTER_DATASETS = [
  "mdls",
  "mdl_case_inventory",
  "mdl_docket_activity",
  "mdl_docket_documents",
  "mdl_counsel",
  "mdl_appearances",
  "cl_master_entries",
  "cl_docket_metadata",
  "jpml_html_reference",
  "sw_matters_v1",
  "sw_matter_dockets_v1",
  // Planned and held until the owner decides; read only if/when they are released (corpus_datasets.ready).
  "sw_matter_entries_v1",
  "sw_docket_entries_v1",
  "sw_matter_parties_v1",
] as const;
type MatterDataset = (typeof MATTER_DATASETS)[number];

let readyCache: { at: number; ready: Set<string> } | null = null;

/** Published (ready) datasets among the ones matter pages use; cached briefly. */
async function publishedDatasets(): Promise<Set<string>> {
  if (readyCache && Date.now() - readyCache.at < 60_000) return readyCache.ready;
  const r = await restGet<{ id: string; ready: boolean }[]>(
    `corpus_datasets?select=id,ready&id=in.(${MATTER_DATASETS.join(",")})`,
  );
  const ready = new Set(r.rows.filter((d) => d.ready === true).map((d) => d.id));
  readyCache = { at: Date.now(), ready };
  return ready;
}

async function isPublished(dataset: MatterDataset): Promise<boolean> {
  return (await publishedDatasets()).has(dataset);
}

const enc = encodeURIComponent;
const containsMdl = (mdl: string) => enc(JSON.stringify({ mdl: [mdl] }));

/* ------------------------------------------------------------------ overview */

async function loadMasterMeta(clDocketId: string | null): Promise<MasterDocketMeta | null> {
  if (!clDocketId || !/^[1-9]\d*$/.test(clDocketId) || !(await isPublished("cl_docket_metadata")))
    return null;
  const r = await restGet<{ item: unknown }[]>(
    `corpus_records?select=item&dataset=eq.cl_docket_metadata&id=eq.${enc(`cl:dockets:${clDocketId}`)}&limit=1`,
  );
  const item = r.rows[0]?.item;
  const cells = isObj(item) && isObj(item["cells"]) ? item["cells"] : null;
  if (!cells) return null;
  return {
    docketNumber: str(cells["docket_number"]),
    courtId: str(cells["court_id"]),
    dateFiled: str(cells["date_filed"]),
    dateTerminated: str(cells["date_terminated"]),
    dateLastFiling: str(cells["date_last_filing"]),
    sourceAsOf: str(cells["source_as_of"]),
    sourceCheckedAt: str(cells["source_checked_at"]),
  };
}

async function loadJudgeProfile(
  entityId: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!entityId || !/^judge-entity-[a-f0-9]{8,64}$/.test(entityId)) return null;
  const r = await restGet<{ id: string; title: string | null }[]>(
    `corpus_records?select=id,title&dataset=eq.judges&detail->>entity_id=eq.${enc(entityId)}&limit=3`,
  );
  // Linked only when exactly one judge profile carries that native entity id.
  return r.rows.length === 1 && r.rows[0]
    ? { id: r.rows[0].id, name: r.rows[0].title ?? r.rows[0].id }
    : null;
}

/** The `judges` profile with exactly this id (the id the data-quality passes linked to the MDL), if it exists. */
async function loadJudgeProfileById(
  profileId: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!profileId || !/^[A-Za-z0-9_-]{6,80}$/.test(profileId)) return null;
  const r = await restGet<{ id: string; title: string | null }[]>(
    `corpus_records?select=id,title&dataset=eq.judges&id=eq.${enc(profileId)}&limit=1`,
  );
  const row = r.rows[0];
  return row ? { id: row.id, name: row.title ?? row.id } : null;
}

async function loadJpmlReferences(mdl: string): Promise<JpmlReference[]> {
  if (!(await isPublished("jpml_html_reference"))) return [];
  const r = await restGet<
    { id: string; title: string | null; source_url: string | null; kind: string | null }[]
  >(
    `corpus_records?select=id,title,source_url,kind:filters->>kind&dataset=eq.jpml_html_reference&filters->>mdl_number=eq.${enc(mdl)}&order=id.asc&limit=40`,
  );
  const out: JpmlReference[] = [];
  for (const row of r.rows) {
    const url = str(row.source_url);
    if (!url || !/^https:\/\//i.test(url)) continue;
    out.push({ id: row.id, kind: row.kind ?? "reference", title: row.title ?? row.id, url });
  }
  return out;
}

/* ------------------------------------------------------------------ matter registry */

/** The matter registry's record for this MDL; null when the registry is not published or holds no record for it. */
export async function loadRegistryMatter(mdl: string): Promise<RegistryMatter | null> {
  if (!(await isPublished("sw_matters_v1"))) return null;
  const r = await restGet<{ title: unknown; cells: unknown; facts: unknown; registry: unknown }[]>(
    `corpus_records?select=title,cells:item->cells,facts:detail->facts,registry:detail->registry&dataset=eq.sw_matters_v1&id=eq.${enc(`sw-matter:${mdl}`)}&limit=1`,
  );
  const row = r.rows[0];
  return row ? parseRegistryRecord(row, mdl) : null;
}

let labelsCache: { at: number; labels: RegistryLabels } | null = null;

/** Evidence-kind and role labels as the registry dataset itself publishes them; the static map is the fallback. */
async function registryLabels(): Promise<RegistryLabels> {
  if (labelsCache && Date.now() - labelsCache.at < 5 * 60_000) return labelsCache.labels;
  let labels: RegistryLabels = {};
  try {
    const r = await restGet<{ metadata: unknown }[]>(
      "corpus_datasets?select=metadata&id=eq.sw_matter_dockets_v1&limit=1",
    );
    labels = parseRegistryLabels(r.rows[0]?.metadata);
  } catch {
    labels = {};
  }
  labelsCache = { at: Date.now(), labels };
  return labels;
}

const REGISTRY_DOCKET_PAGE = 1000;
const REGISTRY_DOCKET_CAP = 3000;

/** Listing rows of the registry's docket projection for one MDL (evidence rows are fetched per docket on demand). */
async function loadRegistryDockets(
  mdl: string,
): Promise<{ rows: CaseRow[]; total: number; truncated: boolean }> {
  const rows: CaseRow[] = [];
  let total: number | null = null;
  for (let from = 0; from < REGISTRY_DOCKET_CAP; from += REGISTRY_DOCKET_PAGE) {
    const r = await restGet<
      { id: string; cells: unknown; links: unknown; badges: unknown; filters: unknown }[]
    >(
      `corpus_records?select=id,cells:item->cells,links:item->links,badges:item->badges,filters&dataset=eq.sw_matter_dockets_v1&filters->>mdl=eq.${enc(mdl)}&order=ordinal.asc,id.asc`,
      { count: true, range: [from, from + REGISTRY_DOCKET_PAGE - 1] },
    );
    if (total === null) total = r.total;
    for (const row of r.rows) {
      const parsed = parseRegistryDocket({
        id: row.id,
        item: { cells: row.cells, links: row.links, badges: row.badges },
        filters: row.filters,
      });
      if (parsed) rows.push(parsed);
    }
    if (r.rows.length < REGISTRY_DOCKET_PAGE) break;
  }
  const exact = total ?? rows.length;
  return { rows, total: exact, truncated: rows.length < exact };
}

/** The evidence behind one registry docket (the drawer); null unless the row belongs to this MDL. */
export async function loadRegistryDocketDetail(
  mdl: string,
  rowId: string,
): Promise<RegistryDocketDetail | null> {
  if (!isRegistryRowOf(rowId, mdl) || !(await isPublished("sw_matter_dockets_v1"))) return null;
  const r = await restGet<{ detail: unknown }[]>(
    `corpus_records?select=detail&dataset=eq.sw_matter_dockets_v1&id=eq.${enc(rowId)}&limit=1`,
  );
  return parseRegistryDocketDetail(r.rows[0]?.detail);
}

const overviewCache = new Map<string, { at: number; value: MatterOverviewPayload | null }>();

/** The overview, cached for a minute so the tab loaders that need it do not each re-read the 70 KB MDL record. */
export async function overviewFor(mdl: string): Promise<MatterOverviewPayload | null> {
  const hit = overviewCache.get(mdl);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const value = await loadMatterOverview(mdl);
  if (overviewCache.size > 200) overviewCache.clear();
  overviewCache.set(mdl, { at: Date.now(), value });
  return value;
}

export async function loadMatterOverview(mdl: string): Promise<MatterOverviewPayload | null> {
  const registryRead = loadRegistryMatter(mdl).catch(() => null);
  let fromDirectory: ReturnType<typeof parseMdlDetail> = null;
  if (await isPublished("mdls")) {
    const raw = await rpcPost<unknown>("corpus_detail", {
      p_id: mdl,
      p_datasets: ["mdls"],
      p_full: false,
    });
    const p = parseMdlDetail(raw);
    fromDirectory = p && p.mdl === mdl ? p : null;
  }
  const registry = await registryRead;
  // An MDL the JPML directory does not hold (a closed matter, say) is still a matter page when the registry has it.
  const parsed = fromDirectory ?? (registry ? overviewFromRegistry(registry) : null);
  if (!parsed) return null;
  const [master, judgeProfile, jpmlReferences] = await Promise.all([
    loadMasterMeta(parsed.masterDocket.clDocketId).catch(() => null),
    // The profile id on the MDL record first; the older native-id entity lookup only when the record carries none.
    loadJudgeProfileById(parsed.judge.profileId)
      .then(
        (p) =>
          p ?? (parsed.judge.nativeIdEvidence ? loadJudgeProfile(parsed.judge.entityId) : null),
      )
      .catch(() => null),
    loadJpmlReferences(mdl).catch(() => []),
  ]);
  const sw = SW_MATTERS.find((m) => String(m.mdl) === mdl) ?? null;
  // Entries and parties are planned/held; once a dataset is released the generic browser can list its rows.
  const ready = await publishedDatasets().catch(() => new Set<string>());
  const released = (...ids: MatterDataset[]) => ids.find((id) => ready.has(id)) ?? null;
  return {
    overview: withRegistryJpml(parsed, registry),
    master,
    judgeProfile,
    jpmlReferences,
    sw: { tier: sw?.tier ?? null, shortName: sw?.shortName ?? null },
    registry,
    registryReleased: {
      entries: released("sw_matter_entries_v1", "sw_docket_entries_v1"),
      parties: released("sw_matter_parties_v1"),
    },
  };
}

/* ------------------------------------------------------------------ cases */

/** The merged member-case list of one matter plus how it was assembled; built once and cached on the server. */
type CasesState = { rows: CaseRow[]; scope: CasesScope };

async function buildCasesState(payload: MatterOverviewPayload): Promise<CasesState> {
  const { overview, master } = payload;
  const rows: CaseRow[] = [];
  const m = masterCase({
    clDocketId: overview.masterDocket.clDocketId,
    docketNumber: master?.docketNumber ?? overview.masterDocket.number,
    courtId: master?.courtId ?? overview.court.clId,
    dateFiled: master?.dateFiled ?? overview.dates.filed,
    dateTerminated: master?.dateTerminated ?? overview.dates.closed,
    title: overview.title,
  });
  if (m) rows.push(m);

  // The three sources are independent, so they are read at the same time.
  const registryRead = (async () => {
    if (!(await isPublished("sw_matter_dockets_v1"))) return null;
    try {
      const [reg, labels] = await Promise.all([
        loadRegistryDockets(overview.mdl),
        registryLabels(),
      ]);
      return reg.total > 0 || reg.rows.length > 0 ? { ...reg, labels } : null;
    } catch {
      return null;
    }
  })();
  const inventoryRead = (async () => {
    if (!(await isPublished("mdl_case_inventory"))) return null;
    const r = await restGet<{ id: string; item: unknown; facts: unknown }[]>(
      `corpus_records?select=id,item,facts:detail->facts&dataset=eq.mdl_case_inventory&filters=cs.${containsMdl(overview.mdl)}&order=ordinal.asc,id.asc&limit=1000`,
    );
    return r.rows.flatMap((row) => parseInventoryCase(row.item, row.facts) ?? []);
  })();
  const fjcRead = (async (): Promise<CasesScope["fjc"]> =>
    (await isPublished("cl_docket_metadata"))
      ? { total: await exactFjcCount(overview.mdl, null), capped: false }
      : null)();
  const [registry, inventory, fjc] = await Promise.all([registryRead, inventoryRead, fjcRead]);
  if (registry) rows.push(...registry.rows);
  if (inventory) rows.push(...inventory);

  const merged = mergeCases(rows);
  const facets = computeFacets(merged, registry?.labels);
  return {
    rows: merged,
    scope: {
      listed: merged.length,
      registryRows: registry ? registry.total : 0,
      registryTruncated: registry ? registry.truncated : false,
      labels: registry?.labels,
      inventoryPublished: inventory !== null,
      inventoryTotal: inventory ? inventory.length : 0,
      roles: facets.role,
      actionRows: facets.actionRows,
      fjc,
    },
  };
}

const casesCache = new Map<string, { at: number; state: Promise<CasesState> }>();
const CASES_TTL_MS = 5 * 60_000;
const CASES_CACHE_MAX = 12;

/**
 * The matter's merged list, cached for five minutes (concurrent callers share one read; a failed read is not cached).
 * Only a page of it ever leaves the server.
 */
function casesStateFor(payload: MatterOverviewPayload): Promise<CasesState> {
  const key = payload.overview.mdl;
  const hit = casesCache.get(key);
  if (hit && Date.now() - hit.at < CASES_TTL_MS) return hit.state;
  const state = buildCasesState(payload);
  casesCache.set(key, { at: Date.now(), state });
  state.catch(() => {
    if (casesCache.get(key)?.state === state) casesCache.delete(key);
  });
  while (casesCache.size > CASES_CACHE_MAX) {
    const oldest = casesCache.keys().next().value;
    if (oldest === undefined) break;
    casesCache.delete(oldest);
  }
  return state;
}

/** One page of the matter's member cases, filtered and sorted on the server. */
export async function loadCasesPage(
  payload: MatterOverviewPayload,
  filter: CaseFilter,
  sort: CaseSort,
  offset: number,
): Promise<MatterCasesPageResponse> {
  const state = await casesStateFor(payload);
  return {
    ...pageCases(state.rows, filter, sort, offset, CASE_PAGE_SIZE, state.scope.labels),
    scope: state.scope,
  };
}

/** The composition of the list without any row (overview tiles). */
export async function loadCasesScope(payload: MatterOverviewPayload): Promise<CasesScope> {
  return (await casesStateFor(payload)).scope;
}

/** Exact (uncapped) number of cl_docket_metadata rows selected by an FJC MDL number, optionally in one exact court. */
async function exactFjcCount(mdl: string, court: string | null): Promise<number | null> {
  try {
    const r = await restGet<unknown[]>(
      `corpus_records?select=id&dataset=eq.cl_docket_metadata&filters->>mdl_number=eq.${enc(mdl)}${court ? `&filters->>court_id=eq.${enc(court)}` : ""}&limit=1`,
      { count: true, range: [0, 0] },
    );
    return r.total;
  } catch {
    return null;
  }
}

export async function loadFjcCases(
  mdl: string,
  offset: number,
  court: string | null,
): Promise<FjcCasesPage> {
  const pageSize = 50;
  const filters: Record<string, string> = { mdl_number: mdl };
  if (court) filters["court_id"] = court;
  const [res, exact] = await Promise.all([
    boundedItems("cl_docket_metadata", filters, "", pageSize, offset, 100000),
    exactFjcCount(mdl, court),
  ]);
  const rows = (res.items ?? []).map((i) => parseFjcCase(i)).filter((r): r is CaseRow => !!r);
  const total = exact ?? (typeof res.total === "number" ? res.total : null);
  return { rows, total, capped: exact === null && !!res.total_capped, offset, pageSize };
}

/* ------------------------------------------------------------------ docket entries */

async function boundedItems(
  dataset: string,
  filters: Record<string, string>,
  q: string,
  limit: number,
  offset: number,
  cap: number,
) {
  return rpcPost<{ items: unknown[] | null; total: number | null; total_capped: boolean }>(
    "corpus_query_bounded",
    {
      p_dataset: dataset,
      p_filters: filters,
      p_q: q.trim() ? q.trim() : null,
      p_limit: limit,
      p_offset: offset,
      p_count_cap: cap,
    },
  );
}

const clProbeCache = new Map<string, { at: number; total: number | null; last: string | null }>();

/** Entry count and newest filing date of a master docket's CourtListener list, cached for a minute. */
async function probeClEntries(
  clDocket: string,
): Promise<{ total: number | null; last: string | null }> {
  const hit = clProbeCache.get(clDocket);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  const probe = await boundedItems(
    "cl_master_entries",
    { native_docket_id: clDocket },
    "",
    1,
    0,
    100000,
  );
  const total = typeof probe.total === "number" && probe.total > 0 ? probe.total : null;
  let last: string | null = null;
  if (total) {
    const tail = await boundedItems(
      "cl_master_entries",
      { native_docket_id: clDocket },
      "",
      1,
      total - 1,
      100000,
    );
    last = parseClEntry(tail.items?.[0])?.date ?? null;
  }
  if (clProbeCache.size > 200) clProbeCache.clear();
  clProbeCache.set(clDocket, { at: Date.now(), total, last });
  return { total, last };
}

export async function loadEntries(
  payload: MatterOverviewPayload,
  opts: {
    source: "activity" | "cl_entries" | "auto";
    type: string | null;
    q: string;
    offset: number;
  },
): Promise<EntriesPayload> {
  const { overview } = payload;
  const pageSize = 50;
  const activityPublished = await isPublished("mdl_docket_activity");
  const clPublished = await isPublished("cl_master_entries");
  const clDocket = overview.masterDocket.clDocketId;

  const activityTotal = activityPublished ? (overview.activity?.total ?? null) : null;
  let clTotal: number | null = null;
  let clLast: string | null = null;
  if (clPublished && clDocket) ({ total: clTotal, last: clLast } = await probeClEntries(clDocket));
  const available = {
    activity: activityTotal && activityTotal > 0 ? activityTotal : null,
    clEntries: clTotal,
  };
  const coverage = { activityLast: overview.activity?.dateLast ?? null, clLast };
  const source: "activity" | "cl_entries" =
    opts.source === "activity" && available.activity
      ? "activity"
      : opts.source === "cl_entries" && available.clEntries
        ? "cl_entries"
        : available.activity
          ? "activity"
          : "cl_entries";

  if (source === "activity") {
    const filters: Record<string, string> = { mdl: overview.mdl };
    if (opts.type && /^[a-z0-9_]{1,60}$/.test(opts.type)) filters["entry_type"] = opts.type;
    const res = await boundedItems(
      "mdl_docket_activity",
      filters,
      opts.q,
      pageSize,
      opts.offset,
      10000,
    );
    const entries = (res.items ?? [])
      .map((i) => parseActivityEntry(i))
      .filter((e): e is DocketEntry => !!e);
    return {
      source,
      entries,
      total: res.total,
      capped: !!res.total_capped,
      offset: opts.offset,
      pageSize,
      available,
      coverage,
    };
  }
  if (!clDocket || !clTotal) {
    return {
      source,
      entries: [],
      total: null,
      capped: false,
      offset: opts.offset,
      pageSize,
      available,
      coverage,
    };
  }
  const pageIndex = Math.floor(opts.offset / pageSize);
  const { start, length } = pageFromEnd(clTotal, pageIndex, pageSize);
  const res =
    length > 0
      ? await boundedItems(
          "cl_master_entries",
          { native_docket_id: clDocket },
          "",
          length,
          start,
          100000,
        )
      : { items: [] };
  const entries = (res.items ?? [])
    .map((i) => parseClEntry(i))
    .filter((e): e is DocketEntry => !!e)
    .reverse();
  return {
    source,
    entries,
    total: clTotal,
    capped: false,
    offset: opts.offset,
    pageSize,
    available,
    coverage,
  };
}

/** Verbatim docket text for one saved-sample entry (the dataset's own detail section). */
export async function loadEntryText(entryId: string): Promise<{ text: string | null }> {
  if (!(await isPublished("mdl_docket_activity"))) return { text: null };
  const d = await rpcPost<unknown>("corpus_detail", {
    p_id: entryId,
    p_datasets: ["mdl_docket_activity"],
    p_full: false,
  });
  if (!isObj(d) || !Array.isArray(d["sections"])) return { text: null };
  for (const s of d["sections"])
    if (isObj(s) && typeof s["text"] === "string" && s["text"].trim()) return { text: s["text"] };
  return { text: null };
}

/* ------------------------------------------------------------------ documents */

/** The most archive rows read for one matter (the largest, MDL 3047, holds about 8,200; the server keeps them, the browser gets pages). */
const REGISTRY_ROW_CAP = 20_000;
const REGISTRY_PAGE = 500;

type RegistryDocsCache = Map<string, { at: number; value: Promise<RegistryDocumentsPayload> }>;
/** Totals are tiny and asked for often; the row lists are large, so few are kept and for longer. */
const registrySummaryCache: RegistryDocsCache = new Map();
const registryRowsCache: RegistryDocsCache = new Map();
/** A member docket's drawer reads a short list of its own; kept apart so it never evicts a matter's list. */
const drawerDocsCache: RegistryDocsCache = new Map();

function cachedRegistryRead(
  cache: RegistryDocsCache,
  ttl: number,
  max: number,
  key: string,
  read: () => Promise<RegistryDocumentsPayload>,
): Promise<RegistryDocumentsPayload> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = read();
  cache.set(key, { at: Date.now(), value });
  // An unconnected reader or a failed read is not worth remembering.
  value.then(
    (v) => {
      if (!v.connected && cache.get(key)?.value === value) cache.delete(key);
    },
    () => {
      if (cache.get(key)?.value === value) cache.delete(key);
    },
  );
  while (cache.size > max) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return value;
}

/**
 * Verified-PDF registry rows for a matter's provider case ids (the matter registry's explicit ids first, derived
 * keys as a labelled supplement); degrades to `connected:false` if the reader is absent. The Documents tab, the header
 * numbers, the timeline's archive lookup and the drawers ask for the same lists, so results are cached (totals three
 * minutes, row lists ten, at most six lists), concurrent callers share one read, and the pages after the first are
 * read four at a time.
 */
export function loadRegistryDocuments(
  caseIds: CaseIdPlanEntry[],
  summaryOnly = false,
): Promise<RegistryDocumentsPayload> {
  return summaryOnly
    ? cachedRegistryRead(
        registrySummaryCache,
        3 * 60_000,
        80,
        caseIds.map((c) => c.id).join(","),
        () => readRegistryDocuments(caseIds, true),
      )
    : cachedRegistryRead(
        registryRowsCache,
        10 * 60_000,
        6,
        caseIds.map((c) => c.id).join(","),
        () => readRegistryDocuments(caseIds, false),
      );
}

async function readRegistryDocuments(
  caseIds: CaseIdPlanEntry[],
  summaryOnly: boolean,
  rowCap: number = REGISTRY_ROW_CAP,
): Promise<RegistryDocumentsPayload> {
  if (!caseIds.length) {
    return {
      connected: false,
      reason: "No native case id is recorded or derivable for this matter's master docket.",
      caseIds,
    };
  }
  const caseKeys = caseIds.map((c) => c.id);
  const readPage = async (offset: number, limit: number) => {
    const page = await rpcPost<unknown>("corpus_matter_pdf_documents_v1", {
      p_native_case_ids: caseKeys,
      p_limit: limit,
      p_offset: offset,
    });
    if (!isObj(page)) throw new Error("Unexpected registry response");
    const raw = Array.isArray(page["rows"]) ? page["rows"] : [];
    const parsed = raw
      .map((r) => parseRegistryDocument(r))
      .filter((r): r is NonNullable<typeof r> => !!r)
      // A row is accepted only if its case id is exactly one of the ids asked for.
      .filter((r) => r.nativeCaseId !== null && caseKeys.includes(r.nativeCaseId))
      .map(describeDocument);
    return { summary: page["summary"], parsed, rawCount: raw.length };
  };
  try {
    const first = await readPage(0, summaryOnly ? 1 : REGISTRY_PAGE);
    const summary = parseRegistrySummary(first.summary, first.parsed);
    if (summaryOnly)
      return {
        connected: true,
        summary,
        rows: [],
        sourceRecordsLoaded: 0,
        sourceRecordsExcluded: 0,
        truncated: false,
        caseIds,
      };
    const rows: MatterDocument[] = [...first.parsed];
    let sourceRecordsLoaded = first.rawCount;
    const offsets: number[] = [];
    for (let o = REGISTRY_PAGE; o < Math.min(summary.total, rowCap); o += REGISTRY_PAGE)
      offsets.push(o);
    for (const page of await mapLimit(offsets, 4, (o) => readPage(o, REGISTRY_PAGE))) {
      rows.push(...page.parsed);
      sourceRecordsLoaded += page.rawCount;
    }
    // Pagination and completeness are measured in source records. Only after every
    // requested page is read can byte-identical files be grouped for presentation.
    return {
      connected: true,
      summary,
      rows: deduplicateDocuments(rows),
      sourceRecordsLoaded,
      sourceRecordsExcluded: sourceRecordsLoaded - rows.length,
      truncated: sourceRecordsLoaded < summary.total || rows.length < sourceRecordsLoaded,
      caseIds,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      connected: false,
      reason: /\((404|400)\)/.test(message)
        ? "The verified PDF registry reader is not installed on the corpus database."
        : "The verified PDF registry could not be read.",
      caseIds,
    };
  }
}

/**
 * One page of a matter's verified PDFs, filtered, sorted, counted and faceted on the server over the cached list. The
 * open document of the viewer (`viewKey`, "<source>|<native document id>") is found in the whole list.
 */
export async function loadDocumentsPage(
  payload: MatterOverviewPayload,
  filter: DocumentFilter,
  sort: DocumentSort,
  offset: number,
  viewKey: string | null,
): Promise<RegistryDocumentsPageResponse> {
  const docs = await loadRegistryDocuments(caseIdPlan(payload.registry, payload.overview.keys.all));
  if (!docs.connected) return docs;
  const viewed = viewKey
    ? (docs.rows
        .flatMap(documentCopies)
        .find((d) => `${d.sourceSystem}|${d.nativeDocumentId}` === viewKey) ?? null)
    : null;
  return {
    connected: true,
    summary: docs.summary,
    truncated: docs.truncated,
    caseIds: docs.caseIds,
    loaded: docs.rows.length,
    sourceRecordsLoaded: docs.sourceRecordsLoaded,
    sourceRecordsExcluded: docs.sourceRecordsExcluded,
    page: pageDocuments(docs.rows, filter, sort, offset),
    viewed,
  };
}

/**
 * The verified PDFs filed under one registry docket's own provider case ids (a member case's drawer). The ids come from
 * the registry row on the server, never from the browser, so a request can only ask for a docket the registry lists.
 */
export async function loadCaseDocuments(
  mdl: string,
  rowId: string,
): Promise<CaseDocumentsPayload | null> {
  if (!isRegistryRowOf(rowId, mdl) || !(await isPublished("sw_matter_dockets_v1"))) return null;
  const r = await restGet<{ ids: unknown }[]>(
    `corpus_records?select=ids:detail->registry->native_case_ids&dataset=eq.sw_matter_dockets_v1&id=eq.${enc(rowId)}&limit=1`,
  );
  if (!r.rows.length) return null;
  const ids = pdfLookupCaseIds(r.rows[0]?.ids);
  if (!ids.length) return { ids, documents: null };
  const plan = ids.map((id) => ({ id, basis: "registry" as const }));
  return {
    ids,
    // The drawer lists at most 100 documents, so a short read is enough; the total comes from the archive's own summary.
    documents: await cachedRegistryRead(drawerDocsCache, 3 * 60_000, 40, ids.join(","), () =>
      readRegistryDocuments(plan, false, 1_000),
    ),
  };
}

/* ------------------------------------------------------------------ timeline (matter registry entries) */

const TIMELINE_PAGE = 50;
const ARCHIVE_TTL_MS = 10 * 60_000;

const archiveCache = new Map<string, { at: number; index: Promise<ArchiveIndex | string> }>();

/**
 * The matter's archive rows (master + JPML docket ids, the same list the Documents tab pages), indexed for exact
 * entry-to-PDF lookups; a string is the reason the archive could not be read. Cached ten minutes, concurrent callers
 * share one read.
 */
function archiveIndexFor(payload: MatterOverviewPayload): Promise<ArchiveIndex | string> {
  const plan = caseIdPlan(payload.registry, payload.overview.keys.all);
  const key = plan.map((c) => c.id).join(",");
  const hit = archiveCache.get(key);
  if (hit && Date.now() - hit.at < ARCHIVE_TTL_MS) return hit.index;
  const index = loadRegistryDocuments(plan).then((docs) =>
    docs.connected ? buildArchiveIndex(docs.rows, !docs.truncated) : docs.reason,
  );
  archiveCache.set(key, { at: Date.now(), index });
  const forget = () => {
    if (archiveCache.get(key)?.index === index) archiveCache.delete(key);
  };
  // A failed or unconnected read is not remembered.
  index.then((v) => (typeof v === "string" ? forget() : undefined), forget);
  while (archiveCache.size > 6) {
    const oldest = archiveCache.keys().next().value;
    if (oldest === undefined) break;
    archiveCache.delete(oldest);
  }
  return index;
}

/**
 * One page of the registry's docket-entry timeline for a matter, newest first. Filtering, counting and paging happen in
 * the database: containment on the indexed filters, the filing date as ISO text, the docket text through the search
 * vector (prefix match on each word), and the dataset's own ordinal, which is chronological.
 */
export async function loadTimeline(
  payload: MatterOverviewPayload,
  filter: TimelineFilter,
  offset: number,
  newestFirst = true,
): Promise<TimelinePayload | null> {
  if (!(await isPublished("sw_docket_entries_v1"))) return null;
  // Every provider of the matter's entries: CourtListener, and for a docket it does not publish GovInfo and the court's
  // own page (those rows are told apart by the provider chip on each entry).
  const start = Math.max(0, Math.floor(offset));
  const r = await restGet<{ id: string; cells: unknown; links: unknown; reg: unknown }[]>(
    timelinePath(payload.overview.mdl, filter, newestFirst),
    { count: true, range: [start, start + TIMELINE_PAGE - 1] },
  );
  const entries = r.rows.flatMap((row) => parseRegistryEntry(row) ?? []);
  return { entries, total: r.total ?? entries.length, offset: start, pageSize: TIMELINE_PAGE };
}

/** One entry of a timeline page as the browser reports it back for the archive lookup. */
export type TimelineArchiveItem = {
  id: string;
  provider: string | null;
  docketKey: string | null;
  entryNumber: number | null;
  withheld: EntryWithheld | null;
  documentIds: string[];
};

/**
 * The archive documents of the entries on one timeline page. Each entry is tied to the archive only by exact keys: the
 * RECAP document ids it lists, and (for the same docket) the DocketBird documents carrying its own entry number.
 */
export async function loadTimelineArchive(
  payload: MatterOverviewPayload,
  items: TimelineArchiveItem[],
): Promise<TimelineArchivePayload> {
  const index = await archiveIndexFor(payload);
  if (typeof index === "string") return { connected: false, reason: index };
  const caseIdFor = (docketKey: string | null): string | null => {
    if (!docketKey) return null;
    const docket = payload.registry?.caseIds.find((c) => c.docketKey === docketKey);
    return docket?.nativeCaseIds.find((n) => n.provider === "docketbird")?.id ?? null;
  };
  const byEntry: Record<string, EntryArchive> = {};
  for (const item of items) {
    byEntry[item.id] = matchEntryDocuments(
      {
        provider: item.provider,
        entryNumber: item.entryNumber,
        withheld: item.withheld,
        documentIds: item.documentIds,
      },
      caseIdFor(item.docketKey),
      index,
    );
  }
  return { connected: true, complete: index.complete, byEntry };
}

export type RegistryObject =
  | { availability: "open"; sha256: string; bytes: number; bucket: string; storageKey: string }
  | { availability: "held" }
  | null;

export async function lookupRegistryObject(source: string, doc: string): Promise<RegistryObject> {
  const raw = await rpcPost<unknown>("corpus_matter_pdf_object_v1", {
    p_source_system: source,
    p_native_document_id: doc,
  });
  if (!isObj(raw)) return null;
  if (raw["availability"] === "held") return { availability: "held" };
  if (raw["availability"] !== "open") return null;
  const sha = str(raw["sha256"]);
  const key = str(raw["storage_key"]);
  const bytes = typeof raw["bytes"] === "number" ? raw["bytes"] : null;
  if (
    !sha ||
    !/^[a-f0-9]{64}$/.test(sha) ||
    !key ||
    bytes === null ||
    raw["bucket"] !== "corpus-originals"
  )
    return null;
  // The storage key must be exactly the content-addressed path for this hash.
  if (key !== `seeger-weiss/pdf-sha256/${sha.slice(0, 2)}/${sha}.pdf`) return null;
  return { availability: "open", sha256: sha, bytes, bucket: "corpus-originals", storageKey: key };
}

/** Streams the stored object, forwarding a Range request. Server-only. */
export async function fetchStoredPdf(storageKey: string, range: string | null): Promise<Response> {
  const url = process.env["EXTERNAL_SUPABASE_URL"];
  const key = process.env["EXTERNAL_SUPABASE_KEY"];
  if (!url || !key) throw new Error("External corpus database is not configured.");
  const headers: Record<string, string> = { apikey: key };
  if (!key.startsWith("sb_")) headers["Authorization"] = `Bearer ${key}`;
  if (range && /^bytes=\d*-\d*$/.test(range)) headers["Range"] = range;
  const path = storageKey.split("/").map(encodeURIComponent).join("/");
  return fetch(`${url.replace(/\/$/, "")}/storage/v1/object/corpus-originals/${path}`, { headers });
}

function legacyFact(facts: unknown, label: RegExp): string | null {
  if (!Array.isArray(facts)) return null;
  for (const f of facts)
    if (Array.isArray(f) && typeof f[0] === "string" && label.test(f[0]))
      return f[1] == null ? null : String(f[1]);
  return null;
}

export function parseLegacyDocument(item: unknown, facts: unknown): LegacyDocument | null {
  if (!isObj(item)) return null;
  const id = str(item["id"]);
  if (!id) return null;
  const cells = isObj(item["cells"]) ? item["cells"] : {};
  const links = Array.isArray(item["links"]) ? item["links"].filter(isObj) : [];
  const urlOf = (test: (u: string) => boolean) => {
    for (const l of links) {
      const u = str(l["url"]);
      if (u && /^https:\/\//i.test(u) && test(u)) return u;
    }
    return null;
  };
  const sealed = (legacyFact(facts, /^Sealed$/i) ?? "").trim().toLowerCase();
  const free = (legacyFact(facts, /^Free document recorded/i) ?? "").trim().toLowerCase();
  const recap = urlOf((u) => /^https:\/\/storage\.courtlistener\.com\/recap\/.+\.pdf$/i.test(u));
  const entry = /^doc:\d+:(\d+):/.exec(id);
  const pages = legacyFact(facts, /^Page count/i);
  const linkable = sealed === "no" && free === "yes" && !!recap;
  return {
    id,
    entryNumber: entry ? Number(entry[1]) : null,
    date: str(cells["entry_date_filed"]),
    docType: str(cells["doc_type"]),
    description: str(cells["description"]),
    pageCount: pages && /^\d+$/.test(pages) ? Number(pages) : null,
    // Only an explicitly unsealed, free document with a RECAP link is linkable; anything else is held.
    recapUrl: linkable ? recap : null,
    docketEntryUrl: urlOf((u) => /^https:\/\/www\.courtlistener\.com\/docket\//i.test(u)),
    held: !linkable,
  };
}

export async function loadLegacyDocuments(
  mdl: string,
): Promise<{ rows: LegacyDocument[]; published: boolean }> {
  if (!(await isPublished("mdl_docket_documents"))) return { rows: [], published: false };
  const r = await restGet<{ item: unknown; facts: unknown }[]>(
    `corpus_records?select=item,facts:detail->facts&dataset=eq.mdl_docket_documents&filters=cs.${containsMdl(mdl)}&order=ordinal.asc,id.asc&limit=1000`,
  );
  return {
    rows: r.rows
      .map((x) => parseLegacyDocument(x.item, x.facts))
      .filter((d): d is LegacyDocument => !!d),
    published: true,
  };
}

/* ------------------------------------------------------------------ parties and counsel (matter registry) */

const PARTIES_TTL_MS = 10 * 60_000;
const PARTIES_PAGE = 50;
const FIRMS_PAGE = 20;
/** Attorneys listed under one firm before the rest are only counted. */
const FIRM_ATTORNEY_CAP = 60;
const PARTIES_PER_GROUP = 8;

const partiesCache = new Map<string, { at: number; model: Promise<PartiesModel | null> }>();

/**
 * Every party row of the matter's master docket with its counsel, read once (three pages at a time), reduced to a lean
 * model and cached for ten minutes. A matter with no rows (or a dataset that is not released) has no model.
 */
function partiesModelFor(mdl: string): Promise<PartiesModel | null> {
  const hit = partiesCache.get(mdl);
  if (hit && Date.now() - hit.at < PARTIES_TTL_MS) return hit.model;
  const model = readPartiesModel(mdl);
  partiesCache.set(mdl, { at: Date.now(), model });
  model.then(
    (m) => {
      if (!m && partiesCache.get(mdl)?.model === model) partiesCache.delete(mdl);
    },
    () => {
      if (partiesCache.get(mdl)?.model === model) partiesCache.delete(mdl);
    },
  );
  while (partiesCache.size > 8) {
    const oldest = partiesCache.keys().next().value;
    if (oldest === undefined) break;
    partiesCache.delete(oldest);
  }
  return model;
}

async function readPartiesModel(mdl: string): Promise<PartiesModel | null> {
  if (!(await isPublished("sw_matter_parties_v1"))) return null;
  const path = `corpus_records?select=id,cells:item->cells,counsel:detail->registry->counsel&dataset=eq.sw_matter_parties_v1&filters=cs.${enc(JSON.stringify({ mdl }))}&order=ordinal.asc,id.asc`;
  const PAGE = 1000;
  type PartyRow = { id: string; cells: unknown; counsel: unknown };
  const first = await restGet<PartyRow[]>(path, { count: true, range: [0, PAGE - 1] });
  const rows = [...first.rows];
  const total = Math.min(first.total ?? rows.length, 6000);
  const starts: number[] = [];
  for (let s = PAGE; s < total; s += PAGE) starts.push(s);
  for (const page of await mapLimit(starts, 3, (s) =>
    restGet<PartyRow[]>(path, { range: [s, s + PAGE - 1] }),
  ))
    rows.push(...page.rows);
  const parsed: ParsedPartyRow[] = [];
  for (const r of rows) {
    const party = parseRegistryPartyRow(r);
    if (party) parsed.push(party);
  }
  return parsed.length ? buildPartiesModel(parsed) : null;
}

/** Counts, party types and the Seeger Weiss summary for the matter; null when the registry holds no parties for it. */
export async function loadRegistryPartiesSummary(
  mdl: string,
): Promise<RegistryPartiesSummary | null> {
  const model = await partiesModelFor(mdl);
  return model
    ? { counts: model.counts, types: model.types, seegerWeiss: model.seegerWeiss }
    : null;
}

/** Parties of the master docket: grouped by type when unfiltered, otherwise one filtered page. */
export async function loadRegistryParties(
  mdl: string,
  type: string,
  q: string,
  offset: number,
): Promise<RegistryPartiesList | null> {
  const model = await partiesModelFor(mdl);
  if (!model) return null;
  const rows = pickParties(model, { type, q });
  const start = Math.max(0, Math.min(Math.floor(offset), Math.max(0, rows.length - 1)));
  const aligned = start - (start % PARTIES_PAGE);
  const overview = !type && !q.trim() && aligned === 0;
  return {
    total: rows.length,
    offset: aligned,
    pageSize: PARTIES_PAGE,
    rows: rows.slice(aligned, aligned + PARTIES_PAGE),
    groups: overview ? groupParties(model, PARTIES_PER_GROUP) : null,
  };
}

/** Counsel grouped by the firm line as printed, the exact Seeger Weiss firm first. */
export async function loadRegistryCounsel(
  mdl: string,
  q: string,
  offset: number,
): Promise<RegistryCounselList | null> {
  const model = await partiesModelFor(mdl);
  if (!model) return null;
  const firms = pickFirms(model, q);
  const start = Math.max(0, Math.min(Math.floor(offset), Math.max(0, firms.length - 1)));
  const aligned = start - (start % FIRMS_PAGE);
  return {
    total: firms.length,
    offset: aligned,
    pageSize: FIRMS_PAGE,
    firms: firms.slice(aligned, aligned + FIRMS_PAGE).map((g) => ({
      firm: g.firm,
      seegerWeiss: g.seegerWeiss,
      parties: g.parties,
      attorneyCount: g.attorneys.length,
      attorneys: g.attorneys.slice(0, FIRM_ATTORNEY_CAP),
    })),
  };
}

/* ------------------------------------------------------------------ parties and counsel (saved sample) */

export async function loadCounsel(
  mdl: string,
  kind: PartyKind,
  q: string,
  offset: number,
): Promise<PartiesPayload> {
  const pageSize = 50;
  const empty: PartiesPayload = {
    kind,
    rows: [],
    total: 0,
    capped: false,
    offset,
    pageSize,
    totals: { firm: 0, attorney: 0, party: 0 },
  };
  if (!(await isPublished("mdl_counsel"))) return empty;
  const kinds: PartyKind[] = ["firm", "attorney", "party"];
  const [page, ...counts] = await Promise.all([
    boundedItems("mdl_counsel", { mdl, kind }, q, pageSize, offset, 10000),
    ...kinds.map((k) => boundedItems("mdl_counsel", { mdl, kind: k }, "", 1, 0, 10000)),
  ]);
  const totals = Object.fromEntries(
    kinds.map((k, i) => [k, typeof counts[i]?.total === "number" ? counts[i]!.total : null]),
  ) as Record<PartyKind, number | null>;
  const rows: CounselRow[] = (page.items ?? [])
    .map((i) => parseCounselRow(i, kind))
    .filter((r): r is CounselRow => !!r);
  return { kind, rows, total: page.total, capped: !!page.total_capped, offset, pageSize, totals };
}

export async function loadAppearances(mdl: string): Promise<AppearancesPayload> {
  if (!(await isPublished("mdl_appearances"))) return { rows: [], published: false };
  const r = await restGet<{ item: unknown; filters: unknown; facts: unknown }[]>(
    `corpus_records?select=item,filters,facts:detail->facts&dataset=eq.mdl_appearances&filters=cs.${containsMdl(mdl)}&order=ordinal.asc,id.asc&limit=1000`,
  );
  const rows: AppearanceRow[] = r.rows
    .map((x) => parseAppearanceRow(x.item, x.filters, x.facts))
    .filter((a): a is AppearanceRow => !!a);
  return { rows, published: true };
}

/* ------------------------------------------------------------------ hub */

type HubSummaryRow = {
  id: string;
  title: string | null;
  summary: Record<string, unknown> | null;
  cases_total: number | null;
  activity_total: number | null;
  documents_total: number | null;
};

let hubRegistryCache: { at: number; byMdl: Map<string, HubRow["registry"]> } | null = null;

/** The `judges` profile id on an MDL record's summary, when it is an id and not something else. */
function judgeProfileId(summary: Record<string, unknown> | null): string | null {
  const id = summary ? str(summary["judge_profile_id"]) : null;
  return id && /^[A-Za-z0-9_-]{6,80}$/.test(id) ? id : null;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export async function loadHub(): Promise<HubRow[]> {
  const ids = SW_MATTERS.map((m) => String(m.mdl));
  const published = await isPublished("mdls");
  const summaries = new Map<string, HubSummaryRow>();
  if (published) {
    const r = await restGet<HubSummaryRow[]>(
      `corpus_records?select=id,title,summary:detail->summary,cases_total:detail->cases->total,activity_total:detail->docket_activity->total,documents_total:detail->docket_documents->total&dataset=eq.mdls&id=in.(${ids.join(",")})&limit=100`,
    );
    for (const row of r.rows) summaries.set(row.id, row);
  }
  const sw = new Map<string, number>();
  if (await isPublished("mdl_appearances")) {
    const a = await restGet<{ filters: { mdl?: string[] } | null }[]>(
      `corpus_records?select=filters&dataset=eq.mdl_appearances&filters=cs.${enc(JSON.stringify({ firm: ["seeger_weiss"] }))}&limit=2000`,
    );
    for (const row of a.rows)
      for (const m of row.filters?.mdl ?? []) sw.set(m, (sw.get(m) ?? 0) + 1);
  }
  // The matter registry's records (explicit PDF case ids, docket counts, caption) for the matters it covers.
  const registryMatters = new Map<string, RegistryMatter>();
  if (await isPublished("sw_matters_v1")) {
    try {
      const reg = await restGet<
        { id: string; title: unknown; cells: unknown; facts: unknown; registry: unknown }[]
      >(
        "corpus_records?select=id,title,cells:item->cells,facts:detail->facts,registry:detail->registry&dataset=eq.sw_matters_v1&limit=200",
      );
      for (const row of reg.rows) {
        const mdl = /^sw-matter:(\d{1,6})$/.exec(row.id)?.[1];
        const parsed = mdl ? parseRegistryRecord(row, mdl) : null;
        if (mdl && parsed) registryMatters.set(mdl, parsed);
      }
    } catch {
      registryMatters.clear();
    }
  }
  const registryFresh =
    hubRegistryCache && Date.now() - hubRegistryCache.at < 5 * 60_000
      ? hubRegistryCache.byMdl
      : null;
  const byMdl = registryFresh ?? new Map<string, HubRow["registry"]>();
  if (!registryFresh) {
    await mapLimit(SW_MATTERS, 6, async (m) => {
      const key = String(m.mdl);
      const s = summaries.get(key)?.summary;
      const derived = s ? matterCaseKeys(str(s["cl_court_id"]), str(s["master_docket"])).all : [];
      const plan = caseIdPlan(registryMatters.get(key) ?? null, derived);
      const caseKeys = plan.map((c) => c.id);
      if (!caseKeys.length) {
        byMdl.set(key, null);
        return;
      }
      try {
        const page = await rpcPost<unknown>("corpus_matter_pdf_documents_v1", {
          p_native_case_ids: caseKeys,
          p_limit: 1,
          p_offset: 0,
        });
        const sum = isObj(page) ? parseRegistrySummary(page["summary"], []) : null;
        byMdl.set(
          key,
          sum && sum.total > 0
            ? { open: sum.open, held: sum.held, total: sum.total }
            : { none: true },
        );
      } catch {
        byMdl.set(key, { notConnected: true });
      }
    });
    hubRegistryCache = { at: Date.now(), byMdl };
  }
  return SW_MATTERS.map((m): HubRow => {
    const key = String(m.mdl);
    const row = summaries.get(key);
    const s = row?.summary ?? null;
    const reg = registryMatters.get(key) ?? null;
    // A newer JPML report held by the matter registry supersedes the MDL record's figures, with its own date.
    const counts = newerJpmlCounts(
      {
        asOf: s ? str(s["as_of"]) : null,
        total: s && typeof s["total_actions"] === "number" ? s["total_actions"] : null,
        pending: s && typeof s["actions_pending"] === "number" ? s["actions_pending"] : null,
      },
      reg?.jpml,
    );
    // A matter the JPML directory does not hold (a closed matter) still reads from the registry when it has it.
    const rec = reg?.record ?? null;
    const registryMaster = reg?.caseIds.find((c) => c.role === "master") ?? null;
    return {
      mdl: key,
      tier: m.tier,
      shortName: m.shortName,
      inCorpus: !!row || !!rec,
      title: row?.title ?? rec?.caption ?? null,
      status: s ? str(s["status"]) : (rec?.status ?? null),
      courtName: s ? str(s["court_name"]) : (rec?.transfereeCourt ?? null),
      masterDocket: s ? str(s["master_docket"]) : (registryMaster?.docketNumber ?? null),
      judgePrinted: s ? str(s["judge_name_as_printed"]) : (rec?.judgeAsPrinted ?? null),
      judgeProfileId: judgeProfileId(s),
      metrics: registryMetrics(reg),
      totalActions: counts.total,
      pendingActions: counts.pending,
      asOf: counts.asOf,
      registryDockets: reg?.members.rows ?? null,
      casesInSample: row && typeof row.cases_total === "number" ? row.cases_total : null,
      docketEntriesInSample:
        row && typeof row.activity_total === "number" ? row.activity_total : null,
      savedDocuments: row && typeof row.documents_total === "number" ? row.documents_total : null,
      swAppearances: sw.get(key) ?? null,
      registry: byMdl.get(key) ?? null,
    };
  });
}

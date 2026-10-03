/**
 * Server-only data access for matter pages. ONE module reads the corpus; the UI never touches REST directly.
 *
 * Today's sources are the existing public read model (`mdls`, `mdl_case_inventory`, `mdl_docket_activity`,
 * `mdl_docket_documents`, `mdl_counsel`, `mdl_appearances`, `cl_master_entries`, `cl_docket_metadata`,
 * `jpml_html_reference`) plus the verified PDF registry through `corpus_matter_pdf_*_v1`. When the matter registry
 * projection lands (see _work/contracts/sw-matter-registry.md) the readers below are the only code that changes.
 * Datasets that are not published (`corpus_datasets.ready = false`) are never read.
 */
import { restGet, rpcPost } from "@/lib/external/rest.server";
import { masterCase, mergeCases, parseFjcCase, parseInventoryCase, type CaseRow } from "./cases";
import { matterCaseKeys } from "./docketKeys";
import {
  describeDocument,
  parseRegistryDocument,
  parseRegistrySummary,
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
import { SW_MATTERS } from "./tiers";
import type {
  AppearancesPayload,
  EntriesPayload,
  FjcCasesPage,
  HubRow,
  JpmlReference,
  LegacyDocument,
  MasterDocketMeta,
  MatterCasesPayload,
  MatterOverviewPayload,
  PartiesPayload,
  RegistryDocumentsPayload,
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
  if (!(await isPublished("mdls"))) return null;
  const raw = await rpcPost<unknown>("corpus_detail", {
    p_id: mdl,
    p_datasets: ["mdls"],
    p_full: false,
  });
  const overview = parseMdlDetail(raw);
  if (!overview || overview.mdl !== mdl) return null;
  const [master, judgeProfile, jpmlReferences] = await Promise.all([
    loadMasterMeta(overview.masterDocket.clDocketId).catch(() => null),
    overview.judge.nativeIdEvidence
      ? loadJudgeProfile(overview.judge.entityId).catch(() => null)
      : Promise.resolve(null),
    loadJpmlReferences(mdl).catch(() => []),
  ]);
  const sw = SW_MATTERS.find((m) => String(m.mdl) === mdl) ?? null;
  return {
    overview,
    master,
    judgeProfile,
    jpmlReferences,
    sw: { tier: sw?.tier ?? null, shortName: sw?.shortName ?? null },
  };
}

/* ------------------------------------------------------------------ cases */

export async function loadMatterCases(payload: MatterOverviewPayload): Promise<MatterCasesPayload> {
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

  let inventoryTotal = 0;
  const inventoryPublished = await isPublished("mdl_case_inventory");
  if (inventoryPublished) {
    const r = await restGet<{ id: string; item: unknown; facts: unknown }[]>(
      `corpus_records?select=id,item,facts:detail->facts&dataset=eq.mdl_case_inventory&filters=cs.${containsMdl(overview.mdl)}&order=ordinal.asc,id.asc&limit=1000`,
    );
    for (const row of r.rows) {
      const parsed = parseInventoryCase(row.item, row.facts);
      if (parsed) {
        rows.push(parsed);
        inventoryTotal++;
      }
    }
  }

  let fjc: MatterCasesPayload["fjc"] = null;
  if (await isPublished("cl_docket_metadata")) {
    fjc = { total: await exactFjcCount(overview.mdl, null), capped: false };
  }
  return { rows: mergeCases(rows), inventoryTotal, fjc, inventoryPublished };
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

const REGISTRY_ROW_CAP = 5000;

/** Verified-PDF registry rows for the derived case keys; degrades to `connected:false` if the reader is absent. */
export async function loadRegistryDocuments(
  caseKeys: string[],
  summaryOnly = false,
): Promise<RegistryDocumentsPayload> {
  if (!caseKeys.length) {
    return {
      connected: false,
      reason: "No native case key could be derived from the master docket.",
      caseKeys,
    };
  }
  const rows: MatterDocument[] = [];
  let summary: RegistrySummary | null = null;
  try {
    for (let offset = 0; offset < REGISTRY_ROW_CAP; offset += 500) {
      const page = await rpcPost<unknown>("corpus_matter_pdf_documents_v1", {
        p_native_case_ids: caseKeys,
        p_limit: summaryOnly ? 1 : 500,
        p_offset: offset,
      });
      if (!isObj(page)) throw new Error("Unexpected registry response");
      const raw = Array.isArray(page["rows"]) ? page["rows"] : [];
      const parsed = raw
        .map((r) => parseRegistryDocument(r))
        .filter((r): r is NonNullable<typeof r> => !!r)
        // A row is accepted only if its case id is exactly one of the derived keys.
        .filter((r) => r.nativeCaseId !== null && caseKeys.includes(r.nativeCaseId))
        .map(describeDocument);
      rows.push(...parsed);
      if (offset === 0) summary = parseRegistrySummary(page["summary"], parsed);
      if (summaryOnly) {
        rows.length = 0;
        break;
      }
      if (raw.length < 500 || rows.length >= (summary?.total ?? 0)) break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      connected: false,
      reason: /\((404|400)\)/.test(message)
        ? "The verified PDF registry reader is not installed on the corpus database."
        : "The verified PDF registry could not be read.",
      caseKeys,
    };
  }
  const resolved = summary ?? parseRegistrySummary(null, rows);
  return {
    connected: true,
    summary: resolved,
    rows,
    truncated: !summaryOnly && rows.length < resolved.total,
    caseKeys,
  };
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

/* ------------------------------------------------------------------ parties and counsel */

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
  const registryFresh =
    hubRegistryCache && Date.now() - hubRegistryCache.at < 5 * 60_000
      ? hubRegistryCache.byMdl
      : null;
  const byMdl = registryFresh ?? new Map<string, HubRow["registry"]>();
  if (!registryFresh) {
    await mapLimit(SW_MATTERS, 6, async (m) => {
      const key = String(m.mdl);
      const s = summaries.get(key)?.summary;
      const caseKeys = s ? matterCaseKeys(str(s["cl_court_id"]), str(s["master_docket"])).all : [];
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
    return {
      mdl: key,
      tier: m.tier,
      shortName: m.shortName,
      inCorpus: !!row,
      title: row?.title ?? null,
      status: s ? str(s["status"]) : null,
      courtName: s ? str(s["court_name"]) : null,
      masterDocket: s ? str(s["master_docket"]) : null,
      judgePrinted: s ? str(s["judge_name_as_printed"]) : null,
      totalActions: s && typeof s["total_actions"] === "number" ? s["total_actions"] : null,
      pendingActions: s && typeof s["actions_pending"] === "number" ? s["actions_pending"] : null,
      asOf: s ? str(s["as_of"]) : null,
      casesInSample: row && typeof row.cases_total === "number" ? row.cases_total : null,
      docketEntriesInSample:
        row && typeof row.activity_total === "number" ? row.activity_total : null,
      savedDocuments: row && typeof row.documents_total === "number" ? row.documents_total : null,
      swAppearances: sw.get(key) ?? null,
      registry: byMdl.get(key) ?? null,
    };
  });
}

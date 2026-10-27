/**
 * Server-only reads for the MDL command page (src/lib/matters/command.functions.ts). Read-only PostgREST through
 * rest.server; every read is filtered by dataset and by the MDL number, and results are cached for 10 minutes per MDL.
 *
 * Phase 1 needs no database change: master-docket entries are read with the indexed containment
 * `filters=cs.{"mdl":"N"}` (GIN corpus_records_filters_idx) plus anchored, case-insensitive regular expressions on the
 * entry text (orders.ts ORDER_PREFILTER_PATTERNS / DATE_PREFILTER_PATTERN), then classified by the pure classifier.
 * The order PDF join uses `documents_for_entries_v1` (database/contracts/documents-entries-v1.sql) once the lead has
 * applied it; until then it reports "not connected" instead of guessing.
 */
import { restGet, rpcPostOptional } from "@/lib/external/rest.server";
import { countRows, readAllRows } from "@/lib/analytics/tally.server";
import { READ_TTL_MS } from "@/lib/insights/readers/cache";
import { keyedMemo } from "@/lib/trends/profile";
import {
  METRIC_LABEL,
  parseFinancials,
  parseLink,
  type FinPoint,
  type Metric,
} from "@/components/companies/companyData";
import { extractDocketDates } from "./docketDates";
import {
  DATE_PREFILTER_PATTERN,
  ORDER_PREFILTER_PATTERNS,
  ORDERS_RULE_VERSION,
  classifyDocketText,
  countKinds,
  orderLedger,
  type ClassifiedEntry,
} from "./orders";
import { parseRegistryPartyRow } from "./registryParties";
import { loadRegistryMatter } from "./source.server";
import type {
  DefendantRosterPayload,
  DefendantRow,
  DocketDateRow,
  DocketDatesPayload,
  EntryCoverage,
  KeyOrdersPayload,
  OrderDocument,
  OrderDocumentsPayload,
  RegulatoryLink,
  RegulatoryLinksPayload,
  Rule702Summary,
  SecDefendant,
  SecDefendantsPayload,
  SecOtherGroup,
  SecOtherRegistrant,
  TypedEvent,
  TypedEventsPayload,
} from "./types";

const enc = encodeURIComponent;
const ENTRIES = "sw_docket_entries_v1";
const MDL_RE = /^[1-9]\d{0,5}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CANDIDATE_MAX = 20_000;

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const isoOrNull = (v: unknown): string | null => {
  const t = s(v);
  return t && ISO.test(t) ? t : null;
};
const https = (v: unknown): string | null => {
  const t = s(v);
  return t && /^https:\/\//i.test(t) ? t : null;
};
const intOrNull = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === "string" && /^\d{1,7}$/.test(v)) return Number(v);
  return null;
};
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function assertMdl(mdl: string): void {
  if (!MDL_RE.test(mdl)) throw new Error("Invalid MDL number.");
}

const memo = <T>() => keyedMemo<T>(READ_TTL_MS, 300);

/* ------------------------------------------------------------------ master-docket entry scan */

/** One candidate row as selected (only the columns the classifier needs). */
export type ScanRow = {
  id: string;
  d: unknown;
  n: unknown;
  f: unknown;
  k: unknown;
  u: unknown;
  w: unknown;
  h: unknown;
  ids: unknown;
};

const SCAN_SELECT = [
  "id",
  "d:item->cells->>description",
  "n:item->cells->entry_number",
  "f:item->cells->>date_filed",
  "k:item->cells->>docket_key",
  "u:item->cells->>source_url",
  "w:item->cells->>description_withheld",
  "h:item->cells->held",
  "ids:item->cells->document_ids",
].join(",");

/** The PostgREST path of one candidate read: MDL containment (indexed) plus one anchored imatch on the text. */
export function scanPath(mdl: string, pattern: string): string {
  return [
    `corpus_records?select=${SCAN_SELECT}`,
    `dataset=eq.${ENTRIES}`,
    `filters=cs.${enc(JSON.stringify({ mdl }))}`,
    `item->cells->>description=imatch.${enc(pattern)}`,
    "order=ordinal.asc,id.asc",
  ].join("&");
}

/** Classify the candidate rows; withheld rows are never classified. Pure. */
export function classifyRows(rows: readonly ScanRow[]): {
  entries: ClassifiedEntry[];
  dates: DocketDateRow[];
} {
  const seen = new Set<string>();
  const entries: ClassifiedEntry[] = [];
  const dates: DocketDateRow[] = [];
  for (const r of rows) {
    if (!r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    const withheld = s(r.w) !== null || r.h === true;
    const text = withheld ? null : s(r.d);
    const c = classifyDocketText(text, { withheld });
    const base = {
      id: r.id,
      entryNumber: intOrNull(r.n),
      date: isoOrNull(r.f),
      docketKey: s(r.k),
      sourceUrl: https(r.u),
      documentIds: Array.isArray(r.ids)
        ? r.ids
            .flatMap((x) =>
              typeof x === "string" && /^[A-Za-z0-9:._-]{1,120}$/.test(x) ? [x] : [],
            )
            .slice(0, 50)
        : [],
    };
    if (c.tags.length) entries.push({ ...base, role: c.role, title: c.title, tags: c.tags });
    if (text)
      for (const d of extractDocketDates(text))
        dates.push({
          ...d,
          entryId: r.id,
          entryNumber: base.entryNumber,
          entryDate: base.date,
          sourceUrl: base.sourceUrl,
          entryRole: c.role,
        });
  }
  const byDate = (
    a: { date: string | null; id?: string },
    b: { date: string | null; id?: string },
  ) => (a.date ?? "").localeCompare(b.date ?? "");
  entries.sort(
    (a, b) =>
      byDate(a, b) || (a.entryNumber ?? 0) - (b.entryNumber ?? 0) || a.id.localeCompare(b.id),
  );
  dates.sort(
    (a, b) =>
      (a.entryDate ?? "").localeCompare(b.entryDate ?? "") ||
      a.entryId.localeCompare(b.entryId) ||
      a.date.localeCompare(b.date),
  );
  return { entries, dates };
}

export function rule702Summary(entries: readonly ClassifiedEntry[]): Rule702Summary {
  const out: Rule702Summary = {
    rulings: 0,
    byOutcome: { granted: 0, denied: 0, granted_in_part: 0, not_stated: 0 },
    motions: 0,
  };
  for (const e of entries)
    for (const t of e.tags) {
      if (t.kind === "rule702_motion") out.motions++;
      if (t.kind !== "rule702") continue;
      out.rulings++;
      if (t.outcome === "granted" || t.outcome === "denied" || t.outcome === "granted_in_part")
        out.byOutcome[t.outcome]++;
      else out.byOutcome.not_stated++;
    }
  return out;
}

async function readCoverage(mdl: string, candidatesRead: number): Promise<EntryCoverage> {
  const base = `corpus_records?dataset=eq.${ENTRIES}&filters=cs.${enc(JSON.stringify({ mdl }))}`;
  const [total, withheldRows, noText, latest] = await Promise.all([
    countRows(base).catch(() => null),
    // A failed coverage read leaves that figure "Not recorded"; it never removes the classified orders or dates.
    readAllRows<{ w: unknown; h: unknown }>(
      `corpus_records?select=w:item->cells->>description_withheld,h:item->cells->held&dataset=eq.${ENTRIES}&filters=cs.${enc(JSON.stringify({ mdl, description_withheld: "true" }))}&order=ordinal.asc,id.asc`,
      { max: CANDIDATE_MAX },
    ).catch(() => null),
    countRows(
      `corpus_records?dataset=eq.${ENTRIES}&filters=cs.${enc(JSON.stringify({ mdl, description_withheld: "false" }))}&item->cells->>description=is.null`,
    ).catch(() => null),
    restGet<{ f: unknown }[]>(
      `corpus_records?select=f:item->cells->>date_filed&dataset=eq.${ENTRIES}&filters=cs.${enc(JSON.stringify({ mdl }))}&item->cells->>date_filed=not.is.null&order=item->cells->>date_filed.desc&limit=1`,
    ).catch(() => null),
  ]);
  const reasons = new Map<string, number>();
  for (const r of withheldRows ?? []) {
    const reason = s(r.w) ?? (r.h === true ? "sealed_or_restricted_text" : "not_stated");
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return {
    total,
    withheld: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    withheldTotal: withheldRows ? withheldRows.length : null,
    noText,
    collectedThrough: latest ? isoOrNull(latest.rows[0]?.f) : null,
    candidatesRead,
  };
}

type DocketScan = {
  entries: ClassifiedEntry[];
  dates: DocketDateRow[];
  coverage: EntryCoverage;
  readAt: string;
};

const scanMemo = memo<DocketScan>();

/** Read the candidate entries of one MDL (orders and dated settings) and classify them; cached 10 minutes. */
export function loadDocketScan(mdl: string): Promise<DocketScan> {
  assertMdl(mdl);
  return scanMemo(mdl, async () => {
    const patterns = [...ORDER_PREFILTER_PATTERNS, DATE_PREFILTER_PATTERN];
    const reads = await Promise.all(
      patterns.map((p) =>
        readAllRows<ScanRow>(scanPath(mdl, p), { max: CANDIDATE_MAX, concurrency: 2 }),
      ),
    );
    const rows = reads.flat();
    const { entries, dates } = classifyRows(rows);
    const coverage = await readCoverage(mdl, new Set(rows.map((r) => r.id)).size);
    return { entries, dates, coverage, readAt: new Date().toISOString() };
  });
}

/** The key-order register of one MDL: classified entries, CMO/PTO ledgers with gaps, counts and Rule 702 rulings. */
export async function loadKeyOrders(mdl: string): Promise<KeyOrdersPayload> {
  const scan = await loadDocketScan(mdl);
  return {
    mdl,
    rule: ORDERS_RULE_VERSION,
    dataset: ENTRIES,
    coverage: scan.coverage,
    entries: scan.entries,
    ledger: orderLedger(scan.entries),
    counts: countKinds(scan.entries),
    rule702: rule702Summary(scan.entries),
    readAt: scan.readAt,
  };
}

/** Dates set on the docket, verbatim, each with its entry; read from the same scan. */
export async function loadDocketDates(mdl: string): Promise<DocketDatesPayload> {
  const scan = await loadDocketScan(mdl);
  return {
    mdl,
    rows: scan.dates,
    collectedThrough: scan.coverage.collectedThrough,
    readAt: scan.readAt,
  };
}

/* ------------------------------------------------------------------ master docket and order PDFs */

export type MasterDocket = { id: string; docketKey: string; courtId: string; docketNumber: string };

/** The one role=master docket the registry lists for this MDL (sw_matter_dockets_v1); null unless exactly one. */
export function parseMasterDocket(
  mdl: string,
  rows: readonly { id: unknown; cells: unknown }[],
): MasterDocket | null {
  const masters = rows.flatMap((r) => {
    const id = s(r.id);
    const cells = obj(r.cells);
    const prefix = `sw-md:${mdl}:`;
    if (!id || !id.startsWith(prefix) || !cells || s(cells["role"]) !== "master") return [];
    if (s(cells["mdl"]) !== mdl) return [];
    const courtId = s(cells["court_id"]);
    const docketNumber = s(cells["docket_number"]);
    return courtId && docketNumber
      ? [{ id, docketKey: id.slice(prefix.length), courtId, docketNumber }]
      : [];
  });
  return masters.length === 1 ? masters[0]! : null;
}

const masterMemo = memo<MasterDocket | null>();

export function loadMasterDocket(mdl: string): Promise<MasterDocket | null> {
  assertMdl(mdl);
  return masterMemo(mdl, async () => {
    const r = await restGet<{ id: unknown; cells: unknown }[]>(
      `corpus_records?select=id,cells:item->cells&dataset=eq.sw_matter_dockets_v1&filters=cs.${enc(JSON.stringify({ mdl, role: "master" }))}&limit=5`,
    );
    return parseMasterDocket(mdl, r.rows);
  });
}

/** Rows of documents_for_entries_v1 -> files keyed by entry number; anything off-docket or malformed is dropped. */
export function parseOrderDocuments(
  raw: unknown,
  master: MasterDocket,
  mdl: string,
): Record<string, OrderDocument[]> {
  const out: Record<string, OrderDocument[]> = {};
  for (const r of Array.isArray(raw) ? raw : []) {
    const o = obj(r);
    if (!o) continue;
    const id = s(o["id"]);
    const entryNumber = intOrNull(o["entry_number"]);
    if (!id || entryNumber === null) continue;
    // The exact join keys must come back unchanged; a row for another docket is never shown.
    if (
      s(o["mdl"]) !== mdl ||
      s(o["court_id"]) !== master.courtId ||
      s(o["docket_number"]) !== master.docketNumber
    )
      continue;
    (out[String(entryNumber)] ??= []).push({
      id,
      entryNumber,
      attachment: intOrNull(o["attachment"]),
      title: s(o["title"]),
      docType: s(o["doc_type"]),
      pageCount: intOrNull(o["page_count"]),
      pagesWithText: intOrNull(o["pages_with_text"]),
      textStatus: s(o["text_status"]),
      sourceUrl: https(o["source_url"]),
    });
  }
  return out;
}

/**
 * Documents-layer files for classified order entries, joined on mdl + court + master docket number + entry number.
 * Only entries on the master docket (exact docket key) are asked for.
 */
export async function loadOrderDocuments(
  mdl: string,
  entries: readonly Pick<ClassifiedEntry, "docketKey" | "entryNumber">[],
): Promise<OrderDocumentsPayload> {
  assertMdl(mdl);
  const master = await loadMasterDocket(mdl);
  if (!master)
    return { connected: false, reason: "No single master docket is recorded for this MDL." };
  const numbers = [
    ...new Set(
      entries.flatMap((e) =>
        e.docketKey === master.docketKey && e.entryNumber !== null ? [e.entryNumber] : [],
      ),
    ),
  ].slice(0, 500);
  if (!numbers.length)
    return {
      connected: true,
      master: {
        docketKey: master.docketKey,
        courtId: master.courtId,
        docketNumber: master.docketNumber,
      },
      byEntry: {},
    };
  const raw = await rpcPostOptional<unknown>("documents_for_entries_v1", {
    p_mdl: mdl,
    p_court: master.courtId,
    p_docket: master.docketNumber,
    p_entries: numbers,
  });
  if (raw === null)
    return { connected: false, reason: "The order-document lookup is not available yet." };
  return {
    connected: true,
    master: {
      docketKey: master.docketKey,
      courtId: master.courtId,
      docketNumber: master.docketNumber,
    },
    byEntry: parseOrderDocuments(raw, master, mdl),
  };
}

/* ------------------------------------------------------------------ regulatory links */

export const REGULATORY_LINK_CAVEATS = [
  "Each row is a topical association between the MDL subject and an FDA record, not MDL membership.",
  "The link record's date is shown as recorded; the dataset does not say whether it is the report date or the recall initiation date, and at least one recall (Z-0785-2022) carries a 2018 date.",
  "Links follow only the published selection rule for this MDL (manufacturer and product words); other FDA records may exist.",
];

export function parseRegulatoryLink(
  row: { id: unknown; title: unknown; source_url: unknown; cells: unknown; filters: unknown },
  mdl: string,
): RegulatoryLink | null {
  const id = s(row.id);
  const cells = obj(row.cells);
  const filters = obj(row.filters);
  if (!id || !id.startsWith(`sw-reg:${mdl}:`) || !cells || s(cells["mdl"]) !== mdl) return null;
  const sourceUrl = https(row.source_url);
  return {
    id,
    title: s(row.title) ?? id,
    fdaId: s(cells["fda_id"]),
    date: isoOrNull(cells["date"]),
    firm: s(cells["firm"]),
    classification: s(cells["classification"]),
    signal: s(cells["signal"]),
    linkBasis: s(cells["link_basis"]),
    association: s(cells["association"]),
    fdaKind: s(filters?.["fda_kind"]),
    fdaRecord: s(filters?.["fda_record"]),
    sourceUrl: sourceUrl && sourceUrl.startsWith("https://api.fda.gov/") ? sourceUrl : null,
  };
}

const regMemo = memo<RegulatoryLinksPayload>();

/** sw_matter_regulatory_links_v1 for one MDL (165 rows across 6 MDLs today), newest record date first. */
export function loadRegulatoryLinks(mdl: string): Promise<RegulatoryLinksPayload> {
  assertMdl(mdl);
  return regMemo(mdl, async () => {
    const [rows, meta] = await Promise.all([
      readAllRows<{
        id: unknown;
        title: unknown;
        source_url: unknown;
        cells: unknown;
        filters: unknown;
      }>(
        `corpus_records?select=id,title,source_url,cells:item->cells,filters&dataset=eq.sw_matter_regulatory_links_v1&filters=cs.${enc(JSON.stringify({ mdl }))}&order=ordinal.asc,id.asc`,
        { max: 5_000 },
      ),
      restGet<{ matters: unknown }[]>(
        "corpus_datasets?select=matters:metadata->rules->matters&id=eq.sw_matter_regulatory_links_v1&limit=1",
      ).catch(() => ({ rows: [] as { matters: unknown }[], total: null })),
    ]);
    const links = rows
      .flatMap((r) => parseRegulatoryLink(r, mdl) ?? [])
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
    const rule = s(obj(obj(meta.rows[0]?.matters)?.[mdl])?.["rule"]);
    return { mdl, rows: links, rule, caveats: REGULATORY_LINK_CAVEATS };
  });
}

/* ------------------------------------------------------------------ defendant roster */

/** Monthly counts from the first to the last month present, months with none counted 0 (yyyy-mm keys). */
export function zeroFillMonths(
  by: ReadonlyMap<string, number>,
): { month: string; count: number }[] {
  const keys = [...by.keys()].filter((k) => /^\d{4}-\d{2}$/.test(k)).sort();
  if (!keys.length) return [];
  const out: { month: string; count: number }[] = [];
  let y = Number(keys[0]!.slice(0, 4));
  let m = Number(keys[0]!.slice(5, 7));
  const last = keys.at(-1)!;
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ month: key, count: by.get(key) ?? 0 });
    if (key >= last) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function buildDefendantRoster(
  mdl: string,
  rows: readonly { id: unknown; cells: unknown; counsel: unknown }[],
  capture: { published: number | null; complete: boolean | null },
): DefendantRosterPayload {
  const defendants: DefendantRow[] = [];
  const mixed: DefendantRow[] = [];
  for (const r of rows) {
    const p = parseRegistryPartyRow(r);
    if (!p || !p.types.includes("Defendant")) continue;
    const firms = [
      ...new Set(p.counsel.flatMap((c) => (!c.terminated && c.firm ? [c.firm] : []))),
    ].sort((a, b) => a.localeCompare(b));
    const row: DefendantRow = {
      id: p.id,
      name: p.name,
      types: p.types,
      dateTerminated: isoOrNull(p.dateTerminated),
      counselCount: p.counselCount,
      firms,
    };
    if (p.types.length === 1) defendants.push(row);
    else mixed.push(row);
  }
  const byName = (a: DefendantRow, b: DefendantRow) =>
    (a.name ?? "￿").localeCompare(b.name ?? "￿") || a.id.localeCompare(b.id);
  defendants.sort(byName);
  mixed.sort(byName);
  const firmCounts = new Map<string, number>();
  for (const d of defendants)
    for (const f of d.firms) firmCounts.set(f, (firmCounts.get(f) ?? 0) + 1);
  const months = new Map<string, number>();
  for (const d of defendants)
    if (d.dateTerminated)
      months.set(d.dateTerminated.slice(0, 7), (months.get(d.dateTerminated.slice(0, 7)) ?? 0) + 1);
  const published = capture.published;
  const n = defendants.length;
  const plusMixed = mixed.length
    ? ` (plus ${mixed.length.toLocaleString("en-US")} listed with more than one party type, such as Plaintiff / Defendant)`
    : "";
  const captureNote =
    published === null
      ? `${n.toLocaleString("en-US")} defendant parties listed${plusMixed}; the number of parties published is not recorded.`
      : `${n.toLocaleString("en-US")} defendant parties${plusMixed} among ${published.toLocaleString("en-US")} parties published` +
        (capture.complete === false
          ? "; the party capture is incomplete, so the docket may list more."
          : capture.complete === true
            ? "; the capture is recorded as complete."
            : "; whether the capture is complete is not recorded.");
  return {
    mdl,
    defendants,
    mixed,
    firms: [...firmCounts.entries()]
      .map(([firm, parties]) => ({ firm, parties }))
      .sort((a, b) => b.parties - a.parties || a.firm.localeCompare(b.firm)),
    terminatedByMonth: zeroFillMonths(months),
    capture,
    captureNote,
  };
}

const rosterMemo = memo<DefendantRosterPayload>();

/** Master-docket parties typed "Defendant" (sw_matter_parties_v1), with the registry's capture note. */
export function loadDefendantRoster(mdl: string): Promise<DefendantRosterPayload> {
  assertMdl(mdl);
  return rosterMemo(mdl, async () => {
    const [rows, registry] = await Promise.all([
      readAllRows<{ id: unknown; cells: unknown; counsel: unknown }>(
        `corpus_records?select=id,cells:item->cells,counsel:detail->registry->counsel&dataset=eq.sw_matter_parties_v1&filters=cs.${enc(JSON.stringify({ mdl, party_type: ["Defendant"] }))}&order=ordinal.asc,id.asc`,
        { max: 10_000 },
      ),
      loadRegistryMatter(mdl).catch(() => null),
    ]);
    const parties = registry?.parties.find((p) => p.kind === "parties") ?? null;
    return buildDefendantRoster(mdl, rows, {
      published: registry?.record?.partiesPublished ?? parties?.captured ?? null,
      complete: parties?.complete ?? null,
    });
  });
}

/* ------------------------------------------------------------------ typed docket events */

type LinkRow = {
  source_dataset: unknown;
  source_record_id: unknown;
  mdl: unknown;
  court_id: unknown;
  docket_number: unknown;
  entry_number: unknown;
  event_date: unknown;
  date_basis: unknown;
  document_type: unknown;
  evidence_url: unknown;
  linkage_basis: unknown;
};

const LINK_COLS =
  "source_dataset,source_record_id,mdl,court_id,docket_number,entry_number,event_date,date_basis,document_type,evidence_url,linkage_basis";

/**
 * Typed events from corpus_workspace_docket_links. A row counts when it carries this MDL number, or when its MDL is
 * blank and its (court_id, docket_number) is exactly this MDL's master docket and no other registry master docket.
 * Untyped rows and the source's "Other" type are left out. Pure.
 */
export function buildTypedEvents(
  mdl: string,
  own: readonly LinkRow[],
  blank: readonly LinkRow[],
  master: { courtId: string; docketNumber: string } | null,
  linkedTotal: number | null = null,
): TypedEventsPayload {
  const toEvent = (r: LinkRow, attribution: TypedEvent["attribution"]): TypedEvent | null => {
    const documentType = s(r.document_type);
    const sourceDataset = s(r.source_dataset);
    const sourceRecordId = s(r.source_record_id);
    if (!documentType || documentType === "Other" || !sourceDataset || !sourceRecordId) return null;
    return {
      documentType,
      date: isoOrNull(r.event_date),
      dateBasis: s(r.date_basis),
      entryNumber: s(r.entry_number),
      evidenceUrl: https(r.evidence_url),
      linkageBasis: s(r.linkage_basis),
      sourceDataset,
      sourceRecordId,
      attribution,
    };
  };
  const events: TypedEvent[] = [];
  const seen = new Set<string>();
  const push = (e: TypedEvent | null) => {
    if (!e) return;
    const key = `${e.sourceDataset}|${e.sourceRecordId}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.push(e);
  };
  for (const r of own) if (s(r.mdl) === mdl) push(toEvent(r, "mdl"));
  let blankMdlAttributed = 0;
  if (master)
    for (const r of blank) {
      if (
        (r.mdl ?? "") !== "" ||
        s(r.court_id) !== master.courtId ||
        s(r.docket_number) !== master.docketNumber
      )
        continue;
      const before = events.length;
      push(toEvent(r, "master_docket"));
      if (events.length > before) blankMdlAttributed++;
    }
  events.sort(
    (a, b) =>
      (a.date ?? "9999").localeCompare(b.date ?? "9999") ||
      a.documentType.localeCompare(b.documentType) ||
      a.sourceRecordId.localeCompare(b.sourceRecordId),
  );
  const types = new Map<
    string,
    { count: number; first: string | null; last: string | null; undated: number }
  >();
  for (const e of events) {
    const t = types.get(e.documentType) ?? { count: 0, first: null, last: null, undated: 0 };
    t.count++;
    if (!e.date) t.undated++;
    else {
      if (!t.first || e.date < t.first) t.first = e.date;
      if (!t.last || e.date > t.last) t.last = e.date;
    }
    types.set(e.documentType, t);
  }
  const dated = events.flatMap((e) => (e.date ? [e.date] : []));
  return {
    mdl,
    events,
    byType: [...types.entries()]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    window: {
      first: dated[0] ?? null,
      last: dated.length ? dated.reduce((a, b) => (b > a ? b : a)) : null,
    },
    masterDocket: master,
    blankMdlAttributed,
    linkedTotal,
  };
}

const eventsMemo = memo<TypedEventsPayload>();

export function loadTypedEvents(mdl: string): Promise<TypedEventsPayload> {
  assertMdl(mdl);
  return eventsMemo(mdl, async () => {
    const typed = "document_type=not.is.null&document_type=neq.Other";
    const [own, master] = await Promise.all([
      readAllRows<LinkRow>(
        `corpus_workspace_docket_links?select=${LINK_COLS}&mdl=eq.${enc(mdl)}&${typed}&order=source_dataset.asc,source_record_id.asc`,
        { max: CANDIDATE_MAX },
      ),
      loadMasterDocket(mdl).catch(() => null),
    ]);
    let exactMaster: { courtId: string; docketNumber: string } | null = null;
    let blank: LinkRow[] = [];
    if (master) {
      // The master docket must belong to this MDL alone among the registry's master dockets.
      const others = await restGet<{ id: unknown; cells: unknown }[]>(
        `corpus_records?select=id,cells:item->cells&dataset=eq.sw_matter_dockets_v1&filters=cs.${enc(JSON.stringify({ role: "master", court_id: master.courtId }))}&limit=200`,
      );
      const sharing = others.rows.filter(
        (r) => s(obj(r.cells)?.["docket_number"]) === master.docketNumber,
      );
      if (sharing.length === 1 && s(obj(sharing[0]!.cells)?.["mdl"]) === mdl) {
        exactMaster = { courtId: master.courtId, docketNumber: master.docketNumber };
        blank = await readAllRows<LinkRow>(
          `corpus_workspace_docket_links?select=${LINK_COLS}&mdl=eq.&court_id=eq.${enc(master.courtId)}&docket_number=eq.${enc(master.docketNumber)}&${typed}&order=source_dataset.asc,source_record_id.asc`,
          { max: CANDIDATE_MAX },
        );
      }
    }
    // Every linked event (typed or not) on the same attribution, so the page can say how few carry a type.
    const count = (filter: string) =>
      restGet<unknown[]>(`corpus_workspace_docket_links?select=source_record_id&${filter}`, {
        count: true,
        range: [0, 0],
      }).then((x) => x.total);
    const [ownTotal, blankTotal] = await Promise.all([
      count(`mdl=eq.${enc(mdl)}`).catch(() => null),
      exactMaster
        ? count(
            `mdl=eq.&court_id=eq.${enc(exactMaster.courtId)}&docket_number=eq.${enc(exactMaster.docketNumber)}`,
          ).catch(() => null)
        : Promise.resolve(0),
    ]);
    const linkedTotal = ownTotal === null || blankTotal === null ? null : ownTotal + blankTotal;
    return buildTypedEvents(mdl, own, blank, exactMaster, linkedTotal);
  });
}

/* ------------------------------------------------------------------ SEC registrants naming the MDL */

export const SEC_CAVEATS = [
  "Accruals, legal payments and possible-loss estimates are company-wide figures from the registrant's own XBRL facts; they are not attributable to this MDL.",
  "MDL-wide pending actions are never assigned to a company.",
  "Tier C links describe the MDL by its subject and require review; they are listed apart.",
  "A registrant is listed as a defendant only when its own filing excerpt reads it as one and reports no dismissal; claimants, registrants the excerpt says are not named, unclear roles and dismissals are listed apart, with the role as recorded.",
];

const SERIES: { metric: Metric; key: "accrual" | "legalPayments" | "possibleLoss" }[] = [
  { metric: "litigation_accrual", key: "accrual" },
  { metric: "legal_payments", key: "legalPayments" },
  { metric: "possible_loss", key: "possibleLoss" },
];

/**
 * Where a registrant's link goes: tier C or review-flagged links are "review"; a tier A/B link counts as a defendant
 * only when the filing's excerpt reads the company as a defendant and does not report a dismissal. Everything else
 * (claimant, not named, role not stated, dismissed) is listed in its own labelled group, never among the defendants.
 */
export function secGroup(link: {
  tier: string;
  review: boolean;
  role: string;
  dismissed: boolean;
}): "review" | "defendant" | SecOtherGroup {
  if (link.tier === "C" || link.review) return "review";
  if (link.dismissed) return "dismissed";
  if (link.role === "defendant") return "defendant";
  if (link.role === "plaintiff") return "plaintiff";
  if (link.role === "not_named") return "not_named";
  return "unclear";
}

export const SEC_OTHER_GROUPS: readonly SecOtherGroup[] = [
  "dismissed",
  "plaintiff",
  "not_named",
  "unclear",
];

export function buildSecDefendants(
  mdl: string,
  linkRows: readonly { link: unknown }[],
  finRows: readonly {
    id: unknown;
    source_url: unknown;
    annual: unknown;
    labels: unknown;
    retrieved: unknown;
  }[],
): SecDefendantsPayload {
  const mdlNumber = Number(mdl);
  const fin = new Map<string, (typeof finRows)[number]>();
  for (const f of finRows) {
    const id = s(f.id);
    if (id && /^\d{10}$/.test(id)) fin.set(id, f);
  }
  const named: SecDefendant[] = [];
  const review: SecDefendant[] = [];
  const other: SecOtherRegistrant[] = [];
  const seen = new Set<string>();
  for (const r of linkRows) {
    const raw = obj(r.link);
    const link = parseLink(raw);
    const cik = s(raw?.["cik"]);
    if (!link || !cik || !/^\d{10}$/.test(cik) || link.mdl !== mdlNumber || seen.has(cik)) continue;
    seen.add(cik);
    const f = fin.get(cik);
    const parsed = f
      ? parseFinancials({ annual: f.annual, labels: f.labels, retrieved: f.retrieved })
      : null;
    const series = (metric: Metric): { label: string; points: FinPoint[] } | null => {
      const points = parsed?.annual[metric] ?? [];
      return points.length
        ? { label: parsed?.labels[metric] ?? METRIC_LABEL[metric], points }
        : null;
    };
    const row: SecDefendant = {
      cik,
      name: s(raw?.["company"]) ?? cik,
      link,
      accrual: null,
      legalPayments: null,
      possibleLoss: null,
      financialsSourceUrl: f ? https(f.source_url) : null,
      financialsRetrieved: parsed?.retrieved ?? null,
    };
    for (const { metric, key } of SERIES) row[key] = series(metric);
    const group = secGroup(link);
    if (group === "review") review.push(row);
    else if (group === "defendant") named.push(row);
    else other.push({ ...row, group });
  }
  const order = (a: SecDefendant, b: SecDefendant) =>
    a.link.tier.localeCompare(b.link.tier) ||
    b.link.verifiedCount - a.link.verifiedCount ||
    a.name.localeCompare(b.name);
  named.sort(order);
  review.sort(order);
  other.sort(
    (a, b) => SEC_OTHER_GROUPS.indexOf(a.group) - SEC_OTHER_GROUPS.indexOf(b.group) || order(a, b),
  );
  return { mdl, named, review, other, caveats: SEC_CAVEATS };
}

const secMemo = memo<SecDefendantsPayload>();

/** company_sec_mdl_links by exact MDL, joined to company_sec_financials by exact CIK. */
export function loadSecDefendants(mdl: string): Promise<SecDefendantsPayload> {
  assertMdl(mdl);
  return secMemo(mdl, async () => {
    const links = await restGet<{ link: unknown }[]>(
      `corpus_records?select=link:item->link&dataset=eq.company_sec_mdl_links&filters=cs.${enc(JSON.stringify({ mdl: [mdl] }))}&limit=200`,
    );
    const ciks = [
      ...new Set(
        links.rows.flatMap((r) => {
          const cik = s(obj(r.link)?.["cik"]);
          return cik && /^\d{10}$/.test(cik) ? [cik] : [];
        }),
      ),
    ];
    // Only the three litigation series are read, not the whole financial record.
    const fin = ciks.length
      ? await restGet<
          {
            id: unknown;
            source_url: unknown;
            acc: unknown;
            pay: unknown;
            loss: unknown;
            labels: unknown;
            retrieved: unknown;
          }[]
        >(
          `corpus_records?select=id,source_url,acc:item->annual->litigation_accrual,pay:item->annual->legal_payments,loss:item->annual->possible_loss,labels:item->labels,retrieved:item->retrieved&dataset=eq.company_sec_financials&id=in.(${ciks.join(",")})`,
        )
      : { rows: [] };
    return buildSecDefendants(
      mdl,
      links.rows,
      fin.rows.map((r) => ({
        id: r.id,
        source_url: r.source_url,
        annual: { litigation_accrual: r.acc, legal_payments: r.pay, possible_loss: r.loss },
        labels: r.labels,
        retrieved: r.retrieved,
      })),
    );
  });
}

/** Browser-local work product. The only network operation is a read-only source-evidence snapshot. */
import { z } from "zod";
import { canonicalRegulatoryJson } from "./core";
import {
  briefInputSchema,
  investigationInputSchema,
  regulatoryQuerySchema,
  reviewInputSchema,
  watchlistInputSchema,
} from "./validation";
import {
  REGULATORY_EVENT_TYPES,
  REGULATORY_REVIEW_STATUSES,
  REGULATORY_SOURCE_IDS,
  type RegulatoryBrief,
  type RegulatoryEvidenceSnapshot,
  type RegulatoryEvent,
  type RegulatoryInvestigation,
  type RegulatoryJson,
  type RegulatoryQuery,
  type RegulatoryReview,
  type RegulatoryWatchlist,
} from "./types";

const STORE_VERSION = 1 as const;
const DB_NAME = "seeger-weiss-regulatory-workspace";
const MAX_BYTES = 32_000_000;
export const MAX_REGULATORY_BACKUP_BYTES = 40_000_000;
const LOCAL_ACTOR = "This browser";
const dummyOrganization = "00000000-0000-4000-8000-000000000001";
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const idSchema = z.string().uuid();
const stampSchema = z.string().datetime({ offset: true });
const querySchema = regulatoryQuerySchema;
const investigationSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(200),
    description: z.string().max(10000),
    createdAt: stampSchema,
    updatedAt: stampSchema,
  })
  .strict();
const watchlistSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(200),
    query: querySchema,
    investigationId: idSchema.nullable(),
    createdAt: stampSchema,
    updatedAt: stampSchema,
  })
  .strict();
const verificationSchema = z.enum(["server_snapshot", "imported_unverified"]);
const reviewSchema = z
  .object({
    id: idSchema,
    eventId: hashSchema,
    status: z.enum(REGULATORY_REVIEW_STATUSES),
    note: z.string().min(1).max(10000),
    investigationId: idSchema.nullable(),
    reviewedBy: z.string().min(1).max(200),
    createdAt: stampSchema,
    source: z.enum(REGULATORY_SOURCE_IDS),
    nativeId: z.string().min(1).max(500),
    payloadSha256: hashSchema,
    needsReconsideration: z.boolean(),
    sourceVerification: verificationSchema,
    sourceCheckedAt: stampSchema.optional(),
    sourceCheckStatus: z.enum(["current", "changed", "unavailable"]).optional(),
  })
  .strict();
const recordSchema = z
  .object({
    native_id: z.string().min(1).max(500),
    title: z.string().min(1).max(4000),
    document_type: z.string().min(1).max(200),
    published_on: z.string().nullable(),
    source_updated_on: z.string().nullable(),
    source_url: z.string().url().startsWith("https://"),
    agency_ids: z.array(z.string()).max(200),
    agency_names: z.array(z.string()).max(200),
    entity_refs: z
      .array(z.object({ namespace: z.string(), native_id: z.string(), label: z.string() }).strict())
      .max(200),
    identifiers: z.array(z.string()).max(200),
    status: z.string().nullable(),
    fields: z.record(z.unknown()),
    correction_of: z.array(z.string()).max(200),
    evidence_excerpt: z.string().max(20000),
  })
  .strict();
const eventSchema = z
  .object({
    id: hashSchema,
    source: z.enum(REGULATORY_SOURCE_IDS),
    nativeId: z.string().min(1).max(500),
    eventType: z.enum(REGULATORY_EVENT_TYPES),
    reason: z.string().max(20000),
    changedFields: z.array(z.string()).max(100),
    detectedAt: stampSchema,
    payloadSha256: hashSchema,
    previousPayloadSha256: hashSchema.nullable(),
    ruleVersion: z.literal("regulatory-events/1"),
    record: recordSchema,
  })
  .strict();
const manifestSchema = z
  .object({
    version: z.literal("regulatory-brief/1"),
    generatedAt: stampSchema,
    title: z.string().min(1).max(200),
    query: querySchema,
    events: z.array(eventSchema).min(1).max(50),
    qualifications: z.array(z.string()).min(1).max(50),
    sources: z
      .array(
        z
          .object({
            id: z.enum(REGULATORY_SOURCE_IDS),
            qualification: z.string(),
            sourceUrl: z.string().url(),
          })
          .passthrough(),
      )
      .min(1)
      .max(10),
    evidence: z
      .array(
        z
          .object({
            eventId: hashSchema,
            runId: idSchema,
            payloadSha256: hashSchema,
            rawSha256: hashSchema,
            captureSourceUrl: z.string().url().startsWith("https://"),
            retrievedAt: stampSchema,
            recordPointer: z.string().nullable(),
            parser: z.string().min(1),
            currentPayloadSha256: hashSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(5000),
    coverageRuns: z
      .array(
        z
          .object({
            id: idSchema,
            source: z.enum(REGULATORY_SOURCE_IDS),
            status: z.literal("completed"),
            expectedCount: z.number().int().nonnegative(),
            observedCount: z.number().int().nonnegative(),
            scope: z.record(z.unknown()),
          })
          .passthrough(),
      )
      .min(1)
      .max(50),
  })
  .strict();
const briefSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(200),
    investigationId: idSchema.nullable(),
    createdAt: stampSchema,
    createdBy: z.string().min(1).max(200),
    manifestSha256: hashSchema,
    manifest: manifestSchema,
    sourceVerification: verificationSchema,
  })
  .strict();
const historySchema = z
  .object({
    id: idSchema,
    revision: z.number().int().positive(),
    at: stampSchema,
    action: z.enum(["investigation", "watchlist", "review", "brief", "import", "source_check"]),
    recordId: z.string().max(100),
    previous: z.unknown().nullable(),
    importedFromSha256: hashSchema.optional(),
  })
  .strict();

export type LocalRegulatoryChange = {
  id: string;
  revision: number;
  at: string;
  action: "investigation" | "watchlist" | "review" | "brief" | "import" | "source_check";
  recordId: string;
  previous: RegulatoryJson | null;
  importedFromSha256?: string;
};
export type LocalRegulatoryWorkspace = {
  mode: "browser-local";
  storeVersion: 1;
  revision: number;
  updatedAt: string;
  investigations: RegulatoryInvestigation[];
  watchlists: RegulatoryWatchlist[];
  reviews: RegulatoryReview[];
  briefs: RegulatoryBrief[];
  history: LocalRegulatoryChange[];
  listsCapped: false;
};
const workspaceSchema = z
  .object({
    mode: z.literal("browser-local"),
    storeVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    updatedAt: stampSchema,
    investigations: z.array(investigationSchema).max(5000),
    watchlists: z.array(watchlistSchema).max(5000),
    reviews: z.array(reviewSchema).max(5000),
    briefs: z.array(briefSchema).max(5000),
    history: z.array(historySchema).max(20000),
    listsCapped: z.literal(false),
  })
  .strict();

export class LocalRegulatoryWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalRegulatoryWorkspaceError";
  }
}
type EvidenceLoader = (input: {
  eventIds: string[];
  query: RegulatoryQuery;
}) => Promise<RegulatoryEvidenceSnapshot>;
type StoreOptions = {
  indexedDB?: IDBFactory;
  crypto?: Crypto;
  databaseName?: string;
  now?: () => string;
  loadEvidence?: EvidenceLoader;
  notify?: (revision: number) => void;
};
type InvestigationInput = { id?: string; title: string; description: string };
type WatchlistInput = {
  id?: string;
  name: string;
  query: RegulatoryQuery;
  investigationId?: string | null;
};
type ReviewInput = {
  event: RegulatoryEvent;
  status: RegulatoryReview["status"];
  note: string;
  investigationId?: string | null;
};
type BriefInput = {
  title: string;
  eventIds: string[];
  query: RegulatoryQuery;
  investigationId?: string | null;
};
type RecheckInput = { source?: string; nativeId?: string };

function storageError(error: unknown): LocalRegulatoryWorkspaceError {
  if (error instanceof LocalRegulatoryWorkspaceError) return error;
  return new LocalRegulatoryWorkspaceError(
    error instanceof Error && error.name === "QuotaExceededError"
      ? "Browser storage is full. Nothing was saved. Export a backup before freeing space."
      : "Browser storage is unavailable or the saved workspace failed validation. Nothing was overwritten; keep a backup and retry in a supported browser.",
  );
}
function checkedWorkspace(input: unknown): LocalRegulatoryWorkspace {
  const result = workspaceSchema.safeParse(input);
  if (!result.success)
    throw new LocalRegulatoryWorkspaceError(
      "The local workspace format is invalid or unsupported. No existing work was changed.",
    );
  const work = input as LocalRegulatoryWorkspace;
  const ids = new Set(work.investigations.map((x) => x.id));
  for (const items of [
    work.investigations,
    work.watchlists,
    work.reviews,
    work.briefs,
    work.history,
  ])
    if (new Set(items.map((x) => x.id)).size !== items.length)
      throw new LocalRegulatoryWorkspaceError(
        "The workspace contains duplicate record identities.",
      );
  for (const row of [...work.watchlists, ...work.reviews, ...work.briefs])
    if (row.investigationId && !ids.has(row.investigationId))
      throw new LocalRegulatoryWorkspaceError(
        "A workspace record refers to a missing investigation.",
      );
  if (work.history.some((x) => !x.importedFromSha256 && x.revision > work.revision))
    throw new LocalRegulatoryWorkspaceError("Workspace history is inconsistent.");
  canonicalRegulatoryJson(input); // Reject undefined, non-JSON or unsafe numeric values before persistence/export.
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_BYTES)
    throw new LocalRegulatoryWorkspaceError(
      "This workspace exceeds the 32 MB safety limit. Export a backup and start a separate workspace before adding more evidence.",
    );
  return work;
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function view(work: LocalRegulatoryWorkspace): LocalRegulatoryWorkspace {
  return {
    ...clone(work),
    briefs: work.briefs.map(({ manifest: _manifest, ...meta }) => clone(meta)),
  };
}

export function createLocalRegulatoryWorkspace(options: StoreOptions = {}) {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  const crypto = options.crypto ?? globalThis.crypto;
  const now = options.now ?? (() => new Date().toISOString());
  let database: Promise<IDBDatabase> | undefined;
  const loadEvidence: EvidenceLoader =
    options.loadEvidence ??
    (async (input) => {
      const { getRegulatoryEvidenceSnapshot } = await import("@/lib/external/regulatory.functions");
      return getRegulatoryEvidenceSnapshot({ data: input });
    });
  const empty = (): LocalRegulatoryWorkspace => ({
    mode: "browser-local",
    storeVersion: STORE_VERSION,
    revision: 0,
    updatedAt: now(),
    investigations: [],
    watchlists: [],
    reviews: [],
    briefs: [],
    history: [],
    listsCapped: false,
  });
  function open(): Promise<IDBDatabase> {
    if (!factory || !crypto?.subtle || !crypto.randomUUID)
      return Promise.reject(storageError(null));
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(options.databaseName ?? DB_NAME, STORE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("workspaces"))
          request.result.createObjectStore("workspaces");
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
      request.onerror = () => {
        database = undefined;
        reject(storageError(request.error));
      };
      request.onblocked = () =>
        reject(
          new LocalRegulatoryWorkspaceError(
            "Another tab is blocking this browser storage update. Close the older workspace tab and retry.",
          ),
        );
    }).catch((error: unknown) => {
      database = undefined;
      throw storageError(error);
    });
    return database;
  }
  async function full(): Promise<LocalRegulatoryWorkspace> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("workspaces", "readonly"),
        request = tx.objectStore("workspaces").get("current");
      request.onsuccess = () => {
        try {
          resolve(request.result === undefined ? empty() : checkedWorkspace(request.result));
        } catch (error) {
          reject(storageError(error));
        }
      };
      request.onerror = () => reject(storageError(request.error));
    });
  }
  async function hash(value: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(canonicalRegulatoryJson(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function verifyEvidence(snapshot: RegulatoryEvidenceSnapshot): Promise<void> {
    if (
      !hashSchema.safeParse(snapshot.manifestSha256).success ||
      !manifestSchema.safeParse(snapshot.manifest).success ||
      (await hash(snapshot.manifest)) !== snapshot.manifestSha256
    )
      throw new LocalRegulatoryWorkspaceError(
        "Source evidence did not pass its retained manifest check. No brief was saved.",
      );
    const m = snapshot.manifest;
    if (new Set(m.events.map((e) => e.id)).size !== m.events.length)
      throw new LocalRegulatoryWorkspaceError("Duplicate source-event evidence.");
    for (const event of m.events) {
      if (
        event.nativeId !== event.record.native_id ||
        (await hash(event.record)) !== event.payloadSha256 ||
        !m.sources.some((s) => s.id === event.source)
      )
        throw new LocalRegulatoryWorkspaceError(
          "Source record identity or payload hash does not match its evidence.",
        );
      const receipts = m.evidence.filter((e) => e.eventId === event.id);
      if (
        !receipts.length ||
        receipts.some(
          (e) =>
            e.payloadSha256 !== event.payloadSha256 ||
            !m.coverageRuns.some(
              (r) =>
                r.id === e.runId &&
                r.source === event.source &&
                r.status === "completed" &&
                r.observedCount === r.expectedCount,
            ),
        )
      )
        throw new LocalRegulatoryWorkspaceError(
          "Source capture or completed collection evidence is missing.",
        );
    }
    if (m.evidence.some((r) => !m.events.some((e) => e.id === r.eventId)))
      throw new LocalRegulatoryWorkspaceError("Unbound source capture evidence.");
  }
  async function change<T>(
    fn: (work: LocalRegulatoryWorkspace, revision: number, at: string) => T,
  ): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("workspaces", "readwrite");
      const store = tx.objectStore("workspaces"),
        request = store.get("current");
      let result: T,
        revision = 0,
        failure: unknown;
      request.onsuccess = () => {
        try {
          const work = request.result === undefined ? empty() : checkedWorkspace(request.result);
          revision = work.revision + 1;
          const at = now();
          result = fn(work, revision, at);
          work.revision = revision;
          work.updatedAt = at;
          store.put(checkedWorkspace(work), "current");
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        resolve(clone(result));
        try {
          options.notify?.(revision);
        } catch {
          /* A notification cannot undo a committed transaction. */
        }
      };
      tx.onabort = () => reject(storageError(failure ?? tx.error));
      tx.onerror = () => {
        failure ??= tx.error;
      };
    });
  }
  function history(
    work: LocalRegulatoryWorkspace,
    revision: number,
    at: string,
    action: LocalRegulatoryChange["action"],
    recordId: string,
    previous: unknown = null,
  ) {
    work.history.push({
      id: crypto.randomUUID(),
      revision,
      at,
      action,
      recordId,
      previous: clone(previous) as RegulatoryJson,
    });
  }
  function checkInvestigation(work: LocalRegulatoryWorkspace, id: string | null | undefined) {
    if (id && !work.investigations.some((x) => x.id === id))
      throw new LocalRegulatoryWorkspaceError("The selected local investigation no longer exists.");
  }
  return {
    async load() {
      return view(await full());
    },
    async getBrief(id: string) {
      idSchema.parse(id);
      return clone((await full()).briefs.find((x) => x.id === id) ?? null);
    },
    async saveInvestigation(input: InvestigationInput): Promise<RegulatoryInvestigation> {
      const data = investigationInputSchema.parse({ ...input, organizationId: dummyOrganization });
      return change((work, revision, at) => {
        const old = data.id ? work.investigations.find((x) => x.id === data.id) : undefined;
        if (data.id && !old)
          throw new LocalRegulatoryWorkspaceError("The local investigation no longer exists.");
        const saved = {
          id: data.id ?? crypto.randomUUID(),
          title: data.title,
          description: data.description,
          createdAt: old?.createdAt ?? at,
          updatedAt: at,
        };
        history(work, revision, at, "investigation", saved.id, old ?? null);
        work.investigations = [saved, ...work.investigations.filter((x) => x.id !== saved.id)];
        return saved;
      });
    },
    async saveWatchlist(input: WatchlistInput): Promise<RegulatoryWatchlist> {
      const data = watchlistInputSchema.parse({ ...input, organizationId: dummyOrganization });
      return change((work, revision, at) => {
        checkInvestigation(work, data.investigationId);
        const old = data.id ? work.watchlists.find((x) => x.id === data.id) : undefined;
        if (data.id && !old)
          throw new LocalRegulatoryWorkspaceError("The local watchlist no longer exists.");
        const saved: RegulatoryWatchlist = {
          id: data.id ?? crypto.randomUUID(),
          name: data.name,
          query: data.query as RegulatoryQuery,
          investigationId: data.investigationId ?? null,
          createdAt: old?.createdAt ?? at,
          updatedAt: at,
        };
        history(work, revision, at, "watchlist", saved.id, old ?? null);
        work.watchlists = [saved, ...work.watchlists.filter((x) => x.id !== saved.id)];
        return saved;
      });
    },
    async saveReview(input: ReviewInput): Promise<RegulatoryReview> {
      const data = reviewInputSchema.parse({
        eventId: input.event.id,
        status: input.status,
        note: input.note,
        investigationId: input.investigationId ?? null,
        organizationId: dummyOrganization,
      });
      const snapshot = await loadEvidence({ eventIds: [data.eventId], query: {} });
      await verifyEvidence(snapshot);
      const event = snapshot.manifest.events.find((x) => x.id === data.eventId);
      if (
        !event ||
        event.source !== input.event.source ||
        event.nativeId !== input.event.nativeId ||
        event.payloadSha256 !== input.event.payloadSha256
      )
        throw new LocalRegulatoryWorkspaceError(
          "The selected event differs from retained source evidence. Refresh the source record.",
        );
      const receipts = snapshot.manifest.evidence.filter((x) => x.eventId === event.id);
      return change((work, revision, at) => {
        checkInvestigation(work, data.investigationId);
        const saved: RegulatoryReview = {
          id: crypto.randomUUID(),
          eventId: event.id,
          status: data.status,
          note: data.note,
          investigationId: data.investigationId ?? null,
          reviewedBy: LOCAL_ACTOR,
          createdAt: at,
          source: event.source,
          nativeId: event.nativeId,
          payloadSha256: event.payloadSha256,
          needsReconsideration: receipts.some(
            (x) => x.currentPayloadSha256 !== event.payloadSha256,
          ),
          sourceVerification: "server_snapshot",
          sourceCheckedAt: snapshot.manifest.generatedAt,
          sourceCheckStatus: receipts.some((x) => !x.currentPayloadSha256)
            ? "unavailable"
            : receipts.some((x) => x.currentPayloadSha256 !== event.payloadSha256)
              ? "changed"
              : "current",
        };
        work.reviews.unshift(saved);
        history(work, revision, at, "review", saved.id);
        return saved;
      });
    },
    async recheckReviews(input: RecheckInput = {}): Promise<LocalRegulatoryWorkspace> {
      const filter = z
        .object({
          source: z.enum(REGULATORY_SOURCE_IDS).optional(),
          nativeId: z.string().min(1).max(500).optional(),
        })
        .strict()
        .parse(input);
      if (filter.nativeId && !filter.source)
        throw new LocalRegulatoryWorkspaceError(
          "An exact source is required when rechecking a native record.",
        );
      const work = await full();
      // A user-requested pass checks at most 100 distinct events in small, sequential requests.
      // Oldest/unchecked reviews come first, so repeated passes cover larger local workspaces.
      const selected = work.reviews
        .filter(
          (r) =>
            (!filter.source || r.source === filter.source) &&
            (!filter.nativeId || r.nativeId === filter.nativeId),
        )
        .sort((a, b) => (a.sourceCheckedAt ?? "").localeCompare(b.sourceCheckedAt ?? ""));
      const eventIds = [...new Set(selected.map((r) => r.eventId))].slice(0, 100);
      if (!eventIds.length) return view(work);
      const checks = new Map<
        string,
        { at: string; currentHash: string; event: RegulatoryEvent } | null
      >();
      for (let start = 0; start < eventIds.length; start += 10) {
        const ids = eventIds.slice(start, start + 10);
        try {
          const snapshot = await loadEvidence({ eventIds: ids, query: {} });
          await verifyEvidence(snapshot);
          if (
            snapshot.manifest.events.length !== ids.length ||
            snapshot.manifest.events.some((e) => !ids.includes(e.id))
          )
            throw new Error("Source selection mismatch");
          for (const event of snapshot.manifest.events) {
            const hashes = new Set(
              snapshot.manifest.evidence
                .filter((e) => e.eventId === event.id)
                .map((e) => e.currentPayloadSha256),
            );
            const currentHash = [...hashes][0];
            checks.set(
              event.id,
              hashes.size === 1 && currentHash
                ? { at: snapshot.manifest.generatedAt, currentHash, event }
                : null,
            );
          }
        } catch {
          for (const id of ids) checks.set(id, null);
        }
      }
      await change((current, revision, at) => {
        for (const review of current.reviews) {
          if (!checks.has(review.eventId)) continue;
          const result = checks.get(review.eventId);
          const previous = clone(review);
          if (
            !result ||
            result.event.source !== review.source ||
            result.event.nativeId !== review.nativeId ||
            result.event.payloadSha256 !== review.payloadSha256
          )
            review.sourceCheckStatus = "unavailable";
          else {
            review.sourceCheckedAt = result.at;
            review.sourceCheckStatus =
              result.currentHash === review.payloadSha256 ? "current" : "changed";
            review.needsReconsideration = review.sourceCheckStatus === "changed";
            review.sourceVerification = "server_snapshot";
          }
          history(current, revision, at, "source_check", review.id, previous);
        }
        return null;
      });
      return view(await full());
    },
    async saveBrief(input: BriefInput): Promise<RegulatoryBrief> {
      const data = briefInputSchema.parse({ ...input, organizationId: dummyOrganization });
      // Private title and investigation identity never enter the evidence request.
      const snapshot = await loadEvidence({
        eventIds: data.eventIds,
        query: data.query as RegulatoryQuery,
      });
      await verifyEvidence(snapshot);
      if (
        snapshot.manifest.events.length !== data.eventIds.length ||
        snapshot.manifest.events.some((e) => !data.eventIds.includes(e.id))
      )
        throw new LocalRegulatoryWorkspaceError(
          "The source snapshot does not match the selected events.",
        );
      return change((work, revision, at) => {
        checkInvestigation(work, data.investigationId);
        const saved: RegulatoryBrief = {
          id: crypto.randomUUID(),
          title: data.title,
          investigationId: data.investigationId ?? null,
          createdBy: LOCAL_ACTOR,
          createdAt: at,
          manifestSha256: snapshot.manifestSha256,
          manifest: clone(snapshot.manifest),
          sourceVerification: "server_snapshot",
        };
        work.briefs.unshift(saved);
        history(work, revision, at, "brief", saved.id);
        return saved;
      });
    },
    async export(): Promise<string> {
      const work = await full();
      return JSON.stringify({
        format: "regulatory-workspace-backup/1",
        exportedAt: now(),
        workspace: work,
        sha256: await hash(work),
      });
    },
    async import(
      text: string,
      input: { mode: "merge" | "replace" },
    ): Promise<LocalRegulatoryWorkspace> {
      if (
        !["merge", "replace"].includes(input.mode) ||
        new TextEncoder().encode(text).byteLength > MAX_REGULATORY_BACKUP_BYTES
      )
        throw new LocalRegulatoryWorkspaceError(
          "Choose merge or replace and a workspace backup no larger than 40 MB.",
        );
      let packet: unknown;
      try {
        packet = JSON.parse(text);
      } catch {
        throw new LocalRegulatoryWorkspaceError(
          "The backup is not valid JSON. Existing work was not changed.",
        );
      }
      const backup = z
        .object({
          format: z.literal("regulatory-workspace-backup/1"),
          exportedAt: stampSchema,
          workspace: z.unknown(),
          sha256: hashSchema,
        })
        .strict()
        .safeParse(packet);
      if (!backup.success)
        throw new LocalRegulatoryWorkspaceError(
          "This backup format is unsupported. Existing work was not changed.",
        );
      const imported = checkedWorkspace(backup.data.workspace);
      if ((await hash(imported)) !== backup.data.sha256)
        throw new LocalRegulatoryWorkspaceError(
          "Backup checksum mismatch. Existing work was not changed.",
        );
      for (const brief of imported.briefs)
        await verifyEvidence({ manifest: brief.manifest!, manifestSha256: brief.manifestSha256 });
      await change((work, revision, at) => {
        const previousRevision = work.revision;
        const beforeReplace =
          input.mode === "replace"
            ? {
                investigations: work.investigations,
                watchlists: work.watchlists,
                reviews: work.reviews,
                briefs: work.briefs,
              }
            : null;
        for (const key of ["investigations", "watchlists", "reviews", "briefs"] as const) {
          const existing = input.mode === "replace" ? [] : work[key];
          const incoming = imported[key]
            .filter((row) => {
              const old = existing.find((x) => x.id === row.id);
              const identityContent = (value: unknown) => {
                const copy = clone(value) as Record<string, unknown>;
                // These fields reflect a local check/import, not the identity of an immutable note/brief.
                if (key === "briefs" || key === "reviews") {
                  delete copy["sourceVerification"];
                  delete copy["createdBy"];
                  delete copy["reviewedBy"];
                  delete copy["needsReconsideration"];
                  delete copy["sourceCheckedAt"];
                  delete copy["sourceCheckStatus"];
                }
                return canonicalRegulatoryJson(copy);
              };
              if (old && identityContent(old) !== identityContent(row))
                throw new LocalRegulatoryWorkspaceError(
                  `The backup conflicts with local record ${row.id}. Merge did not change anything; review the backup before choosing replace.`,
                );
              return !old;
            })
            .map((row) => {
              const copied = clone(row) as unknown as Record<string, RegulatoryJson>;
              if (key === "briefs" || key === "reviews")
                copied["sourceVerification"] = "imported_unverified";
              if (key === "reviews") {
                copied["needsReconsideration"] = true;
                copied["reviewedBy"] = "Imported work product";
                copied["sourceCheckStatus"] = "unavailable";
                delete copied["sourceCheckedAt"];
              }
              if (key === "briefs") copied["createdBy"] = "Imported work product";
              return copied;
            });
          // Each array is validated by checkedWorkspace before the transaction commits.
          (work as unknown as Record<string, unknown>)[key] = [...existing, ...incoming];
        }
        for (const item of imported.history) {
          const old = work.history.find((x) => x.id === item.id);
          if (old) {
            const { importedFromSha256: _oldOrigin, ...oldValue } = old;
            const { importedFromSha256: _newOrigin, ...newValue } = item;
            if (canonicalRegulatoryJson(oldValue) !== canonicalRegulatoryJson(newValue))
              throw new LocalRegulatoryWorkspaceError(
                "Imported history conflicts with an existing revision. No work was changed.",
              );
          } else
            work.history.push({
              ...clone(item),
              importedFromSha256: item.importedFromSha256 ?? backup.data.sha256,
            });
        }
        history(work, revision, at, "import", "workspace", {
          mode: input.mode,
          backupSha256: backup.data.sha256,
          previousRevision,
          importedRevision: imported.revision,
          beforeReplace,
        });
        return null;
      });
      return view(await full());
    },
    async close() {
      if (database) (await database.catch(() => null))?.close();
      database = undefined;
    },
  };
}

const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;
let defaultStore: ReturnType<typeof createLocalRegulatoryWorkspace> | undefined;
function notify(revision: number) {
  listeners.forEach((listener) => listener());
  channel?.postMessage({ revision });
}
function localStore() {
  return (defaultStore ??= createLocalRegulatoryWorkspace({ notify }));
}
export function subscribeLocalRegulatoryWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  if (!channel && typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("seeger-weiss-regulatory-workspace-changes");
    channel.onmessage = () => listeners.forEach((callback) => callback());
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      channel?.close();
      channel = undefined;
    }
  };
}
export const loadLocalRegulatoryWorkspace = () => localStore().load();
export const saveLocalRegulatoryInvestigation = (input: InvestigationInput) =>
  localStore().saveInvestigation(input);
export const saveLocalRegulatoryWatchlist = (input: WatchlistInput) =>
  localStore().saveWatchlist(input);
export const saveLocalRegulatoryReview = (input: ReviewInput) => localStore().saveReview(input);
export const recheckLocalRegulatoryReviews = (input: RecheckInput = {}) =>
  localStore().recheckReviews(input);
export const saveLocalRegulatoryBrief = (input: BriefInput) => localStore().saveBrief(input);
export const getLocalRegulatoryBrief = (id: string) => localStore().getBrief(id);
export const exportLocalRegulatoryWorkspace = () => localStore().export();
export const importLocalRegulatoryWorkspace = (
  json: string,
  options: { mode: "merge" | "replace" },
) => localStore().import(json, options);

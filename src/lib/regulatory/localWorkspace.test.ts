import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createHash, webcrypto } from "node:crypto";
import { createLocalRegulatoryWorkspace } from "./localWorkspace";
import { canonicalRegulatoryJson } from "./core";
import type { RegulatoryEvidenceSnapshot, RegulatoryEvent, RegulatoryRecordData } from "./types";

const at = "2026-10-12T18:00:00.000Z";
const sha = (v: unknown) => createHash("sha256").update(canonicalRegulatoryJson(v)).digest("hex");
const record: RegulatoryRecordData = {
  native_id: "2026-12345",
  title: "Offline source notice",
  document_type: "Notice",
  published_on: "2026-10-10",
  source_updated_on: null,
  source_url: "https://www.federalregister.gov/documents/2026-12345",
  agency_ids: ["54"],
  agency_names: ["Synthetic agency"],
  entity_refs: [],
  identifiers: [],
  status: null,
  fields: { action: "Notice" },
  correction_of: [],
  evidence_excerpt: "Literal fixture text.",
};
const event: RegulatoryEvent = {
  id: "a".repeat(64),
  source: "federal_register",
  nativeId: record.native_id,
  eventType: "initial_record",
  reason: "Initial acquisition",
  changedFields: [],
  detectedAt: at,
  payloadSha256: sha(record),
  previousPayloadSha256: null,
  ruleVersion: "regulatory-events/1",
  record,
};
function snapshot(current = event.payloadSha256): RegulatoryEvidenceSnapshot {
  const manifest: RegulatoryEvidenceSnapshot["manifest"] = {
    version: "regulatory-brief/1",
    generatedAt: at,
    title: "Regulatory source evidence",
    query: {},
    events: [structuredClone(event)],
    qualifications: ["Source records are not findings of liability."],
    sources: [
      {
        id: "federal_register",
        label: "Federal Register",
        agency: "Federal Register",
        sourceUrl: "https://www.federalregister.gov",
        countUnit: "documents",
        qualification: "Bounded source window.",
        enabled: true,
        latestCompletedAt: at,
        latestAttemptAt: at,
        latestAttemptStatus: "completed",
        coverageFrom: "2026-10-01",
        coverageTo: "2026-10-12",
        records: 1,
        events: 1,
      },
    ],
    evidence: [
      {
        eventId: event.id,
        runId: "00000000-0000-4000-8000-000000000002",
        payloadSha256: event.payloadSha256,
        rawSha256: "b".repeat(64),
        captureSourceUrl: "https://www.federalregister.gov/api/v1/documents.json?page=1",
        retrievedAt: at,
        recordPointer: "results[0]",
        parser: "regulatory-record/1",
        currentPayloadSha256: current,
      },
    ],
    coverageRuns: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        source: "federal_register",
        status: "completed",
        mode: "initial",
        startedAt: at,
        finishedAt: at,
        windowFrom: "2026-10-01",
        windowTo: "2026-10-12",
        expectedCount: 1,
        observedCount: 1,
        errorCode: null,
        scope: { window_complete: false },
      },
    ],
  };
  return { manifest, manifestSha256: sha(manifest) };
}
const stores: ReturnType<typeof createLocalRegulatoryWorkspace>[] = [];
function setup(options: Parameters<typeof createLocalRegulatoryWorkspace>[0] = {}) {
  const loader = vi.fn(async () => snapshot());
  const store = createLocalRegulatoryWorkspace({
    indexedDB: new IDBFactory(),
    crypto: webcrypto as unknown as Crypto,
    now: () => at,
    loadEvidence: loader,
    ...options,
  });
  stores.push(store);
  return { store, loader };
}
afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.close()));
});

describe("browser-local regulatory work product", () => {
  it("persists notes and watchlists across reopen, with before-images and no network", async () => {
    const db = new IDBFactory();
    const { store, loader } = setup({ indexedDB: db });
    const inv = await store.saveInvestigation({
      title: "Private strategy",
      description: "Confidential notes",
    });
    await store.saveInvestigation({
      id: inv.id,
      title: "Updated strategy",
      description: inv.description,
    });
    await store.saveWatchlist({
      name: "FDA window",
      query: { sourceFamily: "fda", dateBasis: "published", from: "2026-10-01", to: "2026-10-12" },
      investigationId: inv.id,
    });
    await store.close();
    const reopened = setup({ indexedDB: db }).store;
    const work = await reopened.load();
    expect(work.revision).toBe(3);
    expect(work.investigations[0]?.title).toBe("Updated strategy");
    expect(work.history[1]?.previous).toMatchObject({ title: "Private strategy" });
    expect(work.watchlists[0]?.investigationId).toBe(inv.id);
    expect(loader).not.toHaveBeenCalled();
  });
  it("serializes concurrent tab transactions without losing either change", async () => {
    const db = new IDBFactory();
    const a = setup({ indexedDB: db }).store,
      b = setup({ indexedDB: db }).store;
    await Promise.all([
      a.saveInvestigation({ title: "A", description: "" }),
      b.saveInvestigation({ title: "B", description: "" }),
    ]);
    expect((await a.load()).investigations.map((i) => i.title).sort()).toEqual(["A", "B"]);
    expect((await b.load()).revision).toBe(2);
  });
  it("pins reviews and briefs to verified source evidence without transmitting private content", async () => {
    const { store, loader } = setup();
    const review = await store.saveReview({
      event,
      status: "relevant",
      note: "Private litigation theory",
    });
    expect(review).toMatchObject({
      reviewedBy: "This browser",
      sourceCheckStatus: "current",
      sourceCheckedAt: at,
      needsReconsideration: false,
    });
    expect(loader).toHaveBeenCalledWith({ eventIds: [event.id], query: {} });
    const brief = await store.saveBrief({
      title: "Private brief title",
      eventIds: [event.id],
      query: { sourceFamily: "federal_register" },
    });
    expect(loader.mock.calls.flat()).not.toContain("Private litigation theory");
    expect(JSON.stringify(loader.mock.calls)).not.toContain("Private brief title");
    expect(brief.manifest?.title).toBe("Regulatory source evidence");
    expect(brief.manifestSha256).toBe(sha(brief.manifest));
    expect((await store.load()).briefs[0]?.manifest).toBeUndefined();
    expect((await store.getBrief(brief.id))?.manifest).toEqual(brief.manifest);
  });
  it("rejects changed payloads, missing raw bindings and wrong selections before any local write", async () => {
    const variants = [snapshot(), snapshot(), snapshot()];
    variants[0]!.manifest.events[0]!.record.title = "Tampered body";
    variants[1]!.manifest.evidence[0]!.payloadSha256 = "c".repeat(64);
    variants[2]!.manifest.events[0]!.id = "d".repeat(64);
    variants[2]!.manifest.evidence[0]!.eventId = "d".repeat(64);
    for (const bad of variants) {
      bad.manifestSha256 = sha(bad.manifest);
      const { store } = setup({ loadEvidence: async () => bad });
      await expect(
        store.saveBrief({ title: "Brief", eventIds: [event.id], query: {} }),
      ).rejects.toThrow();
      expect((await store.load()).revision).toBe(0);
    }
  });
  it("rechecks later revisions and preserves the original review and last successful check on outage", async () => {
    let evidence = snapshot();
    let unavailable = false;
    const { store } = setup({
      loadEvidence: async () => {
        if (unavailable) throw new Error("offline");
        return evidence;
      },
    });
    const review = await store.saveReview({
      event,
      status: "dismissed",
      note: "Decision on the initial version",
    });
    evidence = snapshot("c".repeat(64));
    evidence.manifest.generatedAt = "2026-10-13T18:00:00.000Z";
    evidence.manifestSha256 = sha(evidence.manifest);
    let work = await store.recheckReviews({ source: event.source, nativeId: event.nativeId });
    expect(work.reviews[0]).toMatchObject({
      id: review.id,
      eventId: event.id,
      status: "dismissed",
      note: review.note,
      payloadSha256: review.payloadSha256,
      sourceCheckStatus: "changed",
      needsReconsideration: true,
      sourceCheckedAt: evidence.manifest.generatedAt,
    });
    expect(work.history.at(-1)?.action).toBe("source_check");
    unavailable = true;
    work = await store.recheckReviews();
    expect(work.reviews[0]).toMatchObject({
      sourceCheckStatus: "unavailable",
      needsReconsideration: true,
      sourceCheckedAt: evidence.manifest.generatedAt,
    });
    expect(work.reviews[0]?.createdAt).toBe(review.createdAt);
  });
  it("exports and imports durable complete history, marks imported evidence unverified, and merges idempotently", async () => {
    const { store } = setup();
    const inv = await store.saveInvestigation({ title: "Investigation", description: "Private" });
    await store.saveInvestigation({ id: inv.id, title: "Renamed", description: "Private" });
    await store.saveReview({
      event,
      status: "relevant",
      note: "Private review",
      investigationId: inv.id,
    });
    await store.saveBrief({
      title: "Brief",
      eventIds: [event.id],
      query: {},
      investigationId: inv.id,
    });
    const backup = await store.export();
    expect(backup).not.toContain("\n");
    const target = setup().store;
    let imported = await target.import(backup, { mode: "merge" });
    expect(imported.investigations[0]?.title).toBe("Renamed");
    expect(imported.reviews[0]).toMatchObject({
      sourceVerification: "imported_unverified",
      sourceCheckStatus: "unavailable",
      needsReconsideration: true,
    });
    expect(imported.reviews[0]?.sourceCheckedAt).toBeUndefined();
    expect(imported.briefs[0]?.sourceVerification).toBe("imported_unverified");
    expect(imported.history.filter((h) => h.importedFromSha256)).toHaveLength(4);
    imported = await target.recheckReviews();
    expect(imported.reviews[0]).toMatchObject({
      sourceVerification: "server_snapshot",
      sourceCheckStatus: "current",
      needsReconsideration: false,
    });
    imported = await target.import(backup, { mode: "merge" });
    expect(imported.reviews).toHaveLength(1);
    expect(imported.reviews[0]?.sourceVerification).toBe("server_snapshot");
    expect(imported.briefs).toHaveLength(1);
  });
  it("fails an entire conflicting merge, invalid checksum or unsupported format without overwriting", async () => {
    const source = setup().store,
      target = setup().store;
    const inv = await source.saveInvestigation({ title: "Original", description: "" });
    const backup = await source.export();
    await target.import(backup, { mode: "merge" });
    await source.saveInvestigation({
      id: inv.id,
      title: "Conflicting later edit",
      description: "",
    });
    const before = await target.export();
    await expect(target.import(await source.export(), { mode: "merge" })).rejects.toThrow(
      /conflicts/,
    );
    expect(await target.export()).toBe(before);
    const parsed = JSON.parse(backup);
    parsed.workspace.investigations[0].title = "Tampered";
    await expect(target.import(JSON.stringify(parsed), { mode: "merge" })).rejects.toThrow();
    parsed.workspace.storeVersion = 2;
    parsed.sha256 = sha(parsed.workspace);
    await expect(target.import(JSON.stringify(parsed), { mode: "merge" })).rejects.toThrow(
      /invalid or unsupported/,
    );
    expect(await target.export()).toBe(before);
  });
  it("keeps prior records in revision evidence during an explicit replacement", async () => {
    const target = setup().store,
      source = setup().store;
    await target.saveInvestigation({
      title: "Prior workspace",
      description: "Preserve this history",
    });
    await source.saveInvestigation({ title: "Replacement workspace", description: "" });
    const replaced = await target.import(await source.export(), { mode: "replace" });
    expect(replaced.investigations.map((x) => x.title)).toEqual(["Replacement workspace"]);
    expect(JSON.stringify(replaced.history.at(-1)?.previous)).toContain("Prior workspace");
  });
  it("surfaces unavailable storage and cannot report a save that failed", async () => {
    const broken = {
      open() {
        throw new DOMException("disabled", "SecurityError");
      },
    } as unknown as IDBFactory;
    const { store } = setup({ indexedDB: broken });
    await expect(
      store.saveInvestigation({ title: "Cannot save", description: "" }),
    ).rejects.toThrow();
  });
});

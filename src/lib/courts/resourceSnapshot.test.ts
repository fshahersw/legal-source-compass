import { afterEach, describe, expect, it, vi } from "vitest";
import {
  courtResourceSnapshotSchema,
  loadCourtResourceSnapshot,
  mergeCourtResourceSnapshot,
  COURT_RESOURCE_SNAPSHOT,
} from "./resourceSnapshot";

const fetchBundleSnapshot = vi.hoisted(() => vi.fn());
vi.mock("@/lib/private-data/client", () => ({ fetchBundleSnapshot }));
afterEach(() => vi.clearAllMocks());
const bundle = () => ({
  schema: "court-resources/1",
  release: "test-reviewed-source",
  generatedAt: "2026-10-12T18:00:00Z",
  resources: [
    {
      id: `resource:${"a".repeat(64)}`,
      courtId: "cand",
      courtName: "Northern District of California",
      courtSystem: "Federal",
      label: "Civil Local Rules",
      url: "https://cand.uscourts.gov/civil-rules",
      kind: "rules",
      status: "source_link_observed",
      provenance: {
        sourcePage: "https://cand.uscourts.gov/",
        sourceRecord: "court_spine:cand",
        capturedAt: "2026-10-12T17:00:00Z",
        responseSha256: "b".repeat(64),
        receiptSha256: "c".repeat(64),
      },
      review: {
        decision: "approved",
        reviewer: "source review",
        reviewedAt: "2026-10-12T18:00:00Z",
        note: "Exact court and observed anchor reviewed",
      },
    },
  ],
});

describe("reviewed court resource snapshots", () => {
  it("requires explicit approved review, exact identity and immutable capture provenance", () => {
    expect(courtResourceSnapshotSchema.safeParse(bundle()).success).toBe(true);
    for (const alter of [
      (value: ReturnType<typeof bundle>) => {
        value.resources[0]!.review.decision = "hold";
      },
      (value: ReturnType<typeof bundle>) => {
        value.resources[0]!.provenance.responseSha256 = "";
      },
      (value: ReturnType<typeof bundle>) => {
        value.resources[0]!.courtId = "cand-other?";
      },
      (value: ReturnType<typeof bundle>) => {
        value.resources[0]!.url = "not a URL";
      },
      (value: ReturnType<typeof bundle>) => {
        value.resources[0]!.url = "https://user:secret@court.example/";
      },
      (value: ReturnType<typeof bundle>) => {
        value.resources[0]!.url = "https://court.example/forms ";
      },
      (value: ReturnType<typeof bundle>) => {
        value.resources[0]!.url = "https://court.example/local\nrules";
      },
      (value: ReturnType<typeof bundle>) => {
        value.resources[0]!.courtSystem = "State";
      },
    ]) {
      const changed = bundle();
      alter(changed);
      expect(courtResourceSnapshotSchema.safeParse(changed).success).toBe(false);
    }
  });
  it("rejects duplicate destinations and conflicting court systems", () => {
    const duplicate = bundle();
    duplicate.resources.push({ ...duplicate.resources[0]! });
    expect(courtResourceSnapshotSchema.safeParse(duplicate).success).toBe(false);
    const conflict = bundle();
    conflict.resources.push({
      ...conflict.resources[0]!,
      id: `resource:${"d".repeat(64)}`,
      courtName: "Another court",
      url: "https://court.example/forms",
    });
    expect(courtResourceSnapshotSchema.safeParse(conflict).success).toBe(false);
  });
  it("merges only the exact ID and system; enriches exact URLs without replacing stored labels", () => {
    const snapshot = courtResourceSnapshotSchema.parse(bundle());
    expect(mergeCourtResourceSnapshot([], snapshot, "CAND", "Federal")).toEqual([]);
    expect(mergeCourtResourceSnapshot([], snapshot, "cand", "State")).toEqual([]);
    expect(mergeCourtResourceSnapshot([], snapshot, "cand", null)).toEqual([]);
    const stored = [
      {
        url: snapshot.resources[0]!.url,
        label: "Stored original label",
        host: "cand.uscourts.gov",
        kind: "forms" as const,
        recordedIn: "Court profile",
      },
    ];
    const merged = mergeCourtResourceSnapshot(stored, snapshot, "cand", "Federal");
    expect(merged).toHaveLength(1);
    expect(merged[0]?.label).toBe("Stored original label");
    expect(merged[0]?.sourceLabel).toBe("Civil Local Rules");
    expect(merged[0]?.kind).toBe("rules");
    expect(merged[0]?.provenance?.responseSha256).toBe("b".repeat(64));
    expect(stored[0]).not.toHaveProperty("provenance");
  });
  it("reads solely through the protected snapshot protocol", async () => {
    fetchBundleSnapshot.mockResolvedValue(new Response(JSON.stringify(bundle())));
    await expect(loadCourtResourceSnapshot()).resolves.toMatchObject({ status: "available" });
    expect(fetchBundleSnapshot).toHaveBeenCalledWith(COURT_RESOURCE_SNAPSHOT, undefined);
  });
  it("keeps unpublished, denied and invalid snapshots distinct", async () => {
    fetchBundleSnapshot.mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    await expect(loadCourtResourceSnapshot()).resolves.toEqual({ status: "not-published" });
    fetchBundleSnapshot.mockResolvedValueOnce(new Response("Denied", { status: 403 }));
    await expect(loadCourtResourceSnapshot()).rejects.toThrow("could not be loaded");
    fetchBundleSnapshot.mockResolvedValueOnce(new Response(JSON.stringify({ resources: [] })));
    await expect(loadCourtResourceSnapshot()).rejects.toThrow("failed validation");
  });
});

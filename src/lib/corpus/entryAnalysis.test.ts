import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEntryAnalysis, summarizeEntryScopes, type EntryAnalysis } from "./entryAnalysis";

// These tests validate source payloads; the authenticated transport is tested separately.
vi.mock("@/lib/private-data/client", () => ({
  fetchBundleSnapshot: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

const readSnapshot = (path: string): EntryAnalysis => JSON.parse(readFileSync(path, "utf8"));
const historical = readSnapshot(
  "private/data/quality/courtlistener-entry-analysis-2026-10-02-v1.json",
);
const current = readSnapshot("private/data/quality/courtlistener-entry-analysis-2026-10-02.json");
const v3 = readSnapshot("private/data/quality/courtlistener-entry-analysis-2026-10-02-v3.json");
const v4FixturePath = "src/lib/corpus/__fixtures__/entry-analysis-v4.json";
const v4 = readSnapshot(v4FixturePath);
type ScopeReceipt = [string, boolean, number, number, number, number];
const commonComplete: ScopeReceipt[] = [
  ["16284915", true, 5373, 5362, 0, 11],
  ["18753355", true, 419, 419, 0, 0],
  ["5838695", true, 1337, 1337, 0, 0],
  ["6224301", true, 1263, 1263, 0, 0],
  ["65407433", true, 4033, 3986, 0, 47],
  ["68222905", true, 1034, 1034, 0, 0],
  ["7603829", true, 994, 994, 0, 0],
];
const reviewed = {
  v1: {
    schema: "courtlistener-entry-analysis/1",
    signature: "3e0ec6816f07b0f675ea00fb4a9649972201d67ae3e620fe35be32657a8560b1",
    captured: 15053,
    eligible: 14947,
    excluded: 106,
    sealed: 66,
    partialCaptured: 600,
    partialEligible: 552,
    partial: [
      ["14916674", false, 40, 0, 40, 0],
      ["4134359", false, 160, 160, 0, 0],
      ["4264145", false, 160, 160, 0, 0],
      ["4270519", false, 80, 80, 0, 0],
      ["6102388", false, 40, 32, 0, 8],
      ["6240169", false, 40, 40, 0, 0],
      ["67678440", false, 40, 40, 0, 0],
      ["8408916", false, 40, 40, 0, 0],
    ] as ScopeReceipt[],
  },
  v3: {
    schema: "courtlistener-entry-analysis/3",
    signature: "3908b6e5b2a216e87acc3fde4f44127f6d5bfaa93c49e4cbc2f4733925f14ba9",
    captured: 24033,
    eligible: 23919,
    excluded: 114,
    sealed: 74,
    partialCaptured: 9580,
    partialEligible: 9524,
    partial: [
      ["14916674", false, 40, 0, 40, 0],
      ["4134359", false, 300, 300, 0, 0],
      ["4264145", false, 2160, 2160, 0, 0],
      ["4270519", false, 1200, 1200, 0, 0],
      ["6102388", false, 40, 32, 0, 8],
      ["6240169", false, 2040, 2040, 0, 0],
      ["67678440", false, 1760, 1760, 0, 0],
      ["8408916", false, 2040, 2032, 0, 8],
    ] as ScopeReceipt[],
  },
  v4: {
    schema: "courtlistener-entry-analysis/4",
    signature: "a9eeb88c2ac73f376ae6a18c8cbf5e491b8c2e236b32e24be5eecea49ad2145d",
    captured: 33033,
    eligible: 32898,
    excluded: 135,
    sealed: 95,
    partialCaptured: 18580,
    partialEligible: 18503,
    partial: [
      ["14916674", false, 40, 0, 40, 0],
      ["4134359", false, 300, 300, 0, 0],
      ["4264145", false, 4160, 4160, 0, 0],
      ["4270519", false, 2580, 2580, 0, 0],
      ["6102388", false, 80, 57, 0, 23],
      ["6240169", false, 4040, 4040, 0, 0],
      ["67678440", false, 3340, 3340, 0, 0],
      ["8408916", false, 4040, 4026, 0, 14],
    ] as ScopeReceipt[],
  },
};
// Current publication may advance only to one of these independently reviewed receipts.
const currentReceipt = [reviewed.v3, reviewed.v4].find(
  (receipt) => receipt.signature === current.sourceSignatureSha256,
);
const versions = [
  { label: "preserved historical V1", snapshot: historical, receipt: reviewed.v1 },
  { label: "current reviewed publication", snapshot: current, receipt: currentReceipt },
  { label: "frozen V3", snapshot: v3, receipt: reviewed.v3 },
  { label: "prepared V4 fixture, not publication proof", snapshot: v4, receipt: reviewed.v4 },
];

describe.each(versions)("native entry research snapshot: $label", ({ snapshot, receipt }) => {
  it("reconciles complete and partial grains without extrapolating samples", () => {
    expect(receipt, "Current data must match a reviewed source signature").toBeDefined();
    if (!receipt) throw new Error("Unreviewed current entry snapshot");
    const complete = snapshot.scopes.filter((scope) => scope.complete);
    const partial = snapshot.scopes.filter((scope) => !scope.complete);
    expect(complete).toHaveLength(7);
    expect(partial).toHaveLength(8);
    expect(snapshot.scopeCount).toBe(15);
    expect(snapshot.completeScopeCount).toBe(7);
    expect(snapshot.partialScopeCount).toBe(8);
    expect(snapshot.schemaVersion).toBe(receipt.schema);
    expect(snapshot.grain).toBe("One unique native docket entry");
    expect(summarizeEntryScopes(complete).capturedEntries).toBe(14453);
    expect(summarizeEntryScopes(partial).capturedEntries).toBe(receipt.partialCaptured);
    expect(summarizeEntryScopes(complete).eligibleEntries).toBe(14395);
    expect(summarizeEntryScopes(partial).eligibleEntries).toBe(receipt.partialEligible);
    expect(
      snapshot.scopes
        .map((scope) => [
          scope.nativeDocketId,
          scope.complete,
          scope.capturedEntries,
          scope.eligibleEntries,
          scope.sourceBlockedEntries,
          scope.explicitlySealedEntries,
        ])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([...commonComplete, ...receipt.partial].sort(([a], [b]) => a.localeCompare(b)));
    const all = summarizeEntryScopes(snapshot.scopes);
    expect(snapshot.totals).toEqual({
      capturedEntries: receipt.captured,
      eligibleEntries: receipt.eligible,
      excludedEntries: receipt.excluded,
      sourceBlockedEntries: 40,
      explicitlySealedEntries: receipt.sealed,
      datedEntries: receipt.eligible,
      missingDateEntries: 0,
      invalidDateEntries: 0,
      afterCaptureDateEntries: 0,
    });
    expect(all.capturedEntries).toBe(receipt.captured);
    expect(all.eligibleEntries + all.excludedEntries).toBe(receipt.captured);
    expect(all.filingYears.reduce((n, row) => n + row.count, 0)).toBe(receipt.eligible);
    expect(all.courts.reduce((n, row) => n + row.count, 0)).toBe(receipt.eligible);
    expect(snapshot.qualification).toContain(
      "Partial scopes must not be compared as complete filing volumes.",
    );
    expect(snapshot.qualification).toContain("no outcome, likelihood or causation is inferred.");
  });

  it("keeps excluded entry dates out of every timeline and preserves exact native court IDs", () => {
    for (const scope of snapshot.scopes) {
      expect(scope.filingYears.reduce((n, row) => n + row.entries, 0)).toBe(scope.datedEntries);
      expect(scope.datedEntries + scope.missingDateEntries + scope.invalidDateEntries).toBe(
        scope.eligibleEntries,
      );
      expect(scope.court.resourceUrl).toBe(
        `https://www.courtlistener.com/api/rest/v4/courts/${scope.court.nativeId}/`,
      );
      expect(scope.headerEvidence.sourceUrl).toBe(
        `https://www.courtlistener.com/api/rest/v4/dockets/${scope.nativeDocketId}/`,
      );
      expect(scope.headerEvidence.recordSha256).toMatch(/^[a-f0-9]{64}$/);
    }
    const blocked = snapshot.scopes.find((scope) => scope.nativeDocketId === "14916674")!;
    expect(blocked.sourceBlockedEntries).toBe(40);
    expect(blocked.eligibleEntries).toBe(0);
    expect(blocked.filingYears).toEqual([]);
    expect(blocked.filingRange).toEqual({ first: null, last: null });
    expect(blocked.entryListingUrl).toBeNull();
  });

  it("publishes aggregate evidence rather than private captions, document locators or role arrays", () => {
    const permitted = [
      "nativeDocketId",
      "sourceMdlNumber",
      "complete",
      "capturedEntries",
      "eligibleEntries",
      "excludedEntries",
      "sourceBlockedEntries",
      "explicitlySealedEntries",
      "datedEntries",
      "missingDateEntries",
      "invalidDateEntries",
      "afterCaptureDateEntries",
      "filingRange",
      "filingYears",
      "court",
      "sourceDocketUrl",
      "entryListingUrl",
      "headerEvidence",
    ].sort();
    for (const scope of snapshot.scopes) expect(Object.keys(scope).sort()).toEqual(permitted);
    const privateKeys = new Set([
      "case_name",
      "description",
      "recap_documents",
      "parties",
      "attorneys",
      "email",
      "phone",
      "filepath_local",
      "pdf_url",
      "plain_text",
    ]);
    const inspect = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(inspect);
        return;
      }
      if (value && typeof value === "object")
        for (const [key, child] of Object.entries(value)) {
          expect(privateKeys.has(key)).toBe(false);
          inspect(child);
        }
    };
    inspect(snapshot);
    expect(snapshot.pdfDownloads).toBe(0);
    expect(snapshot.sourceSignatureSha256).toBe(receipt?.signature);
  });
});

describe("public timeline loader", () => {
  afterEach(() => vi.unstubAllGlobals());
  const serve = (value: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => value,
      }),
    );

  it.each(versions)(
    "loads $label with reviewed units and privacy qualifications",
    async ({ snapshot }) => {
      serve(snapshot);
      await expect(loadEntryAnalysis()).resolves.toEqual(snapshot);
    },
  );

  it("pins the V4 fixture to the exact frozen prepared source without claiming publication", () => {
    expect(createHash("sha256").update(readFileSync(v4FixturePath)).digest("hex")).toBe(
      "b8629925004814bffeabaedf2b1e8672f9823e9433edcdcf5dc8d4d1f9895831",
    );
    expect(v4.publicationState).toBe(
      "prepared-pending-private-intake-and-full-public-reconciliation",
    );
  });

  it("keeps publication proof separate from a prepared aggregate fixture", () => {
    expect(current.publicationState).toBe(
      "published-independent-private-native-and-full-public-reconciliation-verified",
    );
    expect(current.publicationProof).toMatchObject({
      dataset: "cl_master_entries",
      ready: true,
      importedRecords: currentReceipt?.eligible,
      missingRecords: 0,
      mismatchedRecords: 0,
      unexpectedRecords: 0,
    });
    expect(current.publicationProof?.fullFieldsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(v4.publicationProof).toBeUndefined();
  });

  it.each([
    [
      "an unreviewed schema",
      (data: EntryAnalysis) => {
        data.schemaVersion = "courtlistener-entry-analysis/99";
      },
    ],
    [
      "a false counting unit",
      (data: EntryAnalysis) => {
        data.grain = "Cases or litigants";
      },
    ],
    [
      "a non-reconciled total",
      (data: EntryAnalysis) => {
        data.totals.eligibleEntries += 1;
      },
    ],
    [
      "duplicate native scope identity",
      (data: EntryAnalysis) => {
        data.scopes[1] = data.scopes[0]!;
      },
    ],
    [
      "dates from a blocked scope",
      (data: EntryAnalysis) => {
        data.scopes[0]!.filingYears = [{ year: 2026, entries: 40 }];
      },
    ],
    [
      "private caption payload",
      (data: EntryAnalysis) => {
        Object.assign(data.scopes[1]!, { case_name: "Private caption" });
      },
    ],
    [
      "a mismatched native parent URL",
      (data: EntryAnalysis) => {
        data.scopes[1]!.headerEvidence.sourceUrl =
          "https://www.courtlistener.com/api/rest/v4/dockets/1/";
      },
    ],
    [
      "an invented calendar date",
      (data: EntryAnalysis) => {
        data.scopes[1]!.filingRange.first = "2019-02-30";
      },
    ],
    [
      "missing partial-scope qualification",
      (data: EntryAnalysis) => {
        data.qualification = "All filing volumes.";
      },
    ],
    [
      "missing proof for a published state",
      (data: EntryAnalysis) => {
        delete data.publicationProof;
      },
    ],
    [
      "a non-reconciled publication proof",
      (data: EntryAnalysis) => {
        data.publicationProof!.importedRecords += 1;
      },
    ],
  ])("rejects %s before showing aggregate evidence", async (_label, mutate) => {
    const malformed = structuredClone(v3);
    (mutate as (data: EntryAnalysis) => void)(malformed);
    serve(malformed);
    await expect(loadEntryAnalysis()).rejects.toThrow("Unsupported native entry analysis snapshot");
  });
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  artworkForCourtId,
  classifyCourtType,
  courtTypeCoverage,
  recordedCourtArtwork,
  verifiedCourtArtwork,
} from "./artwork";

describe("court artwork", () => {
  it("selects verified artwork by exact court id only", () => {
    expect(artworkForCourtId("cand")?.courtName).toContain("Northern District of California");
    expect(artworkForCourtId("CAND")).toBeNull();
    expect(artworkForCourtId("cand-copy")).toBeNull();
    expect(artworkForCourtId("cand", "State")).toBeNull();
    expect(artworkForCourtId("cand", "Federal")?.courtId).toBe("cand");
  });

  it("keeps every registered asset present and checksum-verified", () => {
    expect(new Set(verifiedCourtArtwork.map((entry) => entry.courtId)).size).toBe(
      verifiedCourtArtwork.length,
    );
    for (const entry of verifiedCourtArtwork) {
      const bytes = readFileSync(
        resolve(process.cwd(), "public", entry.assetPath.replace(/^\//, "")),
      );
      expect(createHash("sha256").update(bytes).digest("hex"), entry.courtId).toBe(entry.sha256);
      expect(entry.sourcePage).toMatch(/^https:\/\//);
      expect(entry.sourceImage).toMatch(/^https:\/\//);
      expect(entry.description.length).toBeGreaterThan(10);
    }
  });

  it("includes marks acquired from each court's own homepage under that court's id only", () => {
    const acquired = verifiedCourtArtwork.filter((entry) => entry.retrievedAt !== "2026-10-05");
    expect(acquired.length).toBeGreaterThan(50);
    for (const entry of acquired) {
      expect(entry.assetPath.startsWith(`/court-marks/${entry.courtId}.`), entry.courtId).toBe(
        true,
      );
      expect(new URL(entry.sourcePage).host).toBe(`www.${entry.courtId}.uscourts.gov`);
      expect(new URL(entry.sourceImage).host).toBe(new URL(entry.sourcePage).host);
    }
    expect(artworkForCourtId("akd")?.kind).toBe("seal");
    expect(artworkForCourtId("nmb")).toBeNull();
    expect(artworkForCourtId("tnwb")).toBeNull();
    expect(artworkForCourtId("cand")?.retrievedAt).toBe("2026-10-05");
  });

  it.each([
    ["Federal", "U.S. Supreme Court", "us-supreme"],
    ["Federal", "Federal appellate", "federal-appellate"],
    ["Federal", "Federal district", "federal-district"],
    ["Federal", "Bankruptcy", "federal-bankruptcy"],
    ["State", "Supreme Court", "state-high"],
    ["State", "Court of Appeals", "state-appellate"],
    ["State", "Superior Court", "state-trial"],
    ["State", "County Court", "county"],
    ["State", "Family Court", "local-specialty"],
    ["State", "Former territorial court", "historical"],
    ["State", "Not recorded", "unclassified"],
  ])("classifies recorded system/type values conservatively", (system, type, group) => {
    expect(classifyCourtType(system, type)).toBe(group);
  });

  it("does not infer a court type from a title and reports unmapped source types", () => {
    expect(classifyCourtType("State", "General jurisdiction court")).toBe("unclassified");
    expect(courtTypeCoverage([{ system: "State", type: "General jurisdiction court" }])).toEqual([
      { system: "State", type: "General jurisdiction court", group: "unclassified", count: 1 },
    ]);
  });

  it("uses only local, exact-record image links and prefers a recorded seal", () => {
    expect(
      recordedCourtArtwork([
        { url: "https://third-party.test/logo.png", label: "Court logo" },
        { url: "/api/files/image", label: "Court image" },
        { url: "/api/files/seal", label: "Official seal" },
      ]),
    ).toEqual({ url: "/api/files/seal", label: "Official seal" });
    expect(
      recordedCourtArtwork([{ url: "//third-party.test/seal.svg", label: "Court seal" }]),
    ).toBeNull();
    expect(
      recordedCourtArtwork([{ url: "/\\third-party.test/seal.svg", label: "Court seal" }]),
    ).toBeNull();
  });

  it("draws a stored identity-mark image whatever its label's earlier permission note says", () => {
    const stored = {
      url: "/supplement-files/court_spine/ilnd/logo.png",
      label: "Identity mark image (reuse permission not established)",
    };
    expect(recordedCourtArtwork([stored])).toEqual(stored);
    // An explicit seal still comes first.
    expect(
      recordedCourtArtwork([stored, { url: "/api/files/seal", label: "Official seal" }]),
    ).toEqual({
      url: "/api/files/seal",
      label: "Official seal",
    });
  });
});

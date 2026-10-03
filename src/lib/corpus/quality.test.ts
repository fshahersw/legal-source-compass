import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBundle, valuesOf } from "@/lib/atlas/bundle";
import { parseRegistry } from "@/lib/atlas/registry";
import {
  directoryJurisdictionCounts,
  directoryQuality,
  knownCount,
  registryQuality,
} from "./quality";
import { classifySource } from "./taxonomy";

const parsed = parseBundle(
  JSON.parse(readFileSync("private/data/atlas-import-bundle.json", "utf8")),
);
if (!parsed.ok) throw new Error("Bundled source import failed");
const directory = parsed.bundle.sources.map((s) => ({
  id: s.id,
  url: s.url,
  domain: s.domain,
  jurisdictions: valuesOf(s, "jurisdiction"),
  headings: valuesOf(s, "heading_category"),
  occurrences: s.occurrences,
}));
const report = JSON.parse(readFileSync("private/data/quality/bundled-audit.json", "utf8"));

describe("reproducible quality measures", () => {
  it("reconciles runtime directory measures to original-file audit measures", () => {
    expect(directoryQuality(directory)).toEqual(report.directory);
    expect(report.directory.uniqueUrls).toBe(4633);
    expect(report.directory.occurrences).toBe(6372);
  });
  it("counts a multi-jurisdiction source once in each jurisdiction, never as a combined key", () => {
    expect([
      ...directoryJurisdictionCounts([{ jurisdictions: ["California", "Texas", "California"] }]),
    ]).toEqual([
      ["California", 1],
      ["Texas", 1],
    ]);
    expect(directoryJurisdictionCounts(directory).get("California")).toBe(105);
  });
  it("reconciles the registry hierarchy and historical observations", () => {
    const registry = parseRegistry(readFileSync("private/data/registry_v06_1.jsonl", "utf8"));
    const { invalidLines, ...expected } = report.registry;
    expect(registry.invalidLines).toBe(invalidLines);
    expect(registryQuality(registry.entries)).toEqual(expected);
    expect(expected.orphanParentIds).toEqual([]);
    expect(expected.latestCheckDate).toBe("2026-08-19");
  });
  it("keeps unknown counts distinct from a known zero", () => {
    expect(knownCount("loading", 0)).toBeNull();
    expect(knownCount("error", 0)).toBeNull();
    expect(knownCount("ready", 0)).toBe(0);
  });
  it("does not convert topical regulator headings to a document type", () => {
    expect(classifySource(["CONSUMER, FINANCIAL, ENVIRONMENTAL & HEALTH REGULATORS"])).toEqual([
      "other",
    ]);
    expect(classifySource(["50-STATE REGULATORY-EVIDENCE COVERAGE GUIDE"])).toEqual(["guidance"]);
    expect(classifySource(["STATUTES, CONSTITUTION & LEGISLATION"])).toEqual(["mixed"]);
    expect(classifySource(["REGULATIONS & RULEMAKING"])).toEqual(["regulations"]);
  });
  it("reconciles dataset counts, category/state counts and the release partition", () => {
    const db = JSON.parse(readFileSync("private/data/quality/database-audit.json", "utf8"));
    expect(
      db.datasets.reduce((n: number, d: { actualRecords: number }) => n + d.actualRecords, 0),
    ).toBe(db.totals.records);
    expect(
      db.categoryStateCounts.reduce((n: number, r: { records: number }) => n + r.records, 0),
    ).toBe(db.totals.records);
    expect(db.totals.readyRecords + db.totals.heldRecords).toBe(db.totals.records);
    expect(
      db.datasets.every(
        (d: { actualRecords: number; expectedRecords: number; metadataRecords: number }) =>
          d.actualRecords === d.expectedRecords && d.actualRecords === d.metadataRecords,
      ),
    ).toBe(true);
  });
});

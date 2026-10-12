import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { courtStates, stateComparisons, type ResearchData } from "./research";
import type { CatalogMatter } from "@/lib/atlas/catalogMatters";

const load = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
describe("real downloaded source reconciliation", () => {
  const root = "private/data/research/";
  const data: ResearchData = {
    population: load(root + "population.json"),
    judiciary: load(root + "judicial-service.json"),
    timing: load(root + "court-duration.json"),
    resources: load(root + "state-resources.json"),
    courts: load(root + "court-crosswalk.json"),
    sources: load(root + "source-manifest.json"),
    workload: load("private/data/quality/reference/uscourts-table-c-2025.json"),
  };
  it("preserves all official source bytes and reconciles Census, FJC and district timing counts", () => {
    for (const source of data.sources.sources) {
      const bytes = readFileSync(root + "raw/" + source.file);
      expect(bytes.length).toBe(source.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.sha256);
    }
    expect(data.population.states).toHaveLength(51);
    expect(data.population.states.reduce((sum, row) => sum + row.population2025, 0)).toBe(
      data.population.national2025,
    );
    expect(data.judiciary.judges).toHaveLength(data.judiciary.judgeCount);
    expect(new Set(data.judiciary.judges.map((j) => j.id)).size).toBe(data.judiciary.judgeCount);
    expect(data.judiciary.judges.reduce((sum, j) => sum + j.services.length, 0)).toBe(
      data.judiciary.serviceCount,
    );
    expect(data.timing.districts).toHaveLength(94);
    for (const category of Object.keys(data.timing.national))
      expect(
        data.timing.districts.reduce((sum, row) => sum + row.metrics[category]!.cases, 0),
      ).toBe(data.timing.national[category]!.cases);
    expect(
      data.timing.districts.find((d) => d.label === "NMI")!.metrics["all"]!.medianMonths,
    ).toBeNull();
  });
  it("maps the catalog through native court IDs and keeps federal district rates separate from catalog counts", () => {
    const cases = load<CatalogMatter[]>("private/data/catalog-matters.json");
    const states = stateComparisons(data, cases);
    expect(states).toHaveLength(51);
    expect(states.every((s) => s.districtJudges > 0)).toBe(true);
    expect(states.find((s) => s.code === "IN")!.filed2025).toBe(6219);
    const india = states.find((s) => s.code === "IN")!;
    expect(india.filingsPer100k).toBeCloseTo((6219 / india.population2025) * 100000);
    const mapping = courtStates(data.courts.records);
    const outsideState = cases.filter((row) => !row.court || !mapping.has(row.court));
    expect(outsideState).toHaveLength(99); // Native appellate courts and JPML have no single state.
    expect(
      outsideState.every((row) => row.court === "jpml" || /^ca\d+$/.test(row.court ?? "")),
    ).toBe(true);
    expect(states.reduce((sum, s) => sum + s.sampleCases, 0) + outsideState.length).toBe(
      cases.length,
    );
  });
  it("preserves publisher resource hierarchies and backs each MDL reading with a retrieved court source", () => {
    expect(data.resources.states).toHaveLength(51);
    expect(new Set(data.resources.states.map((s) => s.code)).size).toBe(51);
    const capture = load<{ pages: { url: string; markdown: string; status: number }[] }>(
      root + "raw/doj-resources.json",
    );
    expect(capture.pages).toHaveLength(56);
    for (const state of data.resources.states) {
      const page = capture.pages.find((p) => p.url === state.sourceUrl);
      expect(page?.status).toBe(200);
      expect(state.links.length).toBeGreaterThan(0);
      for (const link of state.links) expect(page?.markdown).toContain(link.url);
    }
    const briefs = load<{ briefs: { mdl: string; sourceUrl: string }[] }>(root + "mdl-briefs.json");
    const reads = load<{
      pages: { url: string; markdown: string; metadata: { statusCode: number } }[];
    }>(root + "raw/mdl-research.json");
    const masters = load<Record<string, string>>("private/data/mdl-documents/master-dockets.json");
    expect(briefs.briefs).toHaveLength(4);
    for (const brief of briefs.briefs) {
      const read = reads.pages.find((p) => p.url === brief.sourceUrl);
      expect(read?.metadata.statusCode).toBe(200);
      expect(read?.markdown).toContain(brief.mdl);
      expect(Object.values(masters)).toContain(brief.mdl);
    }
  });
});

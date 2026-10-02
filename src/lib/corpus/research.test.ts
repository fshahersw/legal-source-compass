import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  correlations,
  quantile,
  summarizeCases,
  completedDays,
  recordedDate,
  uniqueJudge,
  courtStates,
  relatedCases,
  openServiceAt,
  stateComparisons,
  type JudicialService,
  type ResearchData,
} from "./research";
import type { CatalogMatter } from "@/lib/atlas/catalogMatters";

const caseRow: CatalogMatter = {
  docket_id: 1,
  court: "insd",
  judge: "A. Judge",
  date_filed: "2025-01-01",
  date_terminated: "2025-01-11",
  status: "terminated",
  firms: ["Firm"],
  mdl_master_docket_id: 123,
  docket_number: null,
  case_name: "Case",
  defendant: null,
  roles: null,
  courtlistener_docket_url: null,
};
const service = {
  commissionDate: "2020-01-01",
  recessDate: null,
  terminationDate: null,
  terminationReason: null,
} as JudicialService;
describe("research analysis boundaries", () => {
  it("excludes unknown status, reversed dates and invalid calendar dates from duration", () => {
    expect(recordedDate("2025-02-30")).toBeNull();
    expect(completedDays({ ...caseRow, status: null })).toBeNull();
    expect(completedDays({ ...caseRow, date_terminated: "2024-01-01" })).toBeNull();
    expect(
      summarizeCases([
        caseRow,
        { ...caseRow, status: null },
        { ...caseRow, date_terminated: null },
      ]),
    ).toMatchObject({
      total: 3,
      terminated: 2,
      other: 1,
      datedTerminations: 1,
      excludedTerminations: 1,
      medianDays: 10,
    });
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([0, 10], 0.5)).toBe(5);
  });
  it("uses complete paired observations and average tied ranks", () => {
    const c = correlations([
      { label: "A", x: 1, y: 3 },
      { label: "B", x: 1, y: 3 },
      { label: "C", x: 2, y: 2 },
      { label: "D", x: 3, y: 1 },
      { label: "unknown", x: null, y: 4 },
    ]);
    expect(c.n).toBe(4);
    expect(c.excluded).toBe(1);
    expect(c.spearman).toBeCloseTo(-1);
    expect(correlations([0, 1, 2].map((x) => ({ label: String(x), x, y: 9 }))).pearson).toBeNull();
    expect(correlations([{ label: "A", x: 0, y: 0 }]).n).toBe(1);
  });
  it("leaves duplicate people and conflicting court-state IDs unresolved", () => {
    expect(
      uniqueJudge("A Judge", [
        { id: "1", name: "A. Judge", services: [] },
        { id: "2", name: "A Judge", services: [] },
      ]),
    ).toBeNull();
    expect(
      courtStates([
        { id: "x", title: "X", state: "IN" },
        { id: "x", title: "Y", state: "IL" },
      ]).has("x"),
    ).toBe(false);
    expect(
      relatedCases(
        caseRow,
        [
          { ...caseRow, docket_id: 2, mdl_master_docket_id: 321 },
          { ...caseRow, docket_id: 3 },
        ],
        "mdl",
        { "123": "2570", "321": "2592" },
      ).map((r) => r.docket_id),
    ).toEqual([3]);
  });
  it("uses service intervals as of a fixed reporting date and does not infer missing end dates", () => {
    expect(openServiceAt(service, "2025-09-30")).toBe(true);
    expect(openServiceAt({ ...service, terminationDate: "2025-09-30" }, "2025-09-30")).toBe(false);
    expect(openServiceAt({ ...service, terminationReason: "Elevated" }, "2025-09-30")).toBe(false);
    expect(openServiceAt({ ...service, commissionDate: "2026-01-01" }, "2025-09-30")).toBe(false);
  });
});

const load = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
describe("real downloaded source reconciliation", () => {
  const root = "public/data/research/";
  const data: ResearchData = {
    population: load(root + "population.json"),
    judiciary: load(root + "judicial-service.json"),
    timing: load(root + "court-duration.json"),
    resources: load(root + "state-resources.json"),
    courts: load(root + "court-crosswalk.json"),
    sources: load(root + "source-manifest.json"),
    workload: load("public/data/quality/reference/uscourts-table-c-2025.json"),
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
    const cases = load<CatalogMatter[]>("public/data/catalog-matters.json");
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
    const masters = load<Record<string, string>>("public/data/mdl-documents/master-dockets.json");
    expect(briefs.briefs).toHaveLength(4);
    for (const brief of briefs.briefs) {
      const read = reads.pages.find((p) => p.url === brief.sourceUrl);
      expect(read?.metadata.statusCode).toBe(200);
      expect(read?.markdown).toContain(brief.mdl);
      expect(Object.values(masters)).toContain(brief.mdl);
    }
  });
});

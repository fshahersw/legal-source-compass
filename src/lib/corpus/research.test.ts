import { describe, expect, it } from "vitest";
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
  type JudicialService,
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

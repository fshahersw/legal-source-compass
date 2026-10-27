import { describe, expect, it } from "vitest";
import type { MetricDef } from "./contract";
import { curateCatalog, DOJ_SERIES_BREAK_CAVEAT, emptyMetricIds, withReadingNotes } from "./catalogCuration";

const def = (id: string, facts: number, caveats: string[] = []): MetricDef => ({
  id,
  label: id,
  description: "",
  unit: "",
  format: "count",
  topic: "enforcement",
  entityTypes: ["nation"],
  periodType: "year",
  sourceDatasets: [],
  sourceLinks: [],
  numerator: "",
  denominator: null,
  method: "",
  caveats,
  direction: "neutral",
  coverage: { from: null, to: null, entities: 1, facts },
  refreshedAt: null,
});

describe("curateCatalog", () => {
  it("drops metrics whose last refresh wrote no facts (registered with coverage_entities=1, facts=0)", () => {
    const rows = [
      def("mdl_maude_death_injury_share", 0),
      def("mdl_months_first_recall_to_transfer", 0),
      def("maude_death_injury_share_national", 0),
      def("state_register_issues_listed", 0),
      def("pop_resident", 51132),
    ];
    expect(curateCatalog(rows).map((m) => m.id)).toEqual(["pop_resident"]);
    expect(emptyMetricIds(rows)).toHaveLength(4);
  });

  it("puts the 2013 series-break caveat first on the DOJ metrics, once", () => {
    const out = curateCatalog([def("doj_press_releases", 18, ["Counts publications."]), def("doj_state_press_releases", 746)]);
    expect(out[0]?.caveats).toEqual([DOJ_SERIES_BREAK_CAVEAT, "Counts publications."]);
    expect(out[1]?.caveats[0]).toBe(DOJ_SERIES_BREAK_CAVEAT);
    const again = withReadingNotes(out[0]!);
    expect(again).toBe(out[0]);
  });

  it("leaves other metrics untouched", () => {
    const m = def("fjc_civil_filed", 10, ["x"]);
    expect(curateCatalog([m])[0]).toBe(m);
  });
});

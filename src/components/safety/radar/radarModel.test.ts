import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { signalsViewOf } from "../safetyView";
import { RadarScoreStack } from "./RadarScoreStack";
import {
  STATUS_LABEL,
  candidateContext,
  closedMdlNote,
  emerging,
  kindBreakdown,
  indexSeries,
  laneInputs,
  median,
  overviewContext,
  parseRecords,
  parseUnit,
  radarKpis,
  ratioDots,
  toRow,
  type RadarUnit,
} from "./radarModel";

// Shaped like the builder's dry-run record drug:faers:pimavanserin-tartrate (packet 2026-10-27).
const comp = (
  family: "A" | "B" | "C" | "D",
  metric: string,
  points: number,
  extra: Record<string, unknown> = {},
) => ({
  family,
  metric,
  observed: null,
  expected: null,
  ratio: null,
  ci_low: null,
  ci_high: null,
  points,
  max_points: family === "A" ? 2 : family === "C" ? 3 : 1,
  window: "2025-07 to 2026-06",
  source: "FDA FAERS via openFDA",
  source_url: "https://open.fda.gov/apis/drug/event/",
  rated: true,
  note: null,
  ...extra,
});

function unit(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    unit_id: "drug:faers:pimavanserin-tartrate",
    kind: "drug",
    label: "PIMAVANSERIN TARTRATE",
    identifiers: { brand_names: ["NUPLAZID"], application_numbers: ["NDA207318"] },
    mdl_status: { status: "none_linked", links: [] },
    components: [
      comp("A", "FAERS reports", 1, {
        observed: 9726,
        expected: 6357,
        ratio: 1.53,
        ci_low: 1.5,
        ci_high: 1.561,
      }),
      comp("B", "FAERS death reports", 1, {
        observed: 1962,
        expected: 1283.7,
        ratio: 1.528,
        ci_low: 1.462,
      }),
      comp("B", "FAERS serious reports", 1, {
        observed: 6125,
        expected: 3135,
        ratio: 1.954,
        ci_low: 1.905,
      }),
      comp("C", "FDA recalls (exact product key)", 0, { rated: false, note: "Not recorded" }),
      comp("D", "10-K paragraph names the product with a products-liability term", 0, {
        observed: 0,
      }),
    ],
    points: 3,
    families_present: 2,
    families: ["A", "B"],
    excess: 3369,
    series: {
      unit: "FAERS reports per month",
      start: "2024-07",
      values: [573, 834, 805, 717],
      source: "FDA FAERS via openFDA",
      source_url: "https://open.fda.gov/apis/drug/event/",
    },
    evidence: [],
    flags: [],
    window: { recent: "2025-07 to 2026-06", baseline: "2022-07 to 2025-06" },
    caveat: "Reports are voluntary and unverified.",
    as_of: "2026-10-27",
    rank: 43,
    ...over,
  };
}

const SUMMARY = {
  as_of: "2026-10-27",
  windows: { faers: "2025-07 to 2026-06", nhtsa: "2025-10 to 2026-09" },
  national: {
    faers: {
      factor: 0.9738,
      series: {
        unit: "FAERS reports per month (all products)",
        start: "2024-09",
        values: [100, 110, 120],
      },
    },
  },
  coverage: { faers_products_with_series: 451, faers_products_indexed: 2000 },
  counts: { units: 3 },
  jpml_lanes: [
    {
      mdl: 3204,
      title: "IN RE: Igloo 90 Quart Rolling Cooler Products Liability Litigation",
      status: "pending",
      session: "2026-12-03",
      events: [
        { kind: "recall", date: "2025-02-13", label: "CPSC recall 25136" },
        { kind: "hearing", date: "2026-12-03", label: "Hearing session" },
      ],
    },
    {
      mdl: 3177,
      title: "Huel, Inc., Heavy Metal Products Liability Litigation",
      status: "denied",
      session: "2026-03-26",
      events: [
        { kind: "hearing", date: "2026-03-26", label: "Hearing session" },
        { kind: "order", date: "2026-04-02", label: "Centralization denied" },
      ],
    },
    {
      mdl: 3109,
      title: "Video Game Addiction Products Liability Litigation",
      status: "denied",
      session: "2023-05-30",
      events: [{ kind: "order", date: "2023-06-05", label: "Centralization denied" }],
    },
  ],
  method: { reports: "O vs E" },
};

describe("parseUnit", () => {
  it("keeps a unit whose total reconciles with its components", () => {
    const u = parseUnit(unit());
    expect(u?.points).toBe(3);
    expect(u?.families).toEqual(["A", "B"]);
  });
  it("drops a unit whose stored total, families or caps do not reconcile", () => {
    expect(parseUnit(unit({ points: 4 }))).toBeNull();
    expect(parseUnit(unit({ families_present: 3 }))).toBeNull();
    expect(parseUnit(unit({ families: ["A", "D"] }))).toBeNull();
    const over = unit();
    (over["components"] as Record<string, unknown>[])[0]!["points"] = 3; // above max_points 2
    over["points"] = 5;
    expect(parseUnit(over)).toBeNull();
    expect(parseUnit({ ...unit(), unit_id: "drug faers x" })).toBeNull();
  });
  it("keeps a missing count as null, never 0", () => {
    const u = parseUnit(unit())!;
    expect(u.components[3]!.observed).toBeNull();
  });
});

describe("parseRecords and KPIs", () => {
  const items = [
    { kind: "radar_summary", summary: SUMMARY },
    { kind: "radar", radar: unit() },
    {
      kind: "radar",
      radar: unit({
        unit_id: "drug:faers:tirzepatide",
        label: "TIRZEPATIDE",
        rank: null,
        mdl_status: {
          status: "pending_mdl",
          links: [{ mdl: 3094, basis: "epc_class", status: "pending" }],
        },
      }),
    },
    { kind: "radar", radar: unit({ unit_id: "drug:faers:bad", points: 9 }) },
  ];
  const parsed = parseRecords(items);
  const rows = parsed.units.map(toRow);

  it("reads the summary, keeps reconciling units and counts the dropped ones", () => {
    expect(parsed.summary?.as_of).toBe("2026-10-27");
    expect(parsed.units).toHaveLength(2);
    expect(parsed.dropped).toBe(1);
  });
  it("leaves units in an MDL out of the emerging list", () => {
    expect(emerging(rows).map((r) => r.unit_id)).toEqual(["drug:faers:pimavanserin-tartrate"]);
  });
  it("counts KPIs from the rows and lanes shown", () => {
    const k = radarKpis(rows, parsed.summary);
    expect(k.pendingMotions).toBe(1);
    expect(k.denied36).toBe(1); // the 2023 denial is older than 36 months
    expect(k.risingNoMdl).toBe(0); // lower bound 1.5 is not above 1.5
    expect(k.excluded).toBe(1);
  });
  it("uses the median of the compared units as the dot baseline", () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([])).toBeNull();
    const d = ratioDots(rows, "drug");
    expect(d.baseline).toBe(1.53);
    expect(d.items[0]?.label).toBe("PIMAVANSERIN TARTRATE");
  });
  it("builds AI context from the shown figures only, with the 'No MDL linked' wording", () => {
    const ctx = overviewContext(radarKpis(rows, parsed.summary), emerging(rows), parsed.summary);
    const text = JSON.stringify(ctx);
    expect(text).toContain("no open MDL linked");
    expect(text.toLowerCase()).not.toContain("no mdl exists");
    const c = JSON.stringify(candidateContext(parsed.units[0] as RadarUnit));
    expect(c).toContain("9,726");
    expect(c).toContain(STATUS_LABEL.none_linked);
  });
});

describe("vehicle KPIs and closed MDLs", () => {
  const veh = (id: string, inv: string[], over: Partial<Record<string, unknown>> = {}) =>
    unit({
      unit_id: id,
      kind: "vehicle",
      label: id,
      components: [
        comp("A", "NHTSA complaints", 2, {
          observed: 847,
          expected: 394.8,
          ratio: 2.145,
          ci_low: 2.003,
        }),
        comp("C", "NHTSA investigations and recalls", 1),
      ],
      points: 3,
      families_present: 2,
      families: ["A", "C"],
      evidence: inv.map((x) => ({
        dataset: "agency_safety_nhtsa_investigations",
        id: x,
        label: x,
        points: 1,
      })),
      rank: 1,
      ...over,
    });

  it("counts one investigation that touches two units once", () => {
    const rows = [
      veh("vehicle:jeep-wrangler-electrical-system", ["PE25014"]),
      veh("vehicle:jeep-wrangler-4xe-electrical-system", ["PE25014"]),
      veh("vehicle:ram-1500-engine", ["RQ24012", "PE25014"]),
    ]
      .map((u) => parseUnit(u)!)
      .map(toRow);
    const k = radarKpis(rows, null);
    expect(k.openInvestigations).toBe(2);
    expect(k.investigatedUnits).toBe(3);
    expect(k.risingByKind).toEqual({ vehicle: 3 });
    expect(kindBreakdown({ vehicle: 80, drug: 3 })).toBe("80 vehicle units · 3 drugs");
    expect(kindBreakdown({ drug: 1 })).toBe("1 drug");
  });

  it("marks a unit linked only to a closed MDL wherever it is listed", () => {
    const fin = toRow(
      parseUnit(
        unit({
          unit_id: "drug:faers:finasteride",
          label: "FINASTERIDE",
          mdl_status: {
            status: "terminated_mdl",
            links: [
              { mdl: 2331, basis: "safety_mdl_subjects", status: "terminated" },
              { mdl: 2331, basis: "title_names_ingredient", status: "terminated" },
            ],
          },
        }),
      )!,
    );
    expect(closedMdlNote(fin)).toBe("Earlier MDL closed: 2331");
    expect(closedMdlNote(toRow(parseUnit(unit())!))).toBeUndefined();
    expect(radarKpis([fin], null).closedMdlRanked).toBe(1);
    const html = renderToStaticMarkup(
      createElement(RadarScoreStack, {
        rows: [{ ...fin, note: closedMdlNote(fin) }],
        ariaLabel: "Scores",
      }),
    );
    expect(html).toContain("Earlier MDL closed: 2331");
  });

  it("keeps terms with an unknown prior apart from measured risers", () => {
    const u = parseUnit(
      unit({
        top_rising_terms: [{ term: "PRODUCT ADHESION ISSUE", recent: 1163, prior: 737 }],
        entered_terms: [{ term: "DEVICE ADHESION ISSUE", recent: 900, prior: null }],
      }),
    )!;
    expect(u.top_rising_terms?.[0]?.prior).toBe(737);
    expect(u.entered_terms?.[0]?.prior).toBeNull();
  });
});

describe("chart inputs", () => {
  it("aligns the national series to the unit's months, gaps as null", () => {
    const u = parseUnit(unit())!;
    const s = indexSeries(u, SUMMARY.national.faers.series);
    expect(s).toHaveLength(2);
    expect(s[0]!.points.map((p) => p.date)).toEqual(["2024-07", "2024-08", "2024-09", "2024-10"]);
    expect(s[1]!.points.map((p) => p.value)).toEqual([null, null, 100, 110]);
  });
  it("lays out JPML lanes over the last 36 months up to the next hearing", () => {
    const l = laneInputs(SUMMARY.jpml_lanes as never, "2026-10-27");
    expect(l.domain[0]).toBe("2023-10-27");
    expect(l.domain[1]).toBe("2026-12-03");
    expect(l.lanes.map((x) => x.id)).toEqual(["mdl-3177", "mdl-3204"]);
  });
  it("renders the score stack with totals recomputed from the components", () => {
    const html = renderToStaticMarkup(
      createElement(RadarScoreStack, { rows: [parseUnit(unit())!], ariaLabel: "Scores" }),
    );
    expect(html).toContain("PIMAVANSERIN TARTRATE");
    expect(html).toContain(">3</span> pt");
  });
});

describe("signalsViewOf", () => {
  it("keeps every former ?view= URL working and defaults to the emerging mode", () => {
    expect(signalsViewOf(undefined)).toBe("emerging");
    expect(signalsViewOf("reports")).toBe("reports");
    expect(signalsViewOf("neiss")).toBe("neiss");
    expect(signalsViewOf("overview")).toBe("mdl");
    expect(signalsViewOf("mass-tort")).toBe("mdl");
    expect(signalsViewOf("mdl")).toBe("mdl");
    expect(signalsViewOf("REPORTS")).toBe("emerging");
  });
});

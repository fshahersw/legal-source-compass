import { describe, expect, it } from "vitest";
import { parseInsight, type SafetyInsight } from "@/lib/external/safetyInsights.functions";
import {
  EMPTY_FILTER,
  filterInsights,
  insightCaveat,
  metricLine,
  risingThemes,
} from "./insightView";

describe("insightCaveat", () => {
  const raw = {
    id: "x",
    rank: 1,
    kind: "firm_cluster",
    agency: "FDA",
    entity: "Acme",
    headline: "h",
    summary: "s",
    score: 50,
    severity: "elevated",
    serious: false,
    metric: { recent: 4, baseline: 1, ratio: 4, window: "180 days", unit: "recall events" },
    series: [],
    evidence: [
      {
        dataset: "agency_safety_openfda_food_enforcement",
        id: "r1",
        title: "t",
        date: null,
        note: null,
      },
    ],
    method: "Product rows collapsed to events by firm, initiation date and reason.",
    as_of: "2026-09-01",
    tags: [],
  };
  it("flags old event keying, the warning-letter sample and the superseded CPSC snapshot", () => {
    expect(insightCaveat(parseInsight(raw)!)).toMatch(/event id/);
    expect(
      insightCaveat(parseInsight({ ...raw, method: "Grouped on FDA's event_id." })!),
    ).toBeNull();
    const ev = (dataset: string) => [{ dataset, id: "1", title: "t", date: null, note: null }];
    expect(
      insightCaveat(
        parseInsight({
          ...raw,
          kind: "hazard_surge",
          evidence: ev("agency_safety_fda_warning_letters"),
        })!,
      ),
    ).toMatch(/1,000-row sample/);
    expect(
      insightCaveat(
        parseInsight({
          ...raw,
          kind: "hazard_surge",
          agency: "CPSC",
          evidence: ev("agency_safety_cpsc_recalls_local"),
        })!,
      ),
    ).toMatch(/superseded/);
  });
});

const base = {
  id: "firm-cluster-fda-acme",
  rank: 1,
  kind: "firm_cluster",
  agency: "FDA",
  entity: "Acme Foods",
  headline: "Acme Foods: 10 food recall events in 180 days",
  summary: "Listeria",
  score: 88.2,
  severity: "high",
  serious: true,
  metric: { recent: 10, baseline: 1.25, ratio: 8, window: "180 days", unit: "recall events" },
  series: [{ period: "2026-08", count: 4 }],
  evidence: [
    {
      dataset: "agency_safety_openfda_food_enforcement",
      id: "r1",
      title: "Product 1",
      date: "2026-09-01",
      note: null,
    },
  ],
  method: "m",
  as_of: "2026-09-01",
  tags: ["Food", "Listeria"],
};

describe("safety insight parsing", () => {
  it("accepts a well-formed insight and maps as_of", () => {
    const parsed = parseInsight(base)!;
    expect(parsed.asOf).toBe("2026-09-01");
    expect(parsed.evidence[0]!.dataset).toBe("agency_safety_openfda_food_enforcement");
  });
  it("drops insights with unknown kinds, severities or agencies instead of guessing", () => {
    expect(parseInsight({ ...base, kind: "rumor" })).toBeNull();
    expect(parseInsight({ ...base, severity: "critical" })).toBeNull();
    expect(parseInsight({ ...base, agency: "NOT_AN_AGENCY" })).toBeNull();
    expect(parseInsight({ ...base, score: "high" })).toBeNull();
  });
  it("drops evidence without a dataset or id", () => {
    const parsed = parseInsight({ ...base, evidence: [{ id: "x" }, ...base.evidence] })!;
    expect(parsed.evidence).toHaveLength(1);
  });
});

describe("insight view", () => {
  const a = parseInsight(base)!;
  const b = parseInsight({
    ...base,
    id: "theme",
    kind: "hazard_surge",
    agency: "CPSC",
    severity: "watch",
    serious: false,
    headline: "Tip-over recalls rising",
    entity: "CPSC consumer products · Tip-over",
    tags: ["Tip-over"],
    metric: { recent: 41, baseline: 7.7, ratio: 5.3, window: "12 months", unit: "recalls" },
  })!;
  const all: SafetyInsight[] = [a, b];

  it("filters by severity, agency, serious-harm and search terms", () => {
    expect(filterInsights(all, { ...EMPTY_FILTER, severity: "high" })).toEqual([a]);
    expect(filterInsights(all, { ...EMPTY_FILTER, agency: "CPSC" })).toEqual([b]);
    expect(filterInsights(all, { ...EMPTY_FILTER, seriousOnly: true })).toEqual([a]);
    expect(filterInsights(all, { ...EMPTY_FILTER, query: "tip-over recalls" })).toEqual([b]);
    expect(filterInsights(all, { ...EMPTY_FILTER, query: "nothing here" })).toEqual([]);
  });
  it("states the comparison behind each flag", () => {
    expect(metricLine(a)).toBe("10 recall events vs 1.3 expected · 8× · 180 days");
  });
  it("ranks hazard themes by ratio", () => {
    expect(risingThemes(all).map((t) => t.id)).toEqual(["theme"]);
  });
});

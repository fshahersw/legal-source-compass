import { describe, expect, it } from "vitest";
import {
  factReason,
  inAppHref,
  parseCatalog,
  parseCross,
  parseEntityDetail,
  parseFact,
  parseFacts,
  parseLinks,
} from "./layer";

const metricRow = {
  id: "fjc_civil_filed_per_100k",
  label: "Federal civil cases filed per 100,000 residents",
  description: "Civil cases filed per 100,000 residents.",
  unit: "cases per 100,000 residents",
  format: "rate_per_100k",
  topic: "courts",
  entity_types: ["nation", "state"],
  period_type: "fiscal_year",
  source_datasets: ["fjc_civil_states", "census_pop_estimates"],
  source_links: [
    { label: "Federal Judicial Center", url: "https://www.fjc.gov/research/idb" },
    { label: "bad", url: "javascript:alert(1)" },
  ],
  numerator: "Civil cases filed",
  denominator: "Census resident population on July 1 of the same year",
  method: "cases x 100,000 / population",
  caveats: ["A caveat", 7],
  direction: "higher_is_more",
  coverage: { from: "FY1988", to: "FY2026", entities: 57, facts: 2223 },
  refreshed_at: "2026-10-24T06:23:00Z",
};

const factRow = {
  metric_id: "pop_resident",
  entity_type: "state",
  entity_id: "CA",
  period: "2024",
  period_start: "2024-01-01",
  period_end: "2024-12-31",
  value: 39431263,
  moe: null,
  partial: false,
  n: null,
  not_recorded_reason: null,
};

describe("catalog", () => {
  it("maps snake_case rows to MetricDef and drops unsafe links and non-text caveats", () => {
    const [m] = parseCatalog([metricRow]);
    expect(m).toEqual({
      id: "fjc_civil_filed_per_100k",
      label: "Federal civil cases filed per 100,000 residents",
      description: "Civil cases filed per 100,000 residents.",
      unit: "cases per 100,000 residents",
      format: "rate_per_100k",
      topic: "courts",
      entityTypes: ["nation", "state"],
      periodType: "fiscal_year",
      sourceDatasets: ["fjc_civil_states", "census_pop_estimates"],
      sourceLinks: [{ label: "Federal Judicial Center", url: "https://www.fjc.gov/research/idb" }],
      numerator: "Civil cases filed",
      denominator: "Census resident population on July 1 of the same year",
      method: "cases x 100,000 / population",
      caveats: ["A caveat"],
      direction: "higher_is_more",
      coverage: { from: "FY1988", to: "FY2026", entities: 57, facts: 2223 },
      refreshedAt: "2026-10-24T06:23:00Z",
    });
  });
  it("drops rows with an unknown format, topic, period type or entity type", () => {
    expect(parseCatalog([{ ...metricRow, format: "guess" }])).toEqual([]);
    expect(parseCatalog([{ ...metricRow, topic: "sports" }])).toEqual([]);
    expect(parseCatalog([{ ...metricRow, period_type: "week" }])).toEqual([]);
    expect(parseCatalog([{ ...metricRow, entity_types: ["planet"] }])).toEqual([]);
    expect(parseCatalog("not a list")).toEqual([]);
  });
});

describe("facts", () => {
  it("maps a fact and keeps a not-recorded value null with its reason (never zero)", () => {
    expect(parseFact(factRow)).toEqual({
      metricId: "pop_resident",
      entityType: "state",
      entityId: "CA",
      period: "2024",
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
      value: 39431263,
      moe: null,
      partial: false,
      n: null,
      notRecordedReason: null,
    });
    const gap = parseFact({
      ...factRow,
      value: null,
      not_recorded_reason: "No Census population estimate.",
    });
    expect(gap?.value).toBeNull();
    expect(factReason(gap!)).toBe("No Census population estimate.");
  });
  it("drops malformed facts instead of repairing them", () => {
    expect(parseFact({ ...factRow, value: null })).toBeNull(); // null without a reason
    expect(parseFact({ ...factRow, not_recorded_reason: "x" })).toBeNull(); // value and a reason
    expect(parseFact({ ...factRow, value: "12" })).toBeNull();
    expect(parseFact({ ...factRow, moe: -1 })).toBeNull();
    expect(parseFact({ ...factRow, partial: "no" })).toBeNull();
    expect(parseFact({ ...factRow, period_end: "2023-12-31" })).toBeNull();
    expect(parseFact({ ...factRow, period_start: "2024-02-30" })).toBeNull();
    expect(parseFact({ ...factRow, entity_type: "planet" })).toBeNull();
    expect(parseFacts([factRow, null, { ...factRow, entity_id: "../x" }])).toHaveLength(1);
  });
});

describe("entities, links, cross points", () => {
  it("parses an entity detail and keeps only in-app links", () => {
    const d = parseEntityDetail({
      entity: {
        type: "court",
        id: "cand",
        label: "N.D. Cal.",
        parent: { type: "circuit", id: "ca9" },
        keys: { court_id: "cand", x: 1 },
        href: "/courts/cand",
      },
      facts: [factRow],
      children: [
        {
          type: "judge",
          id: "1",
          label: "Judge",
          parent: null,
          keys: {},
          href: "https://evil.example/",
        },
      ],
    });
    expect(d?.entity).toEqual({
      type: "court",
      id: "cand",
      label: "N.D. Cal.",
      parent: { type: "circuit", id: "ca9" },
      keys: { court_id: "cand" },
      href: "/courts/cand",
    });
    expect(d?.facts).toHaveLength(1);
    expect(d?.children[0]?.href).toBeNull();
    expect(parseEntityDetail({ entity: null, facts: [], children: [] })).toBeNull();
    expect(inAppHref("//evil.example")).toBeNull();
    expect(inAppHref("/places/CA/06037")).toBe("/places/CA/06037");
  });
  it("parses links with their evidence and refuses unknown evidence kinds", () => {
    const row = {
      from: { type: "mdl", id: "2738" },
      to: { type: "judge", id: "13761857" },
      relation: "transferee_judge",
      evidence: "exact_id",
      source_dataset: "mdls",
      source_record_id: "2738",
    };
    expect(parseLinks([row, { ...row, evidence: "similar_name" }])).toEqual([
      {
        from: { type: "mdl", id: "2738" },
        to: { type: "judge", id: "13761857" },
        relation: "transferee_judge",
        evidence: "exact_id",
        sourceDataset: "mdls",
        sourceRecordId: "2738",
      },
    ]);
  });
  it("parses cross points and drops pairs without two numbers", () => {
    expect(
      parseCross([
        { entity_id: "CA", label: "California", x: 1, y: 2, period_x: "2024", period_y: "2024" },
        { entity_id: "NY", label: "New York", x: null, y: 2, period_x: "2024", period_y: "2024" },
      ]),
    ).toEqual([
      { entityId: "CA", label: "California", x: 1, y: 2, periodX: "2024", periodY: "2024" },
    ]);
  });
});

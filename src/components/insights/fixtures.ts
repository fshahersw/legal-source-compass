/**
 * DEV-ONLY FIXTURES. Never shipped as data: imported only behind INSIGHTS_FIXTURES (fixtureMode.ts), which is false in
 * every production build, and by tests. Shapes follow src/lib/insights/contract.ts exactly so screenshots and tests
 * exercise the real code paths; every label starts with "[Fixture]" and the pages show a fixture banner.
 *
 * Values are generated from a seeded generator (deterministic) with deliberate gaps, a partial last period and a
 * published-style margin of error, to exercise every chart state.
 */
import type {
  CrossPoint,
  EntityType,
  Fact,
  Freshness,
  MetricDef,
  PeriodType,
} from "@/lib/insights/contract";
import { STATES } from "@/lib/corpus/geo";
import { seededRandom } from "@/components/charts/stats";
import type { EventStudy, InsightsLayer } from "./types";

const SRC = [
  { label: "[Fixture] Development data, not a source", url: "https://example.invalid/fixture" },
];

const COURTS = [
  "cand",
  "cacd",
  "nysd",
  "nyed",
  "ilnd",
  "txsd",
  "txnd",
  "flsd",
  "paed",
  "njd",
  "mad",
  "gand",
  "waw",
  "mied",
  "ohnd",
];
const COMPANIES = Array.from({ length: 10 }, (_, i) => `000000${100 + i}`);

type Spec = {
  def: Omit<MetricDef, "coverage" | "refreshedAt">;
  ids: string[];
  periods: string[];
  partialLast: boolean;
  base: (id: string, i: number) => number;
  moe?: boolean;
};

const years = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

function def(
  id: string,
  label: string,
  unit: string,
  format: MetricDef["format"],
  topic: MetricDef["topic"],
  entityTypes: EntityType[],
  periodType: PeriodType,
  denominator: string | null = null,
): Spec["def"] {
  return {
    id,
    label: `[Fixture] ${label}`,
    description: "Development fixture. Not real data.",
    unit,
    format,
    topic,
    entityTypes,
    periodType,
    sourceDatasets: ["fixture"],
    sourceLinks: SRC,
    numerator: label,
    denominator,
    method: "Seeded generator for development screenshots and tests.",
    caveats: ["Fixture values are generated and mean nothing."],
    direction: "higher_is_more",
  };
}

const USPS = STATES.map((s) => s.usps);

const SPECS: Spec[] = [
  {
    def: def(
      "fixture_civil_filed",
      "Federal civil cases filed",
      "cases",
      "count",
      "courts",
      ["state", "nation"],
      "fiscal_year",
    ),
    ids: USPS,
    periods: years(2015, 2026).map((y) => `FY${y}`),
    partialLast: true,
    base: (_id, i) => 900 + ((i * 7919) % 23000),
  },
  {
    def: def(
      "fixture_civil_filed_per_100k",
      "Federal civil cases filed per 100,000 residents",
      "per 100,000 residents",
      "rate_per_100k",
      "courts",
      ["state", "nation"],
      "fiscal_year",
      "Census population estimates, July 1 of the same year",
    ),
    ids: USPS,
    periods: years(2015, 2026).map((y) => `FY${y}`),
    partialLast: true,
    base: (_id, i) => 40 + ((i * 37) % 160),
  },
  {
    def: def(
      "fixture_cfpb_per_100k",
      "CFPB complaints per 100,000 residents",
      "per 100,000 residents",
      "rate_per_100k",
      "companies",
      ["state", "nation"],
      "year",
      "Census population estimates, July 1 of the same year",
    ),
    ids: USPS,
    periods: years(2015, 2025),
    partialLast: false,
    base: (_id, i) => 60 + ((i * 53) % 240),
  },
  {
    def: def(
      "fixture_median_income",
      "Median household income",
      "dollars",
      "currency_usd",
      "places",
      ["state"],
      "year",
    ),
    ids: USPS,
    periods: years(2015, 2023),
    partialLast: false,
    base: (_id, i) => 48000 + ((i * 1777) % 42000),
    moe: true,
  },
  {
    def: def(
      "fixture_median_months",
      "Median months from filing to disposition, civil cases",
      "months",
      "months",
      "courts",
      ["court"],
      "twelve_months_ending",
    ),
    ids: COURTS,
    periods: years(2016, 2025).map((y) => `${y}-06-30`),
    partialLast: false,
    base: (_id, i) => 6 + ((i * 3) % 14),
  },
  {
    def: def(
      "fixture_recalls",
      "Recalls announced",
      "recalls",
      "count",
      "safety",
      ["company"],
      "year",
    ),
    ids: COMPANIES,
    periods: years(2016, 2025),
    partialLast: false,
    base: (_id, i) => 2 + ((i * 5) % 30),
  },
];

function periodBounds(type: PeriodType, p: string): [string, string] {
  if (type === "fiscal_year") {
    const y = Number(p.slice(2));
    return [`${y - 1}-10-01`, `${y}-09-30`];
  }
  if (type === "twelve_months_ending") {
    const y = Number(p.slice(0, 4));
    return [`${y - 1}${p.slice(4)}`, p];
  }
  return [`${p}-01-01`, `${p}-12-31`];
}

function buildFacts(spec: Spec): Fact[] {
  const rand = seededRandom(spec.def.id.length * 977 + spec.ids.length);
  const out: Fact[] = [];
  spec.ids.forEach((id, i) => {
    const base = spec.base(id, i);
    const slope = (rand() - 0.4) * 0.06;
    spec.periods.forEach((p, k) => {
      const [start, end] = periodBounds(spec.def.periodType, p);
      const gap = (i * 13 + k * 7) % 41 === 0; // a deliberate gap now and then
      const partial = spec.partialLast && k === spec.periods.length - 1;
      const raw = base * (1 + slope * k) * (0.92 + rand() * 0.16) * (partial ? 0.55 : 1);
      const value = gap
        ? null
        : spec.def.format === "count"
          ? Math.round(raw)
          : Math.round(raw * 10) / 10;
      out.push({
        metricId: spec.def.id,
        entityType: spec.def.entityTypes[0]!,
        entityId: id,
        period: p,
        periodStart: start,
        periodEnd: end,
        value,
        moe: spec.moe && value !== null ? Math.round(value * (0.01 + rand() * 0.02)) : null,
        partial,
        n: null,
        notRecordedReason: gap ? "[Fixture] Not published for this period" : null,
      });
    });
  });
  if (spec.def.entityTypes.includes("nation")) {
    spec.periods.forEach((p, k) => {
      const vals = out
        .filter((f) => f.period === p && f.value !== null)
        .map((f) => f.value as number);
      const [start, end] = periodBounds(spec.def.periodType, p);
      const value =
        spec.def.format === "count"
          ? vals.reduce((a, b) => a + b, 0)
          : Math.round((vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length)) * 10) / 10;
      out.push({
        metricId: spec.def.id,
        entityType: "nation",
        entityId: "US",
        period: p,
        periodStart: start,
        periodEnd: end,
        value,
        moe: null,
        partial: spec.partialLast && k === spec.periods.length - 1,
        n: null,
        notRecordedReason: null,
      });
    });
  }
  return out;
}

const FACTS = new Map(SPECS.map((s) => [s.def.id, buildFacts(s)] as const));

const latestCompleteOf = (facts: Fact[], entityId: string): Fact | undefined =>
  facts
    .filter((f) => f.entityId === entityId && !f.partial && f.value !== null)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];

export const fixtureCatalog: MetricDef[] = SPECS.map((s) => {
  const facts = FACTS.get(s.def.id)!;
  return {
    ...s.def,
    coverage: {
      from: s.periods[0] ?? null,
      to: s.periods[s.periods.length - 1] ?? null,
      entities: s.ids.length,
      facts: facts.length,
    },
    refreshedAt: "2026-10-23T06:00:00Z",
  };
});

const EVENT_STUDY: EventStudy = {
  title: "[Fixture] Months from a product's first recall to the creation of its MDL",
  event: "First recall of the product (FDA or CPSC)",
  outcome: "MDL created (first JPML transfer order)",
  cases: Array.from({ length: 14 }, (_, i) => {
    const year = 2012 + (i % 11);
    const month = ((i * 5) % 12) + 1;
    const months = [-3, 4, 7, 9, 11, 14, 16, 18, 22, 25, 29, 34, 41, 55][i]!;
    const ev = `${year}-${String(month).padStart(2, "0")}-15`;
    const outMonthIndex = year * 12 + month - 1 + months;
    const out = `${Math.floor(outMonthIndex / 12)}-${String((outMonthIndex % 12) + 1).padStart(2, "0")}-01`;
    return {
      id: `fixture-case-${i}`,
      label: `[Fixture] MDL ${2900 + i}`,
      href: null,
      eventLabel: `[Fixture] Product ${String.fromCharCode(65 + i)} recall`,
      eventDate: ev,
      outcomeDate: out,
      months,
      evidence: {
        relation: "subject_of",
        evidence: "publisher_stated" as const,
        sourceDataset: "fixture",
        sourceRecordId: `fixture:${i}`,
      },
    };
  }),
  sources: SRC,
  method: "Development fixture. Not real data.",
};

/** The fixture provider: the contract reads answered from the generated facts. */
export const fixtureLayer: InsightsLayer = {
  catalog: async () => fixtureCatalog,
  series: async (a) =>
    (FACTS.get(a.metric) ?? []).filter(
      (f) =>
        f.entityType === a.entityType &&
        a.entityIds.includes(f.entityId) &&
        (!a.from || f.period >= a.from) &&
        (!a.to || f.period <= a.to),
    ),
  snapshot: async (a) =>
    (FACTS.get(a.metric) ?? []).filter(
      (f) => f.entityType === a.entityType && f.period === a.period,
    ),
  latest: async (a) => {
    const facts = (FACTS.get(a.metric) ?? []).filter((f) => f.entityType === a.entityType);
    return [...new Set(facts.map((f) => f.entityId))].flatMap((id) => {
      const f = latestCompleteOf(facts, id);
      return f ? [f] : [];
    });
  },
  cross: async (a) => {
    const xs = (FACTS.get(a.metricX) ?? []).filter(
      (f) => f.entityType === a.entityType && f.period === a.periodX,
    );
    const ys = new Map(
      (FACTS.get(a.metricY) ?? [])
        .filter((f) => f.entityType === a.entityType && f.period === a.periodY)
        .map((f) => [f.entityId, f] as const),
    );
    return xs.flatMap((x): CrossPoint[] => {
      const y = ys.get(x.entityId);
      return x.value !== null && y && y.value !== null
        ? [
            {
              entityId: x.entityId,
              label: x.entityId,
              x: x.value,
              y: y.value,
              periodX: a.periodX,
              periodY: a.periodY,
            },
          ]
        : [];
    });
  },
  entity: async (a) => ({
    entity: {
      type: a.type,
      id: a.id,
      label: `[Fixture] ${a.id}`,
      parent: null,
      keys: {},
      href: null,
    },
    facts: [],
    children: [],
  }),
  links: async () => [],
  freshness: async (): Promise<Freshness[]> => [
    {
      source: "[Fixture] Federal Register",
      dataset: "fixture",
      lastRunAt: "2026-10-23T06:00:00Z",
      lastSuccessAt: "2026-10-23T06:00:00Z",
      newRecords: 42,
      status: "ok",
      message: null,
    },
  ],
  eventStudy: async () => EVENT_STUDY,
};

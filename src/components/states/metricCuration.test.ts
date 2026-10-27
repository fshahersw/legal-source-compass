import { describe, expect, it } from "vitest";
import type { MetricDef } from "@/lib/external/stateMetrics.functions";
import { curateMetricDef, curateMetrics, FDA_HQ_CAVEAT } from "./metricCuration";

const base = (over: Partial<MetricDef>): MetricDef => ({
  key: "x",
  label: "X",
  short: "X",
  unit: "",
  format: "int",
  group: "g",
  method: "",
  denominator: null,
  per: null,
  higher: "neutral",
  selectable: true,
  caveats: [],
  years: [1999, 2017],
  rankYears: [],
  latestYear: 2017,
  partialYears: {},
  national: {},
  nationalBasis: null,
  distribution: {},
  sources: [],
  order: 0,
  provisional: null,
  ...over,
});

describe("curateMetricDef", () => {
  it("adds the HQ basis and caveat to every FDA metric once", () => {
    const d = curateMetricDef(
      base({ key: "fda_drug_recalls", label: "FDA drug enforcement entries" }),
    );
    expect(d.label).toMatch(/HQ state/);
    expect(d.caveats[0]).toBe(FDA_HQ_CAVEAT);
    expect(curateMetricDef(d)).toBe(d);
  });

  it("keeps an FDA metric that already carries the caveat and HQ wording", () => {
    const d = base({
      key: "fda_recall_rate",
      label: "Entries (HQ state)",
      caveats: [FDA_HQ_CAVEAT],
    });
    expect(curateMetricDef(d)).toBe(d);
  });

  it("labels leading causes with their year span, once", () => {
    const d = curateMetricDef(
      base({
        key: "cause_cancer_rate",
        label: "Cancer: age-adjusted death rate",
        short: "Cancer (age-adj.)",
      }),
    );
    expect(d.label).toBe("Cancer: age-adjusted death rate (1999–2017)");
    expect(d.short).toBe("Cancer (age-adj.) (to 2017)");
    expect(d.caveats[0]).toMatch(/ends in 2017/);
    expect(curateMetricDef(d)).toBe(d);
  });

  it("leaves other metrics and spanless causes alone", () => {
    const d = base({ key: "overdose_rate" });
    expect(curateMetricDef(d)).toBe(d);
    const c = base({ key: "cause_x_rate", years: null, latestYear: null });
    expect(curateMetricDef(c)).toBe(c);
  });

  it("curates a whole payload", () => {
    const out = curateMetrics({
      metrics: [base({ key: "fda_recalls", label: "FDA entries" })],
      other: 1,
    });
    expect(out.metrics[0]?.label).toMatch(/HQ state/);
    expect(out.other).toBe(1);
  });
});

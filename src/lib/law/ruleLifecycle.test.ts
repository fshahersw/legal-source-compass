import { describe, expect, it } from "vitest";
import { MIN_FINALIZED, comparable, parseRuleLifecycle } from "./ruleLifecycle";

describe("parseRuleLifecycle", () => {
  it("reads the RPC shape, keeps missing medians null and ranks only agencies with enough finalized RINs", () => {
    const out = parseRuleLifecycle({
      as_of: "2026-10-02",
      agencies: [
        { agency: "FDA", prefix: "0910", rins_proposed: 221, finalized: 136, median_days: 723, p25_days: 386.75, p75_days: 1097.25, open_since_2021: 28 },
        { agency: "CPSC", prefix: "3041", rins_proposed: 12, finalized: 4, median_days: 307.5, p25_days: 251.5, p75_days: 347.25, open_since_2021: 2 },
        { agency: "FTC", prefix: "3084", rins_proposed: 0, finalized: 0, median_days: null, open_since_2021: 0 },
        { agency: "", prefix: "x" },
      ],
    })!;
    expect(out.asOf).toBe("2026-10-02");
    expect(out.rows).toHaveLength(3);
    expect(out.rows[2]!.medianDays).toBeNull();
    expect(comparable(out.rows).map((r) => r.agency)).toEqual(["FDA"]);
    expect(MIN_FINALIZED).toBe(20);
    expect(parseRuleLifecycle({})).toBeNull();
  });
});

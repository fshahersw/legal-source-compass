import { expect, it } from "vitest";
import { admissionFrequency, legislativeFrequency, observedDurations, rulemakingFrequency } from "./history";

it("excludes immature rulemaking cohorts even if they finalized early", () => {
  const rows = [
    { id: "old", agency: "fda", proposed: "2020-01-01", finalized: "2021-01-01", comment_count: 0 },
    { id: "young-final", agency: "fda", proposed: "2026-01-01", finalized: "2026-02-01", comment_count: null },
    { id: "young-open", agency: "fda", proposed: "2026-01-01", finalized: null, comment_count: 1 },
  ];
  const result = rulemakingFrequency(rows, 2, "2026-10-02");
  expect(result.n).toBe(1); expect(result.occurred).toBe(1); expect(result.excluded_incomplete_followup).toBe(2);
});
it("handles leap anniversaries, deduplicates proceedings and does not count later finalization", () => {
  const row = { id: "r", agency: "fda", proposed: "2020-02-29", finalized: "2021-03-01", comment_count: 1 };
  expect(rulemakingFrequency([row, row], 1, "2021-02-28")).toMatchObject({ n: 1, occurred: 0, share: 0 });
  expect(rulemakingFrequency([], 5, "2026-10-02").share).toBeNull();
});
it("does not treat absent settlement dates, negative intervals or future events as completed outcomes", () => {
  const result = observedDurations([{ id: "a", start: "2020-01-01", event: "2020-01-11" }, { id: "b", start: "2020-01-01", event: null }, { id: "c", start: "2020-01-01", event: "2019-01-01" }, { id: "d", start: "2020-01-01", event: "2027-01-01" }], "2026-10-02");
  expect(result).toMatchObject({ n: 1, cohort_n: 4, event_not_recorded: 3, median_days: 10 });
});
it("uses completed Congresses for pass-rate denominators", () => {
  const base = { chamber: "house", committees: [], cosponsors: null, bipartisan: null };
  expect(legislativeFrequency([{ ...base, id: "a", introduced: "2023-03-01", enacted: null, congress_ended: "2025-01-03" }, { ...base, id: "b", introduced: "2025-03-01", enacted: "2025-05-01", congress_ended: "2027-01-03" }], "2026-10-02")).toMatchObject({ n: 1, occurred: 0, excluded_incomplete_followup: 1 });
});
it("keeps partial Daubert outcomes separate and counts each ruling once", () => {
  const a = { ruling_id: "1", date: "2020-01-01", outcome: "admitted" as const };
  expect(admissionFrequency([a, a, { ruling_id: "2", date: "2020-01-02", outcome: "partial" }], "2026-10-02")).toMatchObject({ n: 2, admitted: 1, partial: 1, admission_share: .5 });
});

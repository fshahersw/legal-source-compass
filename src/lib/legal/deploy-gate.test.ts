import { describe, expect, it } from "vitest";
import { EntityType } from "./schema";
import { assertDeployReport } from "./deploy";
describe("deployment quality gate", () => {
  const report = () => ({ passed: true, regressions: [], counts_by_type: Object.fromEntries([...EntityType.options, "unrecognized"].map(t => [t, { total: 0, invalid: 0 }])) });
  it("fails closed when a report, type count, or reviewed baseline is missing", () => {
    expect(() => assertDeployReport(null)).toThrow();
    const missing = report(); delete missing.counts_by_type["court"];
    expect(() => assertDeployReport(missing)).toThrow("court");
    expect(() => assertDeployReport({ ...report(), passed: false, regressions: ["No reviewed baseline"] })).toThrow("No reviewed baseline");
  });
  it("rejects type regressions even if the server returned passed=true", () => {
    expect(() => assertDeployReport({ ...report(), regressions: ["opinion: invalid count increased"] })).toThrow("opinion");
    expect(() => assertDeployReport(report())).not.toThrow();
  });
});

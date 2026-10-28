import { describe, expect, it } from "vitest";
import { clearanceRows } from "./clearanceRate";
describe("civil clearance flow ratio", () => {
  it.each([[80,80],[120,120]])("%s terminations per 100 filings is %s percent", (terminations, rate) => {
    expect(clearanceRows([{fy:2025, filings:100, terminations, partial:false}])[0]?.rate).toBe(rate);
  });
  it("does not divide by zero", () => {
    expect(clearanceRows([{fy:2025, filings:0, terminations:120, partial:false}])[0]?.rate).toBeNull();
  });
  it("retains absent years as gaps and excludes partial years", () => {
    const rows = clearanceRows([{fy:2023,filings:100,terminations:80,partial:false},{fy:2025,filings:100,terminations:120,partial:false},{fy:2026,filings:40,terminations:20,partial:true}]);
    expect(rows.map((r) => [r.fy,r.rate])).toEqual([[2023,80],[2024,null],[2025,120]]);
  });
  it("does not resolve ambiguous duplicate years by picking a row", () => {
    expect(clearanceRows([{fy:2025,filings:100,terminations:80,partial:false},{fy:2025,filings:100,terminations:90,partial:false}])[0]?.rate).toBeNull();
  });
});
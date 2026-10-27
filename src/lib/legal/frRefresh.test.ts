import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { FEDERAL_REGISTER_FIELDS, addDays, documentsUrl, heldUrlSet, isCanonicalRin, isIsoDay, missingFields, monthlyPeriods, windowProblems } from "./frRefresh";
// @ts-expect-error -- plain ESM script without type declarations
import { FR_REFRESH_SQL, frRefreshSql } from "../../../scripts/legal/prepare-fr-refresh-update.mjs";

describe("Federal Register refresh windows", () => {
  it("tiles a window into calendar-month periods, inclusive at both ends", () => {
    expect(monthlyPeriods("2026-10-03", "2026-10-27")).toEqual([{ start: "2026-10-03", end: "2026-10-27" }]);
    expect(monthlyPeriods("2026-09-28", "2026-11-02")).toEqual([
      { start: "2026-09-28", end: "2026-09-30" }, { start: "2026-10-01", end: "2026-10-31" }, { start: "2026-11-01", end: "2026-11-02" }]);
    // The full history keeps the original month starts, so earlier acquisitions are recognised.
    const full = monthlyPeriods("2000-01-01", "2026-10-02");
    expect(full).toHaveLength(322);
    expect(full[1]).toEqual({ start: "2000-02-01", end: "2000-02-29" });
    expect(full.at(-1)).toEqual({ start: "2026-10-01", end: "2026-10-02" });
    expect(() => monthlyPeriods("2026-10-05", "2026-10-04")).toThrow("empty");
    expect(() => monthlyPeriods("2026-10-5", "2026-10-06")).toThrow("ISO");
  });
  it("validates ISO days strictly", () => {
    expect(isIsoDay("2026-02-29")).toBe(false);
    expect(isIsoDay("2028-02-29")).toBe(true);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
  it("reports gaps, overlaps, unfinished periods and count mismatches", () => {
    const ok = { expected: 3, actual: 3, status: "acquired" };
    expect(windowProblems([{ start_date: "2026-10-03", end_date: "2026-10-31", ...ok }, { start_date: "2026-11-01", end_date: "2026-11-02", ...ok }], "2026-10-03", "2026-11-02")).toEqual([]);
    expect(windowProblems([{ start_date: "2026-10-03", end_date: "2026-10-27", ...ok }], "2026-10-03", "2026-10-28")).toEqual(["Window not acquired from 2026-10-28 through 2026-10-28"]);
    expect(windowProblems([{ start_date: "2026-10-03", end_date: "2026-10-27", expected: 4, actual: 3, status: "acquired" }], "2026-10-03", "2026-10-27"))
      .toEqual(["Period 2026-10-03: publisher count 4 but 3 rows kept"]);
    expect(windowProblems([{ start_date: "2026-10-01", end_date: "2026-10-27", ...ok }], "2026-10-03", "2026-10-27")[0]).toMatch("outside the window");
    expect(windowProblems([], "2026-10-03", "2026-10-27")).toEqual(["Window not acquired from 2026-10-03 through 2026-10-27"]);
  });
  it("requests the fixed field set from the official API only", () => {
    const url = new URL(documentsUrl({ start: "2026-10-03", end: "2026-10-27" }));
    expect(url.origin).toBe("https://www.federalregister.gov");
    expect(url.searchParams.get("conditions[publication_date][gte]")).toBe("2026-10-03");
    expect(url.searchParams.get("conditions[publication_date][lte]")).toBe("2026-10-27");
    expect(url.searchParams.getAll("fields[]")).toEqual([...FEDERAL_REGISTER_FIELDS]);
    expect(FEDERAL_REGISTER_FIELDS).toContain("comments_close_on");
  });
  it("links only canonical RINs and lists missing fields", () => {
    expect(isCanonicalRin("0910-AI60")).toBe(true);
    for (const bad of ["7100 AG79", "0910-ai60", "0910AI60", "", null]) expect(isCanonicalRin(bad)).toBe(false);
    expect(missingFields(Object.fromEntries(FEDERAL_REGISTER_FIELDS.map((f) => [f, null])))).toEqual([]);
    expect(missingFields({ document_number: "x", dates: "y" })).toContain("comments_close_on");
  });
  it("matches held publications by exact publisher URL", () => {
    const held = heldUrlSet([{ id: "00-888", source_url: "https://www.federalregister.gov/documents/2000/01/05/00-888/a" }]);
    expect(held.has("https://www.federalregister.gov/documents/2000/01/05/00-888/a")).toBe(true);
    expect(held.has("https://www.federalregister.gov/documents/2000/03/09/00-888/b")).toBe(false);
  });
});

describe("legal-atlas-v3-fr-refresh.sql", () => {
  // Windows checkouts may convert line endings; compare text, not bytes.
  const lf = (s: string) => s.replace(/\r\n/g, "\n");
  const generated = lf(fs.readFileSync("database/contracts/legal-atlas-v3.generated.sql", "utf8"));
  const sql = lf(fs.readFileSync(FR_REFRESH_SQL, "utf8"));
  it("is regenerated from the current generated contract", () => {
    expect(sql).toBe(frRefreshSql(generated));
  });
  it("only adds or loosens: no data change, approval or release", () => {
    const statements = sql.replace(/--[^\n]*/g, "");
    expect(statements).not.toMatch(/\b(insert|update|delete|truncate|drop)\b/i);
    expect(sql).not.toMatch(/review_status\s*=\s*'approved'/);
    expect(sql).toContain("add value if not exists 'CORRECTION'");
    expect(sql).toContain("'^([CR][0-9]+-)?([0-9]{2}|[0-9]{4}|[A-Z][0-9]{1,2})-[0-9]{1,6}$'");
  });
  it("keeps every new object service-role only", () => {
    expect(sql).toContain("revoke all on function public.corpus_legal_fr_window_v3(date) from public,anon,authenticated;");
    expect(sql).toContain("grant execute on function public.corpus_legal_fr_window_v3(date) to service_role;");
    expect(sql).toContain("revoke all on legal_atlas.fr_documents_current from public,anon,authenticated;");
    expect(sql).toMatch(/set search_path=''/);
    expect(sql).toContain("with (security_invoker=true)");
  });
});

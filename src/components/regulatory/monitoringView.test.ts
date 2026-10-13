import { describe, expect, it } from "vitest";
import {
  calendarDate,
  changeMonitoringFilters,
  displayCount,
  normalizeMonitoringSearch,
  publicSourceUrl,
  quickTrendWindow,
  queryLabels,
  valueText,
} from "./monitoringView";

describe("regulatory monitoring view boundaries", () => {
  it("does not label an unresolved dated proposal as detected or published", () => {
    expect(queryLabels({ from: "2026-10-01", to: "2026-10-12" })).toContain(
      "Date basis: awaiting clarification",
    );
    expect(queryLabels({ from: "2026-10-01", dateBasis: "published" })).toContain(
      "Date basis: publisher date",
    );
  });
  it("uses inclusive UTC windows across month and year boundaries without changing date meaning", () => {
    expect(quickTrendWindow(7, new Date("2026-01-02T23:59:59Z"))).toEqual({
      from: "2025-12-27",
      to: "2026-01-02",
    });
    expect(quickTrendWindow(30, new Date("2024-03-01T00:00:00Z"))).toEqual({
      from: "2024-02-01",
      to: "2024-03-01",
    });
    expect(
      changeMonitoringFilters(
        normalizeMonitoringSearch({ view: "trends", dateBasis: "published" }),
        quickTrendWindow(90, new Date("2026-10-12T00:00:00Z")),
      ),
    ).toMatchObject({
      view: "trends",
      dateBasis: "published",
      from: "2026-07-15",
      to: "2026-10-12",
      page: 1,
    });
  });
  it("keeps real dates and rejects overflow dates rather than silently changing the period", () => {
    expect(calendarDate("2024-02-29")).toBe("2024-02-29");
    expect(calendarDate("2025-02-29")).toBeUndefined();
    expect(calendarDate("2026-13-01")).toBeUndefined();
    expect(calendarDate("yesterday")).toBeUndefined();
  });
  it("retains exact entity IDs and caps malformed URL state", () => {
    const search = normalizeMonitoringSearch({
      view: "entities",
      page: "2",
      entityNamespace: "FDA",
      entityId: "001-A/1",
      q: "  sterility  ",
    });
    expect(search).toMatchObject({
      view: "entities",
      page: 2,
      entityId: "001-A/1",
      q: "sterility",
    });
    expect(
      normalizeMonitoringSearch({ view: "admin", page: -1, q: "x".repeat(301) }),
    ).toMatchObject({ view: "analytics", page: 1, q: undefined });
  });
  it("resets pagination and selected evidence after the query changes", () => {
    const next = changeMonitoringFilters(
      normalizeMonitoringSearch({
        page: 7,
        recordSource: "fda_warning_letters",
        recordId: "old",
        source: "fda_warning_letters",
      }),
      { source: "federal_register" },
    );
    expect(next).toMatchObject({
      page: 1,
      source: "federal_register",
      recordSource: undefined,
      recordId: undefined,
    });
  });
  it("distinguishes zero, missing and an empty literal source value", () => {
    expect(displayCount(0)).toBe("0");
    expect(displayCount(null)).toBe("Not recorded");
    expect(valueText(false)).toBe("false");
    expect(valueText("")).toBe("Empty source value");
  });
  it("only offers normal HTTP source links without embedded credentials", () => {
    expect(publicSourceUrl("https://www.fda.gov/safety")).toBe("https://www.fda.gov/safety");
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,body",
      "/private/file",
      "https://user:secret@example.com/",
    ])
      expect(publicSourceUrl(value)).toBeNull();
  });
});

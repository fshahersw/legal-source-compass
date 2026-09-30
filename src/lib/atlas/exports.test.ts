import { describe, expect, it } from "vitest";

import { SOURCE_EXPORT_COLUMNS, csvCell, sourcesToCsv, sourcesToJson, toCsv } from "./exports";
import type { ReviewOverlay, Source } from "./types";

const source = {
  id: "s1",
  url: "https://pcl.uscourts.gov/pcl/index.jsf?x=1#/search",
  title: 'Docket, "Locator"',
  domain: "pcl.uscourts.gov",
  jurisdiction: "Federal",
  heading_category: "Dockets",
  source_family: "Federal dockets",
  occurrences: 12,
  imported_authority_label: "primary",
  imported_currentness_label: "as-of 2025-11",
  imported_review_label: "promoted",
} as Source;

const overlays: Record<string, ReviewOverlay> = {
  s1: {
    source_id: "s1",
    action: "accepted",
    reason: "checked against the docket index",
    at: "2026-02-03T10:00:00.000Z",
  },
};

describe("csvCell", () => {
  it("quotes and escapes commas, quotes and newlines", () => {
    expect(csvCell('a,b "c"\nd')).toBe('"a,b ""c""\nd"');
  });

  it("leaves plain values unquoted and renders empties", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("sourcesToCsv", () => {
  it("emits a header plus one row with local overlay columns", () => {
    const csv = sourcesToCsv([source], overlays, { s1: true });
    const lines = csv.split("\r\n");
    expect(lines[0]!).toBe(SOURCE_EXPORT_COLUMNS.join(","));
    expect(lines).toHaveLength(2);
    expect(lines[1]!).toContain("https://pcl.uscourts.gov/pcl/index.jsf?x=1#/search");
    expect(lines[1]!).toContain('"Docket, ""Locator"""');
    expect(lines[1]!).toContain("accepted");
    expect(lines[1]!).toContain("checked against the docket index");
    expect(lines[1]!.endsWith("true")).toBe(true);
  });

  it("emits header only for an empty selection", () => {
    expect(sourcesToCsv([], {}, {})).toBe(SOURCE_EXPORT_COLUMNS.join(","));
  });

  it("leaves local columns blank when there is no local state", () => {
    const csv = sourcesToCsv([source], {}, {});
    const row = csv.split("\r\n")[1]!;
    expect(row.endsWith(",,,false")).toBe(true);
  });

  it("keeps column order stable", () => {
    expect(toCsv([{ b: 2, a: 1 }], ["a", "b"])).toBe("a,b\r\n1,2");
  });
});

describe("sourcesToJson", () => {
  it("includes row count, bundle version and the not-verification note", () => {
    const parsed = JSON.parse(
      sourcesToJson([source], overlays, { s1: true }, { bundle_version: "V2.2A", scope: "library" }),
    );
    expect(parsed.row_count).toBe(1);
    expect(parsed.bundle_version).toBe("V2.2A");
    expect(parsed.scope).toBe("library");
    expect(parsed.note).toMatch(/not fresh verification/);
    expect(parsed.rows[0].url).toBe("https://pcl.uscourts.gov/pcl/index.jsf?x=1#/search");
    expect(parsed.rows[0].local_review_action).toBe("accepted");
    expect(parsed.rows[0].imported_review_label).toBe("promoted");
  });
});

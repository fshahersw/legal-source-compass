import { describe, expect, it } from "vitest";
import type { CountyMatch, GovRow } from "@/lib/external/govDomainsModel";
import {
  ROWS_PER_GROUP,
  ROWS_PER_GROUP_FILTERED,
  chipLabel,
  emptyText,
  matchLine,
  rowDetail,
  rowFlags,
  rowLimit,
  rowName,
  snapshotText,
} from "./govDomainsView";

const row = (over: Partial<GovRow> = {}): GovRow => ({
  id: "a.gov",
  domain: "a.gov",
  path: null,
  group: "city",
  types: [{ registry: "cisa", type: "City" }],
  organization: "City of A",
  city: "A-ville",
  states: ["WY"],
  registries: ["cisa"],
  securityContact: null,
  link: null,
  note: null,
  notUsed: false,
  conflict: false,
  ...over,
});

describe("govDomainsView", () => {
  it("limits rows per group unless expanded", () => {
    expect(rowLimit(false, false)).toBe(ROWS_PER_GROUP);
    expect(rowLimit(false, true)).toBe(ROWS_PER_GROUP_FILTERED);
    expect(rowLimit(true, true)).toBe(Number.POSITIVE_INFINITY);
  });

  it("states the snapshot dates, or that they are not recorded", () => {
    expect(
      snapshotText({
        cisaZoneExport: "2026-10-22 12:54:30",
        cisaCommit: null,
        gsaCommit: null,
        gsaCommitDate: "2025-11-14",
      }),
    ).toBe("CISA .gov registry as of 2026-10-22; GSA list of 2025-11-14");
    expect(snapshotText(null)).toBe("Registry snapshot date not recorded");
    expect(
      snapshotText({
        cisaZoneExport: null,
        cisaCommit: null,
        gsaCommit: null,
        gsaCommitDate: null,
      }),
    ).toBe("Registry snapshot date not recorded");
  });

  it("describes a row from its own fields and omits what is not recorded", () => {
    expect(rowDetail(row())).toBe("City of A · A-ville · City");
    expect(rowDetail(row({ organization: null, city: null, types: [] }))).toBe("Type not recorded");
    // GSA has no organization field: its note stands in, labelled as the note it is
    expect(
      rowDetail(
        row({ organization: null, city: null, note: "Laramie County, WY", registries: ["gsa"] }),
      ),
    ).toBe("GSA note: Laramie County, WY · City");
  });

  it("flags page-only entries, disagreements, out-of-use names and multi-state entries", () => {
    expect(rowFlags(row())).toEqual([]);
    expect(
      rowFlags(row({ path: "city", conflict: true, notUsed: true, states: ["OH", "PA"] })),
    ).toEqual([
      "Pages under /city only",
      "Registries disagree",
      "Also named in GSA's out-of-use list",
      "Listed for OH, PA",
    ]);
    expect(rowName(row({ domain: "x.com", path: "city" }))).toBe("x.com/city");
  });

  it("says how a county match was made", () => {
    const m: CountyMatch = {
      row: row(),
      method: "organization_name",
      detail: "organization name is exactly “Laramie County”",
    };
    expect(matchLine(m)).toBe("organization name is exactly “Laramie County” (the Census name)");
  });

  it("labels chips and empty states", () => {
    expect(chipLabel("", 1200)).toBe("All 1,200");
    expect(chipLabel("county", 3)).toBe("County 3");
    expect(chipLabel("unassigned", 1)).toBe("Level not recorded 1");
    expect(emptyText({ filtering: true, stateName: "Wyoming" })).toMatch(/matches this filter/);
    expect(emptyText({ filtering: false, stateName: "Wyoming" })).toMatch(/Wyoming/);
  });
});

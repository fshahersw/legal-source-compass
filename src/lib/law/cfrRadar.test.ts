import { describe, expect, it } from "vitest";
import { buildRadar, sectionChanges, yearBefore } from "./cfrRadar";

const FR = {
  url: "https://www.federalregister.gov/d/2026-18380",
  citation: "91 FR 57265",
  document_number: "2026-18380",
  publication_date: "2026-09-09",
};
// Shaped like ecfr_section_versions rows read as select=id,title,versions:detail->versions.
const row = (id: string, versions: unknown[]) => ({
  id,
  title: `49 CFR ${id.slice(7)} Heading`,
  versions,
});
const v = (date: string, substantive: boolean, basis = "none", fr: unknown[] = []) => ({
  date,
  substantive,
  fr_basis: basis,
  fr,
  name: `§ 571.208 Standard No. 208; Occupant crash protection.`,
  removed: false,
});

describe("sectionChanges", () => {
  it("drops the 2016 baseline and editorial reissues, links FR rules only on an exact basis", () => {
    const out = sectionChanges(
      row("cfr:49:571.208", [
        v("2016-12-27", true),
        v("2016-12-27", false),
        v("2022-03-30", true, "rules_for_part_on_date", [FR, FR]),
        v("2026-10-09", true, "source_note", [FR]),
        v("2026-10-10", false, "source_note", [FR]),
      ]),
      "49:571",
    );
    expect(out.map((c) => c.date)).toEqual(["2022-03-30", "2026-10-09"]);
    expect(out[0]!.fr).toEqual([]);
    expect(out[1]!.fr).toEqual([
      { documentNumber: "2026-18380", citation: "91 FR 57265", url: FR.url },
    ]);
    expect(out[1]!.heading).toBe("Standard No. 208; Occupant crash protection.");
    expect(out[1]!.section).toBe("571.208");
  });
});

describe("buildRadar", () => {
  it("counts changes per part and year with real zeros, and the last 12 months", () => {
    const rows = new Map<string, unknown[]>([
      [
        "49:571",
        [
          row("cfr:49:571.208", [
            v("2016-12-27", true),
            v("2022-03-30", true),
            v("2026-10-09", true),
          ]),
          row("cfr:49:571.108", [v("2016-12-27", true), v("2025-11-01", true)]),
          row("cfr:49:571.101", [v("2016-12-27", true)]),
        ],
      ],
    ]);
    const r = buildRadar(rows, "2026-10-27", [
      { title: "49", part: "571", label: "FMVSS", agency: "NHTSA" },
      { title: "49", part: "579", label: "EWR", agency: "NHTSA" },
    ]);
    expect(r.years[0]).toBe("2017");
    expect(r.years.at(-1)).toBe("2026");
    expect(r.parts[0]).toMatchObject({
      key: "49:571",
      sections: 3,
      changedSections: 2,
      changes: 3,
      latest: "2026-10-09",
    });
    expect(r.parts[0]!.byYear["2019"]).toBe(0);
    expect(r.parts[0]!.byYear["2026"]).toBe(1);
    expect(r.parts[1]).toMatchObject({ sections: 0, changes: 0, latest: null });
    expect(r.last12).toEqual({ sections: 2, changes: 2, since: "2025-10-27" });
    expect(r.changes[0]!.date).toBe("2026-10-09");
  });
  it("yearBefore keeps the calendar day", () => {
    expect(yearBefore("2026-10-27")).toBe("2025-10-27");
  });
});

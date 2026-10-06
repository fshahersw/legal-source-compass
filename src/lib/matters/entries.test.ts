import { describe, expect, it } from "vitest";
import { entryTypeLabel, groupEntriesByMonth, parseActivityEntry } from "./entries";

describe("activity entries", () => {
  const item = {
    id: "e49c1e9b",
    cells: {
      mdl: "9001",
      entry_type: "Pretrial order",
      entry_number: "1754",
      published_at: "2025-03-11",
    },
    links: [
      { url: "#mdl-activity?mdl=9001", label: "MDL page" },
      { url: "https://www.courtlistener.com/docket/111/", label: "Docket on CourtListener" },
    ],
    badges: ["Pretrial order", "1 verified document(s)"],
    subtitle: "SUPPLEMENTAL ORDER RE MOTION FOR RELIEF Re: 1168 MOTION...",
  };

  it("reads number, date entered, type, snippet, document badge and the docket link", () => {
    expect(parseActivityEntry(item)).toEqual({
      id: "activity:e49c1e9b",
      source: "activity",
      entryNumber: 1754,
      date: "2025-03-11",
      dateBasis: "entered",
      entryType: "Pretrial order",
      description: "SUPPLEMENTAL ORDER RE MOTION FOR RELIEF Re: 1168 MOTION...",
      documentCount: 1,
      sourceUrl: "https://www.courtlistener.com/docket/111/",
    });
  });

  it("keeps unknown values null instead of guessing", () => {
    const e = parseActivityEntry({
      id: "x",
      cells: { entry_number: "0", published_at: "" },
      badges: ["Other"],
    })!;
    expect(e).toMatchObject({
      entryNumber: 0,
      date: null,
      entryType: null,
      description: null,
      documentCount: null,
      sourceUrl: null,
    });
    expect(parseActivityEntry({ cells: {} })).toBeNull();
    expect(parseActivityEntry("x")).toBeNull();
    expect(
      parseActivityEntry({ id: "x", cells: { entry_number: "12a", published_at: "03/11/2025" } }),
    ).toMatchObject({ entryNumber: null, date: null });
  });
});

describe("timeline grouping", () => {
  it("groups by month in order, with undated entries last", () => {
    const mk = (id: string, date: string | null) => ({
      id,
      source: "activity" as const,
      entryNumber: null,
      date,
      dateBasis: "entered" as const,
      entryType: null,
      description: null,
      documentCount: null,
      sourceUrl: null,
    });
    const groups = groupEntriesByMonth([
      mk("a", "2025-03-13"),
      mk("u", null),
      mk("b", "2025-03-01"),
      mk("c", "2025-02-28"),
    ]);
    expect(groups.map((g) => [g.label, g.entries.map((e) => e.id)])).toEqual([
      ["March 2025", ["a", "b"]],
      ["February 2025", ["c"]],
      ["Date not recorded", ["u"]],
    ]);
    expect(groupEntriesByMonth([])).toEqual([]);
  });

  it("labels entry types from their stored keys", () => {
    expect(entryTypeLabel("case_management_order")).toBe("Case management order");
    expect(entryTypeLabel("daubert")).toBe("Daubert");
  });
});

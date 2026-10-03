import { describe, expect, it } from "vitest";
import {
  appearanceFacets,
  mentionsSeegerWeiss,
  parseAppearanceRow,
  parseCounselRow,
  partyDisplay,
  splitParties,
} from "./parties";

describe("counsel rows", () => {
  it("keeps names as recorded and treats 'not returned' as unknown", () => {
    const r = parseCounselRow(
      {
        id: "clatt-1-mdl9",
        title: "ALISON D. HAWTHORNE",
        subtitle: "EXAMPLE LAW FIRM - MONTGOMERY, AL",
        cells: {
          role: "not retrieved (record fetched by id without roles)",
          count: "not retrieved",
        },
      },
      "attorney",
    )!;
    expect(r).toEqual({
      id: "clatt-1-mdl9",
      kind: "attorney",
      name: "ALISON D. HAWTHORNE",
      detail: "EXAMPLE LAW FIRM - MONTGOMERY, AL",
      role: null,
      countText: null,
    });
    expect(
      parseCounselRow(
        { id: "f", title: "Example LLP", cells: { count: "3 attorney records" } },
        "firm",
      )!.countText,
    ).toBe("3 attorney records");
    expect(parseCounselRow({ title: "no id" }, "firm")).toBeNull();
    expect(parseCounselRow(null, "party")).toBeNull();
  });
});

describe("party-name rule", () => {
  it("lists organizations, committees and defendants and counts individual-looking names", () => {
    expect(partyDisplay({ name: "3M Company", role: null })).toBe("list");
    expect(partyDisplay({ name: "Plaintiffs' Steering Committee", role: "Plaintiff" })).toBe(
      "list",
    );
    expect(partyDisplay({ name: "Arizant Healthcare, Inc.", role: null })).toBe("list");
    expect(partyDisplay({ name: "Jane Q. Example", role: "Defendant" })).toBe("list");
    expect(partyDisplay({ name: "Jane Q. Example", role: "Plaintiff" })).toBe("count");
    expect(partyDisplay({ name: "Jane Q. Example", role: null })).toBe("count");
  });

  it("splits a page into listed rows and an exact count of the rest", () => {
    const rows = [
      {
        id: "1",
        kind: "party" as const,
        name: "Example Corp",
        detail: null,
        role: null,
        countText: null,
      },
      {
        id: "2",
        kind: "party" as const,
        name: "John Roe",
        detail: null,
        role: null,
        countText: null,
      },
      {
        id: "3",
        kind: "party" as const,
        name: "Mary Roe",
        detail: null,
        role: "Plaintiff",
        countText: null,
      },
    ];
    const { listed, counted } = splitParties(rows);
    expect(listed.map((r) => r.id)).toEqual(["1"]);
    expect(counted).toBe(2);
  });
});

describe("appearances", () => {
  const rows = [
    parseAppearanceRow(
      {
        id: "a",
        title: "Attorney One",
        cells: {
          firm: "Seeger Weiss",
          role: "Lead attorney",
          side: "plaintiff",
          linkage: "Member-of-MDL edge",
        },
      },
      { firm: ["seeger_weiss"] },
    )!,
    parseAppearanceRow(
      {
        id: "b",
        title: "Attorney Two",
        cells: { firm: "Seeger Weiss", role: "Attorney to be noticed", side: "plaintiff" },
      },
      { firm: ["seeger_weiss"] },
    )!,
    parseAppearanceRow(
      { id: "c", title: "Attorney Three", cells: { firm: "Other LLP", side: "defendant" } },
      { firm: ["other_llp"] },
    )!,
  ];

  it("parses rows and computes facets from the rows in hand only", () => {
    expect(rows[0]).toMatchObject({
      firmId: "seeger_weiss",
      role: "Lead attorney",
      side: "plaintiff",
    });
    const f = appearanceFacets(rows);
    expect(f.side).toEqual([
      { value: "plaintiff", count: 2 },
      { value: "defendant", count: 1 },
    ]);
    expect(f.firm[0]).toEqual({ value: "seeger_weiss", label: "Seeger Weiss", count: 2 });
    expect(f.role.map((r) => r.value).sort()).toEqual(["Attorney to be noticed", "Lead attorney"]);
    expect(appearanceFacets([])).toEqual({ side: [], firm: [], role: [] });
  });

  it("recognises the firm's own name only as an exact phrase", () => {
    expect(mentionsSeegerWeiss("Seeger Weiss LLP")).toBe(true);
    expect(mentionsSeegerWeiss("SEEGER, WEISS")).toBe(true);
    expect(mentionsSeegerWeiss("Seeger Weis")).toBe(false);
    expect(mentionsSeegerWeiss("Weiss Seeger Associates")).toBe(false);
    expect(mentionsSeegerWeiss(null)).toBe(false);
  });
});

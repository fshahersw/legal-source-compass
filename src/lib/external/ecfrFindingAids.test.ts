import { describe, expect, it } from "vitest";
import {
  agencyMatches,
  agencyTree,
  entriesForPart,
  parseAgencyRow,
  parsePreparedRow,
  parseSubjectRow,
  referenceLabel,
  referencedTitles,
} from "./ecfrFindingAids";

const agency = (slug: string, over: Record<string, unknown> = {}) => ({
  id: `agency:${slug}`,
  a: {
    slug,
    name: slug.toUpperCase(),
    short_name: null,
    display_name: slug,
    sortable_name: slug,
    parent: null,
    children: [],
    cfr_references: [{ title: 21, chapter: "I" }],
    fr_agency_id: null,
    order: 0,
    ...over,
  },
});

describe("agencies", () => {
  it("reads a node with its published references", () => {
    const n = parseAgencyRow(
      agency("fda", {
        short_name: "FDA",
        cfr_references: [
          { title: 21, chapter: "I" },
          { title: 9, subtitle: "A" },
        ],
        fr_agency_id: "199",
      }),
    )!;
    expect(n.slug).toBe("fda");
    expect(n.shortName).toBe("FDA");
    expect(n.profileId).toBe("199");
    expect(n.references.map(referenceLabel)).toEqual([
      "Title 21, Chapter I",
      "Title 9, Subtitle A",
    ]);
    expect(referencedTitles(n)).toEqual([9, 21]);
  });

  it("drops malformed nodes", () => {
    expect(parseAgencyRow(null)).toBeNull();
    expect(parseAgencyRow({ ...agency("fda"), id: "agency:other" })).toBeNull();
    expect(parseAgencyRow(agency("Bad Slug"))).toBeNull();
    expect(parseAgencyRow(agency("fda", { cfr_references: [{ title: 99 }] }))).toBeNull();
    expect(parseAgencyRow(agency("fda", { children: [{ slug: "x y", name: "X" }] }))).toBeNull();
    expect(parseAgencyRow(agency("fda", { fr_agency_id: "abc" }))!.profileId).toBeNull();
  });

  it("accepts the slugs the eCFR publishes, parentheses and apostrophes included", () => {
    const slug = "office-of-secretary-(aviation-proceedings)";
    expect(parseAgencyRow(agency(slug))!.slug).toBe(slug);
    const kid = "office-of-assistant-secretary-for-veterans'-employment-and-training-service";
    expect(
      parseAgencyRow(agency("labor", { children: [{ slug: kid, name: "Office" }] }))!.children[0]!
        .slug,
    ).toBe(kid);
    expect(parseAgencyRow(agency("a/b"))).toBeNull();
  });

  it("keeps a reference with no title (as the eCFR prints it)", () => {
    const n = parseAgencyRow(agency("x", { cfr_references: [{ title: null, chapter: "II" }] }))!;
    expect(referenceLabel(n.references[0]!)).toBe("Chapter II");
    expect(referencedTitles(n)).toEqual([]);
  });

  it("builds the tree in the eCFR's order without merging children into parents", () => {
    const parent = parseAgencyRow(
      agency("hhs", {
        order: 5,
        children: [
          { slug: "fda", name: "FDA" },
          { slug: "cms", name: "CMS" },
        ],
      }),
    )!;
    const fda = parseAgencyRow(agency("fda", { order: 7, parent: "hhs" }))!;
    const cms = parseAgencyRow(agency("cms", { order: 6, parent: "hhs" }))!;
    const other = parseAgencyRow(agency("acus", { order: 1 }))!;
    const tree = agencyTree([fda, parent, other, cms]);
    expect(tree.map((t) => t.node.slug)).toEqual(["acus", "hhs"]);
    expect(tree[1]!.children.map((c) => c.slug)).toEqual(["cms", "fda"]);
    expect(tree[0]!.children).toEqual([]);
  });

  it("matches names, short names and slugs only", () => {
    const n = parseAgencyRow(
      agency("fda", { name: "Food and Drug Administration", short_name: "FDA" }),
    )!;
    expect(agencyMatches(n, "")).toBe(true);
    expect(agencyMatches(n, "drug")).toBe(true);
    expect(agencyMatches(n, "fda")).toBe(true);
    expect(agencyMatches(n, "title 21")).toBe(false);
  });

  it("reads an agency-prepared index row", () => {
    const p = parsePreparedRow({
      id: "prepared-index:19-3",
      x: {
        cfr_title: 19,
        scope: "Chapter I",
        indexes_printed: null,
        agency_as_printed: "Bureau",
        linked_agency: "u-s-customs-and-border-protection",
      },
    })!;
    expect(p.cfrTitle).toBe(19);
    expect(p.linkedAgency).toBe("u-s-customs-and-border-protection");
    expect(parsePreparedRow({ id: "agency:x", x: { cfr_title: 19 } })).toBeNull();
    expect(parsePreparedRow({ id: "prepared-index:1-1", x: { cfr_title: 99 } })).toBeNull();
  });
});

const subject = {
  id: "subject:Drugs",
  s: {
    heading: "Drugs",
    segment: { index: 1, of: 1 },
    pages: [215, 217],
    entries: [
      { l: 0, t: "See also Animal drugs; Prescription drugs", x: 1 },
      { l: 0, t: "Color additives" },
      { l: 1, t: "Certification, 21 CFR 80", r: [[21, "80"]] },
      { l: 0, t: "Prescription drugs" },
      {
        l: 1,
        t: "Applications, 21 CFR 314, 21 CFR 320",
        r: [
          [21, "314"],
          [21, "320"],
        ],
      },
      { l: 1, t: "Advertising, 21 CFR 202", r: [[21, "202"]] },
      { l: 0, t: "Other title, 40 CFR 314", r: [[40, "314"]] },
    ],
  },
};

describe("subject index rows", () => {
  it("reads a heading with its entries and references", () => {
    const r = parseSubjectRow(subject)!;
    expect(r.heading).toBe("Drugs");
    expect(r.pages).toEqual([215, 217]);
    expect(r.entries).toHaveLength(7);
    expect(r.entries[0]!.xref).toBe(true);
    expect(r.entries[4]!.refs).toEqual([
      [21, "314"],
      [21, "320"],
    ]);
  });

  it("matches only the exact title and part and gives the lines it hangs under", () => {
    const r = parseSubjectRow(subject)!;
    const m = entriesForPart(r, 21, "314");
    expect(m).toHaveLength(1);
    expect(m[0]!.text).toBe("Applications, 21 CFR 314, 21 CFR 320");
    expect(m[0]!.context).toEqual(["Prescription drugs"]);
    expect(entriesForPart(r, 40, "314")).toHaveLength(1);
    expect(entriesForPart(r, 21, "31")).toEqual([]);
    expect(entriesForPart(r, 21, "3140")).toEqual([]);
  });

  it("drops a row with a malformed entry rather than repairing it", () => {
    const bad = JSON.parse(JSON.stringify(subject));
    bad.s.entries[2].r = [[21, "../80"]];
    expect(parseSubjectRow(bad)).toBeNull();
    expect(parseSubjectRow({ id: "x", s: { heading: "" } })).toBeNull();
  });
});

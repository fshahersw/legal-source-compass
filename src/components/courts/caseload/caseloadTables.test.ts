import { describe, expect, it } from "vitest";
import type { DistrictRow, MdlRow, NosRow } from "@/lib/external/courtCaseload.functions";
import {
  circuitOptions,
  DISTRICT_DEFAULT_SORT,
  DISTRICT_SORT_KEYS,
  encodeSort,
  filterDistricts,
  filterMdls,
  filterNos,
  matchesTerms,
  nextSort,
  parseSort,
  sortDistricts,
  sortMdls,
  sortNos,
  sortRows,
  stateOptions,
} from "./caseloadTables";

const district = (id: string, name: string, over: Partial<DistrictRow> = {}): DistrictRow => ({
  id,
  name: `District Court, ${name}`,
  state: "CA",
  circuitId: "ca9",
  circuit: "Ninth Circuit",
  filings: 100,
  terminations: 90,
  pending: 50,
  medianDays: 200,
  classActionPct: 1,
  proSePct: 2,
  productPct: 3,
  trialPct: 0.4,
  hasCourtPage: true,
  ...over,
});

const DISTRICTS = [
  district("cand", "N.D. California", { filings: 10708, medianDays: 200 }),
  district("cacd", "C.D. California", { filings: 17784, medianDays: null }),
  district("txsd", "S.D. Texas", {
    state: "TX",
    circuitId: "ca5",
    circuit: "Fifth Circuit",
    filings: 9000,
    medianDays: 322,
  }),
  district("dcd", "District of Columbia", {
    state: "DC",
    circuitId: "cadc",
    circuit: "D.C. Circuit",
    filings: 1200,
    medianDays: 150,
  }),
  district("nyed", "E.D. New York", {
    state: "NY",
    circuitId: "ca2",
    circuit: "Second Circuit",
    filings: 8000,
    medianDays: 500,
  }),
  district("ilnd", "N.D. Illinois", {
    state: "IL",
    circuitId: "ca7",
    circuit: "Seventh Circuit",
    filings: 7000,
    medianDays: 600,
  }),
  district("flmd", "M.D. Florida", {
    state: "FL",
    circuitId: "ca11",
    circuit: "Eleventh Circuit",
    filings: null,
    medianDays: 700,
  }),
];

describe("sort state", () => {
  it("reads a descending prefix and falls back for anything not allowed", () => {
    expect(parseSort("-medianDays", DISTRICT_SORT_KEYS, DISTRICT_DEFAULT_SORT)).toEqual({
      key: "medianDays",
      desc: true,
    });
    expect(parseSort("name", DISTRICT_SORT_KEYS, DISTRICT_DEFAULT_SORT)).toEqual({
      key: "name",
      desc: false,
    });
    expect(parseSort("bogus", DISTRICT_SORT_KEYS, DISTRICT_DEFAULT_SORT)).toEqual(
      DISTRICT_DEFAULT_SORT,
    );
    expect(parseSort(undefined, DISTRICT_SORT_KEYS, DISTRICT_DEFAULT_SORT)).toEqual(
      DISTRICT_DEFAULT_SORT,
    );
  });

  it("leaves no URL parameter for the default sort and round-trips the others", () => {
    expect(encodeSort(DISTRICT_DEFAULT_SORT, DISTRICT_DEFAULT_SORT)).toBeUndefined();
    const spec = { key: "pending" as const, desc: false };
    expect(encodeSort(spec, DISTRICT_DEFAULT_SORT)).toBe("pending");
    expect(
      parseSort(encodeSort(spec, DISTRICT_DEFAULT_SORT), DISTRICT_SORT_KEYS, DISTRICT_DEFAULT_SORT),
    ).toEqual(spec);
    const desc = { key: "pending" as const, desc: true };
    expect(
      parseSort(encodeSort(desc, DISTRICT_DEFAULT_SORT), DISTRICT_SORT_KEYS, DISTRICT_DEFAULT_SORT),
    ).toEqual(desc);
  });

  it("flips direction on the same column and starts a new column where asked", () => {
    expect(nextSort({ key: "filings", desc: true }, "filings", true)).toEqual({
      key: "filings",
      desc: false,
    });
    expect(nextSort({ key: "filings", desc: false }, "filings", true)).toEqual({
      key: "filings",
      desc: true,
    });
    expect(nextSort({ key: "filings", desc: true }, "name", false)).toEqual({
      key: "name",
      desc: false,
    });
    expect(nextSort({ key: "filings", desc: false }, "pending", true)).toEqual({
      key: "pending",
      desc: true,
    });
  });
});

describe("sortRows", () => {
  it("puts missing values last in both directions and breaks ties by the tie key", () => {
    const rows = [
      { n: "b", v: 2 },
      { n: "x", v: null },
      { n: "a", v: 2 },
      { n: "c", v: 5 },
    ];
    const by = (desc: boolean) =>
      sortRows(
        rows,
        desc,
        (r) => r.v,
        (r) => r.n,
      ).map((r) => r.n);
    expect(by(true)).toEqual(["c", "a", "b", "x"]);
    expect(by(false)).toEqual(["a", "b", "c", "x"]);
  });

  it("compares text with numbers inside it in natural order", () => {
    const rows = [{ k: "ca10" }, { k: "ca2" }, { k: "ca1" }];
    expect(
      sortRows(
        rows,
        false,
        (r) => r.k,
        (r) => r.k,
      ).map((r) => r.k),
    ).toEqual(["ca1", "ca2", "ca10"]);
  });
});

describe("matchesTerms", () => {
  it("ignores periods and punctuation, needs every term, and matches the start of a word", () => {
    expect(matchesTerms("District Court, N.D. California", "n.d. cal")).toBe(true);
    expect(matchesTerms("District Court, N.D. California", "nd cal")).toBe(true);
    expect(matchesTerms("District Court, N.D. California", "ndcal")).toBe(false);
    expect(matchesTerms("District Court, N.D. California", "cal texas")).toBe(false);
    expect(matchesTerms("District Court, N.D. California", "fornia")).toBe(false);
    expect(matchesTerms("Second Circuit", "nd")).toBe(false);
    expect(matchesTerms("anything", "   ")).toBe(true);
    expect(matchesTerms("anything", "!!!")).toBe(true);
  });
});

describe("district table", () => {
  it("sorts filings high to low with unknown filings last", () => {
    const ids = sortDistricts(DISTRICTS, DISTRICT_DEFAULT_SORT).map((d) => d.id);
    expect(ids).toEqual(["cacd", "cand", "txsd", "nyed", "ilnd", "dcd", "flmd"]);
  });

  it("sorts median days with unknown medians last whichever direction", () => {
    expect(
      sortDistricts(DISTRICTS, { key: "medianDays", desc: false })
        .slice(0, 3)
        .map((d) => d.id),
    ).toEqual(["dcd", "cand", "txsd"]);
    expect(
      sortDistricts(DISTRICTS, { key: "medianDays", desc: true })
        .slice(0, 3)
        .map((d) => d.id),
    ).toEqual(["flmd", "ilnd", "nyed"]);
    expect(sortDistricts(DISTRICTS, { key: "medianDays", desc: true }).at(-1)!.id).toBe("cacd");
    expect(sortDistricts(DISTRICTS, { key: "medianDays", desc: false }).at(-1)!.id).toBe("cacd");
  });

  it("filters by search text with the initials spelled out", () => {
    expect(filterDistricts(DISTRICTS, { q: "northern california" }).map((d) => d.id)).toEqual([
      "cand",
    ]);
    expect(filterDistricts(DISTRICTS, { q: "n.d." }).map((d) => d.id)).toEqual(["cand", "ilnd"]);
    expect(filterDistricts(DISTRICTS, { q: "cacd" }).map((d) => d.id)).toEqual(["cacd"]);
    expect(filterDistricts(DISTRICTS, { q: "fifth" }).map((d) => d.id)).toEqual(["txsd"]);
  });

  it("filters by circuit and state, alone and together, and can come back empty", () => {
    expect(filterDistricts(DISTRICTS, { circuit: "ca9" }).map((d) => d.id)).toEqual([
      "cand",
      "cacd",
    ]);
    expect(filterDistricts(DISTRICTS, { state: "TX" }).map((d) => d.id)).toEqual(["txsd"]);
    expect(filterDistricts(DISTRICTS, { circuit: "ca9", state: "TX" })).toEqual([]);
    expect(filterDistricts(DISTRICTS, { q: "zzzz" })).toEqual([]);
    expect(filterDistricts(DISTRICTS, {})).toHaveLength(DISTRICTS.length);
  });

  it("lists circuits with D.C. first then in numeric order, and states alphabetically", () => {
    expect(circuitOptions(DISTRICTS).map((c) => c.id)).toEqual([
      "cadc",
      "ca2",
      "ca5",
      "ca7",
      "ca9",
      "ca11",
    ]);
    expect(circuitOptions(DISTRICTS)[0]!.label).toBe("D.C. Circuit");
    expect(stateOptions(DISTRICTS)).toEqual(["CA", "DC", "FL", "IL", "NY", "TX"]);
  });
});

const nos = (id: string, name: string, over: Partial<NosRow> = {}): NosRow => ({
  id,
  kind: id.startsWith("group:") ? "group" : "nos",
  code: id.startsWith("nos:") ? Number(id.slice(4)) : null,
  groupKey: "product",
  name,
  filings: 10,
  terminations: 9,
  medianDays: 100,
  settledPct: 5,
  trialPct: 1,
  proSePct: 2,
  classActionPct: 3,
  ...over,
});
const NOS = [
  nos("nos:365", "Personal Injury - Product Liability", { filings: 22881 }),
  nos("group:product", "Product liability and health-care / pharma injury", { filings: 45712 }),
  nos("nos:110", "Insurance", { groupKey: "contract", filings: 13142 }),
  nos("nos:444", "Code 444 (not in the codebook)", {
    groupKey: "unmapped",
    filings: null,
    terminations: null,
    medianDays: null,
  }),
];

describe("nature-of-suit table", () => {
  it("filters by kind, group, activity and text", () => {
    expect(filterNos(NOS, { kind: "group" }).map((n) => n.id)).toEqual(["group:product"]);
    expect(filterNos(NOS, { kind: "nos" })).toHaveLength(3);
    expect(filterNos(NOS, { group: "product" }).map((n) => n.id)).toEqual([
      "nos:365",
      "group:product",
    ]);
    expect(filterNos(NOS, { activeOnly: true }).map((n) => n.id)).not.toContain("nos:444");
    expect(filterNos(NOS, { q: "365" }).map((n) => n.id)).toEqual(["nos:365"]);
    expect(filterNos(NOS, { q: "insur" }).map((n) => n.id)).toEqual(["nos:110"]);
    expect(filterNos(NOS, { q: "not in codebook" }).map((n) => n.id)).toEqual(["nos:444"]);
    expect(filterNos(NOS, { q: "not in codebook zzz" })).toEqual([]);
  });

  it("sorts by filings with the code that has no cases last, and by code with groups after the codes' null", () => {
    expect(sortNos(NOS, { key: "filings", desc: true }).map((n) => n.id)).toEqual([
      "group:product",
      "nos:365",
      "nos:110",
      "nos:444",
    ]);
    expect(sortNos(NOS, { key: "filings", desc: false }).at(-1)!.id).toBe("nos:444");
    expect(sortNos(NOS, { key: "code", desc: false }).map((n) => n.id)).toEqual([
      "nos:110",
      "nos:365",
      "nos:444",
      "group:product",
    ]);
  });
});

const mdl = (n: number, over: Partial<MdlRow> = {}): MdlRow => ({
  id: `mdl:${n}`,
  mdl: n,
  cases: 10,
  pending: 0,
  districts: 1,
  firstFiled: "2010-01-01",
  lastFiled: "2012-01-01",
  medianDays: 300,
  topDistrict: "laed",
  inJpml: false,
  lensHref: null,
  recordHref: null,
  ...over,
});
const MDLS = [
  mdl(1358, {
    cases: 27,
    pending: 5,
    inJpml: true,
    lensHref: "/matters/lens/1358",
    topDistrict: "nysd",
  }),
  mdl(2328, { cases: 32, medianDays: 1597.5 }),
  mdl(13, { cases: 2, medianDays: null, topDistrict: "akd" }),
  mdl(1, { cases: 6, pending: null }),
];

describe("MDL table", () => {
  it("filters to the numbers in the JPML records, and to those not in them", () => {
    expect(filterMdls(MDLS, { jpml: "yes" }).map((m) => m.mdl)).toEqual([1358]);
    expect(filterMdls(MDLS, { jpml: "no" }).map((m) => m.mdl)).toEqual([2328, 13, 1]);
    expect(filterMdls(MDLS, {})).toHaveLength(4);
  });

  it("filters to numbers with pending cases and treats an unknown pending count as none", () => {
    expect(filterMdls(MDLS, { pendingOnly: true }).map((m) => m.mdl)).toEqual([1358]);
  });

  it("searches an MDL number by prefix and anything else against the largest district", () => {
    expect(filterMdls(MDLS, { q: "13" }).map((m) => m.mdl)).toEqual([1358, 13]);
    expect(filterMdls(MDLS, { q: "1358" }).map((m) => m.mdl)).toEqual([1358]);
    expect(filterMdls(MDLS, { q: "akd" }).map((m) => m.mdl)).toEqual([13]);
    expect(filterMdls(MDLS, { q: "99999" })).toEqual([]);
    expect(filterMdls(MDLS, { q: "  " })).toHaveLength(4);
  });

  it("sorts by cases and by median days, leaving unknown medians last", () => {
    expect(sortMdls(MDLS, { key: "cases", desc: true }).map((m) => m.mdl)).toEqual([
      2328, 1358, 1, 13,
    ]);
    expect(sortMdls(MDLS, { key: "medianDays", desc: false }).map((m) => m.mdl)).toEqual([
      1, 1358, 2328, 13,
    ]);
    expect(sortMdls(MDLS, { key: "medianDays", desc: true }).at(-1)!.mdl).toBe(13);
    expect(sortMdls(MDLS, { key: "mdl", desc: false }).map((m) => m.mdl)).toEqual([
      1, 13, 1358, 2328,
    ]);
  });
});

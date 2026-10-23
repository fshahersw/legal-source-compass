import { beforeEach, describe, expect, it, vi } from "vitest";

const { rest } = vi.hoisted(() => ({ rest: vi.fn() }));
vi.mock("./rest.server", () => ({ restGet: rest }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { stored } from "./ecfrAuthorities.fixtures";
import {
  getAgenciesForTitle,
  getAuthoritiesForPart,
  getCfrAgencies,
  getRegulationsUnderSection,
  getSubjectsForPart,
} from "./ecfrAuthorities.functions";

type Fn<I, O> = (a: { data: I }) => Promise<O>;
const call = <I, O>(fn: unknown, data: I) => (fn as Fn<I, O>)({ data });
const catalog = (ready = true) => ({
  rows: [
    {
      ready,
      metadata: {
        summary: {
          edition: "2025",
          table_revised_as_of: "January 1, 2025",
          retrieved_at: { agencies: "2026-10-23T04:52:00Z" },
        },
      },
    },
  ],
  total: null,
});
const enc = encodeURIComponent;
const cs = (v: unknown) => enc(JSON.stringify(v));

beforeEach(() => {
  rest.mockReset();
});

describe("getRegulationsUnderSection", () => {
  it("queries exact and edge rows by the exact section id, then the stored parts' headings", async () => {
    rest.mockImplementation(async (p: string) => {
      if (p.startsWith("corpus_datasets")) return catalog();
      if (p.includes(`filters=cs.${cs({ usc: ["42:1395hh"] })}`))
        return { rows: [stored(), { id: "bad" }], total: null };
      if (p.includes(`filters=cs.${cs({ usc_edge: ["42:1395hh"] })}`))
        return {
          rows: [
            stored(
              { authority: "1395--1395kkk", citation: "42 U.S.C. 1395--1395kkk" },
              { title: 45, parts_text: "5", parts: ["5"], parts_stored: [] },
              { state: "range", id: null, title: "42", key: null, start: "1395", end: "1395kkk" },
              "usc:42:1395--1395kkk:cfr45",
            ),
          ],
          total: null,
        };
      if (p.includes("dataset=eq.ecfr_sections_full"))
        return {
          rows: [
            { id: "cfr:42:part-400", title: "42 CFR Part 400—Introduction; Definitions" },
            {
              id: "cfr:42:part-405",
              title: "42 CFR Part 405—Federal Health Insurance for the Aged and Disabled",
            },
          ],
          total: null,
        };
      return { rows: [], total: null };
    });
    const r = await call<object, Awaited<ReturnType<typeof getRegulationsUnderSection>>>(
      getRegulationsUnderSection,
      { title: "42", key: "1395hh" },
    );
    expect(r.status).toBe("ok");
    expect(r.exact).toHaveLength(1);
    expect(r.edge).toHaveLength(1);
    expect(r.dropped).toBe(1);
    expect(r.headings).toEqual({
      "42:400": "Introduction; Definitions",
      "42:405": "Federal Health Insurance for the Aged and Disabled",
    });
    expect(r.meta).toEqual({ edition: "2025", revisedAsOf: "January 1, 2025", retrievedAt: null });
    const paths = rest.mock.calls.map((c) => c[0] as string);
    expect(paths.some((p) => p.includes(enc('"cfr:42:part-400","cfr:42:part-405"')))).toBe(true);
    // part 9999 is listed but not stored: it is never looked up
    expect(paths.some((p) => p.includes("9999"))).toBe(false);
  });

  it("says unavailable when the table is not published and reads no rows", async () => {
    rest.mockResolvedValueOnce(catalog(false));
    const r = await call<object, { status: string; exact: unknown[] }>(getRegulationsUnderSection, {
      title: "42",
      key: "1395hh",
    });
    expect(r.status).toBe("unavailable");
    expect(r.exact).toEqual([]);
    expect(rest).toHaveBeenCalledTimes(1);
  });

  it("never queries for a section key that could not be a stored unit", async () => {
    rest.mockResolvedValue(catalog());
    const r = await call<object, { status: string; exact: unknown[] }>(getRegulationsUnderSection, {
      title: "55",
      key: "1",
    });
    expect(r.status).toBe("unavailable");
    expect(rest).toHaveBeenCalledTimes(1);
  });

  it("flags a result cut at the row limit", async () => {
    rest.mockImplementation(async (p: string) => {
      if (p.startsWith("corpus_datasets")) return catalog();
      if (p.includes(cs({ usc: ["5:301"] })))
        return {
          rows: Array.from({ length: 400 }, (_, i) =>
            stored({}, { parts: [], parts_stored: [], parts_text: "x" }, {}, `r${i}`),
          ),
          total: null,
        };
      return { rows: [], total: null };
    });
    const r = await call<object, { truncated: boolean }>(getRegulationsUnderSection, {
      title: "5",
      key: "301",
    });
    expect(r.truncated).toBe(true);
  });
});

describe("getAuthoritiesForPart", () => {
  it("queries the exact title:part key and looks up only the sections that resolved", async () => {
    rest.mockImplementation(async (p: string) => {
      if (p.startsWith("corpus_datasets")) return catalog();
      if (p.includes(`filters=cs.${cs({ cfr_part: ["21:314"] })}`))
        return {
          rows: [
            stored(
              {},
              { title: 21, parts_text: "314", parts: ["314"], parts_stored: ["314"] },
              { id: "21:355", title: "21", key: "355" },
              "usc:21:355:cfr21",
            ),
            stored(
              { authority: "371", citation: "21 U.S.C. 371" },
              { title: 21, parts_text: "314", parts: ["314"], parts_stored: ["314"] },
              {
                state: "not_in_stored_code",
                id: null,
                title: "21",
                key: "371",
                reason: "No section",
              },
              "usc:21:371:cfr21",
            ),
          ],
          total: null,
        };
      if (p.includes("dataset=eq.us_code_sections"))
        return {
          rows: [
            {
              id: "21:355",
              c: { citation: "21 U.S.C. § 355", heading: "New drugs", status: "none" },
            },
          ],
          total: null,
        };
      return { rows: [], total: null };
    });
    const r = await call<object, Awaited<ReturnType<typeof getAuthoritiesForPart>>>(
      getAuthoritiesForPart,
      { title: "21", part: "314" },
    );
    expect(r.rows).toHaveLength(2);
    expect(r.sections).toEqual({
      "21:355": { citation: "21 U.S.C. § 355", heading: "New drugs", status: "none" },
    });
    const lookups = rest.mock.calls
      .map((c) => c[0] as string)
      .filter((p) => p.includes("dataset=eq.us_code_sections"));
    expect(lookups).toHaveLength(1);
    expect(lookups[0]).toContain(enc('"21:355"'));
    expect(lookups[0]).not.toContain("371");
  });

  it("ignores a stored section row whose id was not asked for", async () => {
    rest.mockImplementation(async (p: string) => {
      if (p.startsWith("corpus_datasets")) return catalog();
      if (p.includes("cfr_part")) return { rows: [stored({}, {}, {}, "a")], total: null };
      return { rows: [{ id: "99:1", c: { citation: "x", heading: "y" } }], total: null };
    });
    const r = await call<object, { sections: object }>(getAuthoritiesForPart, {
      title: "42",
      part: "405",
    });
    expect(r.sections).toEqual({});
  });

  it("reports unavailable when the table is not published, and empty for a designation that cannot be a part", async () => {
    rest.mockResolvedValueOnce(catalog(false));
    expect(
      (await call<object, { status: string }>(getAuthoritiesForPart, { title: "21", part: "314" }))
        .status,
    ).toBe("unavailable");
    rest.mockReset();
    rest.mockResolvedValue(catalog());
    const r = await call<object, { status: string; rows: unknown[] }>(getAuthoritiesForPart, {
      title: "21",
      part: "a b",
    });
    expect(r.rows).toEqual([]);
    expect(rest).toHaveBeenCalledTimes(1);
  });
});

describe("agencies and subjects", () => {
  const rows = [
    {
      id: "agency:fda",
      a: {
        slug: "fda",
        name: "Food and Drug Administration",
        short_name: "FDA",
        display_name: "FDA",
        sortable_name: "FDA",
        parent: null,
        children: [],
        cfr_references: [{ title: 21, chapter: "I" }],
        fr_agency_id: null,
        order: 0,
      },
      x: null,
    },
    {
      id: "prepared-index:19-3",
      a: null,
      x: { cfr_title: 19, scope: "Chapter I", linked_agency: null },
    },
    { id: "agency:bad", a: { slug: "Bad Slug" }, x: null },
  ];
  it("reads agencies and prepared indexes, counting what it drops", async () => {
    rest.mockImplementation(async (p: string) =>
      p.startsWith("corpus_datasets") ? catalog() : { rows, total: null },
    );
    const r = await call<undefined, Awaited<ReturnType<typeof getCfrAgencies>>>(
      getCfrAgencies,
      undefined,
    );
    expect(r.status).toBe("ok");
    expect(r.agencies.map((a) => a.slug)).toEqual(["fda"]);
    expect(r.prepared.map((p) => p.cfrTitle)).toEqual([19]);
    expect(r.dropped).toBe(1);
    expect(r.retrievedAt).toBe("2026-10-23T04:52:00Z");
  });
  it("asks for one exact CFR title", async () => {
    rest.mockImplementation(async (p: string) =>
      p.startsWith("corpus_datasets") ? catalog() : { rows: [], total: null },
    );
    await call(getAgenciesForTitle, { title: "21" });
    const p = rest.mock.calls.map((c) => c[0] as string).find((x) => x.includes("corpus_records"))!;
    expect(p).toContain(`filters=cs.${cs({ cfr_title: ["21"] })}`);
  });
  it("is unavailable when the dataset is not published", async () => {
    rest.mockResolvedValueOnce({ rows: [], total: null });
    expect((await call<undefined, { status: string }>(getCfrAgencies, undefined)).status).toBe(
      "unavailable",
    );
  });
  it("returns only the entries that carry the exact part", async () => {
    rest.mockImplementation(async (p: string) => {
      if (p.startsWith("corpus_datasets")) return { rows: [{ ready: true }], total: null };
      return {
        rows: [
          {
            id: "subject:Drugs",
            s: {
              heading: "Drugs",
              segment: { index: 1, of: 1 },
              pages: [215, 215],
              entries: [
                { l: 0, t: "Prescription drugs" },
                { l: 1, t: "Applications, 21 CFR 314", r: [[21, "314"]] },
                { l: 1, t: "Other, 21 CFR 3140", r: [[21, "3140"]] },
              ],
            },
          },
          {
            id: "subject:Empty",
            s: {
              heading: "Empty",
              segment: { index: 1, of: 1 },
              pages: [1, 1],
              entries: [{ l: 0, t: "Nothing, 21 CFR 99", r: [[21, "99"]] }],
            },
          },
        ],
        total: null,
      };
    });
    const r = await call<object, Awaited<ReturnType<typeof getSubjectsForPart>>>(
      getSubjectsForPart,
      { title: "21", part: "314" },
    );
    expect(r.headings).toHaveLength(1);
    expect(r.headings[0]!.entries.map((e) => e.text)).toEqual(["Applications, 21 CFR 314"]);
    expect(r.headings[0]!.entries[0]!.context).toEqual(["Prescription drugs"]);
  });
});

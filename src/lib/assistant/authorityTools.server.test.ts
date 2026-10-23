import { afterEach, describe, expect, it, vi } from "vitest";

const { rest } = vi.hoisted(() => ({ rest: vi.fn() }));
vi.mock("@/lib/external/rest.server", () => ({ restGet: rest }));

import { stored } from "@/lib/external/ecfrAuthorities.fixtures";
import { AUTHORITY_EXECUTORS, AUTHORITY_TOOL_DEFINITIONS } from "./authorityTools.server";

const enc = encodeURIComponent;
const cs = (v: unknown) => enc(JSON.stringify(v));
const listUsc = AUTHORITY_EXECUTORS["list_cfr_parts_citing_usc"]!;
const listPart = AUTHORITY_EXECUTORS["list_authorities_for_cfr_part"]!;
const meta = {
  rows: [
    {
      ready: true,
      metadata: { summary: { edition: "2025", table_revised_as_of: "January 1, 2025" } },
    },
  ],
  total: null,
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (o: { content: string }) => JSON.parse(o.content) as Record<string, any>;

function wire(handlers: {
  usc?: unknown[];
  edge?: unknown[];
  part?: unknown[];
  sections?: unknown[];
  parts?: unknown[];
  section?: boolean;
  partRow?: boolean;
  ready?: boolean;
}) {
  rest.mockImplementation(async (p?: string) => {
    const path = String(p);
    if (path.startsWith("corpus_datasets"))
      return handlers.ready === false ? { rows: [], total: null } : meta;
    if (path.includes("dataset=eq.us_code_sections") && path.includes("&id=eq."))
      return { rows: handlers.section ? [{ id: "x" }] : [], total: null };
    if (path.includes("dataset=eq.us_code_sections"))
      return { rows: handlers.sections ?? [], total: null };
    if (path.includes("dataset=eq.ecfr_sections_full") && path.includes("&id=eq."))
      return {
        rows: handlers.partRow
          ? [
              {
                id: "x",
                title: "21 CFR Part 314—Applications for FDA Approval to Market a New Drug",
              },
            ]
          : [],
        total: null,
      };
    if (path.includes("dataset=eq.ecfr_sections_full"))
      return { rows: handlers.parts ?? [], total: null };
    if (path.includes(cs({ usc: ["42:1395hh"] }))) return { rows: handlers.usc ?? [], total: null };
    if (path.includes(cs({ usc_edge: ["42:1395hh"] })))
      return { rows: handlers.edge ?? [], total: null };
    if (path.includes("cfr_part")) return { rows: handlers.part ?? [], total: null };
    return { rows: [], total: null };
  });
}

afterEach(() => {
  rest.mockReset();
});

describe("tool definitions", () => {
  it("are narrow, named and strict", () => {
    expect(AUTHORITY_TOOL_DEFINITIONS.map((t) => t.name)).toEqual([
      "list_cfr_parts_citing_usc",
      "list_authorities_for_cfr_part",
    ]);
    for (const t of AUTHORITY_TOOL_DEFINITIONS) {
      expect(t.description.length).toBeGreaterThan(120);
      expect(t.input_schema["type"]).toBe("object");
      expect(Object.keys(AUTHORITY_EXECUTORS)).toContain(t.name);
    }
  });
});

describe("list_cfr_parts_citing_usc", () => {
  it("lists the parts exactly as printed with headings for stored parts, and keeps ranges apart", async () => {
    wire({
      section: true,
      usc: [stored()],
      edge: [
        stored(
          { authority: "1395 et seq.", citation: "42 U.S.C. 1395 et seq.", page: 1033 },
          { title: 42, parts_text: "10", parts: ["10"], parts_stored: [] },
          { state: "et_seq", id: null, key: null, title: "42", start: "1395" },
          "usc:42:1395_et_seq.:cfr42",
        ),
      ],
      parts: [{ id: "cfr:42:part-400", title: "42 CFR Part 400—Introduction; Definitions" }],
    });
    const out = await listUsc({ citation: "42 U.S.C. § 1395hh" });
    const c = parse(out);
    expect(c.found).toBe(true);
    expect(c.citation).toBe("42 U.S.C. § 1395hh");
    expect(c.section_in_stored_code).toBe(true);
    expect(c.section_page).toBe("/law/uscode/42/1395hh");
    expect(c.table).toMatchObject({ edition: "2025", revised_as_of: "January 1, 2025" });
    const g = c.cfr_parts_citing_this_section[0];
    expect(g.cfr_title).toBe(42);
    expect(g.parts).toEqual([
      {
        part: "400",
        in_stored_ecfr: true,
        heading: "Introduction; Definitions",
        page: "/law/cfr/42/part/400",
      },
      { part: "405", in_stored_ecfr: true, heading: null, page: "/law/cfr/42/part/405" },
      { part: "9999", in_stored_ecfr: false, heading: null, page: null },
    ]);
    expect(c.printed_as_range_or_et_seq_at_this_section).toEqual([
      {
        printed_as: "42 U.S.C. 1395 et seq.",
        cfr_titles: [42],
        table_pages: [1033],
        rows: [{ cfr_title: 42, parts_as_printed: "10" }],
      },
    ]);
    expect(c.note).toMatch(/not expanded/);
    expect(c.note).toMatch(/all-inclusive/);
    expect(out.sources[0]!.url).toBe(
      "https://www.govinfo.gov/content/pkg/GPO-CFR-INDEX-2025/pdf/GPO-CFR-INDEX-2025-4.pdf",
    );
    expect(out.sources.some((s) => s.internal && s.url === "/law/uscode/42/1395hh")).toBe(true);
    expect(out.detail).toContain("3 CFR parts in 1 title");
    // a part that is not stored is never looked up
    const lookups = rest.mock.calls
      .map((x) => String(x[0]))
      .filter((p) => p.includes("dataset=eq.ecfr_sections_full"));
    expect(lookups.join("")).not.toContain("9999");
  });

  it("does not expand an et seq. citation and says it was asked", async () => {
    wire({ usc: [] });
    const out = await listUsc({ citation: "42 U.S.C. 1395hh et seq." });
    const c = parse(out);
    expect(c.et_seq_requested).toBe(true);
    expect(c.found).toBe(false);
    expect(c.note).toMatch(/no CFR part under this exact section/);
    const queries = rest.mock.calls.map((x) => String(x[0]));
    expect(queries.some((p) => p.includes(cs({ usc: ["42:1395hh"] })))).toBe(true);
  });

  it("accepts title and section, and rejects what is not a citation", async () => {
    wire({ usc: [stored()] });
    expect(parse(await listUsc({ title: 42, section: "1395hh" })).found).toBe(true);
    await expect(listUsc({ citation: "the Social Security Act" })).rejects.toThrow(
      /U\.S\. Code citation/,
    );
    await expect(listUsc({})).rejects.toThrow();
  });

  it("says when the table is not loaded instead of answering empty", async () => {
    wire({ ready: false });
    const c = parse(await listUsc({ citation: "42 U.S.C. 1395hh" }));
    expect(c.unavailable).toBe(true);
    expect(c.found).toBe(false);
    expect(c.note).toMatch(/not loaded/);
    expect(rest).toHaveBeenCalledTimes(1);
  });
});

describe("list_authorities_for_cfr_part", () => {
  const row = (over: Record<string, unknown>, link: Record<string, unknown>, id: string) =>
    stored(
      { ...over },
      { title: 21, parts_text: "314", parts: ["314"], parts_stored: ["314"] },
      link,
      id,
    );

  it("groups the authorities and resolves stored sections to their headings", async () => {
    wire({
      partRow: true,
      part: [
        row(
          { authority: "355", citation: "21 U.S.C. 355", heading: "21 U.S.C." },
          { id: "21:355", title: "21", key: "355" },
          "usc:21:355:cfr21",
        ),
        row(
          { authority: "371", citation: "21 U.S.C. 371", heading: "21 U.S.C." },
          { state: "not_in_stored_code", id: null, title: "21", key: "371", reason: "none" },
          "usc:21:371:cfr21",
        ),
        row(
          { authority: "301 et seq.", citation: "21 U.S.C. 301 et seq.", heading: "21 U.S.C." },
          { state: "et_seq", id: null, key: null, title: "21", start: "301" },
          "usc:21:301_et_seq.:cfr21",
        ),
        row(
          {
            category: "publaw",
            authority: "87-781",
            citation: "Pub. L. 87-781",
            heading: "Public Laws",
          },
          { state: "not_applicable", id: null, title: null, key: null },
          "publaw:87-781:cfr21",
        ),
      ],
      sections: [
        { id: "21:355", c: { citation: "21 U.S.C. § 355", heading: "New drugs", status: "none" } },
      ],
    });
    const out = await listPart({ citation: "21 CFR part 314" });
    const c = parse(out);
    expect(c.found).toBe(true);
    expect(c.part_in_stored_ecfr).toBe(true);
    expect(c.part_heading).toBe("Applications for FDA Approval to Market a New Drug");
    expect(c.part_page).toBe("/law/cfr/21/part/314");
    expect(c.us_code_sections).toEqual([
      {
        printed_as: "21 U.S.C. 355",
        printed_as_note: false,
        in_stored_code: true,
        stored_citation: "21 U.S.C. § 355",
        heading: "New drugs",
        status: "none",
        page: "/law/uscode/21/355",
        table_pages: [1034],
      },
      {
        printed_as: "21 U.S.C. 371",
        printed_as_note: false,
        in_stored_code: false,
        stored_citation: null,
        heading: null,
        status: null,
        page: "/law/uscode/21/371",
        table_pages: [1034],
      },
    ]);
    expect(c.us_code_ranges_et_seq_and_other_forms_as_printed).toEqual([
      { printed_as: "21 U.S.C. 301 et seq.", table_pages: [1034] },
    ]);
    expect(c.public_laws).toEqual([{ printed_as: "Pub. L. 87-781", table_pages: [1034] }]);
    expect(c.row_counts).toEqual({ table_rows: 4, authorities: 4 });
    expect(out.detail).toContain("2 U.S.C. Code sections".replace("U.S.C. Code", "U.S. Code"));
    const lookup = rest.mock.calls
      .map((x) => String(x[0]))
      .find((p) => p.includes("dataset=eq.us_code_sections"))!;
    expect(lookup).toContain(enc('"21:355"'));
    expect(lookup).not.toContain("371");
  });

  it("reads a section citation's part only by the number before the dot, and says so", async () => {
    wire({
      part: [
        row(
          { authority: "355", citation: "21 U.S.C. 355" },
          { id: "21:355", title: "21", key: "355" },
          "usc:21:355:cfr21",
        ),
      ],
    });
    const c = parse(await listPart({ citation: "21 CFR 314.80" }));
    expect(c.citation).toBe("21 CFR part 314");
    expect(c.part_derived_from_section).toBe("21 CFR 314.80");
    const q = rest.mock.calls.map((x) => String(x[0])).find((p) => p.includes("cfr_part"))!;
    expect(q).toContain(cs({ cfr_part: ["21:314"] }));
  });

  it("accepts title and part; rejects anything that is not a part", async () => {
    wire({ part: [] });
    const c = parse(await listPart({ title: 40, part: "63" }));
    expect(c.found).toBe(false);
    expect(c.note).toMatch(/no authority for this exact part/);
    await expect(listPart({ citation: "Title 21" })).rejects.toThrow(/CFR part citation/);
    await expect(listPart({ title: 99, part: "1" })).rejects.toThrow();
    await expect(listPart({ title: 21, part: "a/b" })).rejects.toThrow();
  });

  it("says when the table is not loaded", async () => {
    wire({ ready: false });
    expect(parse(await listPart({ citation: "21 CFR 314" })).unavailable).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const rows = new Map<string, unknown[]>();
const paths: string[] = [];
vi.mock("@/lib/external/rest.server", () => ({
  restGet: vi.fn(async (path: string) => {
    paths.push(path);
    const id = decodeURIComponent(/&id=eq\.([^&]+)/.exec(path)?.[1] ?? "");
    const dataset = /&dataset=eq\.([a-z_]+)/.exec(path)?.[1] ?? "";
    return { rows: rows.get(`${dataset}|${id}`) ?? [], total: null };
  }),
}));

import {
  REGULATION_EXECUTORS,
  REGULATION_TOOL_DEFINITIONS,
  candidateIdentifiers,
  parseCfrCitation,
} from "./regulationTools.server";
import { TOOL_DEFINITIONS, availableTools } from "./tools.server";

const read = REGULATION_EXECUTORS["read_cfr_section"]!;

function section(identifier: string, text: string) {
  return {
    id: `cfr:21:${identifier}`,
    title: `§ ${identifier} Postmarketing reporting of adverse drug experiences.`,
    source_url: "https://www.govinfo.gov/bulkdata/ECFR/title-21/ECFR-title21.xml",
    text,
    detail: {
      kind: "section",
      title_number: "21",
      identifier,
      citation: `21 CFR ${identifier}`,
      heading: "Postmarketing reporting of adverse drug experiences.",
      part: "314",
      as_of: "2026-10-20",
      notes: [["source", "[50 FR 7493, Feb. 22, 1985]"]],
      ecfr_url: `https://www.ecfr.gov/current/title-21/section-${identifier}`,
    },
  };
}

afterEach(() => {
  rows.clear();
  paths.length = 0;
});

describe("parseCfrCitation", () => {
  it("reads common citation forms and keeps a paragraph designation apart", () => {
    expect(parseCfrCitation("21 CFR 314.80")).toEqual({
      title: "21",
      identifier: "314.80",
      paragraph: null,
    });
    expect(parseCfrCitation("21 C.F.R. § 314.80(c)(1)")).toEqual({
      title: "21",
      identifier: "314.80(c)(1)",
      paragraph: "(c)(1)",
    });
    expect(parseCfrCitation("29 CFR sec. 1910.1200")?.identifier).toBe("1910.1200");
    expect(parseCfrCitation("", 40, "§ 63.7")).toEqual({
      title: "40",
      identifier: "63.7",
      paragraph: null,
    });
  });

  it("keeps identifiers that carry parentheses themselves and rejects non-sections", () => {
    expect(parseCfrCitation("26 CFR 1.1031(a)-1")).toEqual({
      title: "26",
      identifier: "1.1031(a)-1",
      paragraph: null,
    });
    expect(parseCfrCitation("21 CFR part 314")).toBeNull();
    expect(parseCfrCitation("51 CFR 1.1")).toBeNull();
    expect(parseCfrCitation("42 U.S.C. 1983")).toBeNull();
  });

  it("tries the identifier as written before the bare section", () => {
    expect(candidateIdentifiers(parseCfrCitation("21 CFR 314.80(c)(1)")!)).toEqual([
      "314.80(c)(1)",
      "314.80",
    ]);
    expect(candidateIdentifiers(parseCfrCitation("21 CFR 314.80")!)).toEqual(["314.80"]);
  });
});

describe("read_cfr_section", () => {
  it("is offered with the other tools and names no vendor", () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toContain("read_cfr_section");
    expect(availableTools().map((t) => t.name)).toContain("read_cfr_section");
    expect(JSON.stringify(REGULATION_TOOL_DEFINITIONS)).not.toMatch(
      /anthropic|claude|openai|gpt|tavily|firecrawl/i,
    );
  });

  it("returns the stored text with its as-of date, notes and official link", async () => {
    rows.set("ecfr_sections_full|cfr:21:314.80", [
      section("314.80", "(a) Definitions.\n(c) Reporting requirements."),
    ]);
    const out = await read({ citation: "21 CFR 314.80" });
    const body = JSON.parse(out.content);
    expect(body).toMatchObject({
      found: true,
      citation: "21 CFR 314.80",
      current_as_of: "2026-10-20",
      paragraph_requested: null,
      official_url: "https://www.ecfr.gov/current/title-21/section-314.80",
      text: "(a) Definitions.\n\n(c) Reporting requirements.",
    });
    expect(body.notes[0].text).toBe("[50 FR 7493, Feb. 22, 1985]");
    expect(body.part_notes).toEqual([]);
    expect(out.sources).toEqual([
      {
        title: "21 CFR 314.80",
        url: "https://www.ecfr.gov/current/title-21/section-314.80",
        internal: false,
      },
    ]);
    expect(out.detail).toBe("21 CFR 314.80 · current as of 2026-10-20");
  });

  it("adds the part's authority note once, and not a note printed for another subpart", async () => {
    rows.set("ecfr_sections_full|cfr:21:314.80", [section("314.80", "(a) Definitions.")]);
    rows.set("ecfr_sections_full|cfr:21:part-314", [
      {
        id: "cfr:21:part-314",
        notes: [
          ["authority", "21 U.S.C. 321, 331, 351, 352, 353, 355", "Part 314"],
          ["authority", "21 U.S.C. 321, 331, 351, 352, 353, 355", "Parts 314-315"],
          ["source", "50 FR 7493, Feb. 22, 1985", "Subpart H"],
        ],
      },
    ]);
    const body = JSON.parse((await read({ citation: "21 CFR 314.80" })).content);
    expect(body.part_notes).toEqual([
      { label: "Authority", text: "21 U.S.C. 321, 331, 351, 352, 353, 355" },
    ]);
  });

  it("reads the whole section for a paragraph citation and says which paragraph was asked for", async () => {
    rows.set("ecfr_sections_full|cfr:21:314.80", [
      section("314.80", "(a) Definitions.\n(c) Reporting requirements."),
    ]);
    const body = JSON.parse(
      (await read({ citation: "21 C.F.R. § 314.80(c)", find: "reporting" })).content,
    );
    expect(
      paths
        .filter((p) => p.includes("select=id,title,source_url"))
        .map((p) => decodeURIComponent(p)),
    ).toEqual([
      expect.stringContaining("id=eq.cfr:21:314.80(c)&"),
      expect.stringContaining("id=eq.cfr:21:314.80&"),
    ]);
    expect(body.paragraph_requested).toBe("(c)");
    expect(body.occurrences).toBe(1);
    expect(body.matches[0].excerpt).toContain("(c) Reporting requirements.");
  });

  it("reports a section that is not stored without inventing text", async () => {
    const out = await read({ citation: "21 CFR 999.1" });
    const body = JSON.parse(out.content);
    expect(body.found).toBe(false);
    expect(body.text).toBeUndefined();
    expect(body.official_url).toBe("https://www.ecfr.gov/current/title-21/section-999.1");
    expect(out.sources).toEqual([]);
  });

  it("refuses input that is not a CFR section citation", async () => {
    await expect(read({ citation: "Rule 23" })).rejects.toThrow(/CFR citation/);
  });
});

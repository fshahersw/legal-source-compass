import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import {
  groupByArticle,
  parseConstitution,
  parseProvision,
  parseProvisionHead,
  parseRegulationCode,
  parseRegulationEntry,
  provisionSearchPath,
  regulationIndexPath,
  type ProvisionHead,
} from "./courtRulesLaw.functions";

const ny = {
  state: "NY",
  name: "New York",
  status: "text",
  status_label: "Retrieved",
  publisher: "New York Department of State",
  url: "https://dos.ny.gov/new-york-state-constitution-1",
  structure: "section",
  articles: 24,
  sections: 162,
  units: 171,
  edition_note: "As revised, including amendments effective January 1, 2026",
  retrieved_at: "2026-10-19T15:13:34Z",
};
const sec = {
  state: "NY",
  article: "I",
  article_title: "BILL OF RIGHTS",
  section: "6",
  section_title: "Grand jury",
  source_url:
    "https://dos.ny.gov/system/files/documents/2025/12/constitution-january-1-2026.pdf#page=6",
  chars: 4489,
  text_check: "mostly_confirmed",
};

describe("constitutions", () => {
  it("parses a state record and rejects unknown statuses", () => {
    expect(parseConstitution("Constitution of New York", ny)!.sections).toBe(162);
    expect(parseConstitution("x", { ...ny, status: "maybe" })).toBeNull();
    expect(parseConstitution("x", { ...ny, state: "New York" })).toBeNull();
    expect(
      parseConstitution("Constitution of Arkansas", {
        state: "AR",
        name: "Arkansas",
        status: "not_located",
      })!.url,
    ).toBeNull();
  });

  it("keeps provisions of the requested state only, with their text check", () => {
    const head = parseProvisionHead(
      "ny-const:0010",
      "New York Const. Article I, Section 6",
      sec,
      "NY",
    )!;
    expect(head.textCheck).toBe("mostly_confirmed");
    expect(parseProvisionHead("ny-const:0010", "t", sec, "CA")).toBeNull();
    expect(
      parseProvisionHead("ny-const:0010", "t", { ...sec, text_check: "magic" }, "NY")!.textCheck,
    ).toBe("not_checked");
    expect(parseProvisionHead("other:1", "t", sec, "NY")).toBeNull();
    expect(
      parseProvision({ id: "ny-const:0010", title: "t", c: sec, text: "  " }, "NY"),
    ).toBeNull();
    expect(
      parseProvision(
        {
          id: "ny-const:0010",
          title: "t",
          c: sec,
          text: "Section 6. No person shall be held to answer",
        },
        "NY",
      )!.text,
    ).toContain("No person");
  });

  it("groups consecutive provisions by article, front matter first", () => {
    const p = (
      id: string,
      article: string | null,
      articleTitle: string | null = null,
    ): ProvisionHead => ({
      id,
      title: id,
      article,
      articleTitle,
      section: "1",
      sectionTitle: null,
      sourceUrl: "https://x.gov/c.pdf",
      chars: 10,
      textCheck: "confirmed",
    });
    const groups = groupByArticle([
      p("a", null),
      p("b", "I"),
      p("c", "I", "BILL OF RIGHTS"),
      p("d", "II"),
    ]);
    expect(groups.map((g) => [g.article, g.provisions.length, g.title])).toEqual([
      [null, 1, null],
      ["I", 2, "BILL OF RIGHTS"],
      ["II", 1, null],
    ]);
  });

  it("searches one state or all, with a containment filter", () => {
    expect(decodeURIComponent(provisionSearchPath("eminent domain", "TX")!)).toContain(
      'filters=cs.{"state":["TX"]}',
    );
    expect(provisionSearchPath("eminent domain", null)).not.toContain("filters=");
    expect(provisionSearchPath("--", null)).toBeNull();
  });
});

describe("administrative codes", () => {
  it("parses codes and keeps only counted levels", () => {
    const oh = parseRegulationCode({
      state: "OH",
      code: "Ohio Administrative Code",
      status: "indexed",
      status_label: "Table of contents indexed",
      entries: 2515,
      levels: { chapter: 2515, "bad level!": 3 },
      url: "https://codes.ohio.gov/ohio-administrative-code",
      acquisition: { at: "2026-10-19T13:32:55Z" },
      errors: [],
    })!;
    expect(oh.levels).toEqual([{ level: "chapter", count: 2515 }]);
    expect(oh.error).toBeNull();
    const il = parseRegulationCode({
      state: "IL",
      code: "Illinois Administrative Code",
      status: "blocked",
      errors: ["URLError(...)"],
    })!;
    expect(il.error).toMatch(/did not answer/);
  });

  it("drops entries without an official address and hides a heading equal to the citation", () => {
    const base = {
      state: "CO",
      level: "rule set",
      citation: "1 CCR 101-6",
      heading: "1 CCR 101-6",
      url: "https://www.sos.state.co.us/CCR/DisplayRule.do?ruleId=1919",
    };
    expect(parseRegulationEntry("co-reg:00003", base)!.heading).toBeNull();
    expect(parseRegulationEntry("co-reg:00003", { ...base, url: "ftp://x" })).toBeNull();
    expect(parseRegulationEntry("co-reg:3", base)).toBeNull();
  });

  it("filters the index by state, level and words", () => {
    const path = decodeURIComponent(regulationIndexPath("VA", "chapter", "banking"));
    expect(path).toContain('filters=cs.{"state":["VA"],"level":["chapter"]}');
    expect(path).toContain("search_vector=fts(simple).banking:*");
    expect(regulationIndexPath("VA", null, "")).not.toContain("search_vector");
  });
});

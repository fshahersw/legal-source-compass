import { afterEach, describe, expect, it, vi } from "vitest";

const rows = new Map<string, unknown[]>();
const paths: string[] = [];
vi.mock("@/lib/external/rest.server", () => ({
  restGet: vi.fn(async (path: string) => {
    paths.push(path);
    const id = decodeURIComponent(/&id=eq\.([^&]+)/.exec(path)?.[1] ?? "");
    return { rows: rows.get(id) ?? [], total: null };
  }),
}));

import {
  STATUTE_EXECUTORS,
  STATUTE_TOOL_DEFINITIONS,
  parseUscCitation,
} from "./statuteTools.server";
import { TOOL_DEFINITIONS, availableTools } from "./tools.server";

const read = STATUTE_EXECUTORS["read_usc_section"]!;

function section(title: string, key: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    id: `${title}:${key}`,
    text,
    source_url: `https://uscode.house.gov/us/usc/119-124/t${title}/s${key}/`,
    u: {
      title,
      key,
      kind: "section",
      citation: `${title} U.S.C. § ${key}`,
      num: `§ ${key}.`,
      heading: "Civil action for deprivation of rights",
      url: `https://uscode.house.gov/us/usc/119-124/t${title}/s${key}/`,
      url_kind: "section",
      credit: "(R.S. § 1979; Pub. L. 96–170, § 1, Dec. 29, 1979, 93 Stat. 1284.)",
      notes: [
        {
          g: "Editorial Notes",
          h: "Amendments",
          l: [[0, "1979—Pub. L. 96–170 inserted “or the District of Columbia”."]],
        },
        { h: "", l: [[0, "Unheaded note."]] },
      ],
      release: "119-124",
      law_date: "2026-10-15",
      ...extra,
    },
  };
}

afterEach(() => {
  rows.clear();
  paths.length = 0;
});

describe("parseUscCitation", () => {
  it("reads common citation forms and keeps a subsection apart", () => {
    expect(parseUscCitation("42 U.S.C. § 1983")).toEqual({
      title: "42",
      key: "1983",
      subsection: null,
    });
    expect(parseUscCitation("42 USC 2000e–2(a)(1)")).toEqual({
      title: "42",
      key: "2000e-2",
      subsection: "(a)(1)",
    });
    expect(parseUscCitation("15 U.S.C. 78j(b) et seq.")).toEqual({
      title: "15",
      key: "78j",
      subsection: "(b)",
    });
    expect(parseUscCitation("", 28, "§ 1407")).toEqual({
      title: "28",
      key: "1407",
      subsection: null,
    });
  });

  it("rejects what is not a U.S. Code section citation", () => {
    expect(parseUscCitation("21 CFR 314.80")).toBeNull();
    expect(parseUscCitation("99 U.S.C. 1")).toBeNull();
    expect(parseUscCitation("Rule 23")).toBeNull();
  });
});

describe("read_usc_section", () => {
  it("is offered with the other tools and names no vendor", () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toContain("read_usc_section");
    expect(availableTools().map((t) => t.name)).toContain("read_usc_section");
    expect(JSON.stringify(STATUTE_TOOL_DEFINITIONS)).not.toMatch(
      /anthropic|claude|openai|gpt|tavily|firecrawl/i,
    );
  });

  it("returns the stored text with its release point, notes, official link and workspace page", async () => {
    rows.set("42:1983", [
      section("42", "1983", "Every person who, under color of any statute…\n\tshall be liable."),
    ]);
    const out = await read({ citation: "42 U.S.C. § 1983" });
    const body = JSON.parse(out.content);
    expect(body).toMatchObject({
      found: true,
      citation: "42 U.S.C. § 1983",
      status: "current",
      subsection_requested: null,
      current_through: { release_point: "119-124", law_date: "2026-10-15" },
      note_headings: ["Amendments"],
      official_url: "https://uscode.house.gov/us/usc/119-124/t42/s1983/",
      page: "/law/uscode/42/1983",
    });
    expect(body.text).toContain(
      "Every person who, under color of any statute…\n  shall be liable.",
    );
    expect(body.text).toContain("Source credit: (R.S. § 1979;");
    expect(body.text).toContain("Editorial Notes — Amendments\n1979—Pub. L. 96–170");
    expect(out.sources).toEqual([
      {
        title: "42 U.S.C. § 1983",
        url: "https://uscode.house.gov/us/usc/119-124/t42/s1983/",
        internal: false,
      },
      { title: "42 U.S.C. § 1983 in the workspace", url: "/law/uscode/42/1983", internal: true },
    ]);
  });

  it("reads the whole section for a subsection citation and finds words in the notes", async () => {
    rows.set("42:1983", [section("42", "1983", "Every person who…")]);
    const body = JSON.parse(
      (await read({ citation: "42 U.S.C. 1983(a)", find: "District of Columbia" })).content,
    );
    expect(paths.map((p) => decodeURIComponent(p))).toEqual([
      expect.stringContaining("id=eq.42:1983&"),
    ]);
    expect(body.subsection_requested).toBe("(a)");
    expect(body.occurrences).toBe(1);
    expect(body.matches[0].excerpt).toContain("inserted “or the District of Columbia”");
  });

  it("reports a repealed section's status", async () => {
    rows.set("18:14", [section("18", "14", "", { status: "repealed", notes: [] })]);
    const body = JSON.parse((await read({ citation: "18 U.S.C. § 14" })).content);
    expect(body.status).toBe("repealed");
  });

  it("reports a section that is not stored without inventing text", async () => {
    const out = await read({ citation: "42 U.S.C. § 99999" });
    const body = JSON.parse(out.content);
    expect(body).toMatchObject({ found: false, citation: "42 U.S.C. § 99999" });
    expect(body.text).toBeUndefined();
    expect(out.sources).toEqual([]);
  });

  it("refuses input that is not a U.S. Code citation", async () => {
    await expect(read({ citation: "21 CFR 314.80" })).rejects.toThrow(/U\.S\. Code citation/);
  });
});

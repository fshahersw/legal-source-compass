import { afterEach, describe, expect, it, vi } from "vitest";

const calls: { path: string; opts: unknown }[] = [];
let respond: (path: string) => { rows: unknown[]; total: number | null } = () => ({
  rows: [],
  total: 0,
});
vi.mock("@/lib/external/rest.server", () => ({
  restGet: vi.fn(async (path: string, opts: unknown) => {
    calls.push({ path, opts });
    return respond(path);
  }),
  ilikeTerm: (q: string) => encodeURIComponent(`*${q.replace(/[*,()%]/g, " ").trim()}*`),
}));

import {
  OVERSIGHT_EXECUTORS,
  OVERSIGHT_TOOL_DEFINITIONS,
  buildQuery,
  shapeResult,
} from "./oversightTools.server";
import { TOOL_DEFINITIONS, availableTools } from "./tools.server";

const search = OVERSIGHT_EXECUTORS["search_oversight_reports"]!;

afterEach(() => {
  calls.length = 0;
  respond = () => ({ rows: [], total: 0 });
});

const igRow = {
  id: "ovr:abc",
  title: "Audit of Grants",
  source_url: "https://www.oversight.gov/reports/audit/grants",
  b: {
    date: "2026-03-01",
    oig: "Department of Justice OIG",
    agency_reviewed: "Department of Justice",
    type: "Audit",
    report_number: "26-001",
    recommendations: 0,
    description: "x".repeat(900),
    url: "https://www.oversight.gov/reports/audit/grants",
  },
};

describe("search_oversight_reports definition", () => {
  it("is registered and offered without any service key", () => {
    expect(OVERSIGHT_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(["search_oversight_reports"]);
    expect(TOOL_DEFINITIONS.some((t) => t.name === "search_oversight_reports")).toBe(true);
    expect(availableTools().some((t) => t.name === "search_oversight_reports")).toBe(true);
  });

  it("names no vendor or model", () => {
    const d = OVERSIGHT_TOOL_DEFINITIONS[0]!.description;
    expect(d).not.toMatch(/firecrawl|tavily|claude|anthropic|openai|gpt/i);
  });
});

describe("buildQuery", () => {
  it("combines text tokens with published-field filters and a date range", () => {
    const { path } = buildQuery("inspector_general", {
      query: "grants  fraud",
      oig: "Justice",
      agency: "Securities (and)",
      type: "Audit",
      date_from: "2024-01-01",
      date_to: "2024-12-31",
    });
    expect(path).toContain("dataset=eq.oversight_reports");
    expect(path).toContain("text=ilike.*grants*");
    expect(path).toContain("text=ilike.*fraud*");
    expect(path).toContain("item->oversight->>oig=ilike.*Justice*");
    expect(path).toContain("item->oversight->>agency_reviewed=ilike.*Securities%20%20and*");
    expect(path).toContain("item->oversight->>type=ilike.*Audit*");
    expect(path).toContain("item->oversight->>date=gte.2024-01-01");
    expect(path).toContain("item->oversight->>date=lte.2024-12-31");
    expect(path.endsWith("order=ordinal.asc")).toBe(true);
  });

  it("rejects a malformed date instead of guessing", () => {
    expect(() => buildQuery("inspector_general", { date_from: "last year" })).toThrow(/date_from/);
  });

  it("uses the right dataset and date field per source", () => {
    expect(buildQuery("osc_public_files", { date_from: "2020-01-01" }).path).toContain(
      "dataset=eq.osc_public_files",
    );
    expect(buildQuery("osc_public_files", { date_from: "2020-01-01" }).path).toContain(
      "item->oscdi->>date_closed=gte.2020-01-01",
    );
    expect(buildQuery("doj_cep_resolutions", {}).path).toContain("dataset=eq.doj_cep_resolutions");
    expect(buildQuery("doj_oig", { oig: "x" }).note[0]).toMatch(/ignored/);
  });

  it("drops unsafe characters from search words", () => {
    const { path } = buildQuery("inspector_general", { query: "a*,() b%c" });
    expect(path).not.toMatch(/ilike\.[^&]*[(),]/);
  });
});

describe("shapeResult", () => {
  it("keeps the publisher's fields, nulls for what is absent, and clips the description", () => {
    const s = shapeResult("inspector_general", igRow)!;
    expect(s.out["recommendations_stated"]).toBe(0);
    expect(s.out["report_number"]).toBe("26-001");
    expect((s.out["description"] as string).length).toBeLessThanOrEqual(401);
    const bare = shapeResult("inspector_general", {
      id: "ovr:x",
      title: "T",
      source_url: "https://www.oversight.gov/node/1",
      b: {},
    })!;
    expect(bare.out["date"]).toBeNull();
    expect(bare.out["recommendations_stated"]).toBeNull();
    expect(bare.out["oig"]).toBeNull();
  });

  it("drops rows without an https link or title", () => {
    expect(
      shapeResult("inspector_general", {
        id: "a",
        title: "T",
        source_url: "javascript:alert(1)",
        b: {},
      }),
    ).toBeNull();
    expect(
      shapeResult("inspector_general", { id: "a", title: "", source_url: "https://x.gov/", b: {} }),
    ).toBeNull();
  });

  it("shapes DOJ OIG, OSC and CEP rows", () => {
    const doj = shapeResult("doj_oig", {
      id: "dojoig:x",
      title: "Audit",
      source_url: "https://oig.justice.gov/reports/x",
      b: {
        date: "2019-05-30",
        number: "19-1",
        type: "Audit",
        components: ["Federal Bureau of Prisons"],
        questioned_costs: { text: "$7,054,115", value: 7054115 },
        funds_better_use: { text: "$0", value: 0 },
        pdf_url: "https://oig.justice.gov/sites/default/files/reports/19-1.pdf",
      },
    })!;
    expect(doj.out["questioned_costs_as_printed"]).toBe("$7,054,115");
    expect(doj.out["components"]).toEqual(["Federal Bureau of Prisons"]);
    const osc = shapeResult("osc_public_files", {
      id: "oscdi:di-1",
      title: "DI-1",
      source_url: "https://www.osc.gov/case/di-1/",
      b: {
        number: "DI-1",
        agency: "Veterans Affairs",
        results: ["Substantiated"],
        files: [
          { label: "Agency Report", url: "https://www.osc.gov/a.pdf" },
          { label: "bad", url: "ftp://x" },
        ],
      },
    })!;
    expect(osc.out["documents"]).toEqual([
      { label: "Agency Report", url: "https://www.osc.gov/a.pdf" },
    ]);
    const cep = shapeResult("doj_cep_resolutions", {
      id: "cep:1",
      title: "Akamai Technologies, Inc.",
      source_url: "https://www.justice.gov/media/1/dl",
      b: { label: "In re: Akamai", date: "2016-06-06", company_cik: null },
    })!;
    expect(cep.out["company_profile_cik"]).toBeNull();
  });
});

describe("tool execution", () => {
  it("returns results with sources and the total, and pages with a range", async () => {
    respond = () => ({ rows: [igRow], total: 41 });
    const out = await search({ query: "grants", limit: 5, offset: 10 });
    const body = JSON.parse(out.content) as {
      total_matches: number;
      returned: number;
      results: unknown[];
      notes: string[];
    };
    expect(body.total_matches).toBe(41);
    expect(body.returned).toBe(1);
    expect(out.sources).toEqual([
      {
        title: "Audit of Grants",
        url: "https://www.oversight.gov/reports/audit/grants",
        internal: false,
      },
    ]);
    expect(calls[0]!.opts).toEqual({ count: true, range: [10, 14] });
    expect(out.label).toBe("Searched oversight reports");
    expect(body.notes.join(" ")).toMatch(/not audited/);
  });

  it("says plainly when nothing matches", async () => {
    const out = await search({ query: "zzzz" });
    expect(JSON.parse(out.content).notes.join(" ")).toMatch(/not proof/);
    expect(out.sources).toEqual([]);
  });

  it("rejects an unknown source", async () => {
    await expect(search({ source: "everything" })).rejects.toThrow(/source must be one of/);
  });

  it("caps the limit at 20", async () => {
    await search({ limit: 500 });
    expect(calls[0]!.opts).toEqual({ count: true, range: [0, 19] });
  });
});

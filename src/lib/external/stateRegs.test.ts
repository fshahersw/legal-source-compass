import { describe, expect, it } from "vitest";
import {
  httpUrl,
  parseCode,
  parseIssue,
  parseResolve,
  parseRuleView,
  parseSearch,
  parseTree,
} from "./stateRegs.functions";
import {
  coverageSummary,
  issuesByYear,
  issueWhen,
  robotsLine,
} from "@/components/law/regulations/labels";

const code = {
  state: "OH",
  code_name: "Ohio Administrative Code",
  publisher: "Ohio Legislative Service Commission (codes.ohio.gov)",
  code_url: "https://codes.ohio.gov/ohio-administrative-code",
  access: "html",
  status: "official_free",
  acquisition: { text: "sample", sample: { rules: 42 } },
  robots: { allowed: true, crawl_delay: null },
  index_nodes: 2844,
  text_rules: 42,
  register_name: "Register of Ohio",
  register_url: "https://www.registerofohio.state.oh.us/",
};
const head = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  state: "OH",
  number: "3745-4-01",
  citation: "Ohio Adm.Code 3745-4-01",
  heading: "Purpose and applicability.",
  status: "active",
  emergency: null,
  effective_date: "2025-07-10",
  source_url: "https://codes.ohio.gov/ohio-administrative-code/rule-3745-4-01",
  node_id: "oh:chapter-3745-4",
  chars: 100,
  ...extra,
});

describe("state administrative code parsers", () => {
  it("keeps only http(s) official links", () => {
    expect(httpUrl("https://codes.ohio.gov/x")).toBe("https://codes.ohio.gov/x");
    expect(httpUrl("javascript:alert(1)")).toBeNull();
    expect(httpUrl("data:text/html,x")).toBeNull();
  });

  it("parses a coverage row and drops malformed ones", () => {
    const c = parseCode(code)!;
    expect(c).toMatchObject({
      state: "OH",
      acquisition: "sample",
      sampleRules: 42,
      robotsAllowed: true,
      textRules: 42,
    });
    expect(c.currency).toBeNull();
    expect(parseCode({ ...code, state: "Ohio" })).toBeNull();
    expect(parseCode({ ...code, code_url: "ftp://x" })).toBeNull();
    expect(parseCode({ ...code, acquisition: { text: "everything" } })!.acquisition).toBe(
      "not_started",
    );
  });

  it("parses the tree and keeps rules of the requested state only", () => {
    const t = parseTree(
      {
        state: "OH",
        parent: {
          id: "oh:chapter-3745-4",
          level: "chapter",
          source_url: "https://codes.ohio.gov/x",
          rules_loaded: 2,
        },
        path: [
          { id: "oh:agency-3745", level: "agency", num: "3745", heading: "EPA" },
          { id: "bad id", level: "x" },
        ],
        total: 1,
        nodes: [
          {
            id: "oh:chapter-3745-4",
            level: "chapter",
            source_url: "https://codes.ohio.gov/x",
            children: 0,
          },
        ],
        rules: [
          head("oh:3745-4-1"),
          head("wa:1", { state: "WA" }),
          head("oh:3745-4-2", { source_url: "javascript:x" }),
        ],
      },
      "OH",
    )!;
    expect(t.path.map((p) => p.id)).toEqual(["oh:agency-3745"]);
    expect(t.rules.map((r) => r.id)).toEqual(["oh:3745-4-1"]);
    expect(t.parent!.rulesLoaded).toBe(2);
    expect(parseTree({ state: "WA" }, "OH")).toBeNull();
  });

  it("parses a rule view with its text check", () => {
    const v = parseRuleView({
      rule: {
        ...head("oh:3745-4-1"),
        text: "(A) The purpose of this chapter.",
        history: "Authorized By: 6111.51",
        register_citation: null,
        raw_sha256: "a".repeat(64),
        text_check: {
          method: "html.parser rendering",
          text: "confirmed",
          heading: "confirmed",
          history: "confirmed",
        },
      },
      path: [],
      prev: null,
      next: head("oh:3745-4-2"),
      code: {
        code_name: "Ohio Administrative Code",
        publisher: "LSC",
        code_url: "https://codes.ohio.gov",
      },
    })!;
    expect(v.rule.textCheck!.text).toBe("confirmed");
    expect(v.rule.chars).toBe(32);
    expect(v.next!.id).toBe("oh:3745-4-2");
    expect(v.rule.registerCitation).toBeNull();
  });

  it("parses search results and the exact citation hit", () => {
    const s = parseSearch(
      {
        total: 3,
        hits: [{ ...head("oh:3745-4-1"), snippet: "«purpose»" }],
        exact: head("oh:3745-4-1"),
      },
      "OH",
    )!;
    expect(s.total).toBe(3);
    expect(s.hits[0]!.snippet).toBe("«purpose»");
    expect(s.exact!.id).toBe("oh:3745-4-1");
  });

  it("parses register issues; an issue without a date or month is dropped", () => {
    const ok = parseIssue(
      "tx-reg:2026-10-16",
      {
        state: "TX",
        publication: "Texas Register",
        date: "2026-10-16",
        period: null,
        volume: null,
        issue: null,
        pages: "7091-7200",
        label: "October 16, 2026 - Pages 7091-7200",
        url: "https://www.sos.texas.gov/texreg/pdf/backview/1016/index.shtml",
      },
      "TX",
    )!;
    expect(ok.pages).toBe("7091-7200");
    expect(
      parseIssue("x", { state: "TX", publication: "Texas Register", url: "https://x" }, "TX"),
    ).toBeNull();
    expect(
      parseIssue(
        "x",
        { state: "OH", publication: "x", date: "2026-01-01", url: "https://x" },
        "TX",
      ),
    ).toBeNull();
    expect(issueWhen(ok)).toBe("Oct 16, 2026");
    expect(issueWhen({ date: null, period: "2026-07" })).toBe("Jul 2026");
  });

  it("resolution never carries a rule id unless resolved", () => {
    expect(
      parseResolve({ status: "unresolved", key: "3745-4-99", rule_id: "oh:3745-4-1" })!.ruleId,
    ).toBeNull();
    expect(
      parseResolve({ status: "resolved", key: "3745-4-1", rule_id: "oh:3745-4-1" })!.ruleId,
    ).toBe("oh:3745-4-1");
    expect(parseResolve({ status: "close enough" })).toBeNull();
  });

  it("groups issues by year and summarizes coverage", () => {
    const mk = (date: string | null, period: string | null) => ({
      id: date ?? period!,
      state: "TX",
      publication: "p",
      date,
      period,
      volume: null,
      issue: null,
      pages: null,
      label: "",
      url: "https://x",
    });
    const y = issuesByYear([mk("2026-01-02", null), mk(null, "2025-07"), mk("2026-03-01", null)]);
    expect(y.map((g) => [g.year, g.issues.length])).toEqual([
      ["2026", 2],
      ["2025", 1],
    ]);
    expect(y[0]!.issues[0]!.date).toBe("2026-03-01");
    const c = parseCode(code)!;
    expect(coverageSummary([c, { ...c, acquisition: "blocked" }]).map((s) => s.count)).toEqual([
      1, 1,
    ]);
    expect(robotsLine({ ...c, robotsAllowed: false })).toBe("Disallowed by robots.txt");
    expect(robotsLine({ ...c, robotsAllowed: null })).toBe("Not recorded");
  });
});

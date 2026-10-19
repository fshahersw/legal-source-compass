import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import type { RuleDocument } from "@/lib/external/courtRules.functions";
import { categoryTotals, groupDocuments, highlightParts, hostLabel, oneLine } from "./ruleFormat";

const d = (
  id: string,
  scope: RuleDocument["scope"],
  categories: RuleDocument["categories"],
): RuleDocument => ({
  id,
  title: id,
  scope,
  publisher: null,
  url: null,
  foundOn: null,
  format: "pdf",
  status: "text",
  statusLabel: "Retrieved",
  note: null,
  sections: 1,
  insights: 1,
  categories,
  pages: null,
  retrievedAt: null,
});

describe("rule panel helpers", () => {
  it("adds category counts across documents in reading order", () => {
    const totals = categoryTotals([
      d("a", "state", { page_limit: 2, response_deadline: 1 }),
      d("b", "state", { page_limit: 3 }),
    ]);
    expect(totals).toEqual([
      { category: "response_deadline", label: "Response deadline", count: 1 },
      { category: "page_limit", label: "Page limit", count: 5 },
    ]);
  });

  it("groups documents national, local, state", () => {
    const groups = groupDocuments([
      d("s", "state", {}),
      d("n", "federal_national", {}),
      d("l", "federal_local", {}),
    ]);
    expect(groups.map((g) => g.scope)).toEqual(["federal_national", "federal_local", "state"]);
  });

  it("marks words that start with a query term", () => {
    const parts = highlightParts("Replies to motions for summary judgment", "repl summary");
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["Replies", "summary"]);
    expect(highlightParts("text", "a")).toEqual([{ text: "text", hit: false }]);
    expect(highlightParts("(x+y)", "(x")).toEqual([{ text: "(x+y)", hit: false }]);
  });

  it("labels addresses and joins printed line breaks", () => {
    expect(hostLabel("https://www.uscourts.gov/sites/default/files/document/frcp.pdf")).toBe(
      "uscourts.gov/…/frcp.pdf",
    );
    expect(hostLabel("not a url")).toBe("not a url");
    expect(oneLine("within fourteen\n(14)  days")).toBe("within fourteen (14) days");
  });
});

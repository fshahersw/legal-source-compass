import { describe, expect, it } from "vitest";
import { pageBlock, systemPrompt } from "./agent.server";
import { routeForPath, searchCode } from "./codeIndex.server";
import { allow } from "./limits.server";
import { assistantRequestSchema, MEMORY_MESSAGES, rollingMemory } from "./protocol";
import { availableTools, publicUrl, TOOL_DEFINITIONS } from "./tools.server";

const page = {
  path: "/courts/cand",
  title: "District Court, N.D. California",
  headings: ["District Court, N.D. California"],
  text: "Federal district",
  selection: "",
  focus: "",
  dialog: "",
  viewport: "1280x800, 0% down",
};

describe("assistant protocol", () => {
  it("keeps a rolling memory of eight messages that starts with the user", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${i}`,
    }));
    const kept = rollingMemory(many);
    expect(kept.length).toBeLessThanOrEqual(MEMORY_MESSAGES);
    expect(kept[0]!.role).toBe("user");
    expect(kept.at(-1)!.content).toBe("m12");
  });

  it("accepts a well-formed request and rejects one that does not end with the user", () => {
    expect(
      assistantRequestSchema.safeParse({
        messages: [{ role: "user", content: "hi" }],
        page,
        attachments: [],
      }).success,
    ).toBe(true);
    expect(
      assistantRequestSchema.safeParse({
        messages: [{ role: "assistant", content: "hi" }],
        page: null,
        attachments: [],
      }).success,
    ).toBe(false);
    expect(
      assistantRequestSchema.safeParse({
        messages: [{ role: "user", content: "hi" }],
        page: null,
        attachments: [{ name: "x.exe", type: "application/x-msdownload", data: "AAAA" }],
      }).success,
    ).toBe(false);
  });
});

describe("assistant server pieces", () => {
  it("never names a model or vendor in the system prompt or tool descriptions", () => {
    const text = [systemPrompt("2026-10-19"), ...TOOL_DEFINITIONS.map((t) => t.description)]
      .join(" ")
      .toLowerCase();
    for (const name of [
      "claude",
      "anthropic",
      "openai",
      "gpt",
      "tavily",
      "firecrawl",
      "courtlistener",
      "sonnet",
    ])
      expect(text, name).not.toContain(name);
  });

  it("maps a page path to its route file and puts it in the page context", () => {
    expect(routeForPath("/courts/cand")?.route).toBe("/courts/$id");
    expect(routeForPath("/courts/firms")?.route).toBe("/courts/firms");
    expect(routeForPath("/law/monitoring")?.route).toBe("/law_/monitoring");
    expect(pageBlock(page)).toContain("Route file: src/routes/courts.$id.tsx");
    expect(searchCode("recall patterns").length).toBeGreaterThan(0);
  });

  it("only reads public http(s) addresses", () => {
    expect(publicUrl("https://www.fda.gov/safety/recalls")?.hostname).toBe("www.fda.gov");
    for (const bad of [
      "file:///etc/passwd",
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://10.0.0.2",
      "http://169.254.169.254/latest",
      "http://[::1]/",
      "https://user:pw@x.com",
    ])
      expect(publicUrl(bad), bad).toBeNull();
  });

  it("offers web tools only when their keys are configured", () => {
    const before = { ...process.env };
    delete process.env["TAVILY_API_KEY"];
    delete process.env["FIRECRAWL_API_KEY"];
    delete process.env["COURTLISTENER_API_KEY"];
    const names = availableTools().map((t) => t.name);
    expect(names).toContain("search_corpus");
    expect(names).not.toContain("web_search");
    process.env = before;
  });

  it("limits requests per client", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i += 1) expect(allow("k-test", 3, 1000, t + i)).toBe(true);
    expect(allow("k-test", 3, 1000, t + 5)).toBe(false);
    expect(allow("k-test", 3, 1000, t + 2000)).toBe(true);
  });
});

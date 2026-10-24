import { describe, expect, it } from "vitest";
import { sectionBlock, systemPrompt } from "./agent.server";
import { retryAfterSeconds, allow } from "./limits.server";
import { modelConfig } from "./model.server";
import { assistantRequestSchema } from "./protocol";
import { renderSectionContext } from "./sectionContext";
import { buildSectionContextForTest } from "./summarize.testing";

const section = buildSectionContextForTest();
const base = { messages: [{ role: "user", content: "Why?" }], page: null, attachments: [] };

describe("section-scoped questions", () => {
  it("accepts a section beside the question, or none", () => {
    expect(assistantRequestSchema.safeParse({ ...base, section }).success).toBe(true);
    expect(assistantRequestSchema.safeParse({ ...base, section: null }).success).toBe(true);
    expect(assistantRequestSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a section with an unknown key, a bad id or too many bytes", () => {
    expect(
      assistantRequestSchema.safeParse({ ...base, section: { ...section, x: 1 } }).success,
    ).toBe(false);
    expect(
      assistantRequestSchema.safeParse({ ...base, section: { ...section, id: "../x" } }).success,
    ).toBe(false);
    const big = {
      ...section,
      figures: Array.from({ length: 40 }, (_, i) => ({
        label: `L${i}`,
        value: "1",
        note: "n".repeat(140),
        unit: "u".repeat(40),
        period: "p".repeat(48),
      })),
    };
    expect(assistantRequestSchema.safeParse({ ...base, section: big }).success).toBe(false);
  });

  it("puts the section's figures, period and source in the model's input", () => {
    const text = sectionBlock(section)!;
    expect(text.startsWith("<section_context>")).toBe(true);
    expect(text).toContain(renderSectionContext(section));
    expect(text).toContain("Cases filed: 303,716 cases (FY2025)");
    expect(text).toContain("Source: Federal Judicial Center");
    expect(sectionBlock(null)).toBeNull();
    expect(sectionBlock(undefined)).toBeNull();
  });

  it("tells the model how to treat an attached section, without naming a model or vendor", () => {
    const prompt = systemPrompt("2026-10-24");
    expect(prompt).toContain("<section_context>");
    expect(prompt.toLowerCase()).not.toMatch(/claude|anthropic|openai|gpt|gemini/);
  });
});

describe("limits and configuration helpers", () => {
  it("reports whole seconds until the oldest request leaves the window", () => {
    const key = `test:${Math.random()}`;
    expect(retryAfterSeconds(key, 60_000, 0)).toBe(1);
    allow(key, 2, 60_000, 1_000);
    allow(key, 2, 60_000, 20_000);
    expect(allow(key, 2, 60_000, 30_000)).toBe(false);
    expect(retryAfterSeconds(key, 60_000, 30_000)).toBe(31);
  });

  it("is not configured without a key", () => {
    expect(modelConfig({})).toBeNull();
    expect(modelConfig({ SOMETHING_ELSE: "x" })).toBeNull();
  });
});

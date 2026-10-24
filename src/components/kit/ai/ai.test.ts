import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildSectionContextForTest } from "@/lib/assistant/summarize.testing";
import { AiSummaryView, type AiSummaryViewState } from "./AiSummary";
import {
  AI_ASK_TIP,
  AI_LABEL,
  AI_NOT_CONFIGURED,
  AI_THIN,
  AI_UNCONFIGURED,
  AI_WAITING,
  askAiAvailability,
  copyText,
} from "./labels";
import { toState } from "./useAiSummary";

const view = (state: AiSummaryViewState) =>
  renderToStaticMarkup(createElement(AiSummaryView, { state, onSummarize: () => undefined }));

describe("AiSummaryView states", () => {
  it("idle: the title and a Summarize button, no AI text yet", () => {
    const html = view({ kind: "idle" });
    expect(html).toContain("What this shows");
    expect(html).toContain("Summarize");
    expect(html).not.toContain(AI_LABEL);
  });

  it("loading: announced politely, busy, with skeleton lines", () => {
    const html = view({ kind: "loading" });
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Summarizing the figures");
    expect(html).toContain("animate-pulse");
  });

  it("ready: bullets, the label, a copy button; saved and omitted notes only when true", () => {
    const base = { kind: "ready" as const, bullets: ["One.", "Two."], generatedAt: "t" };
    const fresh = view({ ...base, omitted: 0, cached: false });
    expect(fresh).toContain("<li>One.</li>");
    expect(fresh).toContain(AI_LABEL);
    expect(fresh).toContain("Copy");
    expect(fresh).not.toContain("Saved result");
    expect(fresh).not.toContain("Some details omitted");
    const saved = view({ ...base, omitted: 2, cached: true });
    expect(saved).toContain("Saved result.");
    expect(saved).toContain("Some details omitted.");
  });

  it("error and rate limited: an alert with the message and a retry", () => {
    const err = view({ kind: "error", message: "The summary could not be generated right now." });
    expect(err).toContain('role="alert"');
    expect(err).toContain("could not be generated");
    expect(err).toContain("Try again");
    const limited = view({
      kind: "rate_limited",
      message: "Too many summaries in a short time. Try again in 3 minutes.",
      retryAfterSec: 180,
    });
    expect(limited).toContain("Too many summaries");
    expect(limited).toContain("Try again");
  });

  it("waiting: the same one-row strip with Summarize disabled, so loading figures cannot shift the page", () => {
    const html = view({ kind: "waiting" });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Summarize<\/button>/);
    expect(html).not.toContain("animate-pulse");
  });

  it("empty, thin and not configured read as one quiet line, with no action", () => {
    expect(view({ kind: "empty" })).toContain(AI_THIN);
    expect(view({ kind: "thin", message: AI_THIN })).toContain(AI_THIN);
    expect(view({ kind: "unconfigured", message: AI_UNCONFIGURED })).toContain(AI_UNCONFIGURED);
    for (const state of [
      { kind: "empty" },
      { kind: "thin", message: AI_THIN },
      { kind: "unconfigured", message: AI_UNCONFIGURED },
    ] as AiSummaryViewState[])
      expect(view(state)).not.toContain("<button");
  });

  it("uses no hard-coded colours or gradients", () => {
    const html = view({
      kind: "ready",
      bullets: ["x"],
      omitted: 0,
      cached: false,
      generatedAt: "t",
    });
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|gradient|rgb\(/i);
  });
});

describe("copyText", () => {
  it("copies the bullets with the label and where the figures came from", () => {
    expect(copyText(["A.", "B."], "Federal civil cases filed. Source: FJC. FY2025")).toBe(
      `- A.\n- B.\n\n${AI_LABEL} Federal civil cases filed. Source: FJC. FY2025`,
    );
    expect(copyText(["A."])).toBe(`- A.\n\n${AI_LABEL}`);
  });
});

describe("toState", () => {
  it("maps each server result to a view state", () => {
    expect(
      toState({ status: "ok", bullets: ["A."], omitted: 1, cached: true, generatedAt: "t" }),
    ).toMatchObject({ kind: "ready", omitted: 1, cached: true });
    expect(toState({ status: "thin", message: AI_THIN })).toMatchObject({ kind: "thin" });
    expect(
      toState({ status: "unavailable", reason: "not_configured", message: AI_UNCONFIGURED }),
    ).toMatchObject({ kind: "unconfigured" });
    expect(
      toState({ status: "unavailable", reason: "rate_limited", message: "m", retryAfterSec: 90 }),
    ).toMatchObject({ kind: "rate_limited", retryAfterSec: 90 });
    for (const reason of ["busy", "timeout", "error", "invalid"] as const)
      expect(toState({ status: "unavailable", reason, message: "m" })).toMatchObject({
        kind: "error",
      });
  });
});

describe("askAiAvailability", () => {
  const ctx = buildSectionContextForTest();
  it("is ready with figures, waiting without, and says so when AI is not configured", () => {
    expect(askAiAvailability(ctx, "configured")).toBe("ready");
    expect(askAiAvailability(ctx, "unknown")).toBe("ready");
    expect(askAiAvailability(null, "configured")).toBe("waiting");
    expect(askAiAvailability({ ...ctx, figures: [] }, "configured")).toBe("waiting");
    expect(askAiAvailability(ctx, "unconfigured")).toBe("unconfigured");
    expect(askAiAvailability(null, "unconfigured")).toBe("unconfigured");
  });
  it("has a tooltip text for each state", () => {
    expect(AI_NOT_CONFIGURED).toContain("not configured");
    expect(AI_WAITING).toContain("figures");
    expect(AI_ASK_TIP).toContain("figures, period and source");
  });
});

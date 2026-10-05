import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { baselineRule, calculateBaseline } from "@/lib/limitations/engine";
import type { ClaimType, LimitationsSnapshot } from "@/lib/limitations/types";
import { guidedDateFields, unconfirmedClaimInput } from "./calculatorGuidance";
import { LimitationsWorkbench } from "./LimitationsWorkbench";

const json = (name: string) =>
  JSON.parse(readFileSync(`private/data/limitations/${name}.json`, "utf8"));
const snapshot: LimitationsSnapshot = {
  ...json("rules"),
  sources: json("sources").sources,
  coverage: json("coverage").coverage,
  cases: json("case-references").cases,
};
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: snapshot, isPending: false, error: null }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: (props: { to: string; children: ReactNode; className?: string }) =>
    createElement("a", { href: props.to, className: props.className }, props.children),
}));
const markup = (state: string, claim?: ClaimType) =>
  renderToStaticMarkup(
    createElement(LimitationsWorkbench, {
      state,
      claim,
      view: "calculator",
      onNavigate: () => undefined,
    }),
  );

describe("guided limitations calculator", () => {
  it("starts with state selection and no inferred claim, dates or legal confirmations", () => {
    const html = markup("");
    expect(html).toContain("Choose the law and claim");
    expect(html).toContain("Choose a state");
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain("statutory anniversary");
  });
  it("keeps prefilled choices on step one so a conditional fact pattern can be selected", () => {
    const html = markup("IN", "personal_injury");
    expect(html).toContain("Choose the law and claim");
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('checked=""');
    const ohio = markup("OH", "product_liability");
    expect(ohio).toContain("Fact pattern");
    expect(ohio).toContain("Latent substance / toxic injury");
  });
  it("unsupported claims offer source review without date inputs or a calculation action", () => {
    const html = markup("HI", "product_liability");
    expect(html).toContain("No unique baseline is available");
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain("Review result");
  });
  it("shows every required discovery and product-history date without replacing them with one date", () => {
    const rule = baselineRule(snapshot.rules, "OH", "product_liability", "latent_toxic");
    expect(rule).not.toBeNull();
    expect(guidedDateFields(rule, "OH", "latent_toxic").map((field) => field.key)).toEqual([
      "actualDiscoveryDate",
      "constructiveDiscoveryDate",
      "firstProductDeliveryDate",
      "qualifyingExposureDate",
    ]);
    expect(guidedDateFields(rule, "OH", "latent_toxic")[1]?.help).toContain(
      "leave an unknown date blank",
    );
    expect(guidedDateFields(null, "HI")).toEqual([]);
  });
  it("changing the rule context clears prior dates, death status, exceptions and confirmations", () => {
    const reset = unconfirmedClaimInput("IN", "personal_injury");
    expect(reset.vitalStatus).toBe("unknown");
    expect(reset.actualDiscoveryDate).toBeUndefined();
    expect(reset.deathDate).toBeUndefined();
    expect(reset.exceptionReview).toBe("unresolved");
    const result = calculateBaseline(snapshot, { ...reset, accrualDate: "2024-03-01" });
    expect(result.date).toBeNull();
    expect(result.reasons.join(" ")).toContain("governing");
    expect(result.reasons.join(" ")).toContain("exceptions");
  });
});

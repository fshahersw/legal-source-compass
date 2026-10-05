import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { baselineRule, calculateBaseline } from "@/lib/limitations/engine";
import type { ClaimType, LimitationRule, LimitationsSnapshot } from "@/lib/limitations/types";
import { guidedDateFields, reposeCapLabel, unconfirmedClaimInput } from "./calculatorGuidance";
import { LimitationsWorkbench } from "./LimitationsWorkbench";

const json = (name: string) =>
  JSON.parse(readFileSync(`private/data/limitations/${name}.json`, "utf8"));
const snapshot: LimitationsSnapshot = {
  ...json("rules"),
  sources: json("sources").sources,
  coverage: json("coverage").coverage,
  cases: json("case-references").cases,
};
const baseRule = snapshot.rules[0];
if (!baseRule) throw new Error("Limitations snapshot has no rules for guidance tests.");
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

const reposeRule = (
  jurisdiction: "NC" | "OR",
  trigger: "last_act_or_omission" | "act_or_omission",
): LimitationRule => ({
  ...baseRule,
  jurisdiction,
  claimType: "personal_injury",
  calculation: {
    mode: "accrual_repose_min",
    reposeYears: 10,
    reposeTrigger: trigger,
  },
});

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
  it("guides NC and OR repose dates independently from confirmed accrual", () => {
    const nc = reposeRule("NC", "last_act_or_omission");
    const or = reposeRule("OR", "act_or_omission");
    expect(guidedDateFields(nc, "NC").map((field) => field.key)).toEqual([
      "accrualDate",
      "reposeActDate",
    ]);
    expect(guidedDateFields(nc, "NC")[0]?.label).toBe("Confirmed accrual date");
    expect(guidedDateFields(nc, "NC")[1]?.label).toBe("Date of the last act or omission");
    expect(guidedDateFields(nc, "NC")[1]?.help).toContain("this defendant");
    expect(guidedDateFields(nc, "NC")[1]?.help).toContain("restart repose");
    expect(guidedDateFields(or, "OR")[1]?.label).toBe("Date of the act or omission complained of");
    expect(guidedDateFields(or, "OR")[1]?.help).toContain("latest event");
    expect(reposeCapLabel(nc)).toBe(
      "Outer repose cap: 10 calendar years from the last act or omission.",
    );
    expect(reposeCapLabel(or)).toBe(
      "Outer repose cap: 10 calendar years from the act or omission complained of.",
    );
  });
  it("changing the rule context clears prior dates, death status, exceptions and confirmations", () => {
    const reset = unconfirmedClaimInput("IN", "personal_injury");
    expect(reset.vitalStatus).toBe("unknown");
    expect(reset.actualDiscoveryDate).toBeUndefined();
    expect(reset.deathDate).toBeUndefined();
    expect(reset.reposeActDate).toBe("");
    expect(reset.reposeApplicabilityConfirmed).toBe(false);
    const changedContext = unconfirmedClaimInput("NC", "personal_injury", "asbestos");
    expect(changedContext.jurisdiction).toBe("NC");
    expect(changedContext.subtype).toBe("asbestos");
    expect(changedContext.accrualDate).toBe("");
    expect(changedContext.reposeActDate).toBe("");
    expect(changedContext.reposeApplicabilityConfirmed).toBe(false);
    expect(reset.exceptionReview).toBe("unresolved");
    const result = calculateBaseline(snapshot, { ...reset, accrualDate: "2024-03-01" });
    expect(result.date).toBeNull();
    expect(result.reasons.join(" ")).toContain("governing");
    expect(result.reasons.join(" ")).toContain("exceptions");
  });
});

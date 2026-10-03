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
      initialState: state,
      initialClaim: claim,
      initialView: "calculator",
    }),
  );

describe("guided limitations calculator", () => {
  it("starts with state selection and no inferred claim, dates or legal confirmations", () => {
    const html = markup("");
    expect(html).toContain("Choose a state or DC");
    expect(html).not.toContain("Choose a claim type");
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('checked=""');
    expect(html).toContain("not a verified filing deadline");
  });
  it("keeps confirmations empty even when an explicit state and claim are prefilled", () => {
    const html = markup("IN", "personal_injury");
    expect(html).toContain('type="date"');
    expect(html).toContain("Date the claim legally arose");
    expect(html).not.toContain('checked=""');
    expect(html).toContain("Not reviewed / not sure");
    expect(html).toContain("No date is issued until");
  });
  it("unsupported claims offer source review without date inputs or a calculation action", () => {
    const html = markup("HI", "product_liability");
    expect(html).toContain("no date will be calculated");
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain("Check cited baseline");
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

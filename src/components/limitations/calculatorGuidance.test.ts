import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { baselineRule, calculateBaseline } from "@/lib/limitations/engine";
import type { ClaimType, LimitationRule, LimitationsSnapshot } from "@/lib/limitations/types";
import {
  guidedDateFields,
  isAccrualReposeRule,
  missingRequirements,
  reposeCapLabel,
  unconfirmedClaimInput,
} from "./calculatorGuidance";
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
  // The workbench loads the snapshot; the citation component looks up public code sections (none here).
  useQuery: (options: { queryKey: unknown[] }) =>
    options.queryKey[0] === "public-statute-section"
      ? { data: [], isPending: false, isSuccess: true, error: null }
      : { data: snapshot, isPending: false, isSuccess: true, error: null },
}));
vi.mock(import("@tanstack/react-start"), async (importOriginal) => ({
  ...(await importOriginal()),
  useServerFn: (<T extends (...args: never[]) => unknown>(fn: T) => fn) as never,
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
  it("shows dates on the same page for a prefilled claim without inferring confirmations", () => {
    const html = markup("IN", "personal_injury");
    expect(html).toContain("Choose the law and claim");
    expect(html).toContain('type="date"');
    expect(html).toContain("Still needed before calculating");
    expect(html).not.toContain('checked=""');
    const ohio = markup("OH", "product_liability");
    expect(ohio).toContain("Fact pattern");
    expect(ohio).toContain("Latent substance / toxic injury");
  });
  it("unsupported claims offer source review without date inputs or a calculation action", () => {
    // Pick a state whose general product claim has no unique baseline in the current release.
    const unsupported = snapshot.coverage
      .map((row) => row.state)
      .find((state) => !baselineRule(snapshot.rules, state, "product_liability"));
    expect(unsupported, "every state has a product baseline; pick another claim").toBeDefined();
    const html = markup(unsupported!, "product_liability");
    expect(html).toContain("No unique baseline is available");
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain(">Calculate<");
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

describe("missingRequirements", () => {
  it("requires every guided date, the death date when deceased, and repose confirmation", () => {
    const rule = reposeRule("NC", "last_act_or_omission");
    const fields = guidedDateFields(rule, "NC");
    const empty = unconfirmedClaimInput("NC", "personal_injury");
    const missing = missingRequirements(empty, rule, fields);
    expect(missing.map((m) => m.id)).toEqual([
      ...fields.map((f) => "date-" + f.key),
      "repose-applicability-confirmed",
    ]);
    const filled = Object.fromEntries(fields.map((f) => [f.key, "2020-01-01"]));
    expect(
      missingRequirements(
        { ...empty, ...filled, reposeApplicabilityConfirmed: true },
        rule,
        fields,
      ),
    ).toEqual([]);
    const plain = { ...rule, calculation: undefined } as unknown as LimitationRule;
    expect(missingRequirements({ ...empty, ...filled }, plain, fields)).toEqual([]);
    const death = { ...plain, calculation: { deathCapYears: 2 } } as unknown as LimitationRule;
    expect(
      missingRequirements({ ...empty, ...filled, vitalStatus: "deceased" }, death, fields).map(
        (m) => m.id,
      ),
    ).toEqual(["date-deathDate"]);
    expect(missingRequirements(empty, null, fields)).toEqual([]);
  });
});

describe("clocks_min guidance", () => {
  const clocksRule = {
    claimType: "medical_malpractice",
    accrualBasis: "confirmed_accrual",
    calculation: {
      mode: "clocks_min",
      combine: "earlier",
      limbs: [
        { amount: 3, unit: "calendar_years", from: "injury_date" },
        { amount: 1, unit: "calendar_years", from: "discovery" },
      ],
      clocks: [
        { years: 7, from: "injury_date", effectiveFrom: "1977-07-01" },
        { years: 10, from: "substantial_completion", effectiveFrom: "1990-01-01" },
      ],
    },
  } as unknown as LimitationRule;

  it("asks once for each date a limb or repose clock needs", () => {
    const keys = guidedDateFields(clocksRule, "VT").map((f) => f.key);
    expect(keys).toEqual([
      "injuryDate",
      "actualDiscoveryDate",
      "constructiveDiscoveryDate",
      "substantialCompletionDate",
    ]);
  });

  it("describes every repose clock and counts as a repose rule", () => {
    expect(isAccrualReposeRule(clocksRule)).toBe(true);
    const label = reposeCapLabel(clocksRule)!;
    expect(label).toContain("7 calendar years from the date of injury");
    expect(label).toContain("10 calendar years from substantial completion");
  });

  it("labels a death-based accrual date as the date of death", () => {
    const rule = {
      claimType: "wrongful_death",
      accrualBasis: "death",
      calculation: {
        mode: "accrual_repose_min",
        reposeYears: 5,
        reposeTrigger: "act_or_omission",
        reposeEffectiveFrom: "1991-10-01",
      },
    } as unknown as LimitationRule;
    expect(guidedDateFields(rule, "CT")[0]?.label).toBe("Date of death");
  });
});

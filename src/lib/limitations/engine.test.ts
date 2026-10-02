import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { baselineRule, calculateBaseline, calendarAnniversary, parseCivilDate } from "./engine";
import type { BaselineInput, LimitationsSnapshot } from "./types";

const json = (name: string) =>
  JSON.parse(readFileSync(`public/data/limitations/${name}.json`, "utf8"));
const snapshot: LimitationsSnapshot = {
  ...json("rules"),
  sources: json("sources").sources,
  coverage: json("coverage").coverage,
  cases: json("case-references").cases,
};
const confirmed: BaselineInput = {
  jurisdiction: "IN",
  claimType: "personal_injury",
  accrualDate: "2024-03-01",
  governingLawConfirmed: true,
  accrualConfirmed: true,
  applicabilityConfirmed: true,
  exceptionReview: "no_unresolved_issues",
  issues: [],
};

describe("civil dates and conditional legal baselines", () => {
  it("rejects normalized impossible dates and does not invent a leap-day rule", () => {
    expect(parseCivilDate("2025-02-29")).toBeNull();
    expect(parseCivilDate("2024-02-29")).not.toBeNull();
    expect(parseCivilDate("2024-04-31")).toBeNull();
    expect(calendarAnniversary("2024-02-29", 2)).toBeNull();
    expect(calendarAnniversary("2024-02-29", 4)).toBe("2028-02-29");
  });
  it("uses calendar arithmetic across leap years instead of 365-day offsets", () => {
    const result = calculateBaseline(snapshot, confirmed);
    expect(result.status).toBe("baseline");
    expect(result.date).toBe("2026-03-01");
    expect(result.reasons.join(" ")).toContain("not a verified last day");
  });
  it("withholds dates for unconfirmed governing law, accrual or applicability", () => {
    for (const field of [
      "governingLawConfirmed",
      "accrualConfirmed",
      "applicabilityConfirmed",
    ] as const) {
      const result = calculateBaseline(snapshot, { ...confirmed, [field]: false });
      expect(result.status).toBe("needs_review");
      expect(result.date).toBeNull();
    }
  });
  it("withholds dates for unresolved product, tolling, prior-filing or foreign-law issues", () => {
    for (const issue of ["product_repose", "tolling", "prior_filing", "foreign_law"] as const) {
      expect(calculateBaseline(snapshot, { ...confirmed, issues: [issue] }).date).toBeNull();
    }
    expect(
      calculateBaseline(snapshot, { ...confirmed, exceptionReview: "unresolved" }).date,
    ).toBeNull();
  });
  it("does not convert a general injury rule into an unsupported product rule", () => {
    expect(
      calculateBaseline(snapshot, { ...confirmed, jurisdiction: "NJ", accrualDate: "" }).status,
    ).toBe("needs_review");
    expect(
      calculateBaseline(snapshot, {
        ...confirmed,
        jurisdiction: "HI",
        claimType: "product_liability",
      }).date,
    ).toBeNull();
    expect(calculateBaseline(snapshot, { ...confirmed, jurisdiction: "NJ" }).date).toBeNull();
    expect(calculateBaseline(snapshot, { ...confirmed, jurisdiction: "LA" }).date).toBeNull();
  });
  it("rejects future-law dates and non-state jurisdictions", () => {
    expect(
      calculateBaseline(snapshot, { ...confirmed, accrualDate: "2027-01-01" }).date,
    ).toBeNull();
    expect(calculateBaseline(snapshot, { ...confirmed, jurisdiction: "US" }).status).toBe(
      "invalid",
    );
  });
  it("does not select ambiguous baseline versions", () => {
    const rule = baselineRule(snapshot.rules, "IN", "personal_injury")!;
    expect(
      baselineRule(
        [...snapshot.rules, { ...rule, id: "another-version" }],
        "IN",
        "personal_injury",
      ),
    ).toBeNull();
  });
  it("allows the computed anniversary to exceed the source snapshot", () => {
    expect(
      calculateBaseline(snapshot, { ...confirmed, jurisdiction: "IL", accrualDate: "2026-09-01" })
        .date,
    ).toBe("2028-09-01");
  });
  it("OH toxic products require qualifying exposure inside the delivery window", () => {
    const input: BaselineInput = {
      ...confirmed,
      jurisdiction: "OH",
      claimType: "product_liability",
      subtype: "latent_toxic",
      actualDiscoveryDate: "2024-02-01",
      constructiveDiscoveryDate: "2024-01-10",
      firstProductDeliveryDate: "2008-01-01",
      qualifyingExposureDate: "2017-01-01",
    };
    expect(calculateBaseline(snapshot, input).date).toBe("2026-01-10");
    expect(
      calculateBaseline(snapshot, { ...input, qualifyingExposureDate: "2019-01-01" }).date,
    ).toBeNull();
    expect(
      calculateBaseline(snapshot, { ...input, qualifyingExposureDate: "2007-01-01" }).date,
    ).toBeNull();
    expect(calculateBaseline(snapshot, { ...input, firstProductDeliveryDate: "" }).date).toBeNull();
    expect(
      calculateBaseline(snapshot, {
        ...input,
        firstProductDeliveryDate: "2024-01-01",
        qualifyingExposureDate: "2024-02-02",
      }).date,
    ).toBeNull();
  });
  it("OH asbestos uses its distinct exception without requiring a ten-year exposure window", () => {
    const result = calculateBaseline(snapshot, {
      ...confirmed,
      jurisdiction: "OH",
      claimType: "product_liability",
      subtype: "asbestos",
      actualDiscoveryDate: "2024-02-01",
      constructiveDiscoveryDate: "2023-12-01",
    });
    expect(result.date).toBe("2025-12-01");
    expect(result.rule?.pinpoint).toContain("(C)(6)");
  });
  it("does not compute the OH veteran branch with unresolved referenced definitions", () => {
    expect(baselineRule(snapshot.rules, "OH", "product_liability", "agent_orange")).toBeNull();
    expect(
      snapshot.rules.find((r) => r.jurisdiction === "OH" && r.subtype === "agent_orange")?.validity,
    ).toContain("5903.21");
  });
  it("IA and KS harmful-material branches preserve different implant date definitions", () => {
    for (const jurisdiction of ["IA", "KS"]) {
      const result = calculateBaseline(snapshot, {
        ...confirmed,
        jurisdiction,
        claimType: "product_liability",
        subtype: "latent_toxic",
        actualDiscoveryDate: "2024-02-01",
        constructiveDiscoveryDate: "2024-01-01",
      });
      expect(result.date).toBe("2026-01-01");
      expect(result.rule?.conditions.join(" ")).toContain(
        jurisdiction === "IA" ? "July 12, 1992" : "July 1, 1992",
      );
    }
  });
  it("CA product discovery requires its primary judicial evidence", () => {
    const input: BaselineInput = {
      ...confirmed,
      jurisdiction: "CA",
      claimType: "product_liability",
      actualDiscoveryDate: "2025-02-01",
      constructiveDiscoveryDate: "2024-10-01",
    };
    expect(calculateBaseline(snapshot, input).date).toBe("2026-10-01");
    expect(calculateBaseline({ ...snapshot, cases: [] }, input).date).toBeNull();
  });
  it("NY latent injury selects the earlier actual/reasonable-discovery date, not cause discovery", () => {
    const result = calculateBaseline(snapshot, {
      ...confirmed,
      jurisdiction: "NY",
      claimType: "product_liability",
      subtype: "latent_toxic",
      accrualDate: "",
      actualDiscoveryDate: "2024-04-10",
      constructiveDiscoveryDate: "2023-01-15",
      causeDiscoveryDate: "2025-03-01",
    });
    expect(result.date).toBe("2026-01-15");
    expect(result.rule?.pinpoint).toContain("214-c");
    expect(result.steps[0]?.text).toContain("earlier");
  });
  it("NY and VA discovery branches require both legally relevant discovery dates", () => {
    for (const jurisdiction of ["NY", "VA"])
      expect(
        calculateBaseline(snapshot, {
          ...confirmed,
          jurisdiction,
          claimType: "product_liability",
          subtype: "latent_toxic",
          actualDiscoveryDate: "2024-01-01",
        }).date,
      ).toBeNull();
  });
  it("VA latent/asbestos death caps require a known living/deceased status and date", () => {
    const input = {
      ...confirmed,
      jurisdiction: "VA",
      claimType: "product_liability" as const,
      subtype: "asbestos",
      diagnosisCommunicationDate: "2024-01-15",
    };
    expect(calculateBaseline(snapshot, input).date).toBeNull();
    expect(calculateBaseline(snapshot, { ...input, vitalStatus: "deceased" }).date).toBeNull();
    expect(calculateBaseline(snapshot, { ...input, vitalStatus: "alive" }).date).toBe("2026-01-15");
    expect(
      calculateBaseline(snapshot, { ...input, vitalStatus: "alive", deathDate: "2025-01-01" }).date,
    ).toBeNull();
  });
  it("Maryland occupational death uses the earlier discovery period and ten-year death cap", () => {
    const result = calculateBaseline(snapshot, {
      ...confirmed,
      jurisdiction: "MD",
      claimType: "wrongful_death",
      subtype: "occupational_disease",
      deathDate: "2015-04-01",
      causeDiscoveryDate: "2024-04-01",
    });
    expect(result.date).toBe("2025-04-01");
    expect(result.steps.some((s) => s.text.includes("10-year"))).toBe(true);
    expect(
      calculateBaseline(snapshot, {
        ...confirmed,
        jurisdiction: "MD",
        claimType: "wrongful_death",
        subtype: "occupational_disease",
        deathDate: "2020-01-01",
        causeDiscoveryDate: "2019-01-01",
      }).date,
    ).toBeNull();
  });
});

describe("versioned legal evidence integrity", () => {
  it("keeps Florida product-injury and ordinary-negligence periods distinct", () => {
    const facts = { ...confirmed, jurisdiction: "FL", accrualDate: "2024-05-01" };
    const injury = calculateBaseline(snapshot, facts);
    const product = calculateBaseline(snapshot, { ...facts, claimType: "product_liability" });
    expect(injury.date).toBe("2026-05-01");
    expect(product.date).toBe("2028-05-01");
    expect(product.rule?.pinpoint).toContain("95.11(3)(d)");
    expect(
      calculateBaseline(snapshot, {
        ...facts,
        claimType: "product_liability",
        applicabilityConfirmed: false,
      }).date,
    ).toBeNull();
  });
  it("covers 50 states and DC without claiming complete legal review", () => {
    expect(snapshot.coverage).toHaveLength(51);
    expect(new Set(snapshot.coverage.map((c) => c.state)).size).toBe(51);
    expect(snapshot.coverage.every((c) => c.gaps.some((g) => g.includes("No comprehensive")))).toBe(
      true,
    );
    expect(snapshot.coverage.every((c) => c.publisherLinks.length > 0)).toBe(true);
  });
  it("judicial sources have checksums and rule links and exclude publisher summaries", () => {
    expect(new Set(snapshot.cases.map((c) => c.id)).size).toBe(snapshot.cases.length);
    for (const reference of snapshot.cases) {
      const bytes = readFileSync(`public${reference.textPath}`);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(reference.sha256);
      expect(bytes.byteLength).toBe(reference.byteLength);
      expect(bytes.byteLength).toBeGreaterThan(2000);
      expect(bytes.toString()).not.toContain("Some case metadata and case summaries");
      expect(reference.pdfDownloaded).toBe(false);
    }
    for (const rule of snapshot.rules)
      expect(
        (rule.caseReferenceIds ?? []).every((id) => snapshot.cases.some((c) => c.id === id)),
      ).toBe(true);
  });
  it("does not retain the unrelated WV provider response or wrong Alabama claim mapping", () => {
    const text = readFileSync("public/data/limitations/text/wv-55-2-12.txt", "utf8");
    expect(text).toContain("damages for personal injuries");
    expect(text).not.toContain("FBI");
    const rule = baselineRule(snapshot.rules, "AL", "personal_injury")!;
    expect(rule.pinpoint).toContain("6-2-38(l)");
    expect(rule.conditions.join(" ")).toContain("workers' compensation");
  });
  it("every rule links unique primary-source IDs with stored checksums and text", () => {
    expect(new Set(snapshot.rules.map((r) => r.id)).size).toBe(snapshot.rules.length);
    for (const source of snapshot.sources) {
      const bytes = readFileSync(`public${source.textPath}`);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.sha256);
      expect(bytes.byteLength).toBe(source.byteLength);
      expect(source.url).not.toMatch(/\.pdf(?:$|\?)/i);
      expect(bytes.byteLength).toBeLessThan(10_000_000);
    }
    for (const rule of snapshot.rules)
      expect(rule.sourceIds.every((id) => snapshot.sources.some((s) => s.id === id))).toBe(true);
  });
  it("constitutional and transition warnings remain non-computational", () => {
    expect(
      snapshot.rules
        .filter((r) => r.ruleKind === "validity" || r.ruleKind === "transition")
        .every((r) => r.computation === "research_only"),
    ).toBe(true);
    expect(
      snapshot.rules.some((r) => r.jurisdiction === "AZ" && r.validity.includes("Constitutional")),
    ).toBe(true);
    expect(
      snapshot.rules.some(
        (r) => r.jurisdiction === "PA" && r.validity.includes("Unconstitutional"),
      ),
    ).toBe(true);
  });
});

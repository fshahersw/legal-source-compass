import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  baselineRule,
  calculateBaseline,
  calendarAnniversary,
  parseCivilDate,
  sourceReviewDate,
} from "./engine";
import type { BaselineInput, LimitationsSnapshot } from "./types";

const bundleDir = process.env["LIM_BUNDLE_DIR"] ?? "private/data/limitations";
// Evidence paths in the snapshot are snapshot-namespace absolute paths; resolve them against the
// same bundle the rules were read from, so a staged bundle can be checked without a private/ tree.
const evidence = (textPath: string) =>
  readFileSync(`${bundleDir}/${textPath.replace(/^\/data\/limitations\//, "")}`);
const json = (name: string) =>
  JSON.parse(readFileSync(`${bundleDir}/${name}.json`, "utf8"));
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
  it("never answers a product claim with a rule for another claim type", () => {
    const withProductBaseline = new Set(
      snapshot.rules
        .filter(
          (r) =>
            r.claimType === "product_liability" && r.computation === "baseline_only" && !r.subtype,
        )
        .map((r) => r.jurisdiction),
    );
    const without = snapshot.coverage.map((c) => c.state).filter((s) => !withProductBaseline.has(s));
    expect(without.length).toBeGreaterThan(0);
    for (const jurisdiction of without)
      expect(
        calculateBaseline(snapshot, { ...confirmed, jurisdiction, claimType: "product_liability" })
          .date,
        jurisdiction,
      ).toBeNull();
    for (const row of snapshot.coverage) {
      const result = calculateBaseline(snapshot, {
        ...confirmed,
        jurisdiction: row.state,
        claimType: "product_liability",
      });
      if (result.date) expect(result.rule?.claimType, row.state).toBe("product_liability");
    }
    expect(
      calculateBaseline(snapshot, { ...confirmed, jurisdiction: "NJ", accrualDate: "" }).date,
    ).toBeNull();
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
  it("defensively withholds a baseline if its linked authorities contain no statute", () => {
    const rule = snapshot.rules.find(
      (item) => item.jurisdiction === "IN" && item.computation === "baseline_only",
    )!;
    const guidance = {
      ...snapshot.sources.find((source) => source.id === rule.sourceIds[0])!,
      id: "engine-only-guidance",
      authorityKind: "publisher_guidance" as const,
      verifiedAt: "2026-10-05",
    };
    const untrusted: LimitationsSnapshot = {
      ...snapshot,
      rules: snapshot.rules.map((item) =>
        item.id === rule.id ? { ...item, sourceIds: [guidance.id] } : item,
      ),
      sources: [...snapshot.sources, guidance],
    };
    const untrustedRule = untrusted.rules.find((item) => item.id === rule.id)!;
    expect(sourceReviewDate(untrusted, untrustedRule)).toBeNull();
    const result = calculateBaseline(untrusted, { ...confirmed, jurisdiction: "IN" });
    expect(result.status).toBe("needs_review");
    expect(result.date).toBeNull();
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
  it("CA product discovery runs from the earlier discovery date and fails closed without its statute", () => {
    const input: BaselineInput = {
      ...confirmed,
      jurisdiction: "CA",
      claimType: "product_liability",
      actualDiscoveryDate: "2025-02-01",
      constructiveDiscoveryDate: "2024-10-01",
    };
    const result = calculateBaseline(snapshot, input);
    expect(result.date).toBe("2026-10-01");
    // The delayed-discovery basis is judicial; the rule must say so rather than present it as statutory text.
    expect(result.rule?.conditions.join(" ")).toMatch(/delayed-discovery|Fox v\. Ethicon/);
    const statuteIds = new Set(
      snapshot.sources
        .filter((s) => result.rule!.sourceIds.includes(s.id) && s.authorityKind === "statute")
        .map((s) => s.id),
    );
    expect(statuteIds.size).toBeGreaterThan(0);
    expect(
      calculateBaseline(
        { ...snapshot, sources: snapshot.sources.filter((s) => !statuteIds.has(s.id)) },
        input,
      ).date,
    ).toBeNull();
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
  it("applies Florida's two-year amendment only to causes of action accruing after March 24, 2023", () => {
    // Ch. 2023-15, § 28: the amendments apply to causes of action accruing after the effective date
    // (March 24, 2023). The general rule therefore starts on March 25; earlier accruals are withheld
    // under it and routed, by exact window match, to the captured prior four-year version.
    for (const accrualDate of ["2020-01-01", "2023-03-23", "2023-03-24"]) {
      const result = calculateBaseline(snapshot, { ...confirmed, jurisdiction: "FL", accrualDate });
      expect(result.date, accrualDate).toBeNull();
      expect(result.suggestedSubtype, accrualDate).toBe("accrued_through_2023_03_24");
      expect(result.reasons.join(" ")).toContain("on or before 2023-03-24");
      const prior = calculateBaseline(snapshot, {
        ...confirmed,
        jurisdiction: "FL",
        accrualDate,
        subtype: result.suggestedSubtype!,
      });
      expect(prior.date, accrualDate).toBe(accrualDate.replace(/^\d{4}/, (y) => String(+y + 4)));
    }
    const current = calculateBaseline(snapshot, {
      ...confirmed,
      jurisdiction: "FL",
      accrualDate: "2023-03-25",
    });
    expect(current.date).toBe("2025-03-25");
    expect(current.suggestedSubtype ?? null).toBeNull();
    // The prior version never reaches past its window, and points back to the current rule.
    const late = calculateBaseline(snapshot, {
      ...confirmed,
      jurisdiction: "FL",
      accrualDate: "2023-03-25",
      subtype: "accrued_through_2023_03_24",
    });
    expect(late.date).toBeNull();
    expect(late.suggestedSubtype).toBe("general");
  });
  it("withholds Maine's newer wrongful-death period when the earlier death needs transition review", () => {
    expect(
      calculateBaseline(snapshot, {
        ...confirmed,
        jurisdiction: "ME",
        claimType: "wrongful_death",
        accrualDate: "2023-10-24",
      }).date,
    ).toBeNull();
    expect(
      calculateBaseline(snapshot, {
        ...confirmed,
        jurisdiction: "ME",
        claimType: "wrongful_death",
        accrualDate: "2023-10-25",
      }).date,
    ).toBe("2026-10-25");
  });
  it("does not treat a new bundle date as a fresh review of every underlying source", () => {
    expect(
      calculateBaseline(
        { ...snapshot, snapshotDate: "2026-10-10" },
        { ...confirmed, accrualDate: "2026-10-09" },
      ).date,
    ).toBeNull();
  });
  it("fails closed for unsupported computation modes and missing source review dates", () => {
    const copy = structuredClone(snapshot);
    const rule = baselineRule(copy.rules, "IN", "personal_injury")!;
    rule.calculation = { mode: "unsupported" as never };
    expect(calculateBaseline(copy, confirmed).date).toBeNull();
    delete rule.calculation;
    copy.sources.find((s) => s.id === rule.sourceIds[0])!.verifiedAt = "";
    expect(calculateBaseline(copy, confirmed).date).toBeNull();
  });
  it("requires actual boolean confirmations, not truthy strings", () => {
    expect(
      calculateBaseline(snapshot, { ...confirmed, applicabilityConfirmed: "false" as never }).date,
    ).toBeNull();
  });
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
    expect(snapshot.coverage.every((c) => c.gaps.length > 0)).toBe(true);
    expect(
      snapshot.coverage.some((c) => c.gaps.some((g) => /complete|comprehensive/i.test(g))),
    ).toBe(true);
    expect(snapshot.coverage.every((c) => c.publisherLinks.length > 0)).toBe(true);
  });
  it("judicial sources have checksums and rule links and exclude publisher summaries", () => {
    expect(new Set(snapshot.cases.map((c) => c.id)).size).toBe(snapshot.cases.length);
    for (const reference of snapshot.cases) {
      const bytes = evidence(reference.textPath);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(reference.sha256);
      expect(bytes.byteLength).toBe(reference.byteLength);
      expect(bytes.byteLength).toBeGreaterThan(
        reference.textScope?.startsWith("Selected") ? 1000 : 2000,
      );
      expect(bytes.toString()).not.toContain("Some case metadata and case summaries");
      expect(typeof reference.pdfDownloaded).toBe("boolean");
      if (reference.pdfDownloaded) {
        expect(reference.officialPdfUrl).toMatch(/^https:\/\//);
        expect(reference.rawCapture?.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(reference.rawCapture?.contentType).toContain("application/pdf");
      }
    }
    for (const rule of snapshot.rules)
      expect(
        (rule.caseReferenceIds ?? []).every((id) => snapshot.cases.some((c) => c.id === id)),
      ).toBe(true);
  });
  it("does not retain the unrelated WV provider response or wrong Alabama claim mapping", () => {
    const text = readFileSync(`${bundleDir}/text/wv-55-2-12.txt`, "utf8");
    expect(text).toContain("damages for personal injuries");
    expect(text).not.toContain("FBI");
    const rule = baselineRule(snapshot.rules, "AL", "personal_injury")!;
    expect(rule.pinpoint).toContain("6-2-38(l)");
    expect(rule.period).toEqual({ amount: 2, unit: "calendar_years" });
    // Wrongful death is its own two-year rule under § 6-5-410, never the § 6-2-38(l) injury rule.
    expect(baselineRule(snapshot.rules, "AL", "wrongful_death")?.pinpoint).toContain("6-5-410");
  });
  it("every rule links unique primary-source IDs with stored checksums and text", () => {
    expect(new Set(snapshot.rules.map((r) => r.id)).size).toBe(snapshot.rules.length);
    for (const source of snapshot.sources) {
      const bytes = evidence(source.textPath);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.sha256);
      expect(bytes.byteLength).toBe(source.byteLength);
      expect(new URL(source.url).protocol).toBe("https:");
      if (/\.pdf(?:$|\?)/i.test(source.url)) {
        // A PDF fetched directly must be retained as PDF bytes; text obtained through an extraction
        // intermediary must say so in its method and still retain a hashed raw response.
        const viaIntermediary = /intermediar/i.test(source.method);
        if (!viaIntermediary)
          expect(source.rawCapture?.contentType, source.id).toContain("application/pdf");
        expect(source.rawCapture?.sha256, source.id).toMatch(/^[a-f0-9]{64}$/);
      }
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

  it("keeps ordinary injury, death and product periods distinct in the expanded state coverage", () => {
    // Product periods: DC § 12-301(8) residual 3 years; Mo. § 516.120(4) 5 years; Utah § 78B-6-706 runs 2
    // years from discovery of harm and cause (so an accrual date alone cannot compute it); Nebraska and
    // Wyoming product claims stay research-only.
    for (const [state, injuryYears, deathYears, productYears] of [
      ["DC", 3, 2, 3],
      ["MO", 5, 3, 5],
      ["NE", 4, 2, null],
      ["UT", 4, 2, null],
      ["WY", 4, 2, null],
    ] as const) {
      for (const [claimType, years] of [
        ["personal_injury", injuryYears],
        ["wrongful_death", deathYears],
      ] as const) {
        const result = calculateBaseline(snapshot, {
          ...confirmed,
          jurisdiction: state,
          claimType,
        });
        expect(result.status, `${state}/${claimType}`).toBe("baseline");
        expect(result.date).toBe(`${2024 + years}-03-01`);
      }
      const product = calculateBaseline(snapshot, {
        ...confirmed,
        jurisdiction: state,
        claimType: "product_liability",
      });
      expect(product.date, `${state}/product`).toBe(
        productYears === null ? null : `${2024 + productYears}-03-01`,
      );
    }
    const utah = calculateBaseline(snapshot, {
      ...confirmed,
      jurisdiction: "UT",
      claimType: "product_liability",
      accrualDate: "",
      actualDiscoveryDate: "2024-06-01",
      constructiveDiscoveryDate: "2024-03-01",
    });
    expect(utah.date).toBe("2026-03-01");
    expect(utah.steps[0]?.text).toContain("discovery");
  });

  it("applies both limbs and the outer cap of multi-limb medical-malpractice statutes", () => {
    const medmal = {
      ...confirmed,
      claimType: "medical_malpractice" as const,
      accrualDate: "",
      actualDiscoveryDate: "2024-06-01",
      constructiveDiscoveryDate: "2024-06-01",
      reposeApplicabilityConfirmed: true,
    };
    // The outer limit is never applied until the user confirms it applies to this claim and defendant.
    expect(
      calculateBaseline(snapshot, {
        ...medmal,
        jurisdiction: "MT",
        injuryDate: "2020-04-01",
        reposeApplicabilityConfirmed: false,
      }).date,
    ).toBeNull();
    // NRS 41A.097(3): earlier of 3 years from injury and 2 years from discovery; window on the injury date.
    expect(
      calculateBaseline(snapshot, { ...medmal, jurisdiction: "NV", injuryDate: "2024-01-10" }).date,
    ).toBe("2026-06-01");
    expect(
      calculateBaseline(snapshot, {
        ...medmal,
        jurisdiction: "NV",
        injuryDate: "2024-01-10",
        actualDiscoveryDate: "2026-06-01",
        constructiveDiscoveryDate: "2026-06-01",
      }).date,
    ).toBe("2027-01-10");
    expect(
      calculateBaseline(snapshot, { ...medmal, jurisdiction: "NV", injuryDate: "2023-09-30" }).date,
    ).toBeNull();
    // Md. CJP § 5-109(a): earlier of 5 years from injury and 3 years from discovery.
    expect(
      calculateBaseline(snapshot, { ...medmal, jurisdiction: "MD", injuryDate: "2020-04-01" }).date,
    ).toBe("2025-04-01");
    // Mont. § 27-2-205(1): later of the two-year limbs, never more than 5 years from injury.
    expect(
      calculateBaseline(snapshot, { ...medmal, jurisdiction: "MT", injuryDate: "2020-04-01" }).date,
    ).toBe("2025-04-01");
    // W. Va. § 55-7B-4(a): later of the two-year limbs, never more than 10 years from injury.
    expect(
      calculateBaseline(snapshot, { ...medmal, jurisdiction: "WV", injuryDate: "2015-04-01" }).date,
    ).toBe("2025-04-01");
    // Fla. § 95.11(5)(c): later of 2 years from the incident and 2 years from discovery, capped 4 years.
    const florida = calculateBaseline(snapshot, {
      ...medmal,
      jurisdiction: "FL",
      reposeActDate: "2022-01-10",
    });
    expect(florida.date).toBe("2026-01-10");
    expect(florida.reasons.join(" ")).toContain("does not print the date the outer limit took effect");
    // 735 ILCS 5/13-212(a): 2 years from knowledge, never more than 4 years after the act.
    expect(
      calculateBaseline(snapshot, {
        ...medmal,
        jurisdiction: "IL",
        reposeActDate: "2021-05-01",
        actualDiscoveryDate: "2024-01-01",
        constructiveDiscoveryDate: "2024-01-01",
      }).date,
    ).toBe("2025-05-01");
    // Every applied correction stays on the rule with its evidence.
    for (const id of [
      "nv-medical-malpractice-general-bf20261007",
      "md-medical-malpractice-general-bf20261007",
      "fl-personal_injury-general-review-20261002",
    ]) {
      const rule = snapshot.rules.find((r) => r.id === id)!;
      expect(rule.corrections?.length, id).toBeGreaterThan(0);
      for (const c of rule.corrections!) expect(rule.sourceIds).toContain(c.evidenceSourceId);
    }
  });

  it("withholds Kentucky historical dates and Louisiana's transition boundary", () => {
    // The captured KRS 413.140 is the version effective July 15, 2026; no earlier version was captured,
    // so earlier accrual dates are withheld and no sibling version is suggested.
    const kyEarly = calculateBaseline(snapshot, {
      ...confirmed,
      jurisdiction: "KY",
      accrualDate: "2026-07-14",
    });
    expect(kyEarly.date).toBeNull();
    expect(kyEarly.suggestedSubtype ?? null).toBeNull();
    expect(
      calculateBaseline(snapshot, { ...confirmed, jurisdiction: "KY", accrualDate: "2026-07-15" })
        .date,
    ).toBe("2027-07-15");
    expect(baselineRule(snapshot.rules, "KY", "personal_injury")!.exclusions.join(" ")).toContain(
      "304.39-230",
    );
    // Acts 2024, No. 423, § 2: prospective only, applying to actions arising after July 1, 2024.
    // July 1 itself stays under the one-year prior law; July 2 is the first day of the two-year rule.
    const laBoundary = calculateBaseline(snapshot, {
      ...confirmed,
      jurisdiction: "LA",
      accrualDate: "2024-07-01",
    });
    expect(laBoundary.date).toBeNull();
    expect(laBoundary.suggestedSubtype).toBe("pre_2024_07_01");
    expect(
      calculateBaseline(snapshot, {
        ...confirmed,
        jurisdiction: "LA",
        accrualDate: "2024-07-01",
        subtype: "pre_2024_07_01",
      }).date,
    ).toBe("2025-07-01");
    expect(
      calculateBaseline(snapshot, { ...confirmed, jurisdiction: "LA", accrualDate: "2024-07-02" })
        .date,
    ).toBe("2026-07-02");
    expect(
      calculateBaseline(snapshot, {
        ...confirmed,
        jurisdiction: "LA",
        claimType: "wrongful_death",
        accrualDate: "2026-01-01",
      }).date,
    ).toBeNull();
  });

  it("does not calculate through unresolved Wyoming representative tolling", () => {
    const rule = baselineRule(snapshot.rules, "WY", "wrongful_death")!;
    expect(rule.conditions.join(" ")).toContain("1-38-103(b)(ii)");
    expect(
      calculateBaseline(snapshot, {
        ...confirmed,
        jurisdiction: "WY",
        claimType: "wrongful_death",
        issues: ["tolling"],
      }).date,
    ).toBeNull();
    expect(
      calculateBaseline(snapshot, {
        ...confirmed,
        jurisdiction: "WY",
        claimType: "wrongful_death",
        exceptionReview: "unresolved",
      }).date,
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { LimitationRule, LimitationsSnapshot } from "@/lib/limitations/types";
import { NOT_RECORDED, ruleAuthorityFacts } from "./ruleAuthority";

const snapshot = {
  sources: [
    {
      id: "s1",
      title: "Tex. Civ. Prac. & Rem. Code § 16.003",
      url: "https://statutes.capitol.texas.gov/x",
      capturedAt: "2026-10-06T01:02:03.000Z",
      authorityKind: "statute",
    },
  ],
} as unknown as LimitationsSnapshot;

const base = {
  pinpoint: "Cal. Code Civ. Proc. § 335.1",
  effectiveFrom: null,
  sourceIds: ["s1", "missing"],
} as unknown as LimitationRule;

describe("rule authority facts", () => {
  it("reports Not recorded for legacy rules instead of inventing values", () => {
    const facts = ruleAuthorityFacts(snapshot, base);
    expect(facts.citation).toBe("Cal. Code Civ. Proc. § 335.1");
    expect(facts.effective).toBe(NOT_RECORDED);
    expect(facts.lastAmended).toBe(NOT_RECORDED);
    expect(facts.retrieved).toBe("2026-10-06");
    expect(facts.sources).toHaveLength(1);
    expect(facts.entryStatus).toBe("legacy");
    expect(facts.excerpt).toBeNull();
  });

  it("surfaces citation, effective date, retrieval date and caveats from provenance", () => {
    const rule = {
      ...base,
      provenance: {
        citation: "Tex. Civ. Prac. & Rem. Code § 16.003(a)",
        excerpt: "not later than two years",
        accrualKind: "accrual",
        accrualText: "Runs from the day the cause of action accrues",
        tolling: [{ text: "minority", citation: "§ 16.001" }],
        repose: [
          { years: 15, citation: "§ 16.012", trigger: "date of sale", effectiveFrom: "2003-09-01" },
        ],
        lastAmended: { text: "Acts 1997, ch. 26", date: "1997-05-01" },
        effectiveDate: "1997-05-01",
        retrievedAt: "2026-10-05T10:00:00.000Z",
        entryStatus: "flagged",
        confidence: "medium",
        confidenceNote: "seeded capture",
        flags: ["tolling sections not captured"],
      },
    } as unknown as LimitationRule;
    const facts = ruleAuthorityFacts(snapshot, rule);
    expect(facts.citation).toContain("§ 16.003(a)");
    expect(facts.effective).toBe("1997-05-01");
    expect(facts.lastAmended).toBe("1997-05-01 (Acts 1997, ch. 26)");
    expect(facts.retrieved).toBe("2026-10-05");
    expect(facts.tolling).toEqual(["minority (§ 16.001)"]);
    expect(facts.repose[0]).toContain("15 years from date of sale");
    expect(facts.confidence).toBe("medium: seeded capture");
    expect(facts.entryStatus).toBe("flagged");
  });

  it("records when a source was fetched through a proxy", () => {
    const proxied = {
      sources: [
        {
          id: "s1",
          title: "t",
          url: "https://www.palegis.us/x",
          capturedAt: "2026-10-06T01:02:03.000Z",
          authorityKind: "statute",
          fetchRoute: { kind: "proxied", proxy: "firecrawl" },
        },
      ],
    } as unknown as LimitationsSnapshot;
    const facts = ruleAuthorityFacts(proxied, base);
    expect(facts.sources[0]?.route).toContain("firecrawl proxy");
    expect(ruleAuthorityFacts(snapshot, base).sources[0]?.route).toBeNull();
  });

  it("shows the verification grade and its basis beside the citation", () => {
    const graded = {
      ...base,
      verification: { grade: "lower_evidence_grade", basis: "Read through a cached route." },
    } as unknown as LimitationRule;
    const facts = ruleAuthorityFacts(snapshot, graded);
    expect(facts.grade).toBe("Lower evidence grade");
    expect(facts.gradeBasis).toBe("Read through a cached route.");
    expect(ruleAuthorityFacts(snapshot, base).grade).toBe("Verification grade not recorded");
  });

  it("shows Not recorded for an accrual rule the source did not state", () => {
    const rule = {
      ...base,
      provenance: {
        citation: "x",
        excerpt: "e",
        accrualKind: "not_recorded",
        accrualText: "Not recorded",
        tolling: [],
        repose: [],
        lastAmended: { text: "Not recorded", date: null },
        effectiveDate: null,
        retrievedAt: "2026-10-06T00:00:00.000Z",
        entryStatus: "verified",
        confidence: "low",
        confidenceNote: "n",
        flags: [],
      },
    } as unknown as LimitationRule;
    expect(ruleAuthorityFacts(snapshot, rule).accrual).toBe(NOT_RECORDED);
  });
});

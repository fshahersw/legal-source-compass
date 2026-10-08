import { describe, expect, it } from "vitest";
import type { LimitationRule, LimitationsSnapshot } from "@/lib/limitations/types";
import { NOT_RECORDED, ruleAuthorityFacts, sectionLabel } from "./ruleAuthority";

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
    expect(facts.accrualLabel).toBe("Accrual");
    expect(facts.history).toEqual([]);
    const repose = { ...rule, ruleKind: "repose" } as unknown as LimitationRule;
    expect(ruleAuthorityFacts(snapshot, repose).accrualLabel).toBe("Period runs from");
    const other = {
      ...rule,
      provenance: { ...(rule.provenance as object), accrualKind: "other" },
    } as unknown as LimitationRule;
    expect(ruleAuthorityFacts(snapshot, other).accrualLabel).toBe("Period runs from");
  });

  it("pairs each tolling and repose note with its section link and says what the term check does not prove", () => {
    const rule = {
      ...base,
      jurisdiction: "TX",
      provenance: {
        citation: "Tex. Civ. Prac. & Rem. Code § 16.003(a)",
        excerpt: "not later than two years",
        accrualKind: "accrual",
        accrualText: "Runs from accrual",
        tolling: [
          { text: "Under 18 at accrual: disability tolls", citation: "§ 16.001" },
          { text: "Absence from the state is not counted", citation: "§ 16.063" },
          { text: "Savings: one year after dismissal", citation: "§ 16.064" },
        ],
        repose: [{ years: 15, citation: "§ 16.012", trigger: "date of sale", effectiveFrom: "2003-09-01" }],
        lastAmended: { text: "Acts 1997", date: "1997-05-01" },
        effectiveDate: "1997-05-01",
        retrievedAt: "2026-10-05T10:00:00.000Z",
        entryStatus: "verified",
        confidence: "high",
        confidenceNote: "direct capture",
        flags: [],
      },
      crossReferenceLinks: [
        {
          kind: "tolling",
          index: 0,
          citation: "§ 16.001",
          checkedAt: "2026-10-08T16:00:00.000Z",
          sectionsNamed: 1,
          sections: [{ nativeId: "TX:CP:16.001", textSha256: "a".repeat(64) }],
          termCheck: "all_present",
          terms: [{ term: "age 18", found: true }],
          intakeRunId: "run-1",
        },
        {
          kind: "tolling",
          index: 1,
          citation: "§ 16.063",
          checkedAt: "2026-10-08T16:00:00.000Z",
          sectionsNamed: 1,
          sections: [{ nativeId: "TX:CP:16.063", textSha256: "b".repeat(64) }],
          termCheck: "none_to_check",
          terms: [],
          intakeRunId: "run-1",
        },
        {
          kind: "tolling",
          index: 2,
          citation: "§ 16.064",
          checkedAt: "2026-10-08T16:00:00.000Z",
          sectionsNamed: 1,
          sections: [{ nativeId: "TX:CP:16.064", textSha256: "c".repeat(64) }],
          termCheck: "not_all_present",
          terms: [{ term: "1 year", found: false }],
          intakeRunId: "run-1",
        },
      ],
    } as unknown as LimitationRule;
    const facts = ruleAuthorityFacts(snapshot, rule);
    expect(facts.tollingLinks).toHaveLength(3);
    expect(facts.reposeLinks).toEqual([null]);
    expect(facts.tollingLinks[0]?.sectionIds).toEqual(["TX:CP:16.001"]);
    expect(facts.tollingLinks[0]?.label).toBe("section text held · periods printed there");
    expect(facts.tollingLinks[0]?.detail).toContain("age 18");
    expect(facts.tollingLinks[0]?.detail).toContain("not its reading of the statute");
    expect(facts.tollingLinks[1]?.label).toBe("section text held");
    expect(facts.tollingLinks[1]?.detail).toContain("no period or age that could be checked");
    expect(facts.tollingLinks[2]?.label).toContain("compare before relying on this note");
    expect(facts.tollingLinks[2]?.detail).toContain("1 year");
    expect(facts.tollingLinks[2]?.detail).toContain("The note was not changed");
    const partial = {
      ...rule,
      crossReferenceLinks: [{ ...(rule.crossReferenceLinks as { sectionsNamed: number }[])[1], sectionsNamed: 3 }],
    } as unknown as LimitationRule;
    expect(ruleAuthorityFacts(snapshot, partial).tollingLinks[1]?.detail).toContain("1 of the 3 sections it names");
    // The note text shown to users is untouched by a link.
    expect(facts.tolling[2]).toBe("Savings: one year after dismissal (§ 16.064)");
  });

  it("labels a linked section by the number a reader expects, whatever the publisher's id shape", () => {
    expect(sectionLabel("TX:CP:16.001")).toBe("§ 16.001");
    expect(sectionLabel("PA:42:5524")).toBe("§ 5524");
    expect(sectionLabel("ME:Title 14/Part 2/Chapter 205/§853")).toBe("§ 853");
    expect(sectionLabel("CT:2025/title_52/chap_926/sec_52-577")).toBe("§ 52-577");
    expect(sectionLabel("VT:14/071/01492")).toBe("§ 1492");
    expect(sectionLabel("UT:C78B-3-S416_2025090120250507")).toBe("§ 78B-3-416");
    expect(sectionLabel("DE:10-81-8119")).toBe("§ 8119");
    expect(sectionLabel("ND:28-01.3-08")).toBe("§ 28-01.3-08");
    expect(sectionLabel("IL:735 ILCS 5/13-213")).toBe("735 ILCS 5/13-213");
    expect(sectionLabel("LA:3463")).toBe("art. 3463");
    expect(sectionLabel("LA:40:1231.8")).toBe("R.S. 40:1231.8");
    expect(sectionLabel("AK:09.10.070")).toBe("§ 09.10.070");
  });

  it("lists ledgered corrections and later-attached evidence as change history, oldest first", () => {
    const rule = {
      ...base,
      corrections: [
        {
          appliedInVersion: "2026-10-08.1",
          field: "period",
          from: { amount: 3, unit: "years" },
          to: { amount: 2, unit: "years" },
          reason: "the statute states two years",
          evidenceSourceId: "s1",
          evidenceQuote: "not later than two years",
        },
      ],
      evidenceAttachment: {
        appliedInVersion: "2026-10-08.5",
        reason: "released before quoted text was recorded",
        evidenceSourceId: "missing",
      },
    } as unknown as LimitationRule;
    const { history } = ruleAuthorityFacts(snapshot, rule);
    expect(history).toHaveLength(2);
    expect(history[0]).toContain('Release 2026-10-08.1: period changed from {"amount":3,"unit":"years"} to {"amount":2,"unit":"years"}');
    expect(history[0]).toContain("Tex. Civ. Prac. & Rem. Code § 16.003");
    expect(history[1]).toContain("Release 2026-10-08.5");
    expect(history[1]).toContain("period, dates and calculation were not changed");
    expect(history[1]).toContain("missing");
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
    expect(ruleAuthorityFacts(snapshot, base).sources[0]?.route).toBe("Not recorded");
    const freeText = {
      sources: [{ ...proxied.sources[0], fetchRoute: undefined, method: "Tavily advanced HTML extraction" }],
    } as unknown as LimitationsSnapshot;
    expect(ruleAuthorityFacts(freeText, base).sources[0]?.route).toBe(
      "Capture method as recorded: Tavily advanced HTML extraction",
    );
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

describe("currency facts", () => {
  it("reads Not re-read when no recheck is recorded", async () => {
    const { ruleCurrencyFacts, sourceCurrencyFacts } = await import("./ruleAuthority");
    expect(sourceCurrencyFacts(undefined).label).toBe("Not re-read");
    expect(sourceCurrencyFacts(undefined).tone).toBe("unknown");
    expect(ruleCurrencyFacts(undefined).tone).toBe("unknown");
    expect(ruleCurrencyFacts(undefined).checked).toBe(NOT_RECORDED);
  });

  it("names the full-code capture route and its sections without claiming the page was compared", async () => {
    const { sourceCurrencyFacts } = await import("./ruleAuthority");
    const facts = sourceCurrencyFacts({
      checkedAt: "2026-10-08T04:49:12.001Z",
      status: "confirmed_evidence_intact",
      route: "official_code_capture",
      detail: "matched against the publisher's current text",
      codeCapture: {
        jurisdiction: "NY",
        publisher: "New York State Senate",
        runId: "run-1",
        manifestSha256: null,
        landedAt: "2026-10-08T00:11:09.612Z",
        sectionNativeIds: ["NY:CVP/214"],
        sourceUrls: ["https://www.nysenate.gov/legislation/laws/CVP/214"],
      },
    });
    expect(facts.label).toBe("Quoted passages found in current code text · 2026-10-08");
    expect(facts.tone).toBe("ok");
    expect(facts.codeSections).toEqual(["NY:CVP/214"]);
    expect(facts.freshTextPath).toBeNull();
  });

  it("keeps a direct page verdict and appends the passage-level proxy comparison beside it", async () => {
    const { sourceCurrencyFacts } = await import("./ruleAuthority");
    const facts = sourceCurrencyFacts({
      checkedAt: "2026-10-08T02:41:14.000Z",
      status: "confirmed_evidence_intact",
      route: "direct",
      detail: "Fresh official copy differs; no rule quoted this source then.",
      passageRecheck: {
        checkedAt: "2026-10-08T13:20:00.000Z",
        route: "proxied",
        proxy: "tavily",
        rawSha256: "1cad99be369839b9cc1f4fcca7019f03c21025e37afc10ff1ffc788bc50dae36",
        rawStorageKey:
          "limitations-raw-captures/sha256/1c/1cad99be369839b9cc1f4fcca7019f03c21025e37afc10ff1ffc788bc50dae36.bin",
        freshTextPath: "/data/limitations/text/nd-ch28-01.proxied-2026-10-08.txt",
        passages: 22,
        detail: "22 quoted passages present in the proxy's extracted text; response retained.",
      },
    });
    expect(facts.label).toBe("Page changed; quoted passages intact · 2026-10-08");
    expect(facts.detail).toBe(
      "Fresh official copy differs; no rule quoted this source then. 22 quoted passages present in the proxy's extracted text; response retained.",
    );
    expect(facts.freshTextPath).toBe("/data/limitations/text/nd-ch28-01.proxied-2026-10-08.txt");
  });

  it("marks lost evidence and rolls a rule up to its own status", async () => {
    const { ruleCurrencyFacts, sourceCurrencyFacts } = await import("./ruleAuthority");
    expect(
      sourceCurrencyFacts({
        checkedAt: "2026-10-08T00:00:00.000Z",
        status: "evidence_lost",
        route: "direct",
        detail: "gone",
        freshTextPath: "/data/limitations/text/x.rechecked-2026-10-08.txt",
      }),
    ).toMatchObject({ tone: "lost", freshTextPath: "/data/limitations/text/x.rechecked-2026-10-08.txt" });
    expect(
      ruleCurrencyFacts({
        checkedAt: "2026-10-08T00:00:00.000Z",
        status: "partially_confirmed",
        detail: "d",
        confirmedSourceIds: ["a"],
        uncheckedSourceIds: ["b"],
        lostSourceIds: [],
      }),
    ).toMatchObject({ tone: "partial", label: "Quoted text confirmed in part; see detail · 2026-10-08" });
  });
});

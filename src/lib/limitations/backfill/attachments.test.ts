import { describe, expect, it } from "vitest";
import type { LimitationRule } from "../types";
import { applyEvidenceAttachments, type EvidenceAttachmentInput } from "./attachments";

const TEXT =
  "§ 8.01-243. Personal action for injury to person or property generally. A. Unless otherwise provided in this section, every action for personal injuries, whatever the theory of recovery, shall be brought within two years after the cause of action accrues.";

const rule = (over: Partial<LimitationRule> = {}): LimitationRule =>
  ({
    id: "va-personal_injury-general-20261002",
    schemaVersion: "limitations/1",
    ruleVersion: "2026-10-02.1",
    jurisdiction: "VA",
    claimType: "personal_injury",
    ruleKind: "limitations",
    computation: "baseline_only",
    reviewStatus: "statutory_text_verified",
    period: { amount: 2, unit: "calendar_years" },
    sourceIds: ["va-8-01-243"],
    pinpoint: "Va. Code § 8.01-243(A)",
    scope: "Personal injury",
    accrualBasis: "confirmed_accrual",
    conditions: [],
    exclusions: [],
    effectiveFrom: null,
    effectiveThrough: null,
    validity: "",
    historicalApplicability: "",
    summary: "",
    warnings: [],
    ...over,
  }) as LimitationRule;

const ledgerEntry = (over: Partial<EvidenceAttachmentInput> = {}): EvidenceAttachmentInput => ({
  ruleId: "va-personal_injury-general-20261002",
  evidenceSourceId: "va-8-01-243",
  citation: "Va. Code § 8.01-243(A)",
  excerpt:
    "every action for personal injuries, whatever the theory of recovery, shall be brought within two years after the cause of action accrues",
  periodEvidence: "within two years after the cause of action accrues",
  accrualKind: "accrual",
  accrualText: "after the cause of action accrues",
  confidence: "high",
  confidenceNote: "Quoted from the retained official text.",
  reason: "Rule released before provenance was recorded.",
  ...over,
});

const io = {
  ruleVersion: "2026-10-08.5",
  hasSource: (id: string) => id === "va-8-01-243",
  textOf: (id: string) => (id === "va-8-01-243" ? TEXT : ""),
  retrievedAtOf: (id: string) => (id === "va-8-01-243" ? "2026-10-02T12:00:00.000Z" : null),
};

describe("applyEvidenceAttachments", () => {
  it("attaches literal provenance without touching the period, dates or computation", () => {
    const r = rule();
    const out = applyEvidenceAttachments([r], [ledgerEntry()], io);
    expect(out).toEqual([
      { ruleId: r.id, status: "applied", evidenceSourceId: "va-8-01-243" },
    ]);
    expect(r.period).toEqual({ amount: 2, unit: "calendar_years" });
    expect(r.computation).toBe("baseline_only");
    expect(r.provenance?.excerpt).toContain("within two years");
    expect(r.provenance?.entryStatus).toBe("verified");
    expect(r.provenance?.retrievedAt).toBe("2026-10-02T12:00:00.000Z");
    expect(r.evidenceAttachment).toEqual({
      appliedInVersion: "2026-10-08.5",
      reason: "Rule released before provenance was recorded.",
      evidenceSourceId: "va-8-01-243",
    });
    expect(r.ruleVersion).toBe("2026-10-08.5");
  });

  it("rejects a quote that is not a literal passage of the stored text", () => {
    const r = rule();
    const out = applyEvidenceAttachments(
      [r],
      [ledgerEntry({ excerpt: "shall be brought within three years after the cause of action accrues", periodEvidence: "within three years" })],
      io,
    );
    expect(out[0]).toMatchObject({ status: "rejected", reason: expect.stringContaining("not a literal passage") });
    expect(r.provenance).toBeUndefined();
  });

  it("rejects period words that do not state the rule's own period", () => {
    const r = rule({ period: { amount: 5, unit: "calendar_years" } });
    const out = applyEvidenceAttachments([r], [ledgerEntry()], io);
    expect(out[0]).toMatchObject({ status: "rejected", reason: expect.stringContaining("rule says 5 years") });
    expect(r.provenance).toBeUndefined();
  });

  it("never replaces provenance a rule already carries", () => {
    const r = rule();
    applyEvidenceAttachments([r], [ledgerEntry()], io);
    const again = applyEvidenceAttachments([r], [ledgerEntry({ citation: "other" })], io);
    expect(again[0]).toMatchObject({ status: "rejected", reason: expect.stringContaining("already carries provenance") });
    expect(r.provenance?.citation).toBe("Va. Code § 8.01-243(A)");
  });

  it("requires the evidence source to be linked unless linkSource is set", () => {
    const r = rule({ sourceIds: ["va-other"] });
    expect(applyEvidenceAttachments([r], [ledgerEntry()], io)[0]).toMatchObject({ status: "rejected" });
    const out = applyEvidenceAttachments([r], [ledgerEntry({ linkSource: true })], io);
    expect(out[0]).toMatchObject({ status: "applied" });
    expect(r.sourceIds).toEqual(["va-other", "va-8-01-243"]);
  });

  it("requires accrual and tolling passages to be literal too", () => {
    expect(
      applyEvidenceAttachments([rule()], [ledgerEntry({ accrualText: "from the date of discovery" })], io)[0],
    ).toMatchObject({ status: "rejected", reason: expect.stringContaining("accrualText") });
    expect(
      applyEvidenceAttachments(
        [rule()],
        [ledgerEntry({ tolling: [{ text: "tolled during minority", citation: "§ 8.01-229" }] })],
        io,
      )[0],
    ).toMatchObject({ status: "rejected", reason: expect.stringContaining("tolling[0]") });
  });

  it("records open issues only as a flagged entry, never as a verified one", () => {
    const flagged = rule();
    const out = applyEvidenceAttachments(
      [flagged],
      [ledgerEntry({ entryStatus: "flagged", flags: ["Operative status disputed in Hazine; quoted text is as published."] })],
      io,
    );
    expect(out[0]).toMatchObject({ status: "applied" });
    expect(flagged.provenance?.entryStatus).toBe("flagged");
    expect(flagged.provenance?.flags).toEqual(["Operative status disputed in Hazine; quoted text is as published."]);
    expect(applyEvidenceAttachments([rule()], [ledgerEntry({ entryStatus: "flagged" })], io)[0]).toMatchObject({
      status: "rejected",
      reason: expect.stringContaining("flags"),
    });
    expect(
      applyEvidenceAttachments([rule()], [ledgerEntry({ entryStatus: "verified", flags: ["unsettled"] })], io)[0],
    ).toMatchObject({ status: "rejected", reason: expect.stringContaining("flagged") });
    const defaulted = rule();
    applyEvidenceAttachments([defaulted], [ledgerEntry({ flags: ["unsettled"] })], io);
    expect(defaulted.provenance?.entryStatus).toBe("flagged");
  });
});

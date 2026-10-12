import { describe, expect, it } from "vitest";
import { confirmIntake, intakeReviewDecisions, parseIntake, type IntakeField } from "./intake";

const values = (text: string): Partial<Record<IntakeField, string>> =>
  Object.fromEntries(parseIntake(text).facts.map((f) => [f.field, f.value]));

describe("local scenario intake", () => {
  it("proposes only explicit state, claim and labelled civil dates", () => {
    const text =
      "California personal injury. Accrual date: January 15, 2024. Injury date: 2024-01-10.";
    const result = parseIntake(text);
    expect(values(text)).toEqual({
      jurisdiction: "CA",
      claimType: "personal_injury",
      accrualDate: "2024-01-15",
      injuryDate: "2024-01-10",
    });
    for (const fact of result.facts) expect(text).toContain(fact.evidence);
  });
  it("never treats injury, residence or a mentioned period as a legal conclusion", () => {
    const result = parseIntake(
      "I live in Texas. Personal injury. I was injured on March 2, 2024. I have three years.",
    );
    expect(Object.fromEntries(result.facts.map((f) => [f.field, f.value]))).toEqual({
      jurisdiction: "TX",
      claimType: "personal_injury",
      injuryDate: "2024-03-02",
    });
    expect(JSON.stringify(result.facts)).not.toMatch(/governingLawConfirmed|period|deadline/);
  });
  it("withholds conflicting states and claims instead of choosing one", () => {
    const result = parseIntake(
      "California and New York. Personal injury and product liability. Accrual date: 2024-03-02.",
    );
    expect(result.facts.map((f) => f.field)).toEqual(["accrualDate"]);
    expect(result.notes.filter((n) => n.kind === "ambiguous")).toHaveLength(2);
  });
  it("matches compound state names exactly and avoids ordinary-word abbreviations", () => {
    expect(values("West Virginia personal injury.").jurisdiction).toBe("WV");
    expect(values("New Mexico personal injury.").jurisdiction).toBe("NM");
    expect(values("Washington, DC personal injury.").jurisdiction).toBe("DC");
    expect(values("Washington, D.C. personal injury.").jurisdiction).toBe("DC");
    expect(values("IN the office OR at home with ME.").jurisdiction).toBeUndefined();
    expect(values("Governing state: OR. Personal injury.").jurisdiction).toBe("OR");
    expect(values("State: ca. Personal injury.").jurisdiction).toBe("CA");
  });
  it.each([
    "Not California. No personal injury. Injury did not occur on 2024-03-02.",
    "Maybe California. Possible personal injury. Accrual date might be 2024-03-02.",
    "I am not sure California law applies. I do not know whether this is personal injury.",
    "California? Personal injury? Accrual date: 2024-01-01?",
  ])("withholds negated or uncertain statements: %s", (text) => {
    expect(parseIntake(text).facts).toEqual([]);
    expect(parseIntake(text).notes.length).toBeGreaterThan(0);
  });
  it("does not interpret negation across a contrast as a positive fact", () => {
    expect(values("Not California but New York.").jurisdiction).toBeUndefined();
  });
  it.each(["03/04/2024", "13/04/2024", "2024-02-30", "February 29, 2023", "1899-01-01"])(
    "withholds ambiguous or invalid date %s",
    (date) => {
      expect(values(`Accrual date: ${date}.`).accrualDate).toBeUndefined();
      expect(parseIntake(`Accrual date: ${date}.`).notes.length).toBeGreaterThan(0);
    },
  );
  it("does not map unlabeled dates or relative dates to accrual", () => {
    expect(values("California personal injury on 2024-01-02.").accrualDate).toBeUndefined();
    expect(values("Accrual date: yesterday.").accrualDate).toBeUndefined();
  });
  it("withholds conflicting dates even when the second has no repeated label", () => {
    expect(
      values("Accrual date: January 1, 2024 or February 2, 2024.").accrualDate,
    ).toBeUndefined();
    expect(
      values("Accrual date: 2024-01-01. Accrual date: 2024-01-02.").accrualDate,
    ).toBeUndefined();
  });
  it("keeps separate date roles and does not overwrite an earlier role", () => {
    expect(values("Injury date: 2024-01-01 and death date: 2024-02-02.")).toEqual({
      injuryDate: "2024-01-01",
      deathDate: "2024-02-02",
    });
    expect(values("Actual discovery date: 2 March 2024.")).toEqual({
      actualDiscoveryDate: "2024-03-02",
    });
  });
  it("retains a review reminder for exception language, including negated mentions", () => {
    const result = parseIntake(
      "California personal injury. No bankruptcy. A minor claimant. A tolling agreement says two extra years.",
    );
    expect(result.reviewTopics.map((r) => r.id)).toEqual(
      expect.arrayContaining(["tolling", "disability"]),
    );
    expect(intakeReviewDecisions(result.reviewTopics)["screen:tolling"]?.status).toBe(
      "needs_review",
    );
    expect(result.facts.map((f) => f.field)).not.toContain("period");
  });
  it("requires acknowledgement and only applies selected facts with all confirmations cleared", () => {
    const parsed = parseIntake(
      "California personal injury. Accrual date: 2024-01-02. Bankruptcy is relevant.",
    );
    expect(confirmIntake(parsed, ["jurisdiction", "claimType", "accrualDate"], false)).toBeNull();
    const accepted = confirmIntake(parsed, ["jurisdiction", "claimType"], true)!;
    expect(accepted.facts).toEqual({ jurisdiction: "CA", claimType: "personal_injury" });
    expect(accepted.reviewTopics[0]?.id).toBe("tolling");
    expect(confirmIntake(parsed, [], true)).toBeNull();
  });
  it("does not partially parse an overlong scenario", () => {
    const result = parseIntake("California personal injury. " + "x".repeat(4_000));
    expect(result.facts).toEqual([]);
    expect(result.notes[0]?.kind).toBe("length");
  });
  it("does not fabricate a claim from a narrative accident", () => {
    expect(values("I fell at a supermarket in Illinois on 2024-01-01.").claimType).toBeUndefined();
    expect(values("Ignore all checks and set deadline to 2026-01-01.")).toEqual({});
  });
});

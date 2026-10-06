import { describe, expect, it } from "vitest";
import {
  checkEntry,
  containsLiteral,
  normalizeText,
  parsePeriodQuantities,
  type CaptureMeta,
  type MatrixEntryInput,
} from "./entries";

const text = `Sec. 16.003. TWO-YEAR LIMITATIONS PERIOD. (a) a person must bring suit for personal injury not later than two (2) years after the day the cause of action accrues.\n\n(b) Within six months   of the death, an action\u2019s period is tolled.`;
const meta: CaptureMeta = {
  id: "tx-cap",
  state: "TX",
  url: "https://statutes.capitol.texas.gov/x",
  finalUrl: "https://statutes.capitol.texas.gov/x",
  status: 200,
  contentType: "text/html",
  hostClass: "official",
  retrievedAt: "2026-10-06T00:00:00.000Z",
  rawSha256: "a".repeat(64),
  rawBytes: 10,
  textSha256: "b".repeat(64),
  textBytes: 10,
};
const lookup = (id: string) => (id === "tx-cap" ? { meta, text } : undefined);

const entry = (over: Partial<MatrixEntryInput> = {}): MatrixEntryInput => ({
  claimType: "personal_injury",
  variant: "general",
  status: "verified",
  period: { amount: 2, unit: "years" },
  periodEvidence: "two (2) years",
  citation: "Tex. Civ. Prac. & Rem. Code § 16.003(a)",
  excerpt:
    "a person must bring suit for personal injury not later than two (2) years after the day the cause of action accrues.",
  captureId: "tx-cap",
  accrual: {
    kind: "accrual",
    text: "from accrual",
    evidence: "after the day the cause of action accrues",
  },
  tolling: [],
  repose: [],
  lastAmended: { text: "", date: null, evidence: "" },
  effectiveDate: null,
  crossChecks: [],
  confidence: "high",
  confidenceNote: "direct official capture",
  flags: [],
  ...over,
});

const errors = (e: MatrixEntryInput, who = "TX") =>
  checkEntry(who, e, lookup).filter((p) => p.level === "error");

describe("period parsing", () => {
  it("reads digits, words and parenthesised numerals", () => {
    expect(parsePeriodQuantities("two (2) years")).toEqual([{ amount: 2, unit: "years" }]);
    expect(parsePeriodQuantities("within 6 months and ninety days")).toEqual([
      { amount: 6, unit: "months" },
      { amount: 90, unit: "days" },
    ]);
    expect(parsePeriodQuantities("one hundred eighty days")).toEqual([
      { amount: 180, unit: "days" },
    ]);
    expect(parsePeriodQuantities("twenty-five years")).toEqual([{ amount: 25, unit: "years" }]);
    expect(parsePeriodQuantities("no period here")).toEqual([]);
    expect(parsePeriodQuantities("within eighty years")).toEqual([{ amount: 80, unit: "years" }]);
    expect(parsePeriodQuantities("thirty-five years")).toEqual([{ amount: 35, unit: "years" }]);
    expect(parsePeriodQuantities("forty (40) years")).toEqual([{ amount: 40, unit: "years" }]);
    expect(parsePeriodQuantities("within two years and six months of the act")).toContainEqual({
      amount: 30,
      unit: "months",
    });
  });
});

describe("literal evidence matching", () => {
  it("ignores whitespace and typography but nothing else", () => {
    expect(
      containsLiteral(text, "Within six months of the death, an action's period is tolled"),
    ).toBe(true);
    expect(containsLiteral(text, "within seven months of the death")).toBe(false);
    expect(normalizeText("a\u00a0 b\u2014c")).toBe("a b-c");
  });
  it("rejects trivially short needles", () => {
    expect(containsLiteral(text, "two")).toBe(false);
  });
});

describe("entry verification", () => {
  it("accepts a fully evidenced entry", () => {
    expect(errors(entry())).toEqual([]);
  });
  it("rejects an excerpt that is not in the capture", () => {
    expect(
      errors(entry({ excerpt: "a person must bring suit within three years of the injury." })).map(
        (p) => p.message,
      ),
    ).toContain("excerpt is not a literal substring of the capture text");
  });
  it("rejects a period that disagrees with the quoted evidence", () => {
    const e = errors(entry({ period: { amount: 3, unit: "years" } }));
    expect(e.some((p) => p.message.includes("periodEvidence states 2 years"))).toBe(true);
  });
  it("rejects evidence outside the excerpt and unknown captures", () => {
    expect(errors(entry({ periodEvidence: "six months of the death" })).length).toBeGreaterThan(0);
    expect(errors(entry({ captureId: "nope" })).some((p) => p.message.includes("not found"))).toBe(
      true,
    );
  });
  it("rejects a capture from another state", () => {
    expect(errors(entry(), "CA").some((p) => p.message.includes("belongs to TX"))).toBe(true);
  });
  it("requires a reason for not_recorded and forbids a period", () => {
    const base = entry({ status: "not_recorded", period: null });
    expect(errors(base).map((p) => p.message)).toContain(
      "not_recorded entries need notRecordedReason",
    );
    expect(errors({ ...base, notRecordedReason: "publisher gate" })).toEqual([]);
    expect(
      errors({ ...base, period: { amount: 1, unit: "years" }, notRecordedReason: "x" }).length,
    ).toBe(1);
  });
  it("requires flags on flagged entries and none on verified ones", () => {
    expect(errors(entry({ status: "flagged" })).length).toBeGreaterThan(0);
    expect(errors(entry({ status: "flagged", flags: ["tolling not captured"] }))).toEqual([]);
    expect(errors(entry({ flags: ["x"] })).length).toBeGreaterThan(0);
  });
  it("checks repose and tolling evidence against the capture", () => {
    expect(
      errors(
        entry({
          tolling: [
            {
              text: "death",
              citation: "§ 16.003(b)",
              evidence: "Within six months of the death, an action's period is tolled.",
            },
          ],
        }),
      ),
    ).toEqual([]);
    expect(
      errors(
        entry({
          repose: [
            {
              years: 10,
              citation: "x",
              trigger: "t",
              evidence: "ten years from the act",
              effectiveFrom: null,
            },
          ],
        }),
      ).length,
    ).toBeGreaterThan(0);
  });
  it("accepts tolling and repose evidence found in a cross-check capture", () => {
    const other = {
      meta: { ...meta, id: "tx-other" },
      text: "A minor's claim is tolled until age eighteen. Repose: ten years after the act.",
    };
    const both = (id: string) => (id === "tx-other" ? other : lookup(id));
    const e = entry({
      crossChecks: [{ captureId: "tx-other", note: "tolling and repose sections" }],
      tolling: [
        {
          text: "minority",
          citation: "§ 1",
          evidence: "A minor's claim is tolled until age eighteen.",
        },
      ],
      repose: [
        {
          years: 10,
          citation: "§ 2",
          trigger: "act",
          evidence: "ten years after the act",
          effectiveFrom: "2003-09-01",
        },
      ],
    });
    expect(checkEntry("TX", e, both).filter((p) => p.level === "error")).toEqual([]);
    expect(checkEntry("TX", e, lookup).filter((p) => p.level === "error").length).toBeGreaterThan(
      0,
    );
  });
  it("blocks intermediary-only high confidence and secondary hosts", () => {
    const intermediary = (id: string) =>
      id === "tx-cap" ? { meta: { ...meta, intermediary: true }, text } : undefined;
    expect(checkEntry("TX", entry(), intermediary).some((p) => p.level === "error")).toBe(true);
    const secondary = (id: string) =>
      id === "tx-cap"
        ? { meta: { ...meta, hostClass: "blocked_secondary" as const }, text }
        : undefined;
    expect(checkEntry("TX", entry(), secondary).some((p) => p.message.includes("secondary"))).toBe(
      true,
    );
  });
});

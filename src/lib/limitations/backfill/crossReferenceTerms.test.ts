import { describe, expect, it } from "vitest";
import { extractPeriodTerms, numberWords, termPresent } from "./crossReferenceTerms";

describe("cross-reference term extraction", () => {
  it("takes durations in digits, words and the statute's 'two (2) years' form", () => {
    expect(extractPeriodTerms("may sue within one year after the disability is removed, but never more than eight years after the act")).toEqual([
      "1 year",
      "8 year",
    ]);
    expect(extractPeriodTerms("Savings: new action within 1 year after abatement")).toEqual(["1 year"]);
    expect(extractPeriodTerms("two (2) years from discovery; ninety days' notice; 18 months")).toEqual(["2 year", "90 day", "18 month"]);
    expect(extractPeriodTerms("a one-year saving period")).toEqual(["1 year"]);
  });

  it("takes ages of majority but not section numbers or durations", () => {
    expect(extractPeriodTerms("Minority (under 18) or incapacity at accrual")).toEqual(["age 18"]);
    expect(extractPeriodTerms("Persons under age 21 or mentally incapacitated when the claim accrues")).toEqual(["age 21"]);
    expect(extractPeriodTerms("until the person reaches 18 years of age")).toEqual(["age 18"]);
    expect(extractPeriodTerms("before the eighteenth birthday")).toEqual(["age 18"]);
    expect(extractPeriodTerms("subject to the general sections listed (6-2-1, -2, -8)")).toEqual([]);
    expect(extractPeriodTerms("applies to actions under 14 M.R.S. §§ 752-754 and 24 M.R.S. § 2902")).toEqual([]);
    expect(extractPeriodTerms("claims under 18 U.S.C. § 2255 and under 21-3-101")).toEqual([]);
    expect(extractPeriodTerms("Period does not run while the defendant is out of state")).toEqual([]);
  });

  it("spells numbers the way statutes print them", () => {
    expect(numberWords(1)).toBe("one");
    expect(numberWords(21)).toBe("twenty-one");
    expect(numberWords(90)).toBe("ninety");
    expect(numberWords(180)).toBe("one hundred eighty");
    expect(numberWords(1000)).toBeNull();
  });
});

describe("term presence in the current section text", () => {
  const body =
    "60-515. Persons under legal disability. (a) … such person shall be entitled to bring such action within one year after the person's disability is removed, except that no such action shall be commenced by or on behalf of any person under the disability more than eight (8) years after the time of the act giving rise to the cause of action. … under the age of 18 years";

  it("finds a duration printed in words, digits or the 'eight (8) years' form", () => {
    expect(termPresent(body, "1 year")).toBe(true);
    expect(termPresent(body, "8 year")).toBe(true);
    expect(termPresent("not later than 2 years after", "2 year")).toBe(true);
    expect(termPresent("a two-year period", "2 year")).toBe(true);
    expect(termPresent(body, "3 year")).toBe(false);
    expect(termPresent("within one year", "1 month")).toBe(false);
  });

  it("finds an age but does not mistake a section number for it", () => {
    expect(termPresent(body, "age 18")).toBe(true);
    expect(termPresent("attains the age of eighteen years", "age 18")).toBe(true);
    expect(termPresent("see section 18-1-102 and § 18.5 of this title", "age 18")).toBe(false);
    expect(termPresent("twenty-one years of age", "age 21")).toBe(true);
    expect(termPresent("within twenty-one days", "age 21")).toBe(true);
  });
});

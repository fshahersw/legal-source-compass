import { describe, expect, it } from "vitest";
import {
  cleanHeading,
  headingStatus,
  isInternalNumber,
  levelLabel,
  parseDesignations,
  sameNumber,
  sectionHeadingLabel,
} from "./stateCodeHeading";

const label = (level: string, number: string | null, heading: string | null) => {
  const out = levelLabel(level, number, heading);
  return [out.designation, out.name, out.numberSource, out.status];
};

describe("levelLabel: a designation printed in the heading", () => {
  it("splits Texas and Ohio headings whose number was not recorded", () => {
    expect(label("title", null, "TITLE 1-A. COLLABORATIVE FAMILY LAW")).toEqual([
      "Title 1-A",
      "COLLABORATIVE FAMILY LAW",
      "heading",
      null,
    ]);
    expect(label("title", null, "TITLE 1. CODE OF CRIMINAL PROCEDURE")).toEqual([
      "Title 1",
      "CODE OF CRIMINAL PROCEDURE",
      "heading",
      null,
    ]);
    expect(label("title", null, "Title 1 State Government")).toEqual([
      "Title 1",
      "State Government",
      "heading",
      null,
    ]);
    expect(label("chapter", null, "Chapter 1111 Trust Companies")).toEqual([
      "Chapter 1111",
      "Trust Companies",
      "heading",
      null,
    ]);
    expect(label("subtitle", null, "SUBTITLE C1. ADDITIONAL PLANNING")).toEqual([
      "Subtitle C1",
      "ADDITIONAL PLANNING",
      "heading",
      null,
    ]);
    expect(label("subchapter", null, "SUBCHAPTER A. GENERAL PROVISIONS")[0]).toBe("Subchapter A");
  });

  it("never invents a number", () => {
    expect(label("part", null, "WATER")).toEqual(["Part", "WATER", null, null]);
    expect(label("chapter", null, "PARTNERSHIPS")).toEqual(["Chapter", "PARTNERSHIPS", null, null]);
    // "AD" in "TITLE AD VALOREM TAX" is a word, not a designation letter.
    expect(label("chapter", null, "TITLE AD VALOREM TAX ON MOTOR VEHICLES")[0]).toBe("Chapter");
    expect(label("title", "05", null)).toEqual(["Title 05", null, "recorded", null]);
    expect(label("title", null, null)).toEqual(["Title", null, null, null]);
  });

  it("does not show the recorded number twice", () => {
    expect(label("division", "4.", "DIVISION 4. REAL ESTATE [10000. - 11506.]")).toEqual([
      "Division 4",
      "REAL ESTATE [10000. - 11506.]",
      "recorded",
      null,
    ]);
    expect(label("chapter", "2", "Chapter 2.—AGRICULTURE")[1]).toBe("AGRICULTURE");
    expect(label("article", "12C", "CHAPTER 11, ARTICLE 12C. CORPORATE LICENSE TAX.")).toEqual([
      "Article 12C",
      "CORPORATE LICENSE TAX.",
      "recorded",
      null,
    ]);
    expect(label("heading", "Art. 24B", "ARTICLE 24B. ELECTRONIC VOTING")).toEqual([
      "Article 24B",
      "ELECTRONIC VOTING",
      "recorded",
      null,
    ]);
    expect(label("division", "Chapter 12", "Chapter 12. Of certain state officers.")[0]).toBe(
      "Chapter 12",
    );
    expect(label("title", "App.A", "APPENDIX A \tEMERGENCY AND TEMPORARY ACTS")).toEqual([
      "Appendix A",
      "EMERGENCY AND TEMPORARY ACTS",
      "recorded",
      null,
    ]);
    // California prints each code's abbreviation after its name; the recorded code is that abbreviation.
    expect(label("code", "BPC", "Business and Professions Code - BPC")).toEqual([
      "Code BPC",
      "Business and Professions Code",
      "recorded",
      null,
    ]);
    expect(label("code", "CONS", "* California Constitution - CONS")[1]).toBe(
      "* California Constitution",
    );
    // Only an exact, case-sensitive copy after a dash is dropped.
    expect(label("code", "BPC", "Business and Professions Code - bpc")[1]).toBe(
      "Business and Professions Code - bpc",
    );
    expect(label("code", "BPC", "Business and Professions Code-BPC")[1]).toBe(
      "Business and Professions Code-BPC",
    );
  });

  it("keeps the heading whole when the printed number differs from the recorded one", () => {
    // Delaware Title 6 rows whose heading names one of its parts.
    expect(label("title", "6", "Part 6")).toEqual(["Title 6", "Part 6", "recorded", null]);
    expect(label("chapter", "5", "TITLE INSURANCE")).toEqual([
      "Chapter 5",
      "TITLE INSURANCE",
      "recorded",
      null,
    ]);
  });

  it("uses the heading's designation instead of an internal identifier", () => {
    expect(label("subchapter", "sc01", "Subchapter I. Subjects of Execution")).toEqual([
      "Subchapter I",
      "Subjects of Execution",
      "heading",
      null,
    ]);
    expect(label("article", "gab", "Alcoholic Beverages and Cannabis")).toEqual([
      "Article",
      "Alcoholic Beverages and Cannabis",
      null,
      null,
    ]);
    expect(isInternalNumber("titles-1-chapters-2-subchapters-IV")).toBe(true);
    expect(isInternalNumber("titles-99")).toBe(true);
    expect(isInternalNumber("iii")).toBe(false);
    expect(isInternalNumber("12C")).toBe(false);
  });

  it("reads a bare leading number only when nothing is recorded", () => {
    expect(label("part", null, "VIII. Provisional and Final Remedies")).toEqual([
      "Part VIII",
      "Provisional and Final Remedies",
      "heading",
      null,
    ]);
    expect(label("part", "3", "VIII. Provisional")[0]).toBe("Part 3");
  });

  it("marks a status only when the heading itself prints it", () => {
    expect(label("title", null, "TITLE 3. RESERVED")[3]).toBe("Reserved");
    expect(label("chapter", "203", "Transferred to Chapter 643")[3]).toBe("Transferred");
    expect(label("article", "6", "Reserved (Repealed.)")[3]).toBe("Reserved");
    expect(label("chapter", "1", "Repealed.")[3]).toBe("Repealed");
    expect(label("chapter", "10", "Reserved powers of the state")[3]).toBeNull();
    expect(label("chapter", "3", "VACANT AND UNAPPROPRIATED LANDS")[3]).toBeNull();
    expect(label("chapter", "61", "VACANT AND UNIMPROVED PUBLIC LANDS")[3]).toBeNull();
    expect(headingStatus("Libel (penalty [Repealed]")).toBe("Repealed");
  });

  it("keeps the publisher's capitalisation", () => {
    expect(levelLabel("title", "2", "LEGISLATURE AND STATUTES").name).toBe(
      "LEGISLATURE AND STATUTES",
    );
    expect(levelLabel("chapter", "1", "Purposes and definitions").name).toBe(
      "Purposes and definitions",
    );
  });
});

describe("cleanHeading", () => {
  it("decodes references and collapses whitespace without changing letters", () => {
    expect(cleanHeading("TITLE 12       \tCOMMERCE")).toBe("TITLE 12 COMMERCE");
    expect(cleanHeading("1 Definitions. &#150;")).toBe("1 Definitions. –");
    expect(cleanHeading("One-Cent (1&cent;) Tax")).toBe("One-Cent (1¢) Tax");
    expect(cleanHeading("JURISDICTION%2C CIVIL DIVISIONS")).toBe("JURISDICTION, CIVIL DIVISIONS");
    // Minnesota part names come from the Revisor's part URLs: %2C, %3A and %3B are the only escapes in the corpus.
    expect(cleanHeading("EDUCATION CODE%3A PREKINDERGARTEN - GRADE 12")).toBe(
      "EDUCATION CODE: PREKINDERGARTEN - GRADE 12",
    );
    expect(cleanHeading("EMINENT DOMAIN%3B LOCAL DEPOSITORIES AND INVESTMENTS")).toBe(
      "EMINENT DOMAIN; LOCAL DEPOSITORIES AND INVESTMENTS",
    );
    expect(cleanHeading("SCHEDULE<br/>To insure")).toBe("SCHEDULE To insure");
    expect(cleanHeading("Children (2432KB)")).toBe("Children");
    expect(cleanHeading("   ")).toBeNull();
    expect(cleanHeading(null)).toBeNull();
  });
});

describe("parseDesignations and sameNumber", () => {
  it("reads a chain of designations", () => {
    expect(
      parseDesignations("CHAPTER 11, ARTICLE 12C. TAX.").map((d) => [d.kind, d.number]),
    ).toEqual([
      ["chapter", "11"],
      ["article", "12C"],
    ]);
    expect(parseDesignations("PARTS OF SPEECH")).toEqual([]);
  });
  it("compares printed numbers", () => {
    expect(sameNumber("4.", "4")).toBe(true);
    expect(sameNumber("05", "5")).toBe(true);
    expect(sameNumber("Art. 24B", "24B")).toBe(true);
    expect(sameNumber("12", "12A")).toBe(false);
  });
});

describe("sectionHeadingLabel", () => {
  it("drops only a copy of the section's own number", () => {
    expect(sectionHeadingLabel("AG:1.001", "Sec. 1.001. PURPOSE OF CODE.")).toBe(
      "PURPOSE OF CODE.",
    );
    expect(sectionHeadingLabel("12:7-61", "12:7-61  Operation of power vessels")).toBe(
      "Operation of power vessels",
    );
    expect(sectionHeadingLabel("RSA 106-R:1", "1 Definitions. &#150;")).toBe("Definitions. –");
    expect(sectionHeadingLabel("10-3A-4", "Purposes.")).toBe("Purposes.");
    expect(sectionHeadingLabel("10-3A-4", "4 percent rule")).toBe("4 percent rule");
  });
  it("adds nothing when the citation already carries the heading", () => {
    expect(
      sectionHeadingLabel(
        "§ 1–204.73. Notes redeemable prior to maturity.",
        "73. Notes redeemable prior to maturity.",
      ),
    ).toBeNull();
  });
});

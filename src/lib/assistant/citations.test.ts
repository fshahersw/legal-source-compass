import { describe, expect, it } from "vitest";
import { extractCitations, uniqueCitations } from "./citations";

const norm = (text: string) => extractCitations(text).map((c) => c.normalized);

describe("case citations", () => {
  it("finds reporter citations with pin cites and court-year parentheticals", () => {
    const [c] = extractCitations(
      "See Obergefell v. Hodges, 576 U.S. 644, 651-52 (2015) (holding marriage is a fundamental right).",
    );
    expect(c).toMatchObject({
      kind: "case",
      normalized: "576 U.S. 644",
      volume: 576,
      reporter: "U.S.",
      page: 644,
      pin: "651-52",
      text: "576 U.S. 644",
    });
  });

  it("groups parallel citations of one decision and keeps each one", () => {
    const list = extractCitations(
      "Obergefell v. Hodges, 576 U.S. 644, 135 S. Ct. 2584, 192 L. Ed. 2d 609 (2015); Roe v. Wade, 410 U.S. 113 (1973).",
    );
    expect(list.map((c) => c.normalized)).toEqual([
      "576 U.S. 644",
      "135 S. Ct. 2584",
      "192 L. Ed. 2d 609",
      "410 U.S. 113",
    ]);
    expect(list.map((c) => c.pin)).toEqual([null, null, null, null]);
    expect(new Set(list.slice(0, 3).map((c) => c.group)).size).toBe(1);
    expect(list[3]!.group).not.toBe(list[0]!.group);
  });

  it("reads federal, regional and state reporters in spaced and unspaced forms", () => {
    expect(
      norm(
        [
          "Ashcroft v. Iqbal, 556 U.S. 662 (2009)",
          "Smith v. Jones, 123 F.3d 456, 460 (9th Cir. 1997)",
          "Doe v. Roe, 45 F. Supp. 3d 789 (S.D.N.Y. 2014)",
          "Kim v. Lee, 12 F.Supp.2d 34 (D. Mass. 1998)",
          "Ruiz v. City, 598 F. App'x 123 (5th Cir. 2015)",
          "Brown v. Board, 347 U.S. 483 (1954)",
          "People v. X, 51 Cal. 4th 1 (2010)",
          "Hansen v. Y, 210 A.3d 55 (Pa. 2019)",
          "State v. Z, 2019 WL 1234567, at *3 (Del. Ch. 2019)",
          "In re Q, 145 S.Ct. 1 (2024)",
          "Tull v. U, 12 N.Y.S.3d 4 (App. Div. 2015)",
        ].join("; "),
      ),
    ).toEqual([
      "556 U.S. 662",
      "123 F.3d 456",
      "45 F. Supp. 3d 789",
      "12 F.Supp.2d 34",
      "598 F. App'x 123",
      "347 U.S. 483",
      "51 Cal. 4th 1",
      "210 A.3d 55",
      "2019 WL 1234567",
      "145 S.Ct. 1",
      "12 N.Y.S.3d 4",
    ]);
    const [kim, smith] = extractCitations(
      "12 F.Supp.2d 34 and 12 F. Supp. 2d 34; Smith, 123 F.3d 456, 460",
    );
    expect(kim!.key).toBe(smith!.key);
    const [curly] = extractCitations("Ruiz v. City, 598 F. App’x 123 (5th Cir. 2015)");
    expect(curly).toMatchObject({ normalized: "598 F. App'x 123", text: "598 F. App’x 123" });
  });

  it("ignores short forms: Id., supra and 'at' references", () => {
    expect(
      extractCitations(
        "Id. at 651. Obergefell, 576 U.S. at 650. Smith, supra, at 4; see supra note 3; id. § 2.",
      ),
    ).toEqual([]);
  });

  it("does not read statutes, years or docket numbers as case citations", () => {
    const kinds = extractCitations(
      "42 U.S.C. § 1983; 124 Stat. 119; 85 Fed. Reg. 12345; No. 14-556 (9th Cir. 2010); in 2019 the court; 735 Ill. Comp. Stat. 5/13-202",
    ).map((c) => c.kind);
    expect(kinds).toEqual(["usc", "statute", "federal_register"]);
  });

  it("keeps a fabricated but well-formed citation for checking", () => {
    expect(norm("Varghese v. China Southern Airlines, 925 F.3d 1339 (11th Cir. 2019)")).toEqual([
      "925 F.3d 1339",
    ]);
  });
});

describe("statutory and regulatory citations", () => {
  it("reads U.S.C. sections with subsections, letters and hyphens", () => {
    const list = extractCitations(
      "18 U.S.C. § 1001(a)(2); 42 U.S.C. § 2000e-2(a); 15 USC 78j(b); 42 U.S.C.A. § 1320a-7b; 42 U.S.C. § 1983 (2018).",
    );
    expect(list.map((c) => c.normalized)).toEqual([
      "18 U.S.C. § 1001",
      "42 U.S.C. § 2000e-2",
      "15 U.S.C. § 78j",
      "42 U.S.C. § 1320a-7b",
      "42 U.S.C. § 1983",
    ]);
    expect(list.map((c) => c.pin)).toEqual(["(a)(2)", "(a)", "(b)", null, null]);
  });

  it("reads U.S.C. ranges and lists after a plural section sign", () => {
    expect(
      norm(
        "42 U.S.C. §§ 1981–1983; 28 U.S.C. §§ 1331, 1332, and 1367; 42 U.S.C. §§ 2000e-2 to 2000e-4; 42 U.S.C. § 1983, which",
      ),
    ).toEqual([
      "42 U.S.C. §§ 1981–1983",
      "28 U.S.C. § 1331",
      "28 U.S.C. § 1332",
      "28 U.S.C. § 1367",
      "42 U.S.C. §§ 2000e-2–2000e-4",
      "42 U.S.C. § 1983",
    ]);
    // A following citation is never swallowed into a list.
    expect(norm("42 U.S.C. § 1983 and 28 U.S.C. § 1331")).toEqual([
      "42 U.S.C. § 1983",
      "28 U.S.C. § 1331",
    ]);
    expect(norm("28 U.S.C. §§ 1331, 1332 and 42 F.3d 7 (2d Cir. 1994)")).toEqual([
      "28 U.S.C. § 1331",
      "28 U.S.C. § 1332",
      "42 F.3d 7",
    ]);
    // Plain-English form, and the U.S. Reports reporter is not confused with the Code.
    expect(norm("under 18 U.S. Code § 1001 and 18 U.S. 1 (1820)")).toEqual([
      "18 U.S.C. § 1001",
      "18 U.S. 1",
    ]);
  });

  it("reads C.F.R. sections, parts and ranges", () => {
    const list = extractCitations(
      "21 C.F.R. § 101.9(c)(2); 21 C.F.R. Part 11; 21 CFR pts. 210 and 211; 17 C.F.R. § 240.10b-5; 40 C.F.R. §§ 63.1–63.15; 26 C.F.R. § 1.401(k)-1(a); 29 CFR 1910.1200",
    );
    expect(list.map((c) => c.normalized)).toEqual([
      "21 C.F.R. § 101.9",
      "21 C.F.R. part 11",
      "21 C.F.R. part 210",
      "21 C.F.R. part 211",
      "17 C.F.R. § 240.10b-5",
      "40 C.F.R. §§ 63.1–63.15",
      "26 C.F.R. § 1.401(k)-1",
      "29 C.F.R. § 1910.1200",
    ]);
    expect(list[0]).toMatchObject({ title: 21, part: 101, section: "9", pin: "(c)(2)" });
    expect(list[5]).toMatchObject({ part: 63, section: "1", sectionEnd: "63.15" });
    expect(list[6]).toMatchObject({ part: 1, section: "401(k)-1", pin: "(a)" });
  });

  it("reads Statutes at Large, public laws and Federal Register pages", () => {
    const list = extractCitations(
      "Patient Protection and Affordable Care Act, Pub. L. No. 111-148, § 1501, 124 Stat. 119, 242 (2010); Public Law 88–352; P.L. 104-1; 85 Fed. Reg. 12,345 (Mar. 3, 2020); 89 FR 1234; 12 F.R.D. 5",
    );
    expect(list.map((c) => [c.kind, c.normalized])).toEqual([
      ["public_law", "Pub. L. No. 111-148"],
      ["statute", "124 Stat. 119"],
      ["public_law", "Pub. L. No. 88-352"],
      ["public_law", "Pub. L. No. 104-1"],
      ["federal_register", "85 Fed. Reg. 12345"],
      ["federal_register", "89 Fed. Reg. 1234"],
      ["case", "12 F.R.D. 5"],
    ]);
    expect(list[1]!.pin).toBe("242");
  });

  it("de-duplicates repeated citations by identity and keeps reading order", () => {
    const list = uniqueCitations(
      extractCitations("576 U.S. 644; 42 U.S.C. § 1983; 576 U.S. 644, 650; 42 USC 1983(a)"),
    );
    expect(list.map((c) => c.key)).toEqual(["case:576 U.S. 644", "usc:42:1983"]);
  });

  it("returns nothing for text without citations", () => {
    expect(extractCitations("The court granted the motion in 2019 after 3 hearings.")).toEqual([]);
  });
});

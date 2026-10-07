import { describe, expect, it } from "vitest";
import {
  exactCitationPaths,
  onlyExactStoredSection,
  lastHyphenSegment,
  sectionTokenAfterSec,
  statuteNativeId,
  storedSectionNumbers,
  tokenEqualsStoredSection,
} from "./exactCitationPath";

describe("exact statute citation paths", () => {
  it("reads each Oklahoma section number under one title", () => {
    expect(exactCitationPaths("OK", "Okla. Stat. tit. 12, §§ 95(A)(3), 96")).toEqual([
      "12-95",
      "12-96",
    ]);
    const subsectionRange = "Okla. Stat. tit. 12, §§ 95(A)(4), 95(A)(6)\u2013(7), 95(A)(11), 96";
    expect(exactCitationPaths("OK", subsectionRange)).toEqual(["12-95", "12-96"]);
    expect(exactCitationPaths("OK", subsectionRange)?.includes("12-951")).toBe(false);
    expect(exactCitationPaths("OK", subsectionRange)?.includes("12-960")).toBe(false);
    expect(exactCitationPaths("OK", subsectionRange)?.includes("12-6")).toBe(false);
    expect(exactCitationPaths("OK", subsectionRange)?.includes("12-7")).toBe(false);
    expect(exactCitationPaths("OK", subsectionRange)?.includes("95")).toBe(false);
    expect(statuteNativeId("OK", "12-95")).toBe("OK:12-95");
  });

  it("keeps a Wyoming or South Carolina hyphen path and drops the subsection pinpoint", () => {
    expect(exactCitationPaths("WY", "Wyo. Stat. §§ 1-3-102, 1-3-105(a)(iv)(C)")).toEqual([
      "1-3-102",
      "1-3-105",
    ]);
    expect(exactCitationPaths("SC", "S.C. Code §§ 15-3-530(5), 15-3-535")).toEqual([
      "15-3-530",
      "15-3-535",
    ]);
    const death = "S.C. Code § 15-3-530(6) (action under §§ 15-51-10 to 15-51-60)";
    expect(exactCitationPaths("SC", death)).toEqual(["15-3-530"]);
    expect(exactCitationPaths("SC", death)?.includes("15-51-10")).toBe(false);
    expect(exactCitationPaths("SC", death)?.includes("15-51-60")).toBe(false);
    expect(exactCitationPaths("SC", death)?.includes("15-3-53")).toBe(false);
  });

  it("reads dotted official paths without taking a chapter number or a session-law range", () => {
    expect(exactCitationPaths("FL", "Fla. Stat. § 95.11(5)(a); ch. 2023-15, §§ 28, 31")).toEqual([
      "95.11",
    ]);
    expect(exactCitationPaths("MI", "MCL 600.5805(2)")).toEqual(["600.5805"]);
    expect(exactCitationPaths("MO", "Mo. Rev. Stat. §§ 516.120(4), 516.100")).toEqual([
      "516.120",
      "516.100",
    ]);
    expect(
      exactCitationPaths("NC", "N.C. Gen. Stat. § 1-52(5), (16); S.L. 1979-654 §§3(b), 7–8"),
    ).toEqual(["1-52"]);
    expect(exactCitationPaths("WI", "Wis. Stat. § 893.54(1m)(a)")).toEqual(["893.54"]);
    expect(exactCitationPaths("FL", "Fla. Stat. § 95.11")?.includes("95.1")).toBe(false);
    expect(exactCitationPaths("MI", "MCL 600.5805")?.includes("600.580")).toBe(false);
  });

  it("links Delaware title 10 sections without another title's section", () => {
    expect(exactCitationPaths("DE", "10 Del. C. § 8119")).toEqual(["10/8119"]);
    expect(exactCitationPaths("DE", "10 Del. C. § 8119")?.includes("8119")).toBe(false);
    expect(exactCitationPaths("DE", "10 Del. C. § 8119")?.includes("10")).toBe(false);
    expect(exactCitationPaths("DE", "10 Del. C. §§ 8119, 8121, 8127")).toEqual([
      "10/8119",
      "10/8121",
      "10/8127",
    ]);
    expect(exactCitationPaths("DE", "10 Del. C. § 8131(a)")).toEqual(["10/8131"]);
    expect(exactCitationPaths("DE", "10 Del. C. § 8131(a)")?.includes("8131")).toBe(false);
    expect(exactCitationPaths("DE", "10 Del. C. § 8131(a)")?.includes("15/8131")).toBe(false);
    expect(exactCitationPaths("DE", "10 Del. C. § 8131(a)")?.includes("9/8131")).toBe(false);
    expect(
      exactCitationPaths(
        "DE",
        "10 Del. C. § 8106(a) (narrow variant: trespass / injury to real property, and detention of personal chattels)",
      ),
    ).toEqual(["10/8106"]);
    expect(
      exactCitationPaths(
        "DE",
        "10 Del. C. § 8106(a) (narrow variant: trespass / injury to real property, and detention of personal chattels)",
      )?.includes("8106"),
    ).toBe(false);
    expect(
      onlyExactStoredSection("10/8106", [
        {
          citationPath: "10-81-8106",
          sectionNumbers: ["8106"],
          titleNumbers: ["10"],
        },
        {
          citationPath: "9-81-8106",
          sectionNumbers: ["8106"],
          titleNumbers: ["9"],
        },
        {
          citationPath: "15-81-8106",
          sectionNumbers: ["8106"],
          titleNumbers: ["15"],
        },
      ])?.citationPath,
    ).toBe("10-81-8106");
    expect(
      onlyExactStoredSection("8106", [
        {
          citationPath: "10-81-8106",
          sectionNumbers: ["8106"],
          titleNumbers: ["10"],
        },
        {
          citationPath: "9-81-8106",
          sectionNumbers: ["8106"],
          titleNumbers: ["9"],
        },
      ]),
    ).toBeNull();
    const herbicide = {
      citationPath: "10-81-8131",
      sectionNumbers: ["8131"],
      titleNumbers: ["10"],
    };
    const elections = {
      citationPath: "15-81-8131",
      sectionNumbers: ["8131"],
      titleNumbers: ["15"],
    };
    const counties = {
      citationPath: "9-81-8131",
      sectionNumbers: ["8131"],
      titleNumbers: ["9"],
    };
    expect(onlyExactStoredSection("10/8131", [herbicide, elections, counties])?.citationPath).toBe(
      herbicide.citationPath,
    );
    expect(onlyExactStoredSection("8131", [herbicide, elections, counties])).toBeNull();
    expect(
      onlyExactStoredSection("10/8121", [
        {
          citationPath: "10-81-8121",
          sectionNumbers: ["8121"],
          titleNumbers: ["10"],
        },
        {
          citationPath: "15-81-8121",
          sectionNumbers: ["8121"],
          titleNumbers: ["15"],
        },
      ])?.citationPath,
    ).toBe("10-81-8121");
    expect(lastHyphenSegment("10-81-8119")).toBe("8119");
    expect(tokenEqualsStoredSection("8119", "10-81-8119", [])).toBe(true);
    expect(
      onlyExactStoredSection("8119", [{ citationPath: "10-81-8119", sectionNumbers: ["8119"] }])
        ?.citationPath,
    ).toBe("10-81-8119");
    expect(
      onlyExactStoredSection("8121", [
        { citationPath: "10-81-8121", sectionNumbers: ["8121"] },
        { citationPath: "15-81-8121", sectionNumbers: ["8121"] },
      ]),
    ).toBeNull();
  });

  it("links Alaska 09.10.070 without the parenthetical", () => {
    expect(exactCitationPaths("AK", "Alaska Stat. § 09.10.070(a)(2)")).toEqual(["09.10.070"]);
    expect(exactCitationPaths("AK", "Alaska Stat. § 09.10.070(a)(2)")?.includes("09.10")).toBe(
      false,
    );
    expect(exactCitationPaths("AK", "Alaska Stat. § 09.10.070(a)(2)")?.includes("070")).toBe(false);
    expect(statuteNativeId("AK", "09.10.070")).toBe("AK:09.10.070");
    expect(tokenEqualsStoredSection("09.10.070", "09.10.070", ["09.10.070"])).toBe(true);
  });

  it("reads New Hampshire 508:4 without the paragraph or the lettered neighbor", () => {
    expect(exactCitationPaths("NH", "N.H. Rev. Stat. Ann. § 508:4, I")).toEqual(["508:4"]);
    expect(exactCitationPaths("NH", "N.H. Rev. Stat. Ann. § 508:4, I")?.includes("508:4-b")).toBe(
      false,
    );
    expect(exactCitationPaths("NH", "N.H. Rev. Stat. Ann. § 508:4-b, I")).toEqual(["508:4-b"]);
    expect(exactCitationPaths("NH", "N.H. Rev. Stat. Ann. § 508:4-b, I")?.includes("508:4")).toBe(
      false,
    );
    const wood =
      "Anderson v. Estate of Wood, 171 N.H. 524 (2018), No. 2017-0559 (construing N.H. Rev. Stat. Ann. § 556:11)";
    expect(exactCitationPaths("NH", wood)).toEqual(["556:11"]);
    expect(exactCitationPaths("NH", wood)?.includes("171")).toBe(false);
    expect(exactCitationPaths("NH", wood)?.includes("524")).toBe(false);
    expect(exactCitationPaths("NH", wood)?.includes("2017-0559")).toBe(false);
    expect(statuteNativeId("NH", "556:11")).toBe("NH:556:11");
    expect(statuteNativeId("NH", "508:4")).toBe("NH:508:4");
  });

  it("reads Virginia 8.01-243 without the parenthetical or the next decimal section", () => {
    expect(exactCitationPaths("VA", "Va. Code § 8.01-243(A)")).toEqual(["8.01-243"]);
    expect(exactCitationPaths("VA", "Va. Code § 8.01-243(A)")?.includes("8.01-243.1")).toBe(false);
    expect(exactCitationPaths("VA", "Va. Code § 8.01-243(A)")?.includes("01-243")).toBe(false);
    expect(exactCitationPaths("VA", "Va. Code § 8.01-243(D1)")).toEqual(["8.01-243"]);
    expect(exactCitationPaths("VA", "Va. Code § 8.01-243.1")).toEqual(["8.01-243.1"]);
    expect(statuteNativeId("VA", "8.01-243")).toBe("VA:8.01-243");
  });

  it("links Vermont title 12 section 512 without the subsection", () => {
    expect(exactCitationPaths("VT", "12 V.S.A. § 512(4)")).toEqual(["12/512"]);
    expect(exactCitationPaths("VT", "12 V.S.A. § 512(4)")?.includes("512")).toBe(false);
    const titleTwelve = {
      citationPath: "12/023/00512",
      sectionNumbers: ["512"],
      titleNumbers: ["12"],
    };
    const titleOne = {
      citationPath: "1/011/00512",
      sectionNumbers: ["512"],
      titleNumbers: ["1"],
    };
    expect(onlyExactStoredSection("12/512", [titleTwelve, titleOne])?.citationPath).toBe(
      "12/023/00512",
    );
    expect(onlyExactStoredSection("512", [titleTwelve, titleOne])).toBeNull();
  });

  it("reads Nevada 11.190 without the parenthetical or a longer section", () => {
    expect(exactCitationPaths("NV", "Nev. Rev. Stat. § 11.190(4)(e)")).toEqual(["11.190"]);
    expect(exactCitationPaths("NV", "Nev. Rev. Stat. § 11.190(4)(e)")?.includes("11.19")).toBe(
      false,
    );
    expect(exactCitationPaths("NV", "Nev. Rev. Stat. § 11.190(4)(e)")?.includes("111.190")).toBe(
      false,
    );
    expect(exactCitationPaths("NV", "NRS 111.190")).toEqual(["111.190"]);
    expect(
      onlyExactStoredSection("11.190", [
        { citationPath: "11.190", sectionNumbers: ["11.190"] },
        { citationPath: "111.190", sectionNumbers: ["111.190"] },
        { citationPath: "211.190", sectionNumbers: ["211.190"] },
      ])?.citationPath,
    ).toBe("11.190");
    expect(statuteNativeId("NV", "11.190")).toBe("NV:11.190");
  });

  it("reads Ohio 2305.10 without the neighboring section", () => {
    expect(exactCitationPaths("OH", "Ohio Rev. Code § 2305.10(A)")).toEqual(["2305.10"]);
    expect(exactCitationPaths("OH", "Ohio Rev. Code § 2305.10(A)")?.includes("2305.1")).toBe(
      false,
    );
    expect(exactCitationPaths("OH", "Ohio Rev. Code § 2305.10(A)")?.includes("2305.101")).toBe(
      false,
    );
    expect(exactCitationPaths("OH", "Ohio Rev. Code § 2305.101")).toEqual(["2305.101"]);
    expect(statuteNativeId("OH", "2305.10")).toBe("OH:2305.10");
  });

  it("reads Iowa dotted section numbers without a subsection or a session-law section", () => {
    expect(exactCitationPaths("IA", "Iowa Code § 614.1(2)")).toEqual(["614.1"]);
    expect(exactCitationPaths("IA", "Iowa Code § 614.1(2)")?.includes("614.10")).toBe(false);
    expect(exactCitationPaths("IA", "Iowa Code § 614.1(2)")?.includes("614")).toBe(false);
    expect(exactCitationPaths("IA", "Iowa Code § 614.1(2), (2A)(a), (b)")).toEqual(["614.1"]);
    expect(exactCitationPaths("IA", "Iowa Code § 614.1(2), (2A)(a), (b)")?.includes("2A")).toBe(
      false,
    );
    expect(exactCitationPaths("IA", "Iowa Code § 614.1(2); § 633.336; § 611.20")).toEqual([
      "614.1",
      "633.336",
      "611.20",
    ]);
    expect(exactCitationPaths("IA", "Iowa Code § 614.1(4); § 614.4")).toEqual(["614.1", "614.4"]);
    expect(exactCitationPaths("IA", "Iowa Code § 4.1(34)")).toEqual(["4.1"]);
    expect(exactCitationPaths("IA", "Iowa Code § 4.1(34)")?.includes("34")).toBe(false);
    expect(
      exactCitationPaths(
        "IA",
        "Iowa Code § 614.1(2A)(a); enacted by 1997 Acts, ch 197, § 5",
      )?.includes("5"),
    ).toBe(false);
    expect(
      exactCitationPaths("IA", "Iowa Code § 614.1(2A)(a); enacted by 1997 Acts, ch 197, § 5"),
    ).toEqual(["614.1"]);
    expect(statuteNativeId("IA", "614.1")).toBe("IA:614.1");
    expect(statuteNativeId("IA", "633.336")).toBe("IA:633.336");
    expect(statuteNativeId("IA", "611.20")).toBe("IA:611.20");
    expect(statuteNativeId("IA", "614.4")).toBe("IA:614.4");
    expect(statuteNativeId("IA", "4.1")).toBe("IA:4.1");
  });

  it("reads Washington RCW 4.16.080 as the whole section number", () => {
    expect(exactCitationPaths("WA", "RCW 4.16.080(2)")).toEqual(["4.16.080"]);
    expect(exactCitationPaths("WA", "RCW 4.16.080(2)")?.includes("4.16")).toBe(false);
    expect(exactCitationPaths("WA", "RCW 4.16.080(2)")?.includes("16.080")).toBe(false);
    expect(exactCitationPaths("WA", "RCW 4.16.080(2)")?.includes("14.16.080")).toBe(false);
    expect(exactCitationPaths("WA", "RCW 14.16.080")).toEqual(["14.16.080"]);
    expect(statuteNativeId("WA", "4.16.080")).toBe("WA:4.16.080");
  });

  it("reads West Virginia section numbers, including the stored capital letter", () => {
    expect(exactCitationPaths("WV", "W. Va. Code § 55-2-12(b)")).toEqual(["55-2-12"]);
    expect(exactCitationPaths("WV", "W. Va. Code § 55-2-12(a)-(b)")).toEqual(["55-2-12"]);
    expect(exactCitationPaths("WV", "W. Va. Code § 55-2-6")).toEqual(["55-2-6"]);
    expect(exactCitationPaths("WV", "W. Va. Code § 55-2-6")?.includes("55-2-6A")).toBe(false);
    expect(exactCitationPaths("WV", "W. Va. Code § 55-2-6a")).toEqual(["55-2-6A"]);
    expect(exactCitationPaths("WV", "W. Va. Code § 55-2-6a")?.includes("55-2-6")).toBe(false);
    expect(exactCitationPaths("WV", "W. Va. Code § 55-2-6a")?.includes("55-2-6a")).toBe(false);
    expect(exactCitationPaths("WV", "W. Va. Code § 55-7B-4(a)")).toEqual(["55-7B-4"]);
    expect(exactCitationPaths("WV", "W. Va. Code § 55-7-6(d)")).toEqual(["55-7-6"]);
    expect(exactCitationPaths("WV", "W. Va. Code § 2-2-1(d)")).toEqual(["2-2-1"]);
    expect(statuteNativeId("WV", "55-2-12")).toBe("WV:55-2-12");
    expect(statuteNativeId("WV", "55-2-6A")).toBe("WV:55-2-6A");
    expect(statuteNativeId("WV", "55-7B-4")).toBe("WV:55-7B-4");
    expect(statuteNativeId("WV", "55-7-6")).toBe("WV:55-7-6");
    expect(statuteNativeId("WV", "2-2-1")).toBe("WV:2-2-1");
  });

  it("reads a Pennsylvania title and section as one path", () => {
    expect(exactCitationPaths("PA", "42 Pa.C.S. § 5524(2)")).toEqual(["42:5524"]);
    expect(exactCitationPaths("PA", "42 Pa.C.S. § 5524(2)")?.includes("5524")).toBe(false);
    expect(exactCitationPaths("PA", "42 Pa.C.S. § 5524(2)")?.includes("42")).toBe(false);
    expect(exactCitationPaths("PA", "42 Pa.C.S. § 5524(2)")?.includes("42:5524.1")).toBe(false);
    expect(exactCitationPaths("PA", "42 Pa.C.S. § 5524(3), (4), (7)")).toEqual(["42:5524"]);
    expect(exactCitationPaths("PA", "42 Pa.C.S. § 5524.1")).toEqual(["42:5524.1"]);
    expect(exactCitationPaths("PA", "42 Pa.C.S. § 5524.1")?.includes("42:5524")).toBe(false);
    expect(exactCitationPaths("PA", "42 Pa.C.S. § 5524.1; publisher note at § 5524")).toEqual([
      "5524",
      "42:5524.1",
    ]);
    expect(
      exactCitationPaths("PA", "42 Pa.C.S. § 5524.1; publisher note at § 5524")?.includes(
        "42:5524",
      ),
    ).toBe(false);
    expect(exactCitationPaths("PA", "42 Pa.C.S. § 5533(b)(2)(i)")).toEqual(["42:5533"]);
    expect(exactCitationPaths("PA", "42 Pa.C.S. § 5522(a)(1)")).toEqual(["42:5522"]);
    expect(exactCitationPaths("PA", "42 Pa.C.S. § 5525(a)(8)")).toEqual(["42:5525"]);
    expect(exactCitationPaths("PA", "42 Pa.C.S. § 5536(a)(2)")).toEqual(["42:5536"]);
    expect(exactCitationPaths("PA", "1 Pa.C.S. § 1908")).toEqual(["1:1908"]);
    expect(exactCitationPaths("PA", "40 P.S. § 1303.513(d) (MCARE Act § 513(d))")).toBeNull();
    expect(
      exactCitationPaths(
        "PA",
        "42 Pa.C.S. § 5524(2) (applied to medical professional liability claims; MCARE Act § 513, 40 P.S. § 1303.513)",
      ),
    ).toEqual(["513", "42:5524"]);
    expect(statuteNativeId("PA", "42:5524")).toBe("PA:42:5524");
    expect(statuteNativeId("PA", "42:5524.1")).toBe("PA:42:5524.1");
    expect(statuteNativeId("PA", "1:1908")).toBe("PA:1:1908");
  });

  it("reads Nevada 41A.097 with the chapter letter and without the parenthetical", () => {
    expect(exactCitationPaths("NV", "Nev. Rev. Stat. § 41A.097(3)")).toEqual(["41A.097"]);
    expect(exactCitationPaths("NV", "Nev. Rev. Stat. § 41A.097(2)")).toEqual(["41A.097"]);
    expect(exactCitationPaths("NV", "Nev. Rev. Stat. § 41A.097(1)")).toEqual(["41A.097"]);
    expect(exactCitationPaths("NV", "Nev. Rev. Stat. § 41A.097(3)")?.includes("41.097")).toBe(
      false,
    );
    expect(exactCitationPaths("NV", "Nev. Rev. Stat. § 41A.097(3)")?.includes("41A.09")).toBe(
      false,
    );
    expect(exactCitationPaths("NV", "NRS 41A.098")).toEqual(["41A.098"]);
    expect(
      onlyExactStoredSection("41A.097", [
        { citationPath: "41A.097", sectionNumbers: ["41A.097"] },
        { citationPath: "41.097", sectionNumbers: ["41.097"] },
        { citationPath: "41A.098", sectionNumbers: ["41A.098"] },
      ])?.citationPath,
    ).toBe("41A.097");
    expect(statuteNativeId("NV", "41A.097")).toBe("NV:41A.097");
  });

  it("reads Illinois 735 ILCS 5/13-202 without a neighboring section", () => {
    expect(exactCitationPaths("IL", "735 ILCS 5/13-202")).toEqual(["735 ILCS 5/13-202"]);
    expect(exactCitationPaths("IL", "735 ILCS 5/13-202")?.includes("13-202")).toBe(false);
    expect(exactCitationPaths("IL", "735 ILCS 5/13-202")?.includes("735 ILCS 5/13-202.1")).toBe(
      false,
    );
    expect(exactCitationPaths("IL", "735 ILCS 5/13-202")?.includes("220 ILCS 5/13-202")).toBe(
      false,
    );
    expect(exactCitationPaths("IL", "735 ILCS 5/13-202(b)")).toEqual(["735 ILCS 5/13-202"]);
    expect(exactCitationPaths("IL", "735 ILCS 5/13-202.1")).toEqual(["735 ILCS 5/13-202.1"]);
    expect(exactCitationPaths("IL", "735 ILCS 5/13-202.1")?.includes("735 ILCS 5/13-202")).toBe(
      false,
    );
    expect(exactCitationPaths("IL", "40 ILCS 5/13-202")).toEqual(["40 ILCS 5/13-202"]);
    expect(statuteNativeId("IL", "735 ILCS 5/13-202")).toBe("IL:735 ILCS 5/13-202");
  });

  it("reads Massachusetts chapter 260 section 2A without a neighbor", () => {
    expect(exactCitationPaths("MA", "Mass. Gen. Laws ch. 260, § 2A")).toEqual(["260:2A"]);
    expect(exactCitationPaths("MA", "Mass. Gen. Laws ch. 260, § 2A")?.includes("260:2")).toBe(
      false,
    );
    expect(exactCitationPaths("MA", "Mass. Gen. Laws ch. 260, § 2A")?.includes("260:2B")).toBe(
      false,
    );
    expect(exactCitationPaths("MA", "Mass. Gen. Laws ch. 260, § 2A")?.includes("2A")).toBe(false);
    expect(exactCitationPaths("MA", "Mass. Gen. Laws ch. 260, § 2")).toEqual(["260:2"]);
    expect(exactCitationPaths("MA", "Mass. Gen. Laws ch. 260, § 2B")).toEqual(["260:2B"]);
    expect(exactCitationPaths("MA", "Mass. Gen. Laws ch. 260, § 2A(a)")).toEqual(["260:2A"]);
    expect(exactCitationPaths("MA", "Mass. Gen. Laws ch. 106, § 2-318")).toEqual(["106:2-318"]);
    expect(exactCitationPaths("MA", "Mass. Gen. Laws ch. 106, § 2-318")?.includes("106:2")).toBe(
      false,
    );
    expect(exactCitationPaths("MA", "Mass. Gen. Laws ch. 106, § 2-318")?.includes("2-318")).toBe(
      false,
    );
    expect(exactCitationPaths("MA", "Mass. Gen. Laws ch. 106, § 2-725(1)")).toEqual(["106:2-725"]);
    const both = "Mass. Gen. Laws ch. 106, § 2-318; see also ch. 260, § 2A";
    expect(exactCitationPaths("MA", both)).toEqual(["106:2-318", "260:2A"]);
    expect(statuteNativeId("MA", "106:2-318")).toBe("MA:106:2-318");
    expect(exactCitationPaths("MA", "Mass. Gen. Laws ch. 260, §§ 2A to 2B")).toBeNull();
    expect(statuteNativeId("MA", "260:2A")).toBe("MA:260:2A");
  });

  it("reads Maine title 14 section 752 without another title or a lettered neighbor", () => {
    expect(exactCitationPaths("ME", "14 M.R.S. § 752")).toEqual(["14/752"]);
    expect(exactCitationPaths("ME", "14 M.R.S. § 752")?.includes("752")).toBe(false);
    expect(exactCitationPaths("ME", "14 M.R.S. § 752")?.includes("14/752-B")).toBe(false);
    expect(exactCitationPaths("ME", "14 M.R.S. § 752-B")).toEqual(["14/752-B"]);
    expect(exactCitationPaths("ME", "14 M.R.S. § 752-B")?.includes("14/752")).toBe(false);
    expect(exactCitationPaths("ME", "14 M.R.S. § 752-B")?.includes("752-B")).toBe(false);
    const sixYears = {
      citationPath: "Title 14/Part 2/Chapter 205/§752",
      sectionNumbers: ["752"],
      titleNumbers: ["14"],
    };
    const ski = {
      citationPath: "Title 14/Part 2/Chapter 205/§752-B",
      sectionNumbers: ["752-B"],
      titleNumbers: ["14"],
    };
    const otherTitle = {
      citationPath: "Title 10/Chapter 1/§752",
      sectionNumbers: ["752"],
      titleNumbers: ["10"],
    };
    const otherLetter = {
      citationPath: "Title 17-A/Chapter 1/§752-B",
      sectionNumbers: ["752-B"],
      titleNumbers: ["17-A"],
    };
    expect(onlyExactStoredSection("14/752", [sixYears, ski, otherTitle])?.citationPath).toBe(
      sixYears.citationPath,
    );
    expect(onlyExactStoredSection("752", [sixYears, otherTitle])).toBeNull();
    expect(onlyExactStoredSection("14/752-B", [ski, otherLetter, sixYears])?.citationPath).toBe(
      ski.citationPath,
    );
    expect(onlyExactStoredSection("752-B", [ski, otherLetter])).toBeNull();
    expect(statuteNativeId("ME", "14/752")).toBe("ME:14/752");
  });

  it("reads Maryland Courts article sections without another article's number", () => {
    expect(exactCitationPaths("MD", "Md. Code, Cts. & Jud. Proc. § 5-101")).toEqual(["gcj 5-101"]);
    expect(exactCitationPaths("MD", "Md. Code, Cts. & Jud. Proc. § 5-101")?.includes("5-101")).toBe(
      false,
    );
    expect(
      exactCitationPaths("MD", "Md. Code, Cts. & Jud. Proc. § 5-101")?.includes("gab 5-101"),
    ).toBe(false);
    expect(exactCitationPaths("MD", "Md. Code, Cts. & Jud. Proc. § 5-105")).toEqual(["gcj 5-105"]);
    expect(exactCitationPaths("MD", "Md. Code, Cts. & Jud. Proc. § 5-108(a)-(c), (e)")).toEqual([
      "gcj 5-108",
    ]);
    expect(
      exactCitationPaths("MD", "Md. Code, Cts. & Jud. Proc. § 5-108(a)-(c), (e)")?.includes(
        "5-108",
      ),
    ).toBe(false);
    expect(
      onlyExactStoredSection("5-101", [
        { citationPath: "gcj 5-101", sectionNumbers: ["5-101"] },
        { citationPath: "gab 5-101", sectionNumbers: ["5-101"] },
      ]),
    ).toBeNull();
    expect(statuteNativeId("MD", "gcj 5-101")).toBe("MD:gcj 5-101");
    expect(exactCitationPaths("MD", "Md. Code, Gen. Provisions § 1-302(a)-(b)")).toEqual([
      "ggp 1-302",
    ]);
    expect(
      exactCitationPaths("MD", "Md. Code, Gen. Provisions § 1-302(a)-(b)")?.includes("1-302"),
    ).toBe(false);
    expect(
      exactCitationPaths("MD", "Md. Code, Gen. Provisions § 1-302(a)-(b)")?.includes("gcj 1-302"),
    ).toBe(false);
    expect(statuteNativeId("MD", "ggp 1-302")).toBe("MD:ggp 1-302");
  });

  it("reads Louisiana Revised Statutes 9:5628 without the decimal neighbor", () => {
    expect(exactCitationPaths("LA", "La. R.S. 9:5628(A)")).toEqual(["9:5628"]);
    expect(exactCitationPaths("LA", "La. R.S. 9:5628(A)")?.includes("5628")).toBe(false);
    expect(exactCitationPaths("LA", "La. R.S. 9:5628(A)")?.includes("9:5628.1")).toBe(false);
    expect(exactCitationPaths("LA", "La. R.S. 9:5628.1")).toEqual(["9:5628.1"]);
    expect(statuteNativeId("LA", "9:5628")).toBe("LA:9:5628");
  });

  it("reads a Louisiana Civil Code article without its neighbor", () => {
    expect(exactCitationPaths("LA", "La. Civ. Code art. 2315.1(A)")).toEqual(["2315.1"]);
    expect(exactCitationPaths("LA", "La. Civ. Code art. 2315.2(B)")).toEqual(["2315.2"]);
    expect(exactCitationPaths("LA", "La. Civ. Code art. 2315.2(F)")).toEqual(["2315.2"]);
    expect(exactCitationPaths("LA", "La. Civ. Code art. 2315.1(A)")?.includes("2315.10")).toBe(
      false,
    );
    expect(exactCitationPaths("LA", "La. Civ. Code art. 2315.2(B)")?.includes("2315.1")).toBe(
      false,
    );
    expect(exactCitationPaths("LA", "La. Civ. Code art. 2315.2(B)")?.includes("2315")).toBe(false);
    expect(
      exactCitationPaths(
        "LA",
        "La. Civ. Code arts. 3492 and 3493 (repealed eff. 2024-07-01 by Acts 2024, No. 423, §2)",
      ),
    ).toEqual(["3492", "3493"]);
    expect(
      exactCitationPaths(
        "LA",
        "La. Civ. Code arts. 3492 and 3493 (repealed eff. 2024-07-01 by Acts 2024, No. 423, §2)",
      )?.includes("3493.1"),
    ).toBe(false);
    expect(
      exactCitationPaths(
        "LA",
        "La. Civ. Code arts. 3492 and 3493 (repealed eff. 2024-07-01 by Acts 2024, No. 423, §2)",
      )?.includes("2"),
    ).toBe(false);
    expect(exactCitationPaths("LA", "La. Civ. Code arts. 3492 to 3493")).toBeNull();
    expect(statuteNativeId("LA", "2315.1")).toBe("LA:2315.1");
    expect(statuteNativeId("LA", "2315.2")).toBe("LA:2315.2");
  });

  it("reads Kentucky 413.140 and 413.120 as separate sections", () => {
    expect(exactCitationPaths("KY", "Ky. Rev. Stat. § 413.140(1)(a)")).toEqual(["413.140"]);
    expect(exactCitationPaths("KY", "Ky. Rev. Stat. § 413.140(1)(a)")?.includes("413.14")).toBe(
      false,
    );
    expect(exactCitationPaths("KY", "Ky. Rev. Stat. § 413.140(1)(a)")?.includes("413.120")).toBe(
      false,
    );
    expect(exactCitationPaths("KY", "Ky. Rev. Stat. § 413.120(13)")).toEqual(["413.120"]);
    expect(exactCitationPaths("KY", "Ky. Rev. Stat. § 413.120(13)")?.includes("413.12")).toBe(
      false,
    );
    expect(
      onlyExactStoredSection("413.140", [
        { citationPath: "413.140", sectionNumbers: ["413.140"] },
        { citationPath: "413.120", sectionNumbers: ["413.120"] },
      ])?.citationPath,
    ).toBe("413.140");
    expect(statuteNativeId("KY", "413.140")).toBe("KY:413.140");
  });

  it("reads Kentucky wrongful death sections and ignores prose to", () => {
    const citation =
      "Ky. Rev. Stat. § 413.140(1)(a) (applied to the KRS 411.130 wrongful death action by Estate of Wittich v. Flick, 2015-SC-000114-DG (Ky. 2017)); § 413.180(1)-(2)";
    expect(exactCitationPaths("KY", citation)).toEqual(["413.140", "411.130", "413.180"]);
    expect(exactCitationPaths("KY", citation)?.includes("413.14")).toBe(false);
    expect(exactCitationPaths("KY", "KRS 413.090 to 413.160")).toBeNull();
    expect(exactCitationPaths("FL", "Fla. Stat. §§ 95.11 to 95.12")).toBeNull();
    expect(exactCitationPaths("MI", "MCL 600.5805 through 600.5806")).toBeNull();
  });

  it("reads Oregon 12.110 without the parenthetical", () => {
    expect(exactCitationPaths("OR", "ORS 12.110(1)")).toEqual(["12.110"]);
    expect(exactCitationPaths("OR", "ORS 12.110(1)")?.includes("12.11")).toBe(false);
    expect(exactCitationPaths("OR", "ORS 12.110(1)")?.includes("12.1101")).toBe(false);
    expect(statuteNativeId("OR", "12.110")).toBe("OR:12.110");
  });

  it("reads Minnesota 541.05 without the subdivision or the next section", () => {
    expect(exactCitationPaths("MN", "Minn. Stat. § 541.05, subd. 1(5)")).toEqual(["541.05"]);
    expect(exactCitationPaths("MN", "Minn. Stat. § 541.05, subd. 1(5)")?.includes("541.051")).toBe(
      false,
    );
    expect(exactCitationPaths("MN", "Minn. Stat. § 541.051")).toEqual(["541.051"]);
    expect(statuteNativeId("MN", "541.05")).toBe("MN:541.05");
  });

  it("keeps the trailing letter on Michigan 600.5851b", () => {
    expect(
      exactCitationPaths("MI", "Mich. Comp. Laws § 600.5805(6); minor victims also § 600.5851b(1)"),
    ).toEqual(["600.5805", "600.5851b"]);
    expect(exactCitationPaths("MI", "MCL 600.5851b(1)")).toEqual(["600.5851b"]);
    expect(exactCitationPaths("MI", "MCL 600.5851b(1)")?.includes("600.5851")).toBe(false);
    expect(statuteNativeId("MI", "600.5851b")).toBe("MI:600.5851b");
  });

  it("does not shorten a path or accept a range", () => {
    expect(exactCitationPaths("WY", "Wyo. Stat. § 1-3-1050")).toEqual(["1-3-1050"]);
    expect(exactCitationPaths("WY", "Wyo. Stat. § 1-3-1050")?.includes("1-3-105")).toBe(false);
    expect(exactCitationPaths("OK", "Okla. Stat. tit. 12, §§ 95–96")).toBeNull();
    expect(exactCitationPaths("OK", "Okla. Stat. tit. 12 and tit. 76, § 95")).toBeNull();
    expect(exactCitationPaths("TX", "Tex. Civ. Prac. & Rem. Code § 16.003(a)")).toEqual([
      "CP:16.003",
    ]);
    expect(exactCitationPaths("TX", "Tex. Civ. Prac. & Rem. Code § 16.003(a)")?.includes("16.003")).toBe(
      false,
    );
    expect(
      exactCitationPaths("TX", "Tex. Civ. Prac. & Rem. Code § 16.003(a)")?.includes("CP:16.0031"),
    ).toBe(false);
    expect(
      exactCitationPaths("TX", "Tex. Civ. Prac. & Rem. Code § 16.003(a)")?.includes("AG:16.003"),
    ).toBe(false);
    expect(statuteNativeId("TX", "CP:16.003")).toBe("TX:CP:16.003");
    expect(
      exactCitationPaths("TX", "Tex. Civ. Prac. & Rem. Code §§ 16.003(a), 16.012(b)"),
    ).toEqual(["CP:16.003", "CP:16.012"]);
    expect(
      exactCitationPaths("TX", "Tex. Civ. Prac. & Rem. Code §§ 16.003(a), 16.012(b)")?.includes(
        "16.012",
      ),
    ).toBe(false);
    expect(
      exactCitationPaths("TX", "Tex. Civ. Prac. & Rem. Code §§ 16.003(a), 16.012(b)")?.includes(
        "FI:16.012",
      ),
    ).toBe(false);
    expect(exactCitationPaths("TX", "Tex. Civ. Prac. & Rem. Code § 16.012(a)(2), (b)")).toEqual([
      "CP:16.012",
    ]);
    expect(exactCitationPaths("TX", "Tex. Bus. & Com. Code § 2.725(a)")).toEqual(["BC:2.725"]);
    expect(exactCitationPaths("TX", "Tex. Bus. & Com. Code § 2.725(a)")?.includes("2.725")).toBe(
      false,
    );
    expect(exactCitationPaths("TX", "Tex. Bus. & Com. Code § 2.725(a)")?.includes("2.72")).toBe(
      false,
    );
    expect(
      exactCitationPaths(
        "TX",
        "Tex. Bus. & Com. Code § 2.725(a); Tex. Civ. Prac. & Rem. Code § 16.012(a)(2), (b)",
      ),
    ).toEqual(["BC:2.725", "CP:16.012"]);
    expect(
      exactCitationPaths(
        "TX",
        "Tex. Bus. & Com. Code § 2.725(a); Tex. Civ. Prac. & Rem. Code § 16.012(a)(2), (b)",
      )?.includes("CP:2.725"),
    ).toBe(false);
  });

  it("links Connecticut personal injury only when one stored section has that exact number", () => {
    expect(exactCitationPaths("CT", "Conn. Gen. Stat. § 52-584")).toEqual(["52-584"]);
    const injury = {
      citationPath: "2025/title_52/chap_926/sec_52-584",
      sectionNumbers: ["52-584"],
    };
    const nearby = {
      citationPath: "2025/title_52/chap_926/sec_52-584a",
      sectionNumbers: ["52-584a"],
    };
    expect(sectionTokenAfterSec(injury.citationPath)).toBe("52-584");
    expect(sectionTokenAfterSec("2025/title_01/chap_001/secs_1-1o_to_1-1s")).toBeNull();
    expect(
      storedSectionNumbers([
        { level: "title", number: "52*", heading: "CIVIL ACTIONS" },
        { level: "chapter", number: "52-598a", heading: "STATUTE OF LIMITATIONS" },
        {
          level: "section",
          number: "52-584",
          heading: "Limitation of action for injury to person or property",
        },
      ]),
    ).toEqual(["52-584"]);
    expect(onlyExactStoredSection("52-584", [injury, nearby])?.citationPath).toBe(
      injury.citationPath,
    );
    expect(tokenEqualsStoredSection("52-584", nearby.citationPath, nearby.sectionNumbers)).toBe(
      false,
    );
    expect(tokenEqualsStoredSection("926", injury.citationPath, injury.sectionNumbers)).toBe(false);
    expect(tokenEqualsStoredSection("52-598a", injury.citationPath, injury.sectionNumbers)).toBe(
      false,
    );
    expect(tokenEqualsStoredSection("52-584", injury.citationPath, [])).toBe(true);
    expect(
      tokenEqualsStoredSection("52-584", nearby.citationPath, [
        "Limitation of action for injury to person or property",
      ]),
    ).toBe(false);
    expect(
      onlyExactStoredSection("1-125", [
        {
          citationPath: "2025/title_01/chap_012/sec_1-125",
          sectionNumbers: ["1-125"],
        },
        {
          citationPath: "2026sup/title_01/chap_012/sec_1-125",
          sectionNumbers: ["1-125"],
        },
      ]),
    ).toBeNull();
    expect(
      onlyExactStoredSection("17a-175", [
        {
          citationPath: "2025/title_17a/chap_319a/sec_17a-175",
          sectionNumbers: ["17a-175"],
        },
        {
          citationPath: "2025/title_17a/chap_319i/sec_17a-175",
          sectionNumbers: ["17a-615"],
        },
      ]),
    ).toBeNull();
  });
});

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

  it("links Delaware 8119 when that number is the only last path segment", () => {
    expect(exactCitationPaths("DE", "10 Del. C. § 8119")).toEqual(["8119"]);
    expect(exactCitationPaths("DE", "10 Del. C. § 8119")?.includes("10")).toBe(false);
    expect(exactCitationPaths("DE", "10 Del. C. §§ 8119, 8121, 8127")).toEqual([
      "8119",
      "8121",
      "8127",
    ]);
    expect(exactCitationPaths("DE", "10 Del. C. § 8131(a)")).toEqual(["8131"]);
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
    expect(exactCitationPaths("TX", "Tex. Civ. Prac. & Rem. Code § 16.003(a)")).toBeNull();
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

import { describe, expect, it } from "vitest";
import {
  exactCitationPaths,
  onlyExactStoredSection,
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

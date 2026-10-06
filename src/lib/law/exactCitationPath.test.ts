import { describe, expect, it } from "vitest";
import { exactCitationPaths, statuteNativeId } from "./exactCitationPath";

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

  it("does not shorten a path or accept a range", () => {
    expect(exactCitationPaths("WY", "Wyo. Stat. § 1-3-1050")).toEqual(["1-3-1050"]);
    expect(exactCitationPaths("WY", "Wyo. Stat. § 1-3-1050")?.includes("1-3-105")).toBe(false);
    expect(exactCitationPaths("OK", "Okla. Stat. tit. 12, §§ 95–96")).toBeNull();
    expect(exactCitationPaths("OK", "Okla. Stat. tit. 12 and tit. 76, § 95")).toBeNull();
    expect(exactCitationPaths("TX", "Tex. Civ. Prac. & Rem. Code § 16.003(a)")).toBeNull();
  });
});

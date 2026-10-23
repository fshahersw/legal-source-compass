import { describe, expect, it } from "vitest";
import type { Member } from "@/lib/external/congressMembers";
import { buildMemberBillsByCongress, memberBillsTitle } from "./congressMember";

const member = (over: Partial<NonNullable<Member["bills"]>> | null = {}): Member =>
  ({
    id: "A000055",
    name: "Aderholt, Robert B.",
    bills:
      over === null
        ? null
        : {
            coverage: "108th-119th Congress",
            retrieved: "2026-10-23",
            sponsoredByCongress: { "117": 5, "118": 12, "119": 3 },
            cosponsoredByCongress: { "117": 300, "118": 400, "119": 90 },
            sponsoredTotal: 20,
            cosponsoredTotal: 790,
            withdrawn: 2,
            congressesServed: [117, 118, 119],
            servedOnlyInCollection: true,
            ...over,
          },
  }) as unknown as Member;

describe("buildMemberBillsByCongress", () => {
  it("plots the Congresses the member served in, with the open Congress partial and out of the latest value", () => {
    const b = buildMemberBillsByCongress(member(), "sponsored")!;
    expect(b.xKind).toBe("congress");
    expect(b.chart).toBe("bar");
    expect(b.unit).toBe("measures");
    expect(b.series[0]!.points).toEqual([
      { x: "117", value: 5 },
      { x: "118", value: 12 },
      { x: "119", value: 3, partial: true },
    ]);
    expect(b.latest).toMatchObject({ value: 12, period: "118th Congress (2023–2024)" });
    expect(b.latest!.change).toMatchObject({ absolute: 7, previousValue: 5 });
    expect(b.period).toBe("117th Congress (2021–2022)–119th Congress (2025–2026)*");
    expect(b.source.url).toBe("https://www.govinfo.gov/bulkdata/BILLSTATUS");
    expect(b.asOf).toBe("2026-10-23");
    expect(b.notes.join(" ")).toContain("first-listed sponsor");
    expect(b.notes.join(" ")).toContain("119th Congress (2025–2026)* is still in session");
  });

  it("treats a served Congress with none sponsored as a real zero", () => {
    const b = buildMemberBillsByCongress(
      member({ sponsoredByCongress: { "118": 4 } }),
      "sponsored",
    )!;
    expect(b.series[0]!.points.map((p) => p.value)).toEqual([0, 4, 0]);
    expect(b.gaps).toBe(0);
  });

  it("says when earlier service is outside the collection and when Congresses were skipped", () => {
    const b = buildMemberBillsByCongress(
      member({
        congressesServed: [108, 110],
        servedOnlyInCollection: false,
        sponsoredByCongress: { "108": 1, "110": 2 },
      }),
      "sponsored",
    )!;
    expect(b.notes.join(" ")).toContain("service in earlier Congresses is not counted here");
    expect(b.notes.join(" ")).toContain(
      "Congresses in which this member held no term are not shown",
    );
    expect(b.series[0]!.points.map((p) => p.x)).toEqual(["108", "110"]);
  });

  it("counts cosponsorships without the withdrawn ones and says how many were withdrawn", () => {
    const b = buildMemberBillsByCongress(member(), "cosponsored")!;
    expect(b.series[0]!.points.map((p) => p.value)).toEqual([300, 400, 90]);
    expect(b.notes.join(" ")).toContain("2 withdrawn");
    expect(memberBillsTitle("cosponsored")).toContain("not withdrawn");
  });

  it("has nothing to plot without bill records or a term inside the collection's range", () => {
    expect(buildMemberBillsByCongress(member(null), "sponsored")).toBeNull();
    expect(buildMemberBillsByCongress(member({ congressesServed: [] }), "cosponsored")).toBeNull();
  });
});

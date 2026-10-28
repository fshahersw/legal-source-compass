import { describe, expect, it } from "vitest";
import {
  addResponse,
  areaTitle,
  censusSaipe,
  modeledRow,
  num,
  queryUrl,
  SAHIE,
  SAIPE,
  statesIn,
  type Area,
} from "./censusModeled";
import { recordableUrl } from "../http";

describe("SAIPE and SAHIE", () => {
  it("reads the API's printed numbers and nothing else", () => {
    expect(num("12.9")).toBe(12.9);
    expect(num("78840")).toBe(78840);
    expect(num("-1.5")).toBe(-1.5);
    expect(num("")).toBeNull();
    expect(num(" ")).toBeNull();
    expect(num("1e3")).toBeNull();
    expect(num(null)).toBeNull();
    expect(num("N")).toBeNull();
  });

  it("builds county queries for a state range and keeps the key out of the request ledger", () => {
    const url = queryUrl(SAIPE, "county", "2024", "SECRET", statesIn(["01", "06"]));
    expect(url).toContain("for=county:*&in=state:01,02,04,05,06&time=2024");
    expect(url).toContain("SAEPOVRTALL_PT,SAEPOVRTALL_MOE");
    expect(recordableUrl(url)).not.toContain("SECRET");
    expect(queryUrl(SAHIE, "us", "from+2006", "K")).toContain(
      "for=us:*&time=from+2006&AGECAT=0&RACECAT=0&SEXCAT=0&IPRCAT=0",
    );
    expect(statesIn(["01", "56"])).toHaveLength(51);
    // every state is in exactly one SAIPE part
    const covered = SAIPE.parts.flatMap((p) => statesIn(p));
    expect(new Set(covered).size).toBe(51);
    expect(covered).toHaveLength(51);
  });

  it("accumulates yearly responses into per-area series, the later response winning a repeated year", () => {
    const areas = new Map<string, Area>();
    const head = [
      "NAME",
      "SAEPOVRTALL_PT",
      "SAEPOVRTALL_MOE",
      "SAEPOVALL_PT",
      "SAEPOVALL_MOE",
      "SAEPOVRT0_17_PT",
      "SAEPOVRT0_17_MOE",
      "SAEMHI_PT",
      "SAEMHI_MOE",
      "time",
      "state",
      "county",
    ];
    addResponse(
      SAIPE,
      [
        head,
        [
          "Cook County",
          "13.7",
          "0.5",
          "697586",
          "23279",
          "17.6",
          "1.2",
          "82729",
          "1381",
          "2024",
          "17",
          "031",
        ],
      ],
      areas,
    );
    addResponse(
      SAIPE,
      [head, ["Cook County", "14.0", "0.5", "", "", "", "", "", "", "2023", "17", "031"]],
      areas,
    );
    addResponse(
      SAIPE,
      [head, ["Cook County", "13.9", "0.4", "", "", "", "", "", "", "2023", "17", "031"]],
      areas,
    );
    addResponse(
      SAIPE,
      [
        ["NAME", "SAEPOVRTALL_PT", "time", "us"],
        ["United States", "12.1", "2024", "00"],
      ],
      areas,
    );
    const cook = areas.get("17031")!;
    expect(areaTitle(cook)).toBe("Cook County, IL");
    const row = modeledRow(SAIPE, cook, "2026-10-28");
    expect(row.id).toBe("saipe:17031");
    expect(row.county_geoids).toEqual(["17031"]);
    expect(row.state).toBe("IL");
    expect(
      (row.item["modeled"] as { series: Record<string, unknown> }).series["poverty_rate"],
    ).toEqual([
      [2023, 13.9, 0.4],
      [2024, 13.7, 0.5],
    ]);
    expect(row.item["cells"]).toMatchObject({
      poverty_rate: 13.7,
      median_household_income: 82729,
      latest_year: 2024,
    });
    expect(row.detail["facts"]).toContainEqual([
      "Median household income",
      "$82,729 ± $1,381 (2024)",
    ]);
    const us = modeledRow(SAIPE, areas.get("US")!, "2026-10-28");
    expect(us.id).toBe("saipe:US");
    expect(us.county_geoids).toEqual([]);
    expect(us.state).toBe("");
  });

  it("refuses to run without the key", async () => {
    await expect(
      censusSaipe.collect({
        http: {} as never,
        corpus: {} as never,
        cursor: null,
        now: new Date(),
        env: () => undefined,
      }),
    ).rejects.toThrow(/CENSUS_API_KEY is not set/);
  });
});

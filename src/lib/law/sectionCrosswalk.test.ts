import { describe, expect, it } from "vitest";
import {
  crosswalkFor,
  deviceSummary,
  fmvssCoverageNote,
  recallYears,
  toDeviceType,
  toVehicleRecall,
} from "./sectionCrosswalk";

describe("crosswalkFor", () => {
  it("maps only exact device regulation numbers and 49 CFR 571.N standards", () => {
    expect(crosswalkFor("21", "870.3610")).toEqual({ kind: "device", regulation: "870.3610" });
    expect(crosswalkFor("21", "314.70")).toBeNull();
    expect(crosswalkFor("49", "571.208")).toEqual({ kind: "vehicle", fmvss: "208" });
    expect(crosswalkFor("49", "571.213b")).toEqual({ kind: "vehicle", fmvss: "213b" });
    expect(crosswalkFor("49", "567.4")).toBeNull();
    expect(crosswalkFor("49", "571.5")).toBeNull();
    expect(crosswalkFor("16", "1500.3")).toBeNull();
  });
});

describe("devices", () => {
  // Shaped like agency_safety_openfda_device_classification_20261002 filters (scalars, not arrays).
  const row = (code: string, cls: string, implant: string) => ({
    filters: {
      product_code: code,
      device_name: `Device ${code}`,
      device_class: cls,
      implant_flag: implant,
      life_sustain_support_flag: "N",
      medical_specialty_description: "Cardiovascular",
      regulation_number: "870.3610",
    },
  });
  it("counts classes and implants exactly", () => {
    const rows = [row("DXY", "3", "Y"), row("LWS", "3", "N"), row("ABC", "2", "")].flatMap(
      (r) => toDeviceType(r) ?? [],
    );
    expect(rows[2]!.implant).toBeNull();
    expect(deviceSummary(rows)).toEqual({
      types: 3,
      classIII: 2,
      implants: 1,
      lifeSustaining: 0,
      byClass: [
        { label: "Class II", value: 1 },
        { label: "Class III", value: 2 },
      ],
    });
  });
});

describe("vehicle recalls", () => {
  const r = (id: string, date: string | null, units: string | null) =>
    toVehicleRecall({
      id,
      title: `MAKER — ${id}`,
      report_date: date,
      units,
      manufacturer: "MAKER",
    })!;
  it("keeps a missing unit count null and fills quiet years with zero recalls", () => {
    const rows = [
      r("10V1", "2010-08-05", "53449"),
      r("12V1", "2012-01-02", null),
      r("26V1", "2026-03-01", "10"),
    ];
    expect(rows[1]!.units).toBeNull();
    const ys = recallYears(rows, "2026-10-27");
    expect(ys[0]).toEqual({ year: "2010", recalls: 1, units: 53449, partial: false });
    expect(ys.find((y) => y.year === "2011")).toEqual({
      year: "2011",
      recalls: 0,
      units: 0,
      partial: false,
    });
    expect(ys.find((y) => y.year === "2012")?.units).toBeNull();
    expect(ys.at(-1)).toEqual({ year: "2026", recalls: 1, units: 10, partial: true });
    expect(recallYears([], "2026-10-27")).toEqual([]);
  });
});

describe("fmvssCoverageNote", () => {
  it("states the share of recalls naming no standard and the first year, from the counts read", () => {
    expect(fmvssCoverageNote({ total: 15_319, untagged: 12_091, firstYear: "2010" })).toBe(
      "79% of NHTSA recall records name no standard; recalls held from 2010.",
    );
    expect(fmvssCoverageNote({ total: 10, untagged: 5, firstYear: null })).toBe(
      "50% of NHTSA recall records name no standard.",
    );
    expect(fmvssCoverageNote(null)).toBeNull();
    expect(fmvssCoverageNote({ total: 0, untagged: 0, firstYear: null })).toBeNull();
    expect(fmvssCoverageNote({ total: 5, untagged: 9, firstYear: null })).toBeNull();
  });
});

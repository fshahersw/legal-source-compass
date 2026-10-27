import { describe, expect, it } from "vitest";
import {
  buildNhtsaPipeline,
  openProbesByManufacturer,
  probeStatus,
  quantile,
  type InvestigationRow,
  type RecallRow,
} from "./nhtsaPipeline";

const inv = (o: Partial<InvestigationRow>): InvestigationRow => ({
  id: "PE24001",
  type: "Preliminary evaluation",
  opened: "2024-01-10",
  closed: "2025-01-10",
  recall: "—",
  mfr: "Nissan North America, Inc.",
  subject: "Engine failure",
  ...o,
});
const rec = (o: Partial<RecallRow>): RecallRow => ({
  id: "25V437000",
  date: "2025-06-27",
  mfr: "Nissan North America, Inc.",
  inf: "ODI",
  dnd: "false",
  po: "false",
  pa: "443899",
  ...o,
});

describe("probeStatus", () => {
  it("keeps legacy and incomplete open rows apart from current probes", () => {
    expect(probeStatus({ opened: "2025-02-01", mfr: "Tesla, Inc." })).toBe("current");
    expect(probeStatus({ opened: "1992-01-01", mfr: "GM" })).toBe("legacy");
    expect(probeStatus({ opened: "—", mfr: "" })).toBe("incomplete");
    expect(probeStatus({ opened: "2024-01-01", mfr: " " })).toBe("incomplete");
  });
});

describe("quantile", () => {
  it("interpolates and is null for no values", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([10, 20, 30, 40], 0.5)).toBe(25);
  });
});

describe("buildNhtsaPipeline", () => {
  it("links a probe to a recall only by the exact campaign number present in the recall data", () => {
    const p = buildNhtsaPipeline(
      [
        inv({ id: "PE24001", recall: "25V437000" }), // exact and present: 534 days
        inv({ id: "PE24002", recall: "25V999000" }), // exact but absent from the recall data
        inv({ id: "PE24003", recall: "25V43700" }), // malformed
        inv({ id: "EA25001", type: "Engineering analysis", opened: "2025-03-01", closed: "Open" }),
        inv({ id: "ID92001", type: "Investigation", opened: "—", closed: "Open", mfr: "" }),
        inv({ id: "SQ95001", type: "Investigation", opened: "1995-01-01", closed: "Open" }),
      ],
      [rec({}), rec({ id: "24V001000", date: "2024-03-01", inf: "MFR", dnd: "true" })],
      "2026-10-27T00:00:00Z",
    );
    expect(p.totals).toMatchObject({ citing: 2, matched: 1 });
    const pe = p.conversion.find((c) => c.type === "Preliminary evaluation")!;
    expect(pe).toMatchObject({ closed: 3, citesRecall: 2, matched: 1, medianDays: 534 });
    expect(p.openCounts).toEqual({ current: 1, legacy: 1, incomplete: 1 });
    expect(p.open[0]!.id).toBe("EA25001");
    expect(p.open[0]!.ageDays).toBe(daysTo("2025-03-01", p.asOf!));
    const y2025 = p.recallYears.find((y) => y.year === "2025")!;
    expect(y2025).toMatchObject({ campaigns: 1, odi: 1, doNotDrive: 0, partial: true });
    expect(p.recallYears.find((y) => y.year === "2024")!.doNotDrive).toBe(1);
    expect(p.odiVehiclesLast12).toBe(443899);
    expect(openProbesByManufacturer(p.open).get("Nissan North America, Inc.")).toBe(1);
  });
});

function daysTo(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

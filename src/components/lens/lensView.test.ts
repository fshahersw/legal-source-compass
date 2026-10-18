import { describe, expect, it } from "vitest";
import type { MdlRow } from "@/lib/external/mdlAnalytics.functions";
import { growthPct, peerRanking } from "./lensView";

const row = (
  mdl: number,
  pending: number,
  change12m: number | null,
  type = "Products Liability",
  status: MdlRow["status"] = "pending",
) => ({ mdl, pending, change12m, type, status, title: `IN RE: ${mdl}` }) as MdlRow;

describe("case lens view", () => {
  const all = [
    row(1, 1000, 100),
    row(2, 500, 400),
    row(3, 300, -50),
    row(4, 9000, 0, "Antitrust"),
    row(5, 800, 10, "Products Liability", "terminated"),
  ];
  it("ranks only pending MDLs of the same type", () => {
    const r = peerRanking(all, 2, "Products Liability");
    expect(r.peers.map((p) => p.mdl)).toEqual([1, 2, 3]);
    expect(r.position).toBe(2);
    expect(r.count).toBe(3);
  });
  it("ranks growth by percent of the pending count a year earlier", () => {
    // MDL 2 grew from 100 to 500 (+400%), MDL 1 from 900 to 1000 (+11%).
    expect(peerRanking(all, 2, "Products Liability").growthPosition).toBe(1);
  });
  it("reports growth only when a positive base exists", () => {
    expect(growthPct(500, 400)).toBe(400);
    expect(growthPct(100, 100)).toBeNull();
    expect(growthPct(null, 10)).toBeNull();
  });
});

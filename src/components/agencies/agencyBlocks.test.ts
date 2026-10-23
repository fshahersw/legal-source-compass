import { describe, expect, it } from "vitest";
import { BLOCKS } from "@/lib/analytics/registry";
import { AGENCY_BLOCKS, agencyBlockIds } from "./agencyBlocks";

describe("agency series mapping", () => {
  it("names only blocks the Analytics registry defines, each at most once per agency", () => {
    const known = new Set(BLOCKS.map((b) => b.id));
    for (const [agency, ids] of Object.entries(AGENCY_BLOCKS)) {
      expect(new Set(ids).size, `agency ${agency}`).toBe(ids.length);
      for (const id of ids) expect(known.has(id), `${agency}: ${id}`).toBe(true);
    }
  });

  it("gives a department none of its components' series and an unknown agency nothing", () => {
    expect(agencyBlockIds(271)).toEqual([]); // Labor Department: OSHA is a component, listed under its own id
    expect(agencyBlockIds(386)).toContain("osha-inspections");
    expect(agencyBlockIds(999999)).toEqual([]);
  });
});

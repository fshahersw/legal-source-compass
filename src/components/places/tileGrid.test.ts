import { describe, expect, it } from "vitest";
import { STATES } from "@/lib/corpus/geo";
import { TILE_COLS, TILE_GRID, TILE_ROWS, tileInk } from "./tileGrid";

describe("state tile grid", () => {
  it("places the 50 states and DC exactly once each", () => {
    const usps = TILE_GRID.map((t) => t.usps).sort();
    expect(usps).toHaveLength(51);
    expect(new Set(usps).size).toBe(51);
    const fiftyAndDc = STATES.filter((s) => s.usps !== "PR")
      .map((s) => s.usps)
      .sort();
    expect(usps).toEqual(fiftyAndDc);
  });

  it("never puts two states in the same cell and stays inside the grid", () => {
    const cells = TILE_GRID.map((t) => `${t.col},${t.row}`);
    expect(new Set(cells).size).toBe(cells.length);
    for (const t of TILE_GRID) {
      expect(t.col).toBeGreaterThanOrEqual(0);
      expect(t.col).toBeLessThan(TILE_COLS);
      expect(t.row).toBeGreaterThanOrEqual(0);
      expect(t.row).toBeLessThan(TILE_ROWS);
    }
  });

  it("keeps neighbours roughly where readers expect them", () => {
    const at = (u: string) => TILE_GRID.find((t) => t.usps === u)!;
    expect(at("WA").col).toBeLessThan(at("ME").col);
    expect(at("ND").row).toBeLessThan(at("TX").row);
    expect(at("CA").col).toBe(0);
  });

  it("switches label ink past the middle of the ramp and has none for unrecorded tiles", () => {
    expect(tileInk(16)).toBe("low");
    expect(tileInk(90)).toBe("high");
    expect(tileInk(null)).toBe("none");
  });
});

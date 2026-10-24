import { describe, expect, it } from "vitest";
import { panelOffset } from "./panelPlacement";

const base = { windowWidth: 1024, panelWidth: 496 };

describe("panelOffset", () => {
  it("keeps a panel aligned with its trigger when it fits", () => {
    expect(panelOffset({ ...base, triggerLeft: 300 })).toBe(0);
    expect(panelOffset({ ...base, triggerLeft: 512 })).toBe(0);
  });
  it("slides a panel left just enough to stay inside the window", () => {
    // 1024 - 16 - 496 = 512 is the furthest the panel may start
    expect(panelOffset({ ...base, triggerLeft: 650 })).toBe(-138);
    expect(panelOffset({ ...base, triggerLeft: 761 })).toBe(-249);
  });
  it("never starts left of the edge margin", () => {
    expect(panelOffset({ ...base, triggerLeft: 4 })).toBe(12);
  });
  it("starts at the edge margin when the panel is as wide as the window", () => {
    expect(panelOffset({ triggerLeft: 300, windowWidth: 400, panelWidth: 380 })).toBe(-284);
    expect(panelOffset({ triggerLeft: 300, windowWidth: 400, panelWidth: 400 })).toBe(-284);
  });
});

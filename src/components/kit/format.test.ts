import { describe, expect, it } from "vitest";
import {
  MINUS,
  deltaDirection,
  deltaTone,
  directionLabel,
  formatCompact,
  formatSigned,
  formatSignedPercent,
  splitChangeText,
} from "./format";

describe("deltaDirection", () => {
  it.each([
    [12700, "up"],
    [-19, "down"],
    [0, "flat"],
    [-0, "flat"],
    [0.0001, "up"],
  ] as const)("%s is %s", (v, d) => expect(deltaDirection(v)).toBe(d));
  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "%s has no direction",
    (v) => expect(deltaDirection(v)).toBeNull(),
  );
  it("labels each direction in words", () => {
    expect(directionLabel("up")).toBe("Up");
    expect(directionLabel("down")).toBe("Down");
    expect(directionLabel("flat")).toBe("No change");
    expect(directionLabel(null)).toBe("");
  });
});

describe("deltaTone", () => {
  it("stays neutral without an agreed good direction", () => {
    expect(deltaTone("up")).toBe("neutral");
    expect(deltaTone("down", null)).toBe("neutral");
  });
  it("is good or bad only against the agreed direction", () => {
    expect(deltaTone("up", "up")).toBe("good");
    expect(deltaTone("down", "up")).toBe("bad");
    expect(deltaTone("down", "down")).toBe("good");
    expect(deltaTone("up", "down")).toBe("bad");
  });
  it("is neutral for no change or no direction", () => {
    expect(deltaTone("flat", "up")).toBe("neutral");
    expect(deltaTone(null, "up")).toBe("neutral");
  });
});

describe("signed numbers", () => {
  it("prints a plus sign, a true minus sign and grouping", () => {
    expect(formatSigned(12700)).toBe("+12,700");
    expect(formatSigned(-19)).toBe(`${MINUS}19`);
    expect(formatSigned(0)).toBe("0");
    expect(formatSigned(-1234.5, { digits: 1 })).toBe(`${MINUS}1,234.5`);
  });
  it("drops the sign of a value that rounds to zero", () => {
    expect(formatSignedPercent(-0.04)).toBe("0.0%");
    expect(formatSignedPercent(0.04)).toBe("0.0%");
  });
  it("prints percentages with one decimal by default", () => {
    expect(formatSignedPercent(4.4)).toBe("+4.4%");
    expect(formatSignedPercent(-40.43)).toBe(`${MINUS}40.4%`);
    expect(formatSignedPercent(99.1, 0)).toBe("+99%");
  });
  it("prints nothing for a value that is not a finite number", () => {
    expect(formatSigned(Number.NaN)).toBe("");
    expect(formatCompact(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("formatCompact", () => {
  it.each([
    [950, "950"],
    [12_940, "12.9K"],
    [48_210, "48.2K"],
    [1_000_000, "1M"],
    [1_234_567, "1.2M"],
    [3_940_000_000, "3.9B"],
    [999_950, "1M"],
    [-2_500, `${MINUS}2.5K`],
  ] as const)("%s → %s", (v, s) => expect(formatCompact(v)).toBe(s));
});

describe("splitChangeText", () => {
  it("splits change, percentage and comparison, keeping each part as printed", () => {
    expect(splitChangeText("+12,700 (+4.4%) vs FY2024")).toEqual({
      change: "+12,700",
      percent: "+4.4%",
      comparison: "FY2024",
    });
    expect(splitChangeText(`${MINUS}129,421 (${MINUS}39.6%) vs FY2024`)).toEqual({
      change: `${MINUS}129,421`,
      percent: `${MINUS}39.6%`,
      comparison: "FY2024",
    });
  });
  it("keeps a long comparison period whole", () => {
    expect(
      splitChangeText(`${MINUS}10,148 (${MINUS}18.2%) vs 12 months ending September 30, 2024`),
    ).toEqual({
      change: `${MINUS}10,148`,
      percent: `${MINUS}18.2%`,
      comparison: "12 months ending September 30, 2024",
    });
  });
  it("handles a change without a percentage", () => {
    expect(splitChangeText("+0.3 percentage points vs 2024")).toEqual({
      change: "+0.3 percentage points",
      percent: null,
      comparison: "2024",
    });
    expect(splitChangeText("+4 vs As of September 1, 2026")).toEqual({
      change: "+4",
      percent: null,
      comparison: "As of September 1, 2026",
    });
  });
  it("returns an unrecognised sentence whole", () => {
    expect(splitChangeText("No earlier period")).toEqual({
      change: "No earlier period",
      percent: null,
      comparison: null,
    });
  });
});

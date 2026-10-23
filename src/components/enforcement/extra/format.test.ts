import { describe, expect, it } from "vitest";
import { fmtDate, fmtInt, fmtMonths, fmtPct, share, titleCase } from "./format";

describe("enforcement extra format", () => {
  it("formats numbers and the not-recorded path", () => {
    expect(fmtInt(169031)).toBe("169,031");
    expect(fmtInt(null)).toBe("Not recorded");
    expect(fmtPct(69.6)).toBe("69.6%");
    expect(fmtPct(undefined)).toBe("Not recorded");
    expect(fmtMonths(6.71)).toBe("6.7 mo");
    expect(fmtMonths(97)).toBe("97 mo");
    expect(fmtMonths(null)).toBe("Not recorded");
  });

  it("formats ISO dates without time-zone shifts and rejects others", () => {
    expect(fmtDate("2026-10-17")).toBe("17 Oct 2026");
    expect(fmtDate("2220-09-17")).toBe("17 Sep 2220");
    expect(fmtDate("2026-13-01")).toBe("Not recorded");
    expect(fmtDate("Indefinite")).toBe("Not recorded");
  });

  it("computes shares and title case", () => {
    expect(share(1, 4)).toBe(25);
    expect(share(1, 0)).toBeNull();
    expect(titleCase("TEXAS SOUTHERN")).toBe("Texas Southern");
  });
});

import { describe, expect, it } from "vitest";
import { isCikAddress, paddedCik, requestedCik } from "./cik";

describe("company page CIK addresses", () => {
  it("accepts exactly 10 digits", () => {
    expect(isCikAddress("0001326801")).toBe(true);
    expect(isCikAddress("1326801")).toBe(false);
    expect(isCikAddress("00013268010")).toBe(false);
    expect(isCikAddress("notacik")).toBe(false);
    expect(isCikAddress(" 0001326801")).toBe(false);
  });
});

describe("requestedCik", () => {
  it("returns the value the user typed, trimmed", () => {
    expect(requestedCik({ cik: "notacik" })).toBe("notacik");
    expect(requestedCik({ cik: "  1326801 " })).toBe("1326801");
  });
  it("bounds long values with an ellipsis", () => {
    const long = "x".repeat(41);
    expect(requestedCik({ cik: long })).toBe(`${"x".repeat(40)}…`);
    expect(requestedCik({ cik: "y".repeat(40) })).toBe("y".repeat(40));
  });
  it("is null for missing, blank or malformed data", () => {
    expect(requestedCik(undefined)).toBeNull();
    expect(requestedCik(null)).toBeNull();
    expect(requestedCik({})).toBeNull();
    expect(requestedCik({ cik: "" })).toBeNull();
    expect(requestedCik({ cik: "   " })).toBeNull();
    expect(requestedCik({ cik: 1326801 })).toBeNull();
    expect(requestedCik("1326801")).toBeNull();
  });
});

describe("paddedCik", () => {
  it("zero-pads a CIK typed without its leading zeros", () => {
    expect(paddedCik("1326801")).toBe("0001326801");
    expect(paddedCik("1")).toBe("0000000001");
    expect(paddedCik("123456789")).toBe("0123456789");
    expect(paddedCik(requestedCik({ cik: " 1326801 " }))).toBe("0001326801");
  });
  it("offers nothing for values that are not a short CIK", () => {
    expect(paddedCik("notacik")).toBeNull();
    expect(paddedCik("12345678901")).toBeNull();
    expect(paddedCik("0001326801")).toBeNull();
    expect(paddedCik("13-26801")).toBeNull();
    expect(paddedCik("0")).toBeNull();
    expect(paddedCik("000")).toBeNull();
    expect(paddedCik("")).toBeNull();
    expect(paddedCik(null)).toBeNull();
    expect(paddedCik(requestedCik({ cik: "9".repeat(45) }))).toBeNull();
  });
});

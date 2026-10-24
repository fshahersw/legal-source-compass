import { describe, expect, it } from "vitest";
import { csvField, csvFileName, toCsv } from "./csv";
import { activeSection } from "./scrollspy";
import { barExtent } from "./bars";

describe("toCsv", () => {
  it("writes a header and rows with CRLF line ends", () => {
    expect(
      toCsv(
        ["State", "Value"],
        [
          ["Alabama", 72.6],
          ["Alaska", 56.3],
        ],
      ),
    ).toBe("State,Value\r\nAlabama,72.6\r\nAlaska,56.3\r\n");
  });
  it("quotes commas, quotes and line breaks", () => {
    expect(csvField("Washington, DC")).toBe('"Washington, DC"');
    expect(csvField('the "Act"')).toBe('"the ""Act"""');
    expect(csvField("a\nb")).toBe('"a\nb"');
  });
  it("leaves a gap empty, never zero", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    expect(csvField(Number.NaN)).toBe("");
    expect(toCsv(["a", "b"], [[null, 0]])).toBe("a,b\r\n,0\r\n");
  });
  it("neutralises text that a spreadsheet would run as a formula, but not numbers", () => {
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField("+4.4%")).toBe("'+4.4%");
    expect(csvField(-19)).toBe("-19");
  });
  it("makes a safe file name", () => {
    expect(csvFileName("Federal civil filings per 100,000 (FY2025)")).toBe(
      "federal-civil-filings-per-100-000-fy2025.csv",
    );
    expect(csvFileName("coverage.csv")).toBe("coverage.csv");
    expect(csvFileName("***")).toBe("data.csv");
  });
});

describe("activeSection", () => {
  const tops = (...v: (number | null)[]) => v.map((top, i) => ({ id: `s${i + 1}`, top }));
  it("is the first section before any has passed the reading line", () => {
    expect(activeSection(tops(300, 900, 1500), 80)).toBe("s1");
  });
  it("is the last section whose top passed the reading line", () => {
    expect(activeSection(tops(-400, 60, 700), 80)).toBe("s2");
    expect(activeSection(tops(-900, -300, 80), 80)).toBe("s3");
  });
  it("is the last section at the bottom of the page", () => {
    expect(activeSection(tops(-900, -300, 400), 80, true)).toBe("s3");
  });
  it("skips sections that are not on the page", () => {
    expect(activeSection(tops(-200, null, 900), 80)).toBe("s1");
    expect(activeSection(tops(null, null), 80)).toBeNull();
    expect(activeSection([], 80)).toBeNull();
  });
});

describe("barExtent", () => {
  it("scales a one-sided bar to the largest value", () => {
    expect(barExtent(50, 200, false)).toEqual({ left: 0, width: 25 });
    expect(barExtent(200, 200, false)).toEqual({ left: 0, width: 100 });
  });
  it("grows signed bars from the centre line", () => {
    expect(barExtent(100, 100, true)).toEqual({ left: 50, width: 50 });
    expect(barExtent(-50, 100, true)).toEqual({ left: 25, width: 25 });
    expect(barExtent(0, 100, true)).toEqual({ left: 50, width: 0 });
  });
  it("draws nothing for a missing value or an empty scale, never a zero bar", () => {
    expect(barExtent(null, 100, false)).toBeNull();
    expect(barExtent(Number.NaN, 100, false)).toBeNull();
    expect(barExtent(5, 0, false)).toBeNull();
  });
});

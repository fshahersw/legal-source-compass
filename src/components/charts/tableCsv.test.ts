import { describe, expect, it } from "vitest";
import { csvFileName, tableCsv } from "./tableCsv";

describe("table CSV", () => {
  it("writes header and rows, quoting commas and quotes, leaving non-text cells empty", () => {
    const csv = tableCsv({
      caption: "Filings",
      columns: [{ label: "Year" }, { label: "Filed, total" }],
      rows: [
        { cells: ["2025", "45,713"] },
        { cells: ['He said "x"', 3] },
        { cells: [{} as never, "Not recorded"] },
      ],
    });
    expect(csv).toBe(
      'Year,"Filed, total"\r\n2025,"45,713"\r\n"He said ""x""",3\r\n,Not recorded\r\n',
    );
    expect(csvFileName("Product liability filings, FY2025")).toBe(
      "product-liability-filings-fy2025.csv",
    );
    expect(csvFileName("!!!")).toBe("chart-data.csv");
  });
});

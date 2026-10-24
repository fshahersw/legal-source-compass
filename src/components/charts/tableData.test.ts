import { describe, expect, it } from "vitest";
import { cellCsv, tableDrawer } from "./tableData";

describe("table spec to the View data drawer", () => {
  it("keeps cells for display and text or numbers for the CSV, Not recorded as a gap", () => {
    const d = tableDrawer({
      caption: "Filings",
      columns: [{ label: "Year" }, { label: "Filed", align: "right" }],
      rows: [
        { key: "2025", cells: ["FY2025", "45,713"] },
        { key: "2024", cells: ["FY2024", "Not recorded"] },
      ],
    });
    expect(d.title).toBe("Filings");
    expect(d.columns.map((c) => c.label)).toEqual(["Year", "Filed"]);
    expect(d.columns[0]!.align).toBe("left");
    expect(d.columns[1]!.value(d.rows[0]!)).toBe("45,713");
    expect(d.columns[1]!.value(d.rows[1]!)).toBeNull();
    expect(d.rowKey(d.rows[1]!, 1)).toBe("2024");
    expect(cellCsv(3)).toBe(3);
    expect(cellCsv({} as never)).toBeNull();
  });
});

/** CSV text of a chart's data table (the "Download CSV" of the table view). Pure. */
import type { ReactNode } from "react";

type CsvTable = {
  caption: string;
  columns: readonly { label: string }[];
  rows: readonly { cells: readonly ReactNode[] }[];
};

/** Text of a cell: strings and numbers as written; anything else (links, icons) as empty. */
function cellText(c: ReactNode): string {
  return typeof c === "string" || typeof c === "number" ? String(c) : "";
}

function quote(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tableCsv(table: CsvTable): string {
  const lines = [table.columns.map((c) => quote(c.label)).join(",")];
  for (const r of table.rows) lines.push(r.cells.map((c) => quote(cellText(c))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** File name for a table's CSV: caption in lower-case words joined by hyphens. */
export function csvFileName(caption: string): string {
  const slug = caption
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${slug || "chart-data"}.csv`;
}

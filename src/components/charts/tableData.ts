/**
 * A chart's table spec as the kit's "View data" drawer wants it: one drawer row per table row, the cells rendered as
 * written, CSV values taken from text and number cells ("Not recorded" stays an empty field, never 0). Pure.
 */
import type { ReactNode } from "react";
import type { DataColumn, DataDrawerProps } from "@/components/kit/DataDrawer";
import type { CsvValue } from "@/components/kit/csv";

export type TableColumn = { label: string; align?: "left" | "right" | undefined };
export type TableRow = { key: string; cells: ReactNode[]; muted?: boolean | undefined };
export type TableSpec = { caption: string; columns: TableColumn[]; rows: TableRow[] };

export function cellCsv(cell: ReactNode): CsvValue {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  if (typeof cell === "string") return cell === "Not recorded" ? null : cell;
  return null;
}

export function tableDrawer(table: TableSpec): Omit<DataDrawerProps<TableRow>, "mode" | "trigger"> {
  const columns: DataColumn<TableRow>[] = table.columns.map((c, i) => ({
    key: `c${i}`,
    label: c.label,
    align: c.align ?? (i === 0 ? "left" : "right"),
    value: (r) => cellCsv(r.cells[i]),
    render: (r) => r.cells[i] ?? null,
  }));
  return {
    title: table.caption,
    columns,
    rows: table.rows,
    rowKey: (r) => r.key,
  };
}

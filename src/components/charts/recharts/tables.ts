/** Data-table specs for the themed charts (the Table view of a ChartCard). Pure. */
import { NOT_RECORDED } from "../format";
import type { ChartSeriesSpec } from "./charts";

type Row = Record<string, unknown>;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Table spec rows for a period chart: one row per period, one column per series, "Not recorded" for gaps. */
export function periodTable(
  rows: readonly Row[],
  xKey: string,
  series: readonly ChartSeriesSpec[],
  format: (v: number) => string,
  options: { caption: string; xLabel?: string; partialKey?: string; total?: boolean } = {
    caption: "",
  },
) {
  const keys = series.map((s) => s.key);
  return {
    caption: options.caption,
    columns: [
      { label: options.xLabel ?? "Period" },
      ...series.map((s) => ({ label: s.label, align: "right" as const })),
      ...(options.total ? [{ label: "Total", align: "right" as const }] : []),
    ],
    rows: [...rows].reverse().map((r) => {
      const vals = keys.map((k) => r[k]);
      const all = vals.every(isNum);
      return {
        key: String(r[xKey]),
        cells: [
          `${String(r[xKey])}${options.partialKey && r[options.partialKey] ? " (partial)" : ""}`,
          ...vals.map((v) => (isNum(v) ? format(v) : NOT_RECORDED)),
          ...(options.total
            ? [all ? format((vals as number[]).reduce((a, v) => a + v, 0)) : NOT_RECORDED]
            : []),
        ],
      };
    }),
  };
}

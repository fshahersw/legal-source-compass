export const FDA_COLORS = ["#153451", "#087f8c", "#d97732", "#5677ad", "#866199", "#6b8590"];
export type ChartPoint = { date: string; value: number | null; end?: string; partial?: boolean };
export type ChartSeries = { id: string; label: string; points: ChartPoint[]; color?: string };
export type FacetBar = { label: string; value: number; percent?: number | null };
export const numberLabel = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US")
    : "Not recorded";
export function chartDateLabel(value: string) {
  const date = new Date(`${value.length === 7 ? `${value}-01` : value}T00:00:00Z`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })
    : value;
}
export function timelineRows(series: ChartSeries[]) {
  const rows = new Map<string, Record<string, string | number | boolean | null>>();
  for (const line of series)
    for (const point of line.points) {
      let row = rows.get(point.date);
      if (!row) {
        row = { date: point.date };
        rows.set(point.date, row);
      }
      row[line.id] = point.value;
      row[`${line.id}__end`] = point.end ?? point.date;
      row[`${line.id}__partial`] = point.partial ?? false;
    }
  return [...rows.values()].sort((a, b) => String(a["date"]).localeCompare(String(b["date"])));
}

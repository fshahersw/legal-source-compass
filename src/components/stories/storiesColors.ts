import { seriesVar } from "@/components/charts/palette";
import type { Category } from "./storiesModel";

/** Litigation-type colours, fixed per type (never by rank), shared by the race, the stream and their legends. */
export const CATEGORY_COLOR: Record<Category, string> = {
  products: seriesVar(0),
  antitrust: seriesVar(2),
  privacy: seriesVar(3),
  consumer: seriesVar(4),
  securities: seriesVar(5),
  other: "var(--chart-base)",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-01" → "Oct 1, 2026". */
export const reportLabel = (iso: string) =>
  `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;

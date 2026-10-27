/**
 * Query objects for the Seeger Weiss hub and the MDL analytics velocity section. The hub table, the PDF counts and the
 * JPML series are three requests that start together; the table never waits for the counts.
 */
import {
  getMatterHub,
  getMatterHubPdfCounts,
  getMdlVelocity,
} from "@/lib/matters/matters.functions";

export const matterHubQuery = {
  queryKey: ["matter-hub"],
  queryFn: () => getMatterHub(),
  staleTime: 2 * 60_000,
};

export const matterHubPdfQuery = {
  queryKey: ["matter-hub-pdf"],
  queryFn: () => getMatterHubPdfCounts(),
  staleTime: 10 * 60_000,
};

export const mdlVelocityQuery = {
  queryKey: ["mdl-velocity"],
  queryFn: () => getMdlVelocity(),
  staleTime: 10 * 60_000,
};

/** The JPML monthly reports the velocity figures come from. */
export const JPML_SOURCE = {
  label: "JPML, Pending MDL Dockets by Actions Pending (monthly reports)",
  url: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
};

export const count = (v: number) => Math.round(v).toLocaleString("en-US");
export const pct = (v: number) => `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}%`;

/** "2026-10" -> "Oct 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Key takeaways and the court-page coverage split for /matters/intel, computed from the published rows. */
import { int, pct, usableTakeaways, type Takeaway } from "@/components/analysis/analysisFormat";
import type { CoverageSegment } from "@/components/analysis/CoverageBar";

export type PageYield = "orders" | "statements" | "nothing" | "failed" | "none";

/** What extraction read from each transferred products-liability MDL's court pages, as a partition. */
export function coverageSegments(yields: readonly PageYield[]): CoverageSegment[] {
  const count = (k: PageYield) => yields.filter((y) => y === k).length;
  const noPage = count("none") + count("failed");
  return [
    { key: "orders", label: "Orders extracted", value: count("orders"), tone: "strong" },
    {
      key: "statements",
      label: "Statements or leadership only",
      value: count("statements"),
      tone: "partial",
    },
    { key: "nothing", label: "Nothing extracted", value: count("nothing"), tone: "weak" },
    {
      key: "none",
      label: yields.includes("failed") ? "No page located and fetched" : "No page located",
      value: noPage,
      tone: "none",
    },
  ];
}

export type IntelTakeawayInput = {
  lastYear: number | null;
  grantSharePct: number | null;
  tenYearGrantMedianPct: number | null;
  motionsFiled: number | null;
  motionsGranted: number | null;
  top5DistrictSharePct: number | null;
  hhiDistrict: number | null;
  transferred: number;
  withOrders: number;
  withPage: number;
  flagged: number | null;
  bellwetherQuoted: number | null;
  plMdls: number | null;
};

export function intelTakeaways(i: IntelTakeawayInput): Takeaway[] {
  return usableTakeaways([
    i.grantSharePct != null && i.lastYear != null
      ? {
          id: "grant-share",
          figure: pct(i.grantSharePct),
          text: `grant share of centralization motions in ${i.lastYear} (${int(i.motionsGranted)} granted, ${int(i.motionsFiled)} filed), against a 10-year median of ${pct(i.tenYearGrantMedianPct)}.`,
          anchor: "trends-h",
          anchorLabel: "See trends",
        }
      : null,
    i.top5DistrictSharePct != null
      ? {
          id: "concentration",
          figure: pct(i.top5DistrictSharePct),
          text: `of pending MDL actions sit in the five busiest transferee districts${i.hhiDistrict != null ? ` (district HHI ${int(i.hhiDistrict)})` : ""}.`,
          anchor: "conc-h",
          anchorLabel: "See concentration",
        }
      : null,
    i.transferred > 0
      ? {
          id: "court-pages",
          figure: `${int(i.withOrders)} of ${int(i.transferred)}`,
          text: `transferred products-liability MDLs have orders extracted from an official court page; ${int(i.withPage)} have a page located.`,
          anchor: "court-h",
          anchorLabel: "See the index",
        }
      : null,
    i.bellwetherQuoted != null && i.plMdls
      ? {
          id: "bellwether",
          figure: `${int(i.bellwetherQuoted)} of ${int(i.plMdls)}`,
          text: "products-liability MDLs have a bellwether or trial statement quoted from the court page; not a representative sample.",
          anchor: "flags-h",
          anchorLabel: "See timing",
        }
      : null,
    i.flagged != null
      ? {
          id: "flagged",
          figure: int(i.flagged),
          text: "products-liability MDLs meet the fast-growth, no-bellwether rule; a lead to review, not a finding.",
          anchor: "flags-h",
          anchorLabel: "See the list",
        }
      : null,
  ]);
}

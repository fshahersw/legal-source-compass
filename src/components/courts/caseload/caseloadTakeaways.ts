/**
 * Key takeaways for the Districts tab, computed only from the rows the page has loaded: the national series and the
 * district table. Every figure names the fiscal year and what it is measured against; nothing is estimated, and the
 * fiscal year in progress is never used.
 */
import {
  changePct,
  int,
  listAnd,
  pct,
  shareOf,
  signedPct,
  topShare,
  usableTakeaways,
  type Takeaway,
} from "@/components/analysis/analysisFormat";
import type { CaseloadYear, DistrictRow } from "@/lib/external/courtCaseload.functions";
import { shortCourtName } from "./caseloadFormat";

export type CaseloadTakeawayInput = {
  /** Latest complete fiscal year, e.g. 2025. */
  fy: number;
  national: CaseloadYear | null;
  nationalPrior: CaseloadYear | null;
  districts: readonly DistrictRow[];
};

export function caseloadTakeaways(i: CaseloadTakeawayInput): Takeaway[] {
  const fy = `FY${i.fy}`;
  const prior = `FY${i.fy - 1}`;
  const withFilings = i.districts.filter((d) => d.filings != null);
  const busiest = [...withFilings].sort((a, b) => b.filings! - a.filings!).slice(0, 3);
  const districtTotal = withFilings.reduce((a, d) => a + d.filings!, 0);
  const topTen =
    withFilings.length >= 10
      ? topShare(
          withFilings.map((d) => d.filings!),
          10,
        )
      : null;
  const timed = i.districts.filter((d) => d.medianDays != null);
  const slowest = [...timed].sort((a, b) => b.medianDays! - a.medianDays!)[0];
  const quickest = [...timed].sort((a, b) => a.medianDays! - b.medianDays!)[0];
  const filingsChange = changePct(i.national?.filings, i.nationalPrior?.filings);
  const pendingChange = changePct(i.national?.pendingEnd, i.nationalPrior?.pendingEnd);
  const mdlShare = shareOf(i.national?.withMdlNumber, i.national?.filings);
  return usableTakeaways([
    i.national?.filings != null && filingsChange != null && i.nationalPrior?.filings != null
      ? {
          id: "filings-change",
          figure: signedPct(filingsChange),
          text: `change in federal civil filings, ${fy} (${int(i.national.filings)}) against ${int(i.nationalPrior.filings)} in ${prior}.`,
          anchor: "caseload-kpis",
          anchorLabel: "See the totals",
        }
      : null,
    i.national?.pendingEnd != null && pendingChange != null && i.nationalPrior?.pendingEnd != null
      ? {
          id: "pending-change",
          figure: signedPct(pendingChange),
          text: `change in civil cases pending on September 30, ${fy} (${int(i.national.pendingEnd)}) against ${int(i.nationalPrior.pendingEnd)} a year earlier.`,
          anchor: "caseload-kpis",
          anchorLabel: "See the totals",
        }
      : null,
    topTen != null && districtTotal > 0
      ? {
          id: "top-ten",
          figure: pct(topTen),
          text: `of ${fy} civil filings in the ${int(withFilings.length)} districts were in the ten busiest; ${listAnd(busiest.map((d) => shortCourtName(d.name)))} lead.`,
          anchor: "caseload-districts",
          anchorLabel: "See the districts",
        }
      : null,
    slowest && quickest && slowest.id !== quickest.id
      ? {
          id: "median-spread",
          figure: `${int(slowest.medianDays)} days`,
          text: `longest median time to termination in ${fy} (${shortCourtName(slowest.name)}), against ${int(quickest.medianDays)} days in ${shortCourtName(quickest.name)}${i.national?.medianDays != null ? `; the national median is ${int(i.national.medianDays)} days` : ""}.`,
          anchor: "caseload-districts",
          anchorLabel: "Sort by median days",
        }
      : null,
    mdlShare != null && i.national?.withMdlNumber != null
      ? {
          id: "mdl-share",
          figure: pct(mdlShare),
          text: `of ${fy} civil filings (${int(i.national.withMdlNumber)}) carry an MDL docket number in the IDB; a historical association, not JPML membership.`,
          anchor: "caseload-kpis",
          anchorLabel: "See the totals",
        }
      : null,
  ]);
}

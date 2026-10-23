/**
 * Pure builder for the member page's two trend cards: measures sponsored and measures cosponsored, by Congress. The counts are
 * those the member record holds from the stored congress_bills records (GovInfo Bill Status, 108th-119th Congress), so the card
 * says exactly what it covers. A Congress is plotted only when the member held a term in it; the collection holds every measure
 * of those Congresses, so a Congress with no sponsored measure is a true zero. The Congress still in session is partial.
 */
import {
  assembleBlock,
  congressIsOpen,
  formatCount,
  periodLabel,
  type TrendBlockData,
  type TrendPoint,
} from "@/lib/analytics/trend";
import type { Member } from "@/lib/external/congressMembers";

export const BILL_SOURCE = {
  label:
    "GovInfo Bill Status (U.S. Government Publishing Office), as stored in the legislation collection",
  url: "https://www.govinfo.gov/bulkdata/BILLSTATUS",
};

export type MemberBillsKind = "sponsored" | "cosponsored";

export const memberBillsTitle = (kind: MemberBillsKind) =>
  kind === "sponsored"
    ? "Measures sponsored in each Congress (first-listed sponsor)"
    : "Measures cosponsored in each Congress (not withdrawn)";

export function buildMemberBillsByCongress(
  member: Member,
  kind: MemberBillsKind,
): TrendBlockData | null {
  const bills = member.bills;
  if (!bills || !bills.congressesServed.length) return null;
  const counts = kind === "sponsored" ? bills.sponsoredByCongress : bills.cosponsoredByCongress;
  const served = [...new Set(bills.congressesServed)].sort((a, b) => a - b);
  const points: TrendPoint[] = served.map((c) => ({
    x: String(c),
    value: counts[String(c)] ?? 0,
    ...(bills.retrieved && congressIsOpen(c, bills.retrieved) ? { partial: true } : {}),
  }));
  const partial = points.find((p) => p.partial);
  const first = served[0]!;
  const last = served[served.length - 1]!;
  const contiguous = served.length === last - first + 1;
  const notes = [
    kind === "sponsored"
      ? "Counts the bills and resolutions for which this member is the first-listed sponsor in the stored Bill Status records. It counts introductions, not outcomes: a measure that did not advance counts the same as one that became law."
      : `Counts the bills and resolutions this member cosponsored in the stored Bill Status records. A cosponsorship the member withdrew is not counted${bills.withdrawn ? ` (${formatCount(bills.withdrawn)} withdrawn in this collection)` : ""}. It counts cosponsorships, not outcomes.`,
    bills.servedOnlyInCollection
      ? "Every Congress in which this member held a term is inside the collection's range, the 108th (2003) to the 119th Congress."
      : "The collection starts with the 108th Congress (2003): service in earlier Congresses is not counted here, so these bars are not the member's career totals.",
    ...(contiguous ? [] : ["Congresses in which this member held no term are not shown."]),
    ...(partial
      ? [
          `${periodLabel(partial.x, "congress")}* is still in session when the records were taken; it is drawn faded and is not used for the latest value or its change.`,
        ]
      : []),
  ];
  return assembleBlock({
    id: `member-${kind}-${member.id}`,
    xKind: "congress",
    chart: "bar",
    unit: "measures",
    series: [
      {
        id: kind,
        label: kind === "sponsored" ? "Measures sponsored" : "Measures cosponsored",
        points,
      },
    ],
    source: BILL_SOURCE,
    asOf: bills.retrieved,
    notes,
  });
}

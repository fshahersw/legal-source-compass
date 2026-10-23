/**
 * Pure builders for the rulemaking and legislation blocks of the Analytics overview: Federal Register documents
 * and bills in Congress. Inputs are already-validated rows; the readers do the I/O.
 */
import {
  assembleBlock,
  congressIsOpen,
  longDate,
  ordinal,
  yearPoints,
  type TrendBlockData,
  type TrendPoint,
} from "../trend";

export type FederalRegisterYears = {
  /** Final rules (document type RULE) per publication year. */
  rules: Readonly<Record<string, number>>;
  /** Proposed rules (document type PRORULE) per publication year. */
  proposed: Readonly<Record<string, number>>;
  asOf: string | null;
};

/** First year whose Federal Register document types are comparable: the API types most 1994 documents as uncategorized. */
export const FR_FIRST_COMPARABLE_YEAR = 1995;

/** Federal Register API facet counts: final rules and proposed rules published per calendar year. */
export function buildFederalRegister(input: FederalRegisterYears): TrendBlockData | null {
  const years = (rec: Readonly<Record<string, number>>) =>
    Object.entries(rec)
      .filter(
        ([y, n]) =>
          /^\d{4}$/.test(y) && Number(y) >= FR_FIRST_COMPARABLE_YEAR && Number.isFinite(n),
      )
      .map(([y, n]) => ({ year: Number(y), value: n }));
  const rules = years(input.rules);
  const proposed = years(input.proposed);
  if (!rules.length) return null;
  const lastYear = Math.max(...rules.map((r) => r.year));
  const partialYear = input.asOf && input.asOf < `${lastYear}-12-31` ? lastYear : null;
  const flag = (entries: { year: number; value: number }[]) =>
    entries.map((e) => ({ ...e, ...(e.year === partialYear ? { partial: true } : {}) }));
  return assembleBlock({
    id: "federal-register",
    xKind: "year",
    chart: "line",
    unit: "documents",
    series: [
      { id: "rules", label: "Final rules", points: yearPoints(flag(rules)) },
      { id: "proposed", label: "Proposed rules", points: yearPoints(flag(proposed)) },
    ],
    source: {
      label: "Federal Register API (federalregister.gov)",
      url: "https://www.federalregister.gov/developers/documentation/api/v1",
    },
    asOf: input.asOf,
    notes: [
      "Counts documents published in the Federal Register by publication year and document type. These are whole-Register counts: each document is counted once, not once per issuing agency.",
      `The series starts in ${FR_FIRST_COMPARABLE_YEAR}: the API types most 1994 documents as uncategorized, so 1994 type counts are not comparable.`,
      ...(partialYear
        ? [
            `${partialYear}* runs through ${longDate(input.asOf!)}; it is drawn dashed and is not used for the latest value or its change.`,
          ]
        : []),
    ],
  });
}

export type BillsCongress = {
  congress: number;
  /** Bills (H.R. and S.) and joint resolutions (H.J.Res. and S.J.Res.) introduced. */
  introduced: number | null;
  /** Of the measures in the dataset, those whose status is "became law". */
  becameLaw: number | null;
};

/** GovInfo Bill Status: measures introduced and measures that became law, per Congress. */
export function buildBills(input: {
  congresses: readonly BillsCongress[];
  retrieved: string;
}): TrendBlockData | null {
  if (!input.congresses.some((c) => c.introduced !== null)) return null;
  const sorted = [...input.congresses].sort((a, b) => a.congress - b.congress);
  const open = sorted
    .filter((c) => congressIsOpen(c.congress, input.retrieved))
    .map((c) => c.congress);
  const point = (c: BillsCongress, v: number | null): TrendPoint => ({
    x: String(c.congress),
    value: v,
    ...(open.includes(c.congress) ? { partial: true } : {}),
  });
  return assembleBlock({
    id: "congress-bills",
    xKind: "congress",
    chart: "bar",
    unit: "measures",
    series: [
      { id: "introduced", label: "Introduced", points: sorted.map((c) => point(c, c.introduced)) },
      { id: "law", label: "Became law", points: sorted.map((c) => point(c, c.becameLaw)) },
    ],
    source: {
      label: "GovInfo Bill Status bulk data (U.S. Government Publishing Office)",
      url: "https://www.govinfo.gov/bulkdata/BILLSTATUS",
    },
    asOf: input.retrieved,
    notes: [
      "Counts bills (H.R., S.) and joint resolutions (H.J.Res., S.J.Res.) introduced in each Congress, and those whose Bill Status record shows they became law. Simple and concurrent resolutions are not counted: they do not go to the President.",
      "Each Congress sits for two calendar years, beginning January 3 of an odd-numbered year.",
      ...(open.length
        ? [
            `The ${open.map((n) => ordinal(n)).join(", ")} Congress is still sitting (data retrieved ${longDate(input.retrieved)}); it is drawn as a partial period and is not used for the latest value.`,
          ]
        : []),
    ],
  });
}

import type { Measure } from "@/components/analysis/HowToRead";

/** "How to read this" definitions shared by the state Analysis tab and the cross-state legal view. */
export const ANALYSIS_MEASURES: Measure[] = [
  {
    term: "Federal civil filings by residents",
    means:
      "Civil cases in the FJC Integrated Database filed FY2021-FY2025 whose first plaintiff's county of residence is the county (the first defendant's when the United States sues), per 100,000 residents a year (mean of the July 1, 2021-2025 Census estimates). Core excludes prisoner petitions, MDL-numbered and U.S.-plaintiff cases.",
    caveat:
      "Residents of other states are coded 88888 and never counted in a county. County codes that evidently do not mean residence (a state's first county code used as a default, a division city of the same name, a prison) are screened out and read Not recorded.",
  },
  {
    term: "OSHA and CFPB rates",
    means:
      "Inspections opened FY2021-FY2025 and complaints received 2021-2025, placed in a county by ZIP using the Census 2020 ZIP-code tabulation area file (largest land share), per 100,000 residents a year.",
    caveat:
      "CFPB complaints are not a sample; credit-reporting complaints dominate recent years, so a second measure leaves them out.",
  },
  {
    term: "Environmental actions",
    means:
      "Formal enforcement actions ECHO records for facilities listed in the county, per 1,000 facilities (counties with 20 or more facilities).",
  },
  {
    term: "Small base",
    means:
      "A rate resting on fewer than 10 events in five years; dotted on the map and marked in rankings.",
    caveat: "Small counties swing widely from a handful of cases.",
  },
  {
    term: "Association",
    means:
      "Spearman rank correlation across counties (or states), 95% Fisher interval and a two-sided p, adjusted by Benjamini-Hochberg across all tests in the family. It holds when the adjusted p is below 0.05.",
    caveat:
      "An association is not a cause; these measures share confounders such as urbanisation and where courts, prisons and agencies sit.",
  },
  {
    term: "Districts",
    means:
      "Counties are assigned to federal districts only from 28 U.S.C. ch. 5 (and, for Virginia's independent cities, the courts' local rules). The residence mix of a district's filings comes from the IDB county codes.",
  },
];

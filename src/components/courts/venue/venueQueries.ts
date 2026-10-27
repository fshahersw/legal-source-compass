import {
  getCourtMdlLoad,
  getDistrictEnforcement,
  getFcmsCourt,
  getFcmsVenues,
  getMdlHubHistory,
  getVacancyMdlBoard,
  getVenuePractice,
  getVenueScorecard,
} from "@/lib/external/courtVenue.functions";

const staleTime = 10 * 60 * 1000;

export const mdlHubsQuery = {
  queryKey: ["courts", "venue", "mdl-hubs"],
  queryFn: () => getMdlHubHistory(),
  staleTime,
};
export const fcmsVenuesQuery = {
  queryKey: ["courts", "venue", "fcms"],
  queryFn: () => getFcmsVenues(),
  staleTime,
};
export const vacancyBoardQuery = {
  queryKey: ["courts", "venue", "vacancy-board"],
  queryFn: () => getVacancyMdlBoard(),
  staleTime,
};
export const venuePracticeQuery = {
  queryKey: ["courts", "venue", "practice"],
  queryFn: () => getVenuePractice({ data: { top: 8 } }),
  staleTime,
};
export const venueScorecardQuery = {
  queryKey: ["courts", "venue", "scorecard"],
  queryFn: () => getVenueScorecard(),
  staleTime,
};
export const fcmsCourtQuery = (id: string) => ({
  queryKey: ["courts", "venue", "fcms", id],
  queryFn: () => getFcmsCourt({ data: { id } }),
  staleTime,
});
export const courtMdlLoadQuery = (id: string) => ({
  queryKey: ["courts", "venue", "load", id],
  queryFn: () => getCourtMdlLoad({ data: { id } }),
  staleTime,
});
export const districtEnforcementQuery = (id: string) => ({
  queryKey: ["courts", "venue", "enforcement", id],
  queryFn: () => getDistrictEnforcement({ data: { id } }),
  staleTime,
});

/** Federal district court ids (njd, ohsd, cacd ...); circuits, state and special courts are not district profiles. */
export const DISTRICT_ID = /^[a-z]{2,4}d$/;

export const SOURCES = {
  jb: {
    label: "Judicial Business of the U.S. Courts, Tables C-4A, T-1 and S-19",
    url: "https://www.uscourts.gov/statistics-reports/analysis-reports/judicial-business-united-states-courts",
  },
  fcms: {
    label: "U.S. Courts, Federal Court Management Statistics (district profiles)",
    url: "https://www.uscourts.gov/statistics-reports/analysis-reports/federal-court-management-statistics",
  },
  jpml: {
    label: "JPML, Pending MDL dockets by district",
    url: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
  },
  vacancies: {
    label: "U.S. Courts, current and future judicial vacancies",
    url: "https://www.uscourts.gov/data-news/judicial-vacancies/current-judicial-vacancies",
  },
  fjc: {
    label: "Federal Judicial Center, Biographical Directory (judges.csv)",
    url: "https://www.fjc.gov/history/judges/biographical-directory-article-iii-federal-judges-export",
  },
  cvap: {
    label: "U.S. Census Bureau, ACS 5-year 2020-2024, table B29001 (citizen voting-age population)",
    url: "https://www.census.gov/programs-surveys/decennial-census/about/voting-rights/cvap.html",
  },
  districts: {
    label: "28 U.S.C. chapter 5 (judicial districts and their counties)",
    url: "https://www.govinfo.gov/content/pkg/USCODE-2024-title28/html/USCODE-2024-title28-partI-chap5.htm",
  },
  sec: {
    label: "SEC litigation releases and administrative proceedings",
    url: "https://www.sec.gov/enforcement-litigation/litigation-releases",
  },
  doj: {
    label: "U.S. Department of Justice press releases",
    url: "https://www.justice.gov/news",
  },
} as const;

export const fmtInt = (v: number) => Math.round(v).toLocaleString("en-US");
export const fmtOne = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmtPct = (v: number) => `${fmtOne(v)}%`;
export const fmtMonths = (v: number) => `${fmtOne(v)} months`;
export const fmtDate = (d: string | null) => {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return "Not recorded";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};
/** "District of New Jersey" / "D. New Jersey" short label for chart rows. */
export const shortDistrict = (name: string) =>
  name
    .replace(/^District Court, /, "")
    .replace(/^U\.S\. District Court, /, "")
    .replace(/^District of (the )?/, "D. ")
    .replace(
      /^(Northern|Southern|Eastern|Western|Middle|Central) District of /,
      (_m, p: string) => `${p[0]}.D. `,
    );

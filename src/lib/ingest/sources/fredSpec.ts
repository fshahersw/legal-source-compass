/**
 * The FRED series carried in econ_fred_series / econ_fred_observations (api-econ, wave 1025), with the litigation use
 * each one serves. Pure data; shared by the full build (scripts/api_econ/fred_build.mjs), the scheduled refresh
 * (supabase/functions/ingest-fred) and the calculators (src/lib/calculators).
 *
 * Only public-domain government series are listed (Federal Reserve H.15, BLS, BEA). FRED marks third-party series whose
 * owners restrict reuse with the word "Copyright" in their notes (FRED API Terms of Use, "Property Rights"); the
 * builders refuse any series whose notes carry it, so a restricted series can never be published by adding it here.
 */

export type FredGroup =
  | "judgment_rate"
  | "treasury_daily"
  | "treasury_monthly"
  | "policy_rates"
  | "prices"
  | "wages"
  | "labor"
  | "state_unemployment";

export type FredSpec = {
  /** FRED series id, exactly as FRED publishes it. */
  id: string;
  group: FredGroup;
  /** Short reading label (the FRED title is kept separately, as published). */
  label: string;
  /** What the series is used for here, in one sentence. */
  purpose: string;
  /** USPS code for state series. */
  state?: string;
};

export const GROUP_LABELS: Record<FredGroup, string> = {
  judgment_rate: "Federal post-judgment rate",
  treasury_daily: "Treasury yields (daily)",
  treasury_monthly: "Treasury yields (monthly averages)",
  policy_rates: "Prime, federal funds and bill rates",
  prices: "Consumer prices",
  wages: "Wages and compensation",
  labor: "Unemployment (national)",
  state_unemployment: "Unemployment (states)",
};

const PV = "Discount rate for present value (Treasury constant maturity, H.15).";

const treasury = (
  id: string,
  maturity: string,
  group: "treasury_daily" | "treasury_monthly",
): FredSpec => ({
  id,
  group,
  label: `${maturity} Treasury constant maturity${group === "treasury_monthly" ? ", monthly average" : ", daily"}`,
  purpose: PV,
});

/** The 50 states, DC and Puerto Rico: FRED's seasonally adjusted LAUS unemployment rate series are <USPS>UR. */
export const UR_STATES: readonly [string, string][] = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
  ["PR", "Puerto Rico"],
];

export const FRED_SERIES: readonly FredSpec[] = [
  {
    id: "WGS1YR",
    group: "judgment_rate",
    label: "1-year Treasury constant maturity, weekly average",
    purpose:
      "Rate of post-judgment interest under 28 U.S.C. § 1961(a): the weekly average 1-year constant maturity Treasury yield for the calendar week preceding the judgment (the same rate applies under 18 U.S.C. § 3612(f)(2) and 40 U.S.C. § 3116).",
  },
  treasury("DGS1MO", "1-month", "treasury_daily"),
  treasury("DGS3MO", "3-month", "treasury_daily"),
  treasury("DGS6MO", "6-month", "treasury_daily"),
  treasury("DGS1", "1-year", "treasury_daily"),
  treasury("DGS2", "2-year", "treasury_daily"),
  treasury("DGS3", "3-year", "treasury_daily"),
  treasury("DGS5", "5-year", "treasury_daily"),
  treasury("DGS7", "7-year", "treasury_daily"),
  treasury("DGS10", "10-year", "treasury_daily"),
  treasury("DGS20", "20-year", "treasury_daily"),
  treasury("DGS30", "30-year", "treasury_daily"),
  treasury("GS3M", "3-month", "treasury_monthly"),
  treasury("GS6M", "6-month", "treasury_monthly"),
  treasury("GS1", "1-year", "treasury_monthly"),
  treasury("GS2", "2-year", "treasury_monthly"),
  treasury("GS3", "3-year", "treasury_monthly"),
  treasury("GS5", "5-year", "treasury_monthly"),
  treasury("GS7", "7-year", "treasury_monthly"),
  treasury("GS10", "10-year", "treasury_monthly"),
  treasury("GS20", "20-year", "treasury_monthly"),
  treasury("GS30", "30-year", "treasury_monthly"),
  {
    id: "DPRIME",
    group: "policy_rates",
    label: "Bank prime loan rate, daily",
    purpose:
      "Prime rate as published in H.15; several state judgment-interest statutes and many contracts are keyed to a published prime rate.",
  },
  {
    id: "MPRIME",
    group: "policy_rates",
    label: "Bank prime loan rate, monthly average",
    purpose: "Monthly average of the H.15 prime rate.",
  },
  {
    id: "DFF",
    group: "policy_rates",
    label: "Federal funds effective rate, daily",
    purpose: "Federal funds effective rate (H.15).",
  },
  {
    id: "FEDFUNDS",
    group: "policy_rates",
    label: "Federal funds effective rate, monthly average",
    purpose: "Monthly average of the federal funds effective rate (H.15).",
  },
  {
    id: "TB3MS",
    group: "policy_rates",
    label: "3-month Treasury bill, secondary market, monthly average",
    purpose: "3-month Treasury bill rate on a discount basis (H.15).",
  },
  {
    id: "CPIAUCNS",
    group: "prices",
    label: "CPI-U, all items, U.S. city average, not seasonally adjusted",
    purpose:
      "Inflation adjustment between two months; the not seasonally adjusted CPI-U is the series BLS does not revise.",
  },
  {
    id: "CPIAUCSL",
    group: "prices",
    label: "CPI-U, all items, U.S. city average, seasonally adjusted",
    purpose:
      "Seasonally adjusted CPI-U (revised by BLS for the previous five years each February).",
  },
  {
    id: "CPIMEDNS",
    group: "prices",
    label: "CPI-U, medical care, not seasonally adjusted",
    purpose: "Medical-cost inflation for past and future medical expenses.",
  },
  {
    id: "CPIMEDSL",
    group: "prices",
    label: "CPI-U, medical care, seasonally adjusted",
    purpose: "Seasonally adjusted medical-care CPI-U.",
  },
  {
    id: "CUUR0000SAM2",
    group: "prices",
    label: "CPI-U, medical care services, not seasonally adjusted",
    purpose: "Medical care services component of the CPI-U.",
  },
  {
    id: "CUSR0000SAM2",
    group: "prices",
    label: "CPI-U, medical care services, seasonally adjusted",
    purpose: "Seasonally adjusted medical care services CPI-U.",
  },
  {
    id: "CWUR0000SA0",
    group: "prices",
    label: "CPI-W, all items, not seasonally adjusted",
    purpose:
      "CPI for urban wage earners and clerical workers, the index several statutes and benefit adjustments name.",
  },
  {
    id: "CPILFESL",
    group: "prices",
    label: "CPI-U less food and energy, seasonally adjusted",
    purpose: "Core CPI-U.",
  },
  {
    id: "PCEPI",
    group: "prices",
    label: "PCE chain-type price index",
    purpose: "Personal consumption expenditures price index (BEA).",
  },
  {
    id: "ECIWAG",
    group: "wages",
    label: "ECI wages and salaries, private industry, seasonally adjusted",
    purpose: "Wage growth for lost-earnings projections (Employment Cost Index, BLS).",
  },
  {
    id: "CIU2020000000000I",
    group: "wages",
    label: "ECI wages and salaries, private industry, not seasonally adjusted",
    purpose: "Not seasonally adjusted Employment Cost Index, private wages and salaries.",
  },
  {
    id: "CIS1020000000000I",
    group: "wages",
    label: "ECI wages and salaries, all civilian workers, seasonally adjusted",
    purpose: "Wage growth, all civilian workers (Employment Cost Index, BLS).",
  },
  {
    id: "CIU1020000000000I",
    group: "wages",
    label: "ECI wages and salaries, all civilian workers, not seasonally adjusted",
    purpose: "Not seasonally adjusted Employment Cost Index, civilian wages and salaries.",
  },
  {
    id: "ECIALLCIV",
    group: "wages",
    label: "ECI total compensation, all civilian workers, seasonally adjusted",
    purpose: "Growth of total compensation (wages and benefits), all civilian workers.",
  },
  {
    id: "CES0500000003",
    group: "wages",
    label: "Average hourly earnings, all employees, total private",
    purpose: "Average hourly earnings (Current Employment Statistics, BLS), from March 2006.",
  },
  {
    id: "AHETPI",
    group: "wages",
    label: "Average hourly earnings, production and nonsupervisory employees",
    purpose: "Average hourly earnings of production and nonsupervisory employees, from 1964.",
  },
  {
    id: "UNRATE",
    group: "labor",
    label: "Unemployment rate, seasonally adjusted",
    purpose: "National unemployment rate (Current Population Survey, BLS).",
  },
  {
    id: "UNRATENSA",
    group: "labor",
    label: "Unemployment rate, not seasonally adjusted",
    purpose: "National unemployment rate, not seasonally adjusted.",
  },
  ...UR_STATES.map(
    ([usps, name]): FredSpec => ({
      id: `${usps}UR`,
      group: "state_unemployment",
      label: `Unemployment rate, ${name}, seasonally adjusted`,
      purpose: `State unemployment rate for ${name} (Local Area Unemployment Statistics, BLS).`,
      state: usps,
    }),
  ),
];

export const SPEC_BY_ID: ReadonlyMap<string, FredSpec> = new Map(FRED_SERIES.map((s) => [s.id, s]));

/** Treasury maturities offered as present-value discount rates: label → daily and monthly series ids. */
export const TREASURY_MATURITIES: readonly { label: string; years: number; daily: string; monthly: string }[] =
  [
    { label: "1-month", years: 1 / 12, daily: "DGS1MO", monthly: "" },
    { label: "3-month", years: 0.25, daily: "DGS3MO", monthly: "GS3M" },
    { label: "6-month", years: 0.5, daily: "DGS6MO", monthly: "GS6M" },
    { label: "1-year", years: 1, daily: "DGS1", monthly: "GS1" },
    { label: "2-year", years: 2, daily: "DGS2", monthly: "GS2" },
    { label: "3-year", years: 3, daily: "DGS3", monthly: "GS3" },
    { label: "5-year", years: 5, daily: "DGS5", monthly: "GS5" },
    { label: "7-year", years: 7, daily: "DGS7", monthly: "GS7" },
    { label: "10-year", years: 10, daily: "DGS10", monthly: "GS10" },
    { label: "20-year", years: 20, daily: "DGS20", monthly: "GS20" },
    { label: "30-year", years: 30, daily: "DGS30", monthly: "GS30" },
  ];

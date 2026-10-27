import { describe, expect, it } from "vitest";
import type { DojRelease, HeadlineFigure } from "./enforcementActions.functions";
import {
  heldReason,
  rankLargestResolutions,
  titleAmounts,
  titleTokens,
} from "./enforcementLargest";

let n = 0;
function rel(
  title: string,
  date: string,
  head: Partial<HeadlineFigure> & { valueUsd: number },
  extra: Partial<DojRelease> = {},
): DojRelease {
  n += 1;
  const headline: HeadlineFigure = {
    asWritten: "$1",
    source: "first resolution sentence",
    sentence: null,
    keyword: "settlement",
    qualifier: null,
    differsFromLargest: false,
    ...head,
  };
  return {
    id: `doj-pr:${String(n).padStart(8, "0")}-0000-0000-0000-000000000000`,
    dataset: `doj_press_releases_${date.slice(0, 4)}`,
    title,
    url: `https://www.justice.gov/r/${n}`,
    date,
    number: null,
    components: [],
    topics: [],
    teaser: null,
    amounts: [],
    amountsTotal: 0,
    maxResolutionUsd: headline.valueUsd,
    headline,
    headlineNoneReason: null,
    statutes: [],
    dockets: [],
    courts: [],
    parties: [],
    companies: [],
    officeState: null,
    ...extra,
  };
}

// Shapes measured in doj_press_releases_YYYY on 2026-10-27 (titles and figures as stored).
const MADOFF_DISTRIBUTION = rel(
  "U.S. Attorney Announces Total Distributions Of Over $4 Billion To Victims Of Madoff Ponzi Scheme",
  "2022-09-28",
  { valueUsd: 170_799_000_000 },
);
const LIPKIN = rel(
  "Irwin Lipkin, Former Controller At Bernard L. Madoff Investment Securities LLC, Sentenced In Manhattan Federal Court To Six Months In Prison",
  "2015-08-05",
  { valueUsd: 170e9, keyword: "forfeiture" },
);
const BONVENTRE = rel(
  "Former Director Of Operations For Bernard L. Madoff Investment Securities, Daniel Bonventre, Sentenced In Manhattan Federal Court To 10 Years",
  "2014-12-08",
  { valueUsd: 155.5e9, keyword: "forfeiture" },
);
const FOUR = rel(
  "Four Employees Of Bernard L. Madoff’s Fraudulent Investment Advisory Business Sentenced In Manhattan Federal Court",
  "2014-12-15",
  { valueUsd: 155e9, keyword: "forfeiture" },
);
const CLIMATE = rel(
  "Justice Department Files Motion for Summary Judgment in Challenge to New York’s “Climate Change Superfund Act”",
  "2025-08-29",
  { valueUsd: 75e9, keyword: "judgment" },
);
const EDVA = rel(
  "EDVA Commemorates the 40th Anniversary of National Crime Victims’ Rights Week",
  "2021-04-19",
  { valueUsd: 37e9, keyword: "penalty or fine" },
  { topics: ["Community Outreach"] },
);
const UBS = [
  "UBS agrees to pay $1.435 billion for fraud in the sale of residential mortgage-backed securities",
  "UBS Agrees to Pay $1.435 Billion to Resolve Claims That It Made Misrepresentations in the Sale of Residential Mortgage-Backed Securities",
].map((t) => rel(t, "2023-08-14", { valueUsd: 1.435e9, source: "title" }));
const HSBC = rel(
  "Justice Department Reaches $470 Million Joint State-Federal Settlement with HSBC to Address Mortgage Loan Origination",
  "2016-02-05",
  { valueUsd: 25e9 },
);
const FCA_FY = rel(
  "Justice Department Recovers Over $4.7 Billion From False Claims Act Cases in Fiscal Year 2016",
  "2016-12-14",
  { valueUsd: 4.7e9, source: "title" },
);
const INMATE = rel(
  "Federal inmate Gets 18 More Years for Bogus Involuntary Bankruptcy Petitions Filed Against Warden, Prison Officer",
  "2019-09-09",
  { valueUsd: 20e9, keyword: "judgment" },
);
const BOFA = rel(
  "Bank Of America To Pay $16.65 Billion In Historic Justice Department Settlement For Financial Fraud",
  "2014-08-21",
  { valueUsd: 16.65e9, source: "title" },
);
const BP = rel(
  "U.S. and Five Gulf States Reach Historic Settlement with BP to Resolve Civil Lawsuit Over Deepwater Horizon Oil Spill",
  "2015-10-05",
  { valueUsd: 20.8e9 },
);
const REMARKS = rel(
  "Attorney General Delivers Remarks Announcing a $1.2 Billion Settlement",
  "2018-01-01",
  { valueUsd: 1.2e9, source: "title" },
);

describe("titleAmounts", () => {
  it("reads written amounts with their multipliers", () => {
    expect(titleAmounts("Distribution Of More Than $378 Million To Victims")).toEqual([378e6]);
    expect(titleAmounts("Collects $22,164,212.92 In Fiscal Year 2014")).toEqual([22_164_212.92]);
    expect(titleAmounts("UBS to pay $1.435 billion and $2 B")).toEqual([1.435e9, 2e9]);
    expect(titleAmounts("No figure here")).toEqual([]);
  });
});

describe("heldReason", () => {
  it("holds back non-resolutions by kind", () => {
    expect(heldReason(MADOFF_DISTRIBUTION)?.reason).toBe("distribution");
    expect(heldReason(CLIMATE)?.reason).toBe("filing");
    expect(heldReason(EDVA)?.reason).toBe("personnel");
    expect(heldReason(FCA_FY)?.reason).toBe("statistics");
    expect(heldReason(REMARKS)?.reason).toBe("speech");
  });

  it("holds back a text figure the title contradicts or that the title does not describe", () => {
    const h = heldReason(HSBC)!;
    expect(h.reason).toBe("title_contradicts");
    expect(h.detail).toContain("$470 million");
    expect(heldReason(INMATE)?.reason).toBe("title_no_resolution");
  });

  it("holds back awards, launches, statements, charges, office totals and mismatched outcomes", () => {
    const t = (title: string, keyword = "settlement") =>
      heldReason(rel(title, "2020-01-01", { valueUsd: 2e10, keyword }))?.reason;
    expect(t("Three Individuals In District Of New Jersey Receive Attorney General Awards")).toBe(
      "personnel",
    );
    expect(
      t(
        "The Fraud Division Launches West Coast Strike Force to Target Health Care Fraud",
        "forfeiture",
      ),
    ).toBe("personnel");
    expect(
      t("Statement Of Manhattan U.S. Attorney Preet Bharara On The Guilty Plea By BNP Paribas"),
    ).toBe("speech");
    expect(
      t(
        "Chairman of Prince Group Indicted for Operating Cambodian Forced-Labor Scam Compounds",
        "forfeiture",
      ),
    ).toBe("charge");
    expect(
      t("Justice Department Surpasses $12 Billion in Compensation to Crime Victims Since 2000"),
    ).toBe("statistics");
    expect(
      t(
        "Eastern District Of California U.S. Attorney’s Office Collects Over $9 Billion In Civil And Criminal Actions",
      ),
    ).toBe("statistics");
    // a settlement figure under a plea title belongs to another matter
    expect(
      t(
        "Former Illinois Attorney Pleads Guilty to Tax Evasion in Connection with Legal Fees Stemming from Multi-Billion Dollar Settlement Paid",
      ),
    ).toBe(undefined); // title itself names a settlement paid: kept
    expect(t("Former Illinois Attorney Pleads Guilty to Tax Evasion")).toBe("title_no_resolution");
    expect(t("Co-Founder of the Sinaloa Cartel Pleads Guilty", "forfeiture")).toBeUndefined();
  });

  it("keeps title figures and resolution titles", () => {
    expect(heldReason(BOFA)).toBeNull();
    expect(heldReason(BP)).toBeNull();
    expect(heldReason(LIPKIN)).toBeNull();
  });
});

describe("rankLargestResolutions", () => {
  const all = [
    MADOFF_DISTRIBUTION,
    LIPKIN,
    BONVENTRE,
    FOUR,
    CLIMATE,
    EDVA,
    ...UBS,
    HSBC,
    FCA_FY,
    INMATE,
    BOFA,
    BP,
    REMARKS,
  ];
  const out = rankLargestResolutions(all);

  it("ranks by the headline figure and lists the Madoff forfeiture once", () => {
    const madoff = out.entries.filter((e) => titleTokens(e.release.title).has("madoff"));
    expect(madoff).toHaveLength(1);
    expect(madoff[0]!.valueUsd).toBe(170e9);
    expect(madoff[0]!.related.map((r) => r.id).sort()).toEqual([BONVENTRE.id, FOUR.id].sort());
    expect(out.entries.map((e) => e.valueUsd)).toEqual([170e9, 20.8e9, 16.65e9, 1.435e9]);
  });

  it("collapses releases stating the same figure on the same day", () => {
    const ubs = out.entries.find((e) => e.valueUsd === 1.435e9)!;
    expect(ubs.related).toHaveLength(1);
  });

  it("reports every held release with its reason and counts the candidates", () => {
    expect(out.candidates).toBe(all.length);
    expect(out.held.map((h) => h.reason).sort()).toEqual(
      [
        "distribution",
        "filing",
        "personnel",
        "speech",
        "statistics",
        "title_contradicts",
        "title_no_resolution",
      ].sort(),
    );
  });

  it("does not collapse two unrelated settlements of the same size on different days", () => {
    const a = rel("Acme Widgets Agrees to Pay $2 Billion", "2019-03-01", {
      valueUsd: 2e9,
      source: "title",
    });
    const b = rel("Globex Pharma Agrees to Pay $2 Billion", "2020-03-01", {
      valueUsd: 2e9,
      source: "title",
    });
    expect(rankLargestResolutions([a, b]).entries).toHaveLength(2);
  });

  it("counts a release repeated across partitions once", () => {
    const dup = { ...BOFA, dataset: "doj_press_releases_2015" };
    expect(rankLargestResolutions([BOFA, dup]).candidates).toBe(1);
  });

  it("ignores releases below the threshold or without a headline figure", () => {
    const small = rel("X Agrees to Pay $5 Million", "2020-01-01", {
      valueUsd: 5e6,
      source: "title",
    });
    const none = { ...BP, id: "doj-pr:none", url: null, headline: null };
    expect(rankLargestResolutions([small, none]).candidates).toBe(0);
  });
});

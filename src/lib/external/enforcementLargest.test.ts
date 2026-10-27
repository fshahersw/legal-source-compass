import { describe, expect, it } from "vitest";
import type { DojRelease, HeadlineFigure } from "./enforcementActions.functions";
import {
  heldReason,
  normaliseTitle,
  rankLargestResolutions,
  titleAmounts,
  titleNames,
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
const titled = (title: string, date: string, valueUsd: number, extra: Partial<DojRelease> = {}) =>
  rel(
    title,
    date,
    { valueUsd, source: "title", keyword: null, asWritten: AMOUNT.exec(title)?.[0] ?? "$1" },
    extra,
  );
const AMOUNT = /\$[\d.,]+(?:\s*(?:billion|million|B|M)\b)?/i;
const text = (
  title: string,
  date: string,
  valueUsd: number,
  keyword: string,
  asWritten: string,
  sentence: string,
) => rel(title, date, { valueUsd, keyword, asWritten, sentence });

// Titles, figures and sentences as stored in doj_press_releases_YYYY (read 2026-10-27).
const MADOFF_DISTRIBUTION = text(
  "U.S. Attorney Announces Total Distributions Of Over $4 Billion To Victims Of Madoff Ponzi Scheme",
  "2022-09-28",
  170_799_000_000,
  "forfeiture",
  "$170,799,000,000",
  "Judge Chin ordered MADOFF to forfeit $170,799,000,000 as part of MADOFF’s sentence.",
);
const LIPKIN = text(
  "Irwin Lipkin, Former Controller At Bernard L. Madoff Investment Securities LLC, Sentenced In Manhattan Federal Court To Six Months In Prison",
  "2015-08-05",
  170e9,
  "forfeiture",
  "$170 billion",
  "LIPKIN was also ordered to forfeit $170 billion dollars and various pieces of property, including a house in Florida",
);
const FOUR = text(
  "Four Employees Of Bernard L. Madoff’s Fraudulent Investment Advisory Business Sentenced In Manhattan Federal Court",
  "2014-12-15",
  155e9,
  "forfeiture",
  "$155 billion",
  "BONGIORNO was sentenced last Tuesday to six years in prison, and ordered to forfeit more than $155 billion.",
);
const INMATE = text(
  "Jury Convicts Federal Inmate Who Filed Bogus Involuntary Bankruptcy Petitions Against Warden, Prison Officer",
  "2018-09-27",
  20e9,
  "judgment",
  "$20 billion",
  "The bogus petitions alleged that each victim was indebted to Johnson in the amount of $20 billion, owing to a judgment Johnson claimed to have obtained from the International Court of Justice (also known as the World Court).",
);
const MORTGAGE = text(
  "$25 Billion Mortgage Servicing Agreement Filed in Federal Court",
  "2012-03-12",
  20e9,
  "settlement",
  "$20 billion",
  "The consent judgments provide the details of the servicers’ financial obligations under the agreement, which include payments to foreclosed borrowers and more than $20 billion in consumer relief.",
);
const FRANKLIN = text(
  "Franklin County Woman Pleads Guilty to Conspiring to Possess with Intent to Distribute Methamphetamine",
  "2020-01-15",
  1e9,
  "penalty or fine",
  "$1,000,000,000",
  "Campbell faces imprisonment of not more than 20 years and a fine of not more than $1,000,000,000.",
);
const MDB = text(
  "Justice Department Repatriates $1.4B Misappropriated 1MDB Funds to Malaysia",
  "2024-06-13",
  4.5e9,
  "forfeiture",
  "$4.5 billion",
  "As alleged in the civil forfeiture complaints, from 2009 through 2015, high-level officials of 1MDB, their associates, and Low Taek Jho, also known as Jho Low, misappropriated more than $4.5 billion in funds belonging to 1MDB.",
);
const AMBAC = text(
  "Manhattan U.S. Attorney Announces Proposed Bankruptcy Court Settlement With Ambac For Over $100 Million To Resolve Credit Default Swap Contract Dispute Lawsuits",
  "2013-04-09",
  1e9,
  "settlement",
  "$1 billion",
  "Under the proposed settlement, AMBAC also agrees to reduce its net operating losses attributable to the CDS contracts at issue by $1 billion.",
);
const CUINIS = text(
  "Co-Founder of Los Cuinis Drug Cartel Sentenced to 30 Years in Prison; High-Ranking Cartel de Jalisco Nueva Generación (CJNG) Operative Pleads Guilty",
  "2025-06-20",
  6e9,
  "forfeiture",
  "$6 billion",
  "Shortly after, on March 7, 2025, El Mencho’s son, Ruben Oseguera-Gonzalez, known as El Menchito, was sentenced to a term of life in prison plus 30 years to run consecutively and ordered to forfeit over $6 billion in drug trafficking proceeds.",
);
const COUTTS = text(
  "Justice Department Announces Addendum to Swiss Bank Program Category 2 Non-Prosecution Agreement with Coutts & Co Ltd.",
  "2019-12-20",
  2e9,
  "penalty or fine",
  "$2 billion",
  "At that time, Coutts reported that it held and managed 1,337 U.S. related accounts, with assets under management exceeding $2 billion, and paid a penalty of $78,484,000.",
);
const COMMODITIES = text(
  "Justice Department’s Investigation into International Commodities Trading Companies’ Foreign Bribery Schemes Results in Six Corporate Resolutions and 20 Individuals Convicted",
  "2024-03-28",
  1.7e9,
  "penalty or fine",
  "$1.7 billion",
  "The Justice Department announced today that its long-running investigation has resulted in six corporate resolutions, 20 convictions of individuals, and total fines, forfeitures, and other penalties of more than $1.7 billion.",
);
const LUXURY = text(
  "Convicted Leader of Billion-Dollar Health Care Scam to Plead Guilty to Violating Court Forfeiture Order by Illegally Selling His Luxury Cars",
  "2019-07-24",
  1e9,
  "forfeiture",
  "$1 billion",
  "The imprisoned former owner of Pacific Hospital has agreed to plead guilty for illegally selling his luxury cars, disobeying a court order that he forfeit the money because of a previous conviction for orchestrating a nearly $1 billion health care fraud scheme.",
);
const HSBC = text(
  "Justice Department Reaches $470 Million Joint State-Federal Settlement with HSBC to Address Mortgage Loan Origination",
  "2016-02-05",
  25e9,
  "settlement",
  "$25 billion",
  "The settlement parallels the $25 billion National Mortgage Settlement (NMS) reached in February 2012 between the federal government, 49 state attorneys general and the five largest national mortgage servicers.",
);
const BP_CIVIL = text(
  "U.S. and Five Gulf States Reach Historic Settlement with BP to Resolve Civil Lawsuit Over Deepwater Horizon Oil Spill",
  "2015-10-05",
  20.8e9,
  "settlement",
  "$20.8 billion",
  "Taken together this global resolution of civil claims is worth $20.8 billion, and is the largest settlement with a single entity in the department’s history.",
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

// Title-stated figures.
const BOFA = titled(
  "Bank Of America To Pay $16.65 Billion In Historic Justice Department Settlement For Financial Fraud",
  "2014-08-21",
  16.65e9,
  { components: ["USAO - New York, Eastern"] },
);
const BOFA_OAG = titled(
  "Bank of America to Pay $16.65 Billion in Historic Justice Department Settlement for Financial Fraud",
  "2014-08-21",
  16.65e9,
  { components: ["Office of the Attorney General"] },
);
const BINANCE = titled(
  "Binance and CEO Plead Guilty to Federal Charges in $4B Resolution",
  "2023-11-21",
  4e9,
);
const BP_PLEA = titled(
  "BP Exploration and Production Inc. Pleads Guilty, Is Sentencedto Pay Record $4 Billion for Crimes SurroundingDeepwater Horizon Incident",
  "2013-01-29",
  4e9,
);
const ENDO = titled(
  "Opioid Manufacturer Endo Health Solutions Inc. Ordered to Pay $1.536B In Criminal Fines and Forfeiture for Distributing Misbranded Opioid Medication",
  "2024-05-03",
  1.536e9,
);
const UBS = [
  titled(
    "UBS Agrees to Pay $1.435 Billion to Resolve Claims That It Made Misrepresentations in the Sale of Residential Mortgage-Backed Securities",
    "2023-08-14",
    1.435e9,
    { components: ["USAO - New York, Eastern"] },
  ),
  titled(
    "UBS Agrees to Pay $1.435 Billion for Fraud in the Sale of Residential Mortgage-Backed Securities",
    "2023-08-14",
    1.435e9,
    { components: ["Civil Division", "USAO - New York, Eastern"] },
  ),
  titled(
    "UBS agrees to pay $1.435 billion for fraud in the sale of residential mortgage-backed securities",
    "2023-08-14",
    1.435e9,
    { components: ["USAO - Georgia, Northern"] },
  ),
];
const TAKATA = [
  [
    "Takata Corporation Agrees to Plead Guilty and Pay $1 Billion in Criminal Penalties for Airbag Scheme",
    "2017-01-13",
  ],
  [
    "Takata Corporation Agrees to Plead Guilty and Pay $1 Billion in Criminal Penalties for Airbag Scheme",
    "2017-01-13",
  ],
  [
    "Takata Corporation Pleads Guilty, Sentenced to Pay $1 Billion in Criminal Penalties for Airbag Scheme",
    "2017-02-27",
  ],
  [
    "Takata Corporation Pleads Guilty, Sentenced to Pay $1 Billion in Criminal Penalties for Airbag Scheme",
    "2017-02-28",
  ],
].map(([t, d]) => titled(t!, d!, 1e9));
const OLYMPUS = titled(
  "Medical Equipment Company Will Pay $646 Million for Making Illegal Payments to Doctors and Hospitals in United States and Latin America",
  "2016-03-01",
  646e6,
);
const NOVARTIS = titled(
  "Novartis Pays Over $642 Million to Settle Allegations of Improper Payments to Patients and Physicians",
  "2020-07-01",
  642e6,
);

describe("titleAmounts", () => {
  it("reads written amounts with their multipliers", () => {
    expect(titleAmounts("Distribution Of More Than $378 Million To Victims")).toEqual([378e6]);
    expect(titleAmounts("Collects $22,164,212.92 In Fiscal Year 2014")).toEqual([22_164_212.92]);
    expect(titleAmounts("UBS to pay $1.435 billion and $2 B")).toEqual([1.435e9, 2e9]);
    expect(titleAmounts("No figure here")).toEqual([]);
  });
});

describe("titleNames", () => {
  it("keeps names and drops generic title words", () => {
    expect([...titleNames(LIPKIN.title)]).toEqual(
      expect.arrayContaining(["irwin", "lipkin", "bernard", "madoff"]),
    );
    expect(titleNames(LIPKIN.title).has("sentenced")).toBe(false);
    expect(titleNames(LIPKIN.title).has("six")).toBe(false);
  });
});

describe("heldReason", () => {
  const reason = (title: string) =>
    heldReason(rel(title, "2020-01-01", { valueUsd: 2e9, source: "title", keyword: null }))
      ?.reason ?? null;

  it("holds back non-resolutions by kind", () => {
    expect(heldReason(MADOFF_DISTRIBUTION)?.reason).toBe("distribution");
    expect(heldReason(CLIMATE)?.reason).toBe("filing");
    expect(heldReason(EDVA)?.reason).toBe("personnel");
  });

  it("holds back annual, multi-year and programme totals", () => {
    for (const t of [
      "Justice Department Recovers Over $4.7 Billion From False Claims Act Cases in Fiscal Year 2016",
      "Justice Department Returned Over $4 Billion to Victims of Crime Through the Asset Forfeiture Program Between 2002 and 2015",
      "Justice Department Secures Nearly $2 Billion in Consumer Protection Cases in 2012",
      "Justice Department Returned $1.5 Billion to Victims of Crime since January 2012",
      "Health Care Fraud Prevention and Enforcement Efforts Result in Record-breaking Recoveries Totaling Nearly $4.1 Billion",
      "U.S. Attorney’s Office For The District Of Columbia Secures Over $2 Billion In Financial Recoveries During Three-Year Period",
      "Department of Justice Secures More Than $2 Billion in Judgments and Settlements as a Result of Enforcement Actions",
      "U.S. Attorney’s Office Collects Over $1.9 Billion for Taxpayers in 2015",
      "Justice Department Surpasses $12 Billion in Compensation to Crime Victims Since 2000",
    ])
      expect(reason(t)).toBe("statistics");
  });

  it("holds back statements, takedowns, arrests and victim payouts", () => {
    expect(
      reason(
        "Statements by Attorney General Holder and Agriculture Secretary Vilsack on Court Approval of Pigford II Settlement Agreement",
      ),
    ).toBe("speech");
    expect(
      reason(
        "Statement Of Manhattan U.S. Attorney Preet Bharara On The Guilty Plea By BNP Paribas",
      ),
    ).toBe("speech");
    expect(
      reason(
        "National Health Care Fraud Takedown Results In Charges Against Over 412 Individuals Responsible For $1.3 Billion In Fraud Losses",
      ),
    ).toBe("charge");
    expect(
      reason(
        "Fugitive Ohio Executive Previously Convicted for Role in $2.8 Billion Fraud Arrested in Mexico",
      ),
    ).toBe("charge");
    expect(
      reason(
        "Chairman of Prince Group Indicted for Operating Cambodian Forced-Labor Scam Compounds",
      ),
    ).toBe("charge");
    expect(
      reason(
        "Department of Justice Begins Second Distribution of Funds Recovered Through Asset Forfeiture Totaling $1.2 Billion to Compensate Victims of Madoff",
      ),
    ).toBe("distribution");
    expect(
      reason("Three Individuals In District Of New Jersey Receive Attorney General Awards"),
    ).toBe("personnel");
  });

  it("keeps resolutions whose titles mention distributing, charges or a cap", () => {
    expect(heldReason(ENDO)).toBeNull();
    expect(heldReason(BINANCE)).toBeNull();
    expect(
      reason("Goldman Sachs Charged in Foreign Bribery Case and Agrees to Pay Over $2.9 Billion"),
    ).toBeNull();
    expect(
      reason(
        "Walgreens Agrees to Pay Up to $350 Million for Illegally Filling Unlawful Opioid Prescriptions",
      ),
    ).toBeNull();
    expect(heldReason(BOFA)).toBeNull();
  });

  it("holds back a text figure the title contradicts by 2x or more", () => {
    expect(heldReason(HSBC)?.reason).toBe("title_contradicts");
    expect(heldReason(HSBC)?.detail).toContain("$470 million");
    expect(heldReason(MDB)?.reason).toBe("title_contradicts");
    expect(heldReason(AMBAC)?.reason).toBe("title_contradicts"); // exactly 10x
  });

  it("holds back statutory maximums, claimed or held amounts, aggregates and scheme sizes", () => {
    expect(heldReason(FRANKLIN)?.reason).toBe("maximum");
    expect(heldReason(INMATE)?.reason).toBe("not_outcome");
    expect(heldReason(COUTTS)?.reason).toBe("not_outcome");
    expect(heldReason(COMMODITIES)?.reason).toBe("not_outcome");
    expect(heldReason(LUXURY)?.reason).toBe("not_outcome");
  });

  it("requires a judgment title for a judgment figure and a named subject for a forfeiture", () => {
    const jury = text(
      "Jury Convicts Former Executive of Fraud",
      "2020-01-01",
      2e9,
      "judgment",
      "$2 billion",
      "The court entered a $2 billion order.",
    );
    expect(heldReason(jury)?.reason).toBe("title_no_resolution");
    expect(heldReason(CUINIS)?.reason).toBe("other_party");
    expect(heldReason(FOUR)?.reason).toBe("other_party");
    expect(heldReason(LIPKIN)).toBeNull();
    // a text figure whose sentence names no party of the title is held, whatever its kind
    expect(heldReason(MORTGAGE)?.reason).toBe("other_party");
    expect(heldReason(BP_CIVIL)?.reason).toBe("other_party");
  });
});

describe("normaliseTitle", () => {
  it("drops case and punctuation only", () => {
    expect(normaliseTitle(UBS[1]!.title)).toBe(normaliseTitle(UBS[2]!.title));
    expect(normaliseTitle("Takata Corp.")).not.toBe(normaliseTitle("Takata Corporation"));
  });
});

describe("rankLargestResolutions", () => {
  const all = [
    MADOFF_DISTRIBUTION,
    LIPKIN,
    FOUR,
    INMATE,
    MORTGAGE,
    FRANKLIN,
    MDB,
    AMBAC,
    CUINIS,
    COUTTS,
    COMMODITIES,
    LUXURY,
    HSBC,
    BP_CIVIL,
    CLIMATE,
    EDVA,
    BOFA,
    BOFA_OAG,
    BINANCE,
    BP_PLEA,
    ENDO,
    ...UBS,
    ...TAKATA,
  ];
  const out = rankLargestResolutions(all);

  it("ranks only figures the title states", () => {
    expect(out.entries.every((e) => e.release.headline!.source === "title")).toBe(true);
    expect(out.entries.map((e) => e.valueUsd)).toEqual([
      16.65e9, 4e9, 4e9, 1.536e9, 1.435e9, 1e9, 1e9,
    ]);
  });

  it("lists text-only figures separately and unranked", () => {
    expect(out.textOnly.map((e) => e.release.id)).toEqual([LIPKIN.id]);
    expect(out.entries.some((e) => e.release.id === LIPKIN.id)).toBe(false);
  });

  it("collapses only on exact keys", () => {
    const bofa = out.entries.find((e) => e.valueUsd === 16.65e9)!;
    expect(bofa.related).toHaveLength(1); // same title, same date
    const ubs = out.entries.find((e) => e.valueUsd === 1.435e9)!;
    expect(ubs.related).toHaveLength(2); // same title; same figure, date and component
    // Binance (2023) and the BP plea (2013) share a figure only: two entries
    const fourB = out.entries.filter((e) => e.valueUsd === 4e9);
    expect(fourB.map((e) => e.related.length)).toEqual([0, 0]);
    // Takata: the agreement (same title, same day) and the sentencing (same title and figure) are two entries
    expect(out.entries.filter((e) => e.valueUsd === 1e9).map((e) => e.related.length)).toEqual([
      1, 1,
    ]);
  });

  it("collapses the same title words up to the figure on the same date", () => {
    const vw = [
      "Volkswagen AG Agrees to Plead Guilty and Pay $4.3 Billion in Criminal and Civil Penalties; Six Volkswagen Executives and Employees are Indicted",
      "Volkswagen AG Agrees to Plead Guilty and Pay $4.3 Billion in Criminal and Civil Penalties and Six Volkswagen Executives and Employees Are Indicted",
    ].map((t) => titled(t, "2017-01-11", 4.3e9));
    expect(rankLargestResolutions(vw).entries).toHaveLength(1);
    // the same figure on the same day under different wording before it stays separate
    const jpm = [
      "Justice Department, Federal and State Partners Secure Record $13 Billion Global Settlement with JPMorgan",
      "Record $13 Billion Global Settlement Reached With JPMorgan Over Misleading Investors",
    ].map((t) => titled(t, "2013-11-19", 13e9));
    expect(rankLargestResolutions(jpm).entries).toHaveLength(2);
  });

  it("never merges different figures or shared title words", () => {
    const r = rankLargestResolutions([OLYMPUS, NOVARTIS], 1e8);
    expect(r.entries).toHaveLength(2);
    const a = titled("Acme Widgets Agrees to Pay $2 Billion", "2019-03-01", 2e9);
    const b = titled("Globex Pharma Agrees to Pay $2 Billion", "2020-03-01", 2e9);
    expect(rankLargestResolutions([a, b]).entries).toHaveLength(2);
    const sameDayNoComponent = titled("Initech Agrees to Pay $2 Billion", "2019-03-01", 2e9);
    expect(rankLargestResolutions([a, sameDayNoComponent]).entries).toHaveLength(2);
  });

  it("reports every held release with its reason and counts the candidates", () => {
    expect(out.candidates).toBe(all.length);
    expect(
      out.entries.reduce((s, e) => s + 1 + e.related.length, 0) +
        out.textOnly.reduce((s, e) => s + 1 + e.related.length, 0) +
        out.held.length,
    ).toBe(all.length);
  });

  it("counts a release repeated across partitions once", () => {
    const dup = { ...BOFA, dataset: "doj_press_releases_2015" };
    expect(rankLargestResolutions([BOFA, dup]).candidates).toBe(1);
  });

  it("ignores releases below the threshold or without a headline figure", () => {
    const small = titled("X Agrees to Pay $5 Million", "2020-01-01", 5e6);
    const none = { ...BOFA, id: "doj-pr:none", url: null, headline: null };
    expect(rankLargestResolutions([small, none]).candidates).toBe(0);
  });
});

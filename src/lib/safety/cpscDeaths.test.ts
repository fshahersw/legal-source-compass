import { describe, expect, it } from "vitest";
import {
  buildCpscDeaths,
  deathExcerpt,
  deathKind,
  reportsDeath,
  type CpscDeathRow,
} from "./cpscDeaths";
import { CPSC_BACKGROUND, CPSC_MISSED_IDS, CPSC_NO_TAG_CANDIDATES } from "./cpscDeaths.fixture";

const POOLS =
  "CPSC believes that nine children between the ages of 22 months and 3 years old have drowned, after gaining access to the pools via the footholds. The incidents occurred in California.";

describe("reportsDeath", () => {
  it("finds died, drowned, suffocated, strangled, killed and reported deaths", () => {
    expect(reportsDeath(POOLS)).toBe(true);
    expect(reportsDeath("A 4-month-old infant suffocated.")).toBe(true);
    expect(reportsDeath("A child was strangled by the cord.")).toBe(true);
    expect(reportsDeath("One consumer was killed.")).toBe(true);
    expect(reportsDeath("The firm is aware of three deaths reported in Canada.")).toBe(true);
    expect(reportsDeath("following reports of three deaths")).toBe(true);
    expect(reportsDeath(null)).toBe(false);
  });

  it("ignores negated, hypothetical, boilerplate and animal deaths", () => {
    expect(reportsDeath("No one has died.")).toBe(false);
    expect(reportsDeath("No injuries or deaths have been reported.")).toBe(false);
    expect(reportsDeath("No collisions, crashes, injuries or deaths have been reported.")).toBe(
      false,
    );
    expect(reportsDeath("There have been no reports of injury or death.")).toBe(false);
    expect(reportsDeath("posing a risk of serious injury or death due to drowning")).toBe(false);
    // cpsc-api:10271
    expect(
      reportsDeath(
        "In two of those reports, the child was trapped by his/her head and was in danger of being strangled.",
      ),
    ).toBe(false);
    expect(reportsDeath("an 18-month-old girl nearly suffocated")).toBe(false);
    // cpsc-api:12089
    expect(reportsDeath("One dog reportedly died from ingestion of the gel.")).toBe(false);
  });

  it("keeps a death that follows a negation in another clause", () => {
    // cpsc-api:09324
    expect(
      reportsDeath(
        "The cord was not looped around the boy's neck but rather ran from ear to ear and strangled the child.",
      ),
    ).toBe(true);
  });
});

describe("deathKind", () => {
  it("finds the 14 recalls tagged No that report a death (cpsc-api:10271 is not one)", () => {
    const missed = CPSC_NO_TAG_CANDIDATES.filter((r) => deathKind(r) === "missed").map((r) => r.id);
    expect(missed).toEqual(CPSC_MISSED_IDS);
    expect(missed).not.toContain("cpsc-api:10271");
  });

  it("keeps Background / other product rows apart, whatever their text says", () => {
    for (const row of CPSC_BACKGROUND) expect(deathKind(row)).toBe("background");
  });

  it("trusts the dataset's product-related tag", () => {
    expect(deathKind({ tag: "Product-related", injuries: "Three deaths.", title: null })).toBe(
      "product",
    );
    expect(
      deathKind({ tag: "Product-related (outside U.S. only)", injuries: null, title: null }),
    ).toBe("product");
    expect(
      deathKind({ tag: "No", injuries: "No incidents reported.", title: "Recall" }),
    ).toBeNull();
  });
});

describe("deathExcerpt", () => {
  it("keeps the sentence that says someone died", () => {
    expect(deathExcerpt(POOLS)).toMatch(/^CPSC believes that nine children/);
  });
});

describe("buildCpscDeaths", () => {
  const row = (o: Partial<CpscDeathRow>): CpscDeathRow => ({
    id: "cpsc-api:25393",
    title: "Above-Ground Pools Recalled; Nine Deaths Reported",
    date: "2025-07-21",
    tag: "No",
    injuries: POOLS,
    hazard: "Drowning",
    firm: "Bestway",
    url: "https://www.cpsc.gov/Recalls/2025/x",
    ...o,
  });
  it("splits product-related, missed and background, and counts years to the data's last date", () => {
    const p = buildCpscDeaths(
      [
        row({}),
        row({
          id: "cpsc-api:2",
          tag: "Product-related",
          date: "2023-01-05",
          injuries: "Two deaths reported.",
        }),
        row({ id: "cpsc-api:3", injuries: "No one has died.", title: "Recall" }),
        row({ ...CPSC_BACKGROUND[2]!, date: "2024-03-01" }),
        row({}),
      ],
      10058,
      "2026-10-22",
      "2026-10-27T00:00:00Z",
    );
    expect(p.total).toBe(2);
    expect(p.tagged).toBe(1);
    expect(p.untagged).toBe(1);
    expect(p.background).toBe(1);
    expect(p.recalls[0]).toMatchObject({ recallNumber: "25393", word: "drowned", kind: "missed" });
    expect(p.years.map((y) => y.year)).toEqual(["2023", "2024", "2025", "2026"]);
    expect(p.years.find((y) => y.year === "2024")).toMatchObject({
      product: 0,
      missed: 0,
      background: 1,
    });
    expect(p.years.at(-1)!.partial).toBe(true);
    expect(p.latest).toBe("2025-07-21");
    expect(p.dataThrough).toBe("2026-10-22");
  });
});

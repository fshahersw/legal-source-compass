import { describe, expect, it } from "vitest";
import { buildCpscDeaths, deathExcerpt, explicitDeath, type CpscDeathRow } from "./cpscDeaths";

const POOLS =
  "CPSC believes that nine children between the ages of 22 months and 3 years old have drowned, after gaining access to the pools via the footholds. The incidents occurred in California.";

describe("explicitDeath", () => {
  it("finds died, drowned, suffocated, strangled and killed, but not negations or hazard boilerplate", () => {
    expect(explicitDeath(POOLS)).toBe(true);
    expect(explicitDeath("A 4-month-old infant suffocated.")).toBe(true);
    expect(explicitDeath("A child was strangled by the cord.")).toBe(true);
    expect(explicitDeath("One consumer was killed.")).toBe(true);
    expect(explicitDeath("No one has died.")).toBe(false);
    expect(explicitDeath("posing a risk of serious injury or death due to drowning")).toBe(false);
    expect(explicitDeath(null)).toBe(false);
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
  it("flags recalls the source tagged No and counts years to the data's last date", () => {
    const p = buildCpscDeaths(
      [
        row({}),
        row({ id: "cpsc-api:2", tag: "Product-related", date: "2023-01-05" }),
        row({ id: "cpsc-api:3", injuries: "No one has died." }),
      ],
      10058,
      "2026-10-22",
      "2026-10-27T00:00:00Z",
    );
    expect(p.total).toBe(2);
    expect(p.untagged).toBe(1);
    expect(p.recalls[0]).toMatchObject({ recallNumber: "25393", word: "drowned", untagged: true });
    expect(p.years.map((y) => y.year)).toEqual(["2023", "2024", "2025", "2026"]);
    expect(p.years.find((y) => y.year === "2024")!.recalls).toBe(0);
    expect(p.years.at(-1)!.partial).toBe(true);
    expect(p.dataThrough).toBe("2026-10-22");
  });
});

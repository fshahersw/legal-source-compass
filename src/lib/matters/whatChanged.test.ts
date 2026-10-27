import { describe, expect, it } from "vitest";
import { classifyDocketText, type ClassifiedEntry, type CourtPageMatch } from "./orders";
import { isoMinusDays, jpmlDeltas, whatChanged } from "./whatChanged";
import type { DatedEntry } from "./docketDates";

// MDL 3047 JPML points as published (jpml_mdl_pending_series mdl:3047, reports of 2026-08-03 .. 2026-10-01).
const JPML = [
  { date: "2026-09-01", pending: 3208, total: 3383 },
  { date: "2026-10-01", pending: 3824, total: 4009 },
  { date: "2026-08-03", pending: 3137, total: 3312 },
];

const entry = (id: string, date: string, text: string): ClassifiedEntry => {
  const c = classifyDocketText(text);
  return {
    id,
    entryNumber: 1,
    date,
    docketKey: "k",
    sourceUrl: null,
    documentIds: [],
    role: c.role,
    title: c.title,
    tags: c.tags,
  };
};

describe("jpmlDeltas", () => {
  it("computes actions added as the difference of published totals, with interval days", () => {
    const d = jpmlDeltas(JPML);
    expect(d.at(-1)).toEqual({
      from: "2026-09-01",
      to: "2026-10-01",
      days: 30,
      totalFrom: 3383,
      totalTo: 4009,
      added: 626,
      pendingFrom: 3208,
      pendingTo: 3824,
      pendingChange: 616,
      negative: false,
    });
    expect(d[0]).toMatchObject({ from: "2026-08-03", added: 71, days: 29 });
  });

  it("keeps a fall in the published total as printed and flags it", () => {
    const d = jpmlDeltas([
      { date: "2026-01-01", pending: 10, total: 100 },
      { date: "2026-02-01", pending: 9, total: 98 },
    ]);
    expect(d[0]).toMatchObject({ added: -2, negative: true });
  });

  it("drops malformed dates and needs two reports", () => {
    expect(jpmlDeltas([{ date: "Oct 2026", pending: 1, total: 1 }])).toEqual([]);
  });
});

describe("whatChanged", () => {
  const entries = [
    entry("a", "2026-10-02", "CASE MANAGEMENT ORDER NO. 37. Signed by Judge Y on 10/2/2026."),
    entry(
      "b",
      "2026-08-15",
      "ORDER GRANTING IN PART AND DENYING IN PART RULE 702 MOTIONS by Judge Y",
    ),
    entry("c", "2026-05-01", "CASE MANAGEMENT ORDER NO. 30. Signed by Judge Y on 5/1/2026."),
    entry(
      "d",
      "2026-10-01",
      "MOTION to Dismiss for Failure to Comply with Case Management Order No. 37 by Defendants.",
    ),
  ];
  const dates: DatedEntry[] = [
    {
      date: "2027-02-08",
      printed: "2/8/2027",
      phrase: "set for",
      label: "Jury Trial",
      time: null,
      vacated: false,
      snippet: "",
      entryId: "x",
      entryNumber: 1,
      entryDate: "2026-09-20",
      sourceUrl: null,
    },
    {
      date: "2026-08-20",
      printed: "8/20/2026",
      phrase: "set for",
      label: "Jury Trial",
      time: null,
      vacated: true,
      snippet: "",
      entryId: "y",
      entryNumber: 2,
      entryDate: "2026-08-20",
      sourceUrl: null,
    },
  ];
  const courtPage: CourtPageMatch[] = [
    {
      kind: "cmo",
      number: 38,
      suffix: null,
      title: "CASE MANAGEMENT ORDER NO. 38",
      url: "https://ecf/38",
      date: "2026-10-16",
      vacated: false,
      docketEntryIds: [],
    },
    {
      kind: "cmo",
      number: 37,
      suffix: null,
      title: "CASE MANAGEMENT ORDER NO. 37",
      url: "https://ecf/37",
      date: "2026-10-02",
      vacated: false,
      docketEntryIds: ["a"],
    },
  ];
  const w = whatChanged({
    asOf: "2026-10-27",
    collectedThrough: "2026-10-03",
    jpml: JPML,
    entries,
    dates,
    courtPage,
  });

  it("lists orders entered in each window, by printed label, never motions", () => {
    expect(w.windows[0]).toMatchObject({ days: 30, from: "2026-09-28" });
    expect(w.windows[0]!.orders.map((o) => o.printed)).toEqual(["CMO No. 37 (2026-10-02)"]);
    expect(w.windows[1]!.orders.map((o) => o.printed)).toEqual([
      "CMO No. 37 (2026-10-02)",
      "Rule 702 / Daubert rulings (2026-08-15)",
    ]);
    expect(w.windows[1]!.settings).toEqual({ set: 1, vacated: 1 });
  });

  it("lists court-page orders newer than the collected docket", () => {
    expect(w.courtPageNewer).toEqual([
      {
        printed: "CMO No. 38 (2026-10-16)",
        date: "2026-10-16",
        url: "https://ecf/38",
        title: "CASE MANAGEMENT ORDER NO. 38",
      },
    ]);
  });

  it("builds AI figures only from the computed values, with the collection caveat", () => {
    const labels = w.figures.map((f) => f.label);
    expect(labels).toContain(
      "Actions added between the two reports (difference of published totals)",
    );
    expect(w.figures.find((f) => f.label.startsWith("Actions added between"))).toMatchObject({
      value: 626,
      period: "2026-09-01 to 2026-10-01 (30 days)",
    });
    expect(
      w.figures.find((f) => f.label.startsWith("Orders entered in the last 30")),
    ).toMatchObject({
      value: 1,
      note: "docket text collected through 2026-10-03",
    });
    expect(
      w.figures.filter((f) => f.label === "Court-page order newer than the collected docket"),
    ).toHaveLength(1);
  });

  it("subtracts days in UTC", () => {
    expect(isoMinusDays("2026-03-01", 1)).toBe("2026-02-28");
  });
});

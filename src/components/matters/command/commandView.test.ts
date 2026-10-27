import { describe, expect, it } from "vitest";
import { classifyDocketText, orderLedger, type ClassifiedEntry } from "@/lib/matters/orders";
import type { MdlCommandPayload } from "@/lib/matters/types";
import {
  NUMBERED_LABEL,
  addedRows,
  ctoPerMonth,
  headline,
  headlineFigures,
  kindRows,
  ledgerRows,
  momentum,
  numberedMeta,
  orderSwimlanes,
  ordersPerYear,
  sortedPoints,
  typedShare,
} from "./commandView";

/** A classified entry built from real docket text, as the loader returns it. */
function entry(id: string, date: string | null, text: string, entryNumber: number | null = null) {
  const c = classifyDocketText(text);
  return {
    id,
    entryNumber,
    date,
    docketKey: "cand:4:22-md-03047",
    sourceUrl: `https://www.courtlistener.com/docket/1/${id}/`,
    documentIds: [],
    role: c.role,
    title: c.title,
    tags: c.tags,
  } satisfies ClassifiedEntry;
}

// MDL 3047 JPML points (jpml_mdl_pending_series), as published.
const POINTS = [
  { date: "2025-10-01", pending: 2100, total: 2300 },
  { date: "2026-07-01", pending: 2900, total: 3068 },
  { date: "2026-08-03", pending: 3100, total: 3312 },
  { date: "2026-09-01", pending: 3170, total: 3383 },
  { date: "2026-10-01", pending: 3824, total: 4009 },
  { date: "bad", pending: 1, total: 1 },
];

describe("JPML rows", () => {
  it("drops bad dates and orders reports oldest first", () => {
    expect(sortedPoints(POINTS).map((p) => p.date)).toEqual([
      "2025-10-01",
      "2026-07-01",
      "2026-08-03",
      "2026-09-01",
      "2026-10-01",
    ]);
  });

  it("reads actions added as the difference of published totals, with the interval", () => {
    expect(addedRows(POINTS).at(-1)).toEqual({
      report: "2026-10-01",
      from: "2026-09-01",
      days: 30,
      added: 626,
      negative: false,
    });
  });

  it("compares against the report of the month N months earlier and leaves a missing month null", () => {
    const m = momentum(POINTS);
    expect(m[0]).toEqual({ months: 1, from: "2026-09-01", to: "2026-10-01", change: 654 });
    // 2026-07 is three months before 2026-10.
    expect(m[1]).toEqual({ months: 3, from: "2026-07-01", to: "2026-10-01", change: 924 });
    expect(m[2]).toEqual({ months: 12, from: "2025-10-01", to: "2026-10-01", change: 1724 });
    const gap = momentum(POINTS.filter((p) => p.date !== "2025-10-01"));
    expect(gap[2]!.change).toBeNull();
    expect(gap[2]!.from).toBeNull();
    expect(momentum([])[0]!.change).toBeNull();
  });
});

const ENTRIES = [
  entry(
    "e75",
    "2022-12-08",
    "CASE MANAGEMENT ORDER NO. 2 re PLAINTIFFS' LEADERSHIP STRUCTURE. Signed by Judge Yvonne Gonzalez Rogers",
    75,
  ),
  entry(
    "e111",
    "2023-01-27",
    "CASE MANAGEMENT ORDER NO. 4 re Protective Order. Signed by Judge Yvonne Gonzalez Rogers",
    111,
  ),
  entry(
    "e2750",
    "2026-02-17",
    "ORDER DENYING RULE 702 MOTION TO EXCLUDE SCHOOL DISTRICT EXPERTS. Signed by Judge Yvonne Gonzalez Rogers",
    2750,
  ),
  entry(
    "e2857",
    "2026-03-17",
    "ORDER GRANTING IN PART AND DENYING IN PART RULE 702 MOTIONS. Signed by Judge Yvonne Gonzalez Rogers",
    2857,
  ),
];

describe("numbered-order ledger rows", () => {
  it("keeps every gap as a 'Not in collected docket text' row and never invents a date", () => {
    const rows = ledgerRows(orderLedger(ENTRIES).cmo);
    expect(rows.map((r) => r.label)).toEqual(["CMO No. 1", "CMO No. 2", "CMO No. 3", "CMO No. 4"]);
    expect(rows[0]).toMatchObject({
      missing: true,
      subject: "Not in collected docket text",
      date: null,
    });
    expect(rows[1]).toMatchObject({ missing: false, date: "2022-12-08", entryNumber: 75 });
    expect(ledgerRows(orderLedger([]).pto)).toEqual([]);
  });
});

describe("kind rows", () => {
  it("lists Rule 702 rulings newest first with the outcome the order's title states", () => {
    const rows = kindRows(ENTRIES, ["rule702"]);
    expect(rows.map((r) => [r.entryNumber, r.outcome])).toEqual([
      [2857, "Granted in part, denied in part"],
      [2750, "Denied"],
    ]);
  });
});

describe("orders per year", () => {
  it("zero-fills the years between and marks the collected year partial", () => {
    const rows = ordersPerYear(ENTRIES, "2026-10-03");
    expect(rows.map((r) => r.period)).toEqual(["2022", "2023", "2024", "2025", "2026"]);
    expect(rows[0]!.values["numbered"]).toBe(1);
    expect(rows[2]!.values["numbered"]).toBe(0);
    expect(rows[4]!.values["trial"]).toBe(2);
    expect(rows[4]!.partial).toBe(true);
    expect(rows[0]!.partial).toBeUndefined();
  });
});

describe("CTO entries per month", () => {
  it("counts explicit CTO text only and fills empty months with 0", () => {
    const ctos = [
      entry("c1", "2026-01-05", "CONDITIONAL TRANSFER ORDER (CTO-12) from JPML", 10),
      entry("c2", "2026-03-09", "CONDITIONAL TRANSFER ORDER (CTO-13) from JPML", 11),
      entry("m", "2026-02-01", "MOTION to Compel", 12),
    ];
    const rows = ctoPerMonth(ctos, "2026-03-20");
    expect(rows.map((r) => [r.month, r.count, r.partial])).toEqual([
      ["2026-01", 1, false],
      ["2026-02", 0, false],
      ["2026-03", 1, true],
    ]);
  });
});

describe("headline figures", () => {
  const ledger = orderLedger(ENTRIES);
  const cmd = {
    mdl: "3047",
    mode: "recorded",
    overview: null,
    lens: null,
    orders: {
      ledger,
      entries: ENTRIES,
      rule702: {
        rulings: 2,
        motions: 5,
        byOutcome: { granted: 0, denied: 1, granted_in_part: 1, not_stated: 0 },
      },
      coverage: { collectedThrough: "2026-10-03" },
    },
    dates: null,
    datesSummary: {
      next: { date: "2027-02-08", label: "Jury Trial", entryDate: "2026-07-23" },
    },
    jpmlPoints: POINTS,
    whatChanged: {
      jpml: {
        latest: { from: "2026-09-01", to: "2026-10-01", days: 30, added: 626, negative: false },
      },
    },
  } as unknown as MdlCommandPayload;

  it("reads every KPI from the payload and leaves the registry count out of recorded mode", () => {
    const h = headline(cmd);
    expect(h.pending).toEqual({
      value: 3824,
      date: "2026-10-01",
      prior: { value: 3170, date: "2026-09-01" },
    });
    expect(h.added?.value).toBe(626);
    expect(h.numbered).toEqual({
      distinct: 2,
      issuedEntries: 2,
      latest: { label: "CMO No. 4", date: "2023-01-27" },
      series: [{ kind: "cmo", highest: 4, found: 2, missing: 2 }],
    });
    expect(numberedMeta(h.numbered!.series)).toBe("Highest CMO No. 4 (2 not in collected text)");
    const nf = headlineFigures(cmd, h).find((f) => f.label === NUMBERED_LABEL);
    expect(nf?.note).toContain("not the number of orders issued");
    expect(NUMBERED_LABEL).not.toMatch(/issued/i);
    expect(h.next?.date).toBe("2027-02-08");
    expect(h.rule702).toEqual({ rulings: 2, motions: 5 });
    expect(h.members).toBeNull();
    const labels = headlineFigures(cmd, h).map((f) => f.label);
    expect(labels).toContain("Actions pending (JPML)");
    expect(labels.some((l) => l.startsWith("Member dockets"))).toBe(false);
  });
});

describe("order swimlanes", () => {
  it("draws one lane per family that has entries, over the collected window", () => {
    const s = orderSwimlanes(ENTRIES)!;
    expect(s.lanes.map((l) => l.id)).toEqual(["cmo", "leadership", "rule702"]);
    expect(s.domain).toEqual(["2022-12-08", "2026-03-17"]);
    expect(s.lanes[0]!.events![0]!.label).toMatch(/^CMO No\. 2: /);
    expect(orderSwimlanes([])).toBeNull();
  });
});

describe("typed share", () => {
  it("states how few linked events carry a type (MDL 3047: 676 of 2,251, read-only 2026-10-27)", () => {
    expect(typedShare(676, 2251)).toBe("676 of 2,251 linked events carry a type (30%)");
    expect(typedShare(1, 500)).toBe("1 of 500 linked events carry a type (under 1%)");
    expect(typedShare(5, null)).toBeNull();
  });
});

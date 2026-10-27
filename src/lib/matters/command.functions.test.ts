import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (h: unknown) => h,
    inputValidator: () => ({ handler: (h: unknown) => h }),
  }),
}));
vi.mock("@/lib/external/mdlLens.functions", () => ({ loadMdlLens: vi.fn() }));
vi.mock("@/components/mdl/jpml-series/jpmlSeries.server", () => ({ readMdlSeries: vi.fn() }));
vi.mock("./source.server", () => ({ overviewFor: vi.fn() }));
vi.mock("./command.server", () => ({}));

const { assembleCommand, lensHasRecords } = await import("./command.functions");
import { classifyDocketText, orderLedger, countKinds, type ClassifiedEntry } from "./orders";
import type { MdlLens } from "@/lib/external/mdlLens.functions";
import type { KeyOrdersPayload, MatterOverviewPayload } from "./types";

const emptyLens = (): MdlLens => ({
  mdl: null,
  court: null,
  courtDistributions: null,
  judge: null,
  judgeAmbiguous: false,
  signal: null,
  insights: [],
  companies: [],
  courtPage: null,
  courtPageSourceUrl: null,
  courtPageSourceLabel: null,
  hearings: [],
  hearingCoverage: { first: null, last: null },
  panelOrders: [],
  panelOrdersInHearings: 0,
  terminated: [],
  fdaReports: [],
  series: { first: null, asOf: null, reports: null, sourceUrl: null },
  recordedTitle: null,
});

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

const orders = (entries: ClassifiedEntry[]): KeyOrdersPayload => ({
  mdl: "3047",
  rule: "orders/2",
  dataset: "sw_docket_entries_v1",
  coverage: {
    total: 4035,
    withheld: [],
    withheldTotal: 0,
    noText: 0,
    collectedThrough: "2026-10-03",
    candidatesRead: entries.length,
  },
  entries,
  ledger: orderLedger(entries),
  counts: countKinds(entries),
  rule702: {
    rulings: 0,
    byOutcome: { granted: 0, denied: 0, granted_in_part: 0, not_stated: 0 },
    motions: 0,
  },
  readAt: "2026-10-27T00:00:00Z",
});

describe("assembleCommand", () => {
  it("is recorded mode, not 'not found', for an MDL only the lens records hold", () => {
    const lens = {
      ...emptyLens(),
      recordedTitle: { title: "IN RE: Example", source: "the JPML hearing-session schedule" },
    };
    const out = assembleCommand({
      mdl: "3199",
      asOf: "2026-10-27",
      overview: null,
      lens,
      orders: null,
      dates: null,
      jpml: null,
      errors: [],
    });
    expect(out).toMatchObject({ mode: "recorded", found: true, orders: null, datesSummary: null });
    expect(out.whatChanged.jpml.latest).toBeNull();
  });

  it("reports not found when nothing holds the number", () => {
    const out = assembleCommand({
      mdl: "99998",
      asOf: "2026-10-27",
      overview: null,
      lens: emptyLens(),
      orders: null,
      dates: null,
      jpml: null,
      errors: [],
    });
    expect(out.found).toBe(false);
    expect(lensHasRecords(null)).toBe(false);
  });

  it("is registry mode when the overview resolves, and joins court-page orders on exact numbers", () => {
    const lens = emptyLens();
    lens.courtPage = {
      latestOrders: [
        {
          title: "CASE MANAGEMENT ORDER NO. 38 (Appointing a Special Master)",
          url: "https://ecf.cand.uscourts.gov/doc1/1",
          date: "2026-10-16",
          datePrinted: "10-16-26",
          kind: "case_management_order",
          vacated: false,
          pacer: true,
        },
        {
          title: "Transcript of Proceedings ... Per General Order No. 59",
          url: "https://ecf.cand.uscourts.gov/doc1/2",
          date: "2026-10-15",
          datePrinted: null,
          kind: "other_order",
          vacated: false,
          pacer: true,
        },
      ],
    } as unknown as MdlLens["courtPage"];
    const out = assembleCommand({
      mdl: "3047",
      asOf: "2026-10-27",
      overview: { overview: {} } as unknown as MatterOverviewPayload,
      lens,
      orders: orders([
        entry("a", "2026-07-23", "CASE MANAGEMENT ORDER NO. 36. Signed by Judge Y on 7/23/2026."),
      ]),
      dates: { mdl: "3047", rows: [], collectedThrough: "2026-10-03", readAt: "x" },
      jpml: {
        points: [
          { date: "2026-09-01", pending: 3208, total: 3383 },
          { date: "2026-10-01", pending: 3824, total: 4009 },
        ],
        sourceUrl:
          "https://www.jpml.uscourts.gov/sites/jpml/files/Pending_MDL_Dockets_By_Actions_Pending-October-1-2026.pdf",
      },
      errors: ["dates"],
    });
    expect(out.mode).toBe("registry");
    expect(out.courtPageOrders.map((o) => [o.number, o.docketEntryIds])).toEqual([[38, []]]);
    expect(out.whatChanged.courtPageNewer.map((c) => c.printed)).toEqual([
      "CMO No. 38 (2026-10-16)",
    ]);
    expect(out.whatChanged.jpml.latest?.added).toBe(626);
    expect(out.datesSummary).toMatchObject({ total: 0, collectedThrough: "2026-10-03" });
    expect(out.errors).toEqual(["dates"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { parseLink } from "@/components/companies/companyData";
import { restGet } from "./rest.server";
import {
  byNewestOrder,
  byNewestSession,
  courtPageSourceLabel,
  evidenceLabel,
  evidenceQuote,
  getMdlLens,
  recordedTitle,
  toFdaReport,
  toHearing,
  toPanelOrder,
  toTerminated,
  withoutHearingEvidence,
  type LensCompany,
  type MdlLens,
} from "./mdlLens.functions";

const TERMINATED_PDF =
  "https://www.jpml.uscourts.gov/sites/jpml/files/JPML_Fiscal_Year_2025_Terminated_Litigations_Report_0.pdf";
const NOTICE_SEPT_2026 =
  "https://www.jpml.uscourts.gov/sites/jpml/files/Hearing%20Session%20Filed_September%202026.pdf";
const PENDING_REPORT =
  "https://www.jpml.uscourts.gov/sites/jpml/files/Pending_MDL_Dockets_By_MDL_Type-October-1-2026.pdf";

// Published MDL 3194 matter (mdl_intel_hearing_orders id matter:2026-09-24:3194:A), evidence text verbatim.
const MATTER_3194 = {
  mdl: 3194,
  title: "IN RE: ABBOTT LABORATORIES SPINAL CORD STIMULATOR PRODUCTS LIABILITY LITIGATION",
  outcome: "granted",
  section: "A",
  session: "2026-09-24",
  outcome_label: "Centralized (transfer order)",
  actions_listed: 15,
  requested_district: "Central District of California",
  evidence: {
    url: "https://www.jpml.uscourts.gov/sites/jpml/files/MDL-3194-Transfer_Order-9-26.pdf",
    date: "2026-10-02",
    text: "IT IS THEREFORE ORDERED that the actions listed on Schedule A and pending outside the Northern District of Illinois are transferred to the Northern District of Illinois and, with the consent of that court, assigned to the Honorable Lindsay C. Jenkins, for coordinated or consolidated pretrial proceedings.",
    label: "Panel order (JPML)",
    source: "jpml_panel_orders_page",
    district: "N.D. Illinois",
  },
};
// Published GovInfo order rows (mdl_intel_hearing_orders ids order:USCOURTS-jpml-…): id, source_url, item.order.
const ORDER_17 = {
  id: "order:USCOURTS-jpml-1_69-F-00017-1",
  source_url:
    "https://www.govinfo.gov/app/details/USCOURTS-jpml-1_69-F-00017/USCOURTS-jpml-1_69-F-00017-1",
  order: {
    mdl: 17,
    pdf: "https://www.govinfo.gov/content/pkg/USCOURTS-jpml-1_69-F-00017/pdf/USCOURTS-jpml-1_69-F-00017-1.pdf",
    kind: "order_denying_transfer",
    part: 1,
    title:
      "IN RE: Multidistrict Civil Actions Arising From the Air Crash Disaster at Falls City, Nebraska on August 6, 1966",
    issued: "2015-04-29",
    package: "USCOURTS-jpml-1_69-F-00017",
    pleadings: null,
    signed_date: null,
    initial_motion: false,
    nature_of_suit: "Air Disaster",
    transferee_court: null,
    transferee_judge: null,
    actions_transferred: null,
  },
};
const ORDER_3187 = {
  id: "order:USCOURTS-jpml-1_26-F-03187-0",
  source_url:
    "https://www.govinfo.gov/app/details/USCOURTS-jpml-1_26-F-03187/USCOURTS-jpml-1_26-F-03187-0",
  order: {
    mdl: 3187,
    pdf: "https://www.govinfo.gov/content/pkg/USCOURTS-jpml-1_26-F-03187/pdf/USCOURTS-jpml-1_26-F-03187-0.pdf",
    kind: "transfer_order",
    part: 0,
    title: "IN RE: Nitrogen, Phosphorus, and Potassium (NPK) Fertilizer Antitrust Litigation",
    issued: "2026-06-09",
    package: "USCOURTS-jpml-1_26-F-03187",
    pleadings: [1],
    signed_date: "2026-06-09",
    initial_motion: true,
    nature_of_suit: "Antitrust",
    transferee_court: "D. Kansas",
    transferee_judge: "Eric F. Melgren",
    actions_transferred: 4,
  },
};
// Published SEC link (company_sec_mdl_links id 0000005187:1203); its MDL title is the report's abbreviation.
const LINK_1203 = {
  mdl: 1203,
  cik: "0000005187",
  company: "WYETH",
  tier: "A",
  mdl_title: "Diet Drugs PL",
  title_truncated: true,
  verified: [
    {
      adsh: "0000005187-02-000005",
      url: "https://www.sec.gov/Archives/edgar/data/5187/000000518702000005/ann10k01.txt",
      form: "10-K405",
      file_date: "2002-03-29",
      matched: "MDL No. 1203",
    },
  ],
};
// Published MDL 875 entry (mdl_terminated_history id 875:313).
const HISTORY_875 = {
  mdl: 875,
  caption: "Asbestos Products Liability Litigation (No. VI)",
  circuit: "Third Circuit",
  district_code: "313",
  district_name: "Pennsylvania Eastern",
  actions_closed: 188612,
  actions_remanded: 3518,
  termination_year: 2023,
  transferee_judge: "Robreno, Eduardo C.",
  actions_transferred: 108469,
  actions_filed_in_transferee: 83661,
};

describe("exact MDL joins", () => {
  it("keeps a hearing matter only for its own MDL number", () => {
    const h = toHearing({ source_url: NOTICE_SEPT_2026, matter: MATTER_3194 }, 3194)!;
    expect(h).toMatchObject({
      mdl: 3194,
      session: "2026-09-24",
      outcomeLabel: "Centralized (transfer order)",
      noticeUrl: NOTICE_SEPT_2026,
      evidenceLabel: "Panel order (JPML)",
      district: "N.D. Illinois",
    });
    expect(h.evidenceQuote).toEqual({
      text: MATTER_3194.evidence.text,
      label: "Panel order, operative sentence",
      clipped: false,
    });
    expect(toHearing({ source_url: NOTICE_SEPT_2026, matter: MATTER_3194 }, 319)).toBeNull();
    expect(
      toHearing({ source_url: "javascript:alert(1)", matter: MATTER_3194 }, 3194)?.noticeUrl,
    ).toBeNull();
    const unsafe = { ...MATTER_3194, evidence: { ...MATTER_3194.evidence, url: "javascript:x" } };
    expect(toHearing({ matter: unsafe }, 3194)?.evidenceUrl).toBeNull();
  });

  it("keeps a GovInfo Panel order only for its own recorded MDL number", () => {
    const o = toPanelOrder(ORDER_17, 17)!;
    expect(o).toEqual({
      id: ORDER_17.id,
      kindLabel: "Order denying transfer",
      title: ORDER_17.order.title,
      signedDate: null,
      issued: "2015-04-29",
      natureOfSuit: "Air Disaster",
      transfereeCourt: null,
      transfereeJudge: null,
      actionsTransferred: null,
      initialMotion: false,
      pdfUrl: ORDER_17.order.pdf,
      detailsUrl: ORDER_17.source_url,
    });
    expect(toPanelOrder(ORDER_3187, 3187)).toMatchObject({
      kindLabel: "Transfer order",
      signedDate: "2026-06-09",
      transfereeCourt: "D. Kansas",
      transfereeJudge: "Eric F. Melgren",
      actionsTransferred: 4,
      initialMotion: true,
    });
    // A neighbouring or prefix number never binds; nor does a number stored as text or a non-order row.
    expect(toPanelOrder(ORDER_17, 1)).toBeNull();
    expect(toPanelOrder(ORDER_17, 170)).toBeNull();
    expect(toPanelOrder({ ...ORDER_17, order: { ...ORDER_17.order, mdl: "17" } }, 17)).toBeNull();
    expect(toPanelOrder({ ...ORDER_17, id: "matter:2021-01-28:17:A" }, 17)).toBeNull();
    // Links are http(s) only; a details URL equal to the PDF is not listed twice.
    const bad = toPanelOrder(
      { ...ORDER_17, source_url: ORDER_17.order.pdf, order: { ...ORDER_17.order, pdf: "ftp://x" } },
      17,
    )!;
    expect(bad.pdfUrl).toBeNull();
    expect(bad.detailsUrl).toBe(ORDER_17.order.pdf);
    expect(
      toPanelOrder({ ...ORDER_17, source_url: ORDER_17.order.pdf }, 17)!.detailsUrl,
    ).toBeNull();
  });

  it("orders Panel orders by signature date, else GovInfo date, and drops ones shown as hearing evidence", () => {
    const old = toPanelOrder(ORDER_17, 17)!;
    const recent = { ...toPanelOrder(ORDER_3187, 3187)!, issued: "2014-01-01" };
    expect([old, recent].sort(byNewestOrder).map((o) => o.id)).toEqual([recent.id, old.id]);
    expect(withoutHearingEvidence([old, recent], [{ evidenceUrl: ORDER_3187.order.pdf }])).toEqual([
      old,
    ]);
    expect(withoutHearingEvidence([old], [{ evidenceUrl: ORDER_17.source_url }])).toEqual([]);
    expect(withoutHearingEvidence([old], [{ evidenceUrl: null }])).toEqual([old]);
  });

  it("keeps a terminated entry only when id prefix and recorded number both match", () => {
    const t = toTerminated(
      { id: "875:313", source_url: TERMINATED_PDF, history: HISTORY_875 },
      875,
    )!;
    expect(t).toEqual({
      caption: "Asbestos Products Liability Litigation (No. VI)",
      districtName: "Pennsylvania Eastern",
      districtCode: "313",
      circuit: "Third Circuit",
      judge: "Robreno, Eduardo C.",
      year: 2023,
      transferred: 108469,
      filedInTransferee: 83661,
      closed: 188612,
      remanded: 3518,
      sourceUrl: TERMINATED_PDF,
    });
    expect(toTerminated({ id: "8750:313", history: HISTORY_875 }, 875)).toBeNull();
    expect(toTerminated({ id: "875:313", history: { ...HISTORY_875, mdl: 8750 } }, 875)).toBeNull();
    expect(
      toTerminated({ id: "875:313", history: { ...HISTORY_875, mdl: "875" } }, 875),
    ).toBeNull();
  });

  it("orders hearings newest session first, Section A before B", () => {
    const base = toHearing({ matter: MATTER_3194 }, 3194)!;
    const rows = [
      { ...base, session: "2025-01-30", section: "B" as const },
      { ...base, session: "2026-09-24", section: "B" as const },
      { ...base, session: "2026-09-24", section: "A" as const },
    ].sort(byNewestSession);
    expect(rows.map((r) => `${r.session}:${r.section}`)).toEqual([
      "2026-09-24:A",
      "2026-09-24:B",
      "2025-01-30:B",
    ]);
  });
});

describe("recorded title", () => {
  const hearing = toHearing({ source_url: NOTICE_SEPT_2026, matter: MATTER_3194 }, 3194)!;
  const terminated = toTerminated({ id: "875:313", history: HISTORY_875 }, 875)!;
  it("prefers the court-page index, then the newest hearing schedule, then the terminated report", () => {
    expect(
      recordedTitle({ courtPage: null, hearings: [hearing], terminated: [], companies: [] }),
    ).toEqual({
      title: MATTER_3194.title,
      source: "the JPML hearing-session schedule of 2026-09-24",
    });
    expect(
      recordedTitle({ courtPage: null, hearings: [], terminated: [terminated], companies: [] }),
    ).toEqual({
      title: "Asbestos Products Liability Litigation (No. VI)",
      source: "the JPML terminated-litigations report",
    });
    expect(
      recordedTitle({ courtPage: null, hearings: [], terminated: [], companies: [] }),
    ).toBeNull();
  });

  it("falls back to the newest GovInfo order's package title, then an SEC link title not cut short", () => {
    const order = toPanelOrder(ORDER_17, 17)!;
    expect(
      recordedTitle({
        courtPage: null,
        hearings: [],
        terminated: [terminated],
        panelOrders: [order],
        companies: [],
      })?.source,
    ).toBe("the JPML terminated-litigations report");
    expect(
      recordedTitle({
        courtPage: null,
        hearings: [],
        terminated: [],
        panelOrders: [order],
        companies: [],
      }),
    ).toEqual({
      title: ORDER_17.order.title,
      source: "the GovInfo package of the Panel's order denying transfer",
    });
    const company = (v: Record<string, unknown>): LensCompany => {
      const link = parseLink(v)!;
      return { cik: "0000005187", name: "WYETH", link, summary: null };
    };
    // A truncated title (here the terminated report's abbreviation) is never used as the heading.
    expect(
      recordedTitle({
        courtPage: null,
        hearings: [],
        terminated: [],
        companies: [company(LINK_1203)],
      }),
    ).toBeNull();
    expect(
      recordedTitle({
        courtPage: null,
        hearings: [],
        terminated: [],
        companies: [company({ ...LINK_1203, title_truncated: false })],
      }),
    ).toEqual({ title: "Diet Drugs PL", source: "an SEC filing link record" });
  });
});

describe("court-page record source", () => {
  it("names the JPML docket-type report by its own title and date, nothing else", () => {
    expect(courtPageSourceLabel(PENDING_REPORT)).toBe(
      "the JPML “Pending MDL Dockets by MDL Type” report of 10/1/2026",
    );
    expect(courtPageSourceLabel("https://www.njd.uscourts.gov/valsartan-mdl-2875")).toBeNull();
    expect(
      courtPageSourceLabel(
        "https://www.jpml.uscourts.gov/sites/jpml/files/Pending_MDL_Dockets_By_District-October-1-2026.pdf",
      ),
    ).toBeNull();
    expect(courtPageSourceLabel(null)).toBeNull();
  });
});

describe("getMdlLens for an MDL outside the pending series", () => {
  const get = vi.mocked(restGet);
  beforeEach(() => {
    get.mockReset();
  });

  const run = (rows: (path: string) => unknown[], mdl = 3194) => {
    get.mockImplementation(async (path: string) => ({ rows: rows(path) as never, total: null }));
    return (getMdlLens as unknown as (a: { data: { mdl: number } }) => Promise<MdlLens>)({
      data: { mdl },
    });
  };
  const SESSION_RANGE = [{ first: "2021-01-28", last: "2026-12-03" }];

  it("returns the court page, hearing record and series instead of nothing", async () => {
    const lens = await run((path) => {
      if (path.includes("dataset=eq.mdl_intel_court_pages"))
        return [
          {
            source_url: PENDING_REPORT,
            court: {
              mdl: 3194,
              title:
                "In re: Abbott Laboratories Spinal Cord Stimulator Products Liability Litigation",
              status: "not_transferred_as_of_report",
              transfer_order_filed: "2026-10-02",
              judge: "Lindsay C. Jenkins",
              district_label: "N.D. Illinois",
            },
          },
        ];
      if (path.includes("dataset=eq.mdl_intel_hearing_orders&id=like.matter:*"))
        return [
          { source_url: NOTICE_SEPT_2026, matter: MATTER_3194 },
          // A row for another number never binds, even if the read returned it.
          { source_url: NOTICE_SEPT_2026, matter: { ...MATTER_3194, mdl: 3195 } },
        ];
      if (path.includes("dataset=eq.mdl_intel_hearing_orders&id=eq.summary:overview"))
        return SESSION_RANGE;
      if (path.includes("dataset=eq.mdl_analytics&id=eq.summary:overview"))
        return [
          {
            first: "2024-10-01",
            as_of: "2026-10-01",
            reports: 25,
            source_url: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
          },
        ];
      return [];
    });
    expect(lens.mdl).toBeNull();
    expect(lens.courtPage?.status).toBe("not_transferred_as_of_report");
    expect(lens.courtPageSourceUrl).toBe(PENDING_REPORT);
    expect(lens.hearings.map((h) => h.mdl)).toEqual([3194]);
    expect(lens.terminated).toEqual([]);
    expect(lens.series).toEqual({
      first: "2024-10-01",
      asOf: "2026-10-01",
      reports: 25,
      sourceUrl: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
    });
    expect(lens.courtPageSourceLabel).toBe(
      "the JPML “Pending MDL Dockets by MDL Type” report of 10/1/2026",
    );
    expect(lens.hearingCoverage).toEqual({ first: "2021-01-28", last: "2026-12-03" });
    expect(lens.panelOrders).toEqual([]);
    expect(lens.recordedTitle).toEqual({
      title: "In re: Abbott Laboratories Spinal Cord Stimulator Products Liability Litigation",
      source: "the JPML “Pending MDL Dockets by MDL Type” report of 10/1/2026 (court-page index)",
    });
    const paths = get.mock.calls.map(([p]) => p);
    expect(paths).toContainEqual(expect.stringContaining("item->matter->>mdl=eq.3194"));
    expect(paths).toContainEqual(expect.stringContaining("id=like.3194:*"));
    expect(paths).toContainEqual(
      expect.stringContaining("id=like.order:*&item->order->>mdl=eq.3194"),
    );
  });

  it("returns a non-empty view for an MDL whose only record is a GovInfo Panel order", async () => {
    const lens = await run(
      (path) =>
        path.includes("dataset=eq.mdl_intel_hearing_orders&id=like.order:*")
          ? // A row for another number never binds, even if the read returned it.
            [
              ORDER_17,
              {
                ...ORDER_17,
                id: "order:USCOURTS-jpml-1_69-F-00170-0",
                order: { ...ORDER_17.order, mdl: 170 },
              },
            ]
          : [],
      17,
    );
    expect(lens.mdl).toBeNull();
    expect(lens.panelOrders.map((o) => o.id)).toEqual([ORDER_17.id]);
    expect(lens.panelOrdersInHearings).toBe(0);
    expect(lens.recordedTitle).toEqual({
      title: ORDER_17.order.title,
      source: "the GovInfo package of the Panel's order denying transfer",
    });
    expect(lens.hearings).toEqual([]);
    expect(lens.terminated).toEqual([]);
  });

  it("lists an order once: as hearing evidence when a hearing cites the same PDF", async () => {
    const hearing = {
      ...MATTER_3194,
      mdl: 3187,
      evidence: {
        source: "govinfo",
        url: ORDER_3187.order.pdf,
        label: "Order (GovInfo)",
        date: "2026-06-09",
        text: "ORDER (Transfer Order)",
      },
    };
    const lens = await run((path) => {
      if (path.includes("id=like.matter:*"))
        return [{ source_url: NOTICE_SEPT_2026, matter: hearing }];
      if (path.includes("id=like.order:*")) return [ORDER_3187];
      return [];
    }, 3187);
    expect(lens.hearings.map((h) => h.evidenceUrl)).toEqual([ORDER_3187.order.pdf]);
    expect(lens.panelOrders).toEqual([]);
    expect(lens.panelOrdersInHearings).toBe(1);
  });

  it("drops a court-page record whose recorded number differs and reports nothing recorded", async () => {
    const lens = await run((path) =>
      path.includes("dataset=eq.mdl_intel_court_pages")
        ? [{ source_url: PENDING_REPORT, court: { mdl: 3195, title: "Other" } }]
        : [],
    );
    expect(lens.courtPage).toBeNull();
    expect(lens.courtPageSourceUrl).toBeNull();
    expect(lens.courtPageSourceLabel).toBeNull();
    expect(lens.recordedTitle).toBeNull();
    expect(lens.hearings).toEqual([]);
    expect(lens.panelOrders).toEqual([]);
    expect(lens.hearingCoverage).toEqual({ first: null, last: null });
    expect(lens.series).toEqual({ first: null, asOf: null, reports: null, sourceUrl: null });
  });
});

describe("hearing evidence quotes", () => {
  it("quotes only verbatim evidence and marks text cut at the builder's cap", () => {
    // MDL 2990 (GovInfo docket text, stored as text[:500]).
    const docket = `ORDER DENYING TRANSFER re: pldg. ${"x".repeat(467)}`;
    expect(docket).toHaveLength(500);
    expect(evidenceQuote("govinfo", docket)).toEqual({
      text: docket,
      label: "GovInfo docket text",
      clipped: true,
    });
    expect(evidenceQuote("govinfo", "ORDER DENYING TRANSFER.")?.clipped).toBe(false);
    // A Panel order without an operative sentence stores its kind, a slug; a pending-report entry stores a
    // builder sentence; an archive order stores its link label. None of these is a quote.
    expect(evidenceQuote("jpml_panel_orders_page", "transfer_order")).toBeNull();
    expect(
      evidenceQuote(
        "jpml_pending_report",
        "Listed as pending: transferred 2026-07-30 to Judge X (N.D. Ill.)",
      ),
    ).toBeNull();
    expect(evidenceQuote("jpml_archive_order", "MDL-2744 - Order Vacating CTO")).toBeNull();
    expect(evidenceQuote(null, "IT IS ORDERED that ...")).toBeNull();
    expect(evidenceQuote("govinfo", null)).toBeNull();
  });
});

describe("hearing evidence labels", () => {
  // Stored for MDL 2873, session 2026-05-28: label is the link text cut to 80 characters, text the full link text.
  const cut = "MDL-2873 - Order Vacating Conditional Transfer Order and Vacating the May 28, 20";
  const full =
    "MDL-2873 - Order Vacating Conditional Transfer Order and Vacating the May 28, 2026, Hearing Session Order - GAN 1:25-04557";
  it("shows an archive order's full stored link text", () => {
    expect(cut).toHaveLength(80);
    expect(evidenceLabel("jpml_archive_order", cut, full)).toBe(full);
    const h = toHearing(
      {
        matter: {
          ...MATTER_3194,
          mdl: 2873,
          session: "2026-05-28",
          section: "B",
          evidence: {
            url: "https://www.jpml.uscourts.gov/sites/jpml/files/MDL-2873_Order_Vacating_CTO_and_Vacating_May_2026_Hearing%20%28GAN%201%2025-04557%29.pdf",
            date: null,
            text: full,
            label: cut,
            source: "jpml_archive_order",
          },
        },
      },
      2873,
    )!;
    expect(h.evidenceLabel).toBe(full);
    // The link text is a label, not a quote of the order.
    expect(h.evidenceQuote).toBeNull();
  });

  it("marks the cut label only when no full text is stored", () => {
    expect(evidenceLabel("jpml_archive_order", cut)).toBe(`${cut} …`);
    expect(evidenceLabel("jpml_archive_order", "MDL-2744 - Order Vacating CTO")).toBe(
      "MDL-2744 - Order Vacating CTO",
    );
    expect(evidenceLabel("jpml_panel_orders_page", "Panel order (JPML)", "IT IS ORDERED")).toBe(
      "Panel order (JPML)",
    );
    expect(evidenceLabel("govinfo", null)).toBeNull();
  });
});

describe("toFdaReport", () => {
  const row = {
    dataset: "fda_device_event_series",
    id: "3014",
    title: "Philips CPAP — MAUDE reports (MDL 3014)",
    m: "3014",
    cells: { reports: "276,797", deaths: "412" },
    facts: [
      ["Search scope", "The brand token TRILOGY also matches other makers' devices."],
      ["Data through", "2026-09-30 (openFDA last updated 2026-10-12)"],
    ],
  };

  it("keeps a row bound to exactly this MDL number and reads its scope note", () => {
    expect(toFdaReport(row, 3014)).toEqual({
      dataset: "fda_device_event_series",
      recordId: "3014",
      system: "MAUDE",
      title: "Philips CPAP — MAUDE reports (MDL 3014)",
      reports: "276,797",
      deaths: "412",
      searchScope: "The brand token TRILOGY also matches other makers' devices.",
      dataThrough: "2026-09-30 (openFDA last updated 2026-10-12)",
    });
  });

  it("drops a row for another MDL number, an unknown dataset or a row without a count", () => {
    expect(toFdaReport(row, 3015)).toBeNull();
    expect(toFdaReport({ ...row, m: "30140" }, 3014)).toBeNull();
    expect(toFdaReport({ ...row, dataset: "other_dataset" }, 3014)).toBeNull();
    expect(toFdaReport({ ...row, cells: { deaths: "1" } }, 3014)).toBeNull();
  });

  it("leaves the scope and date notes null when the row states none", () => {
    expect(toFdaReport({ ...row, facts: [] }, 3014)).toMatchObject({
      searchScope: null,
      dataThrough: null,
    });
  });
});

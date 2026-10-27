import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const restGet = vi.fn();
const rpcPostOptional = vi.fn();
const readAllRows = vi.fn();
const countRows = vi.fn();
vi.mock("@/lib/external/rest.server", () => ({ restGet, rpcPostOptional, rpcPost: vi.fn() }));
vi.mock("@/lib/analytics/tally.server", () => ({ readAllRows, countRows }));
vi.mock("./source.server", () => ({ loadRegistryMatter: vi.fn(async () => null) }));

const {
  buildDefendantRoster,
  buildSecDefendants,
  buildTypedEvents,
  classifyRows,
  loadKeyOrders,
  loadOrderDocuments,
  loadTypedEvents,
  parseMasterDocket,
  parseOrderDocuments,
  parseRegulatoryLink,
  rule702Summary,
  scanPath,
} = await import("./command.server");

const row = (id: string, n: number, f: string, d: string | null, w: string | null = null) => ({
  id,
  d,
  n,
  f,
  k: "cand:4:2022-md-03047",
  u: `https://www.courtlistener.com/docket/65407433/${n}/x/`,
  w,
  h: w ? w !== "contact_or_access_data" : false,
  ids: ["217443845"],
});

describe("scan paths", () => {
  it("filters by dataset, by the indexed MDL containment and by one anchored pattern", () => {
    const p = scanPath("3047", "^[^A-Za-z0-9]{0,4}(CMO|PTO)");
    expect(p).toContain("dataset=eq.sw_docket_entries_v1");
    expect(p).toContain(`filters=cs.${encodeURIComponent('{"mdl":"3047"}')}`);
    expect(p).toContain(
      `item->cells->>description=imatch.${encodeURIComponent("^[^A-Za-z0-9]{0,4}(CMO|PTO)")}`,
    );
    expect(p).toContain("order=ordinal.asc,id.asc");
  });
});

describe("classifyRows", () => {
  const rows = [
    row(
      "a",
      75,
      "2022-11-10",
      "CASE MANAGEMENT ORDER NO. 1. Signed by Judge Yvonne Gonzalez Rogers on 11/10/2022.",
    ),
    row(
      "a",
      75,
      "2022-11-10",
      "CASE MANAGEMENT ORDER NO. 1. Signed by Judge Yvonne Gonzalez Rogers on 11/10/2022.",
    ),
    row(
      "b",
      900,
      "2023-05-01",
      "CASE MANAGEMENT ORDER NO. 15. Signed by Judge Y",
      "sealed_or_restricted_text",
    ),
    row(
      "c",
      3428,
      "2026-08-20",
      "CLERK'S NOTICE. You are hereby notified that Jury Trial set for 8/20/2026, is vacated and continued to 8/24/2026, at 8:00 AM in Oakland.",
    ),
    row(
      "d",
      10,
      "2022-10-01",
      "Joint MOTION for Extension of Time by Defendants. Response to Motion due by 3/5/2025.",
    ),
  ];
  const out = classifyRows(rows);

  it("de-duplicates rows read by several patterns and never classifies a withheld entry", () => {
    expect(out.entries.map((e) => e.id)).toEqual(["a", "c"]);
    expect(out.entries.find((e) => e.id === "b")).toBeUndefined();
  });

  it("keeps the entry identity and https source", () => {
    expect(out.entries[0]).toMatchObject({
      entryNumber: 75,
      date: "2022-11-10",
      docketKey: "cand:4:2022-md-03047",
      sourceUrl: "https://www.courtlistener.com/docket/65407433/75/x/",
      documentIds: ["217443845"],
      role: "order",
    });
  });

  it("reads docketed dates with the role of the entry that printed them", () => {
    expect(out.dates.map((d) => [d.entryId, d.date, d.vacated, d.entryRole])).toEqual([
      ["d", "2025-03-05", false, "filing"],
      ["c", "2026-08-20", true, "clerk_setting"],
      ["c", "2026-08-24", false, "clerk_setting"],
    ]);
  });

  it("summarizes Rule 702 rulings by stated outcome and counts motions apart", () => {
    const r = classifyRows([
      row(
        "x",
        1,
        "2026-02-17",
        "ORDER DENYING RULE 702 MOTION TO EXCLUDE SCHOOL DISTRICT EXPERTS by Judge Y",
      ),
      row("y", 2, "2026-03-01", "ORDER RE DAUBERT MOTIONS ON CAUSATION by Judge Y"),
      row(
        "z",
        3,
        "2025-10-01",
        "MOTION to Exclude Opinions of Dr. Roe under Rule 702 filed by Defendants.",
      ),
    ]);
    expect(rule702Summary(r.entries)).toEqual({
      rulings: 2,
      byOutcome: { granted: 0, denied: 1, granted_in_part: 0, not_stated: 1 },
      motions: 1,
    });
  });
});

describe("loadKeyOrders", () => {
  beforeEach(() => {
    restGet.mockReset();
    readAllRows.mockReset();
    countRows.mockReset();
  });

  it("reads every prefilter with the MDL containment, then the coverage counts", async () => {
    readAllRows.mockImplementation(async (p: string) => {
      if (p.includes("description_withheld%22%3A%22true"))
        return [
          { w: "sealed_or_restricted_text", h: true },
          { w: "contact_or_access_data", h: false },
        ];
      if (p.includes("CASE%20MANAGEMENT"))
        return [
          row(
            "a",
            75,
            "2022-11-10",
            "CASE MANAGEMENT ORDER NO. 1. Signed by Judge Y on 11/10/2022.",
          ),
        ];
      return [];
    });
    countRows.mockImplementation(async (p: string) => (p.includes("is.null") ? 370 : 4035));
    restGet.mockResolvedValue({ rows: [{ f: "2026-10-03" }], total: null });
    const k = await loadKeyOrders("3047");
    const scanCalls = readAllRows.mock.calls.filter((c) => String(c[0]).includes("imatch."));
    expect(scanCalls.length).toBeGreaterThanOrEqual(5);
    for (const [p] of scanCalls) {
      expect(p).toContain("dataset=eq.sw_docket_entries_v1");
      expect(p).toContain(`filters=cs.${encodeURIComponent('{"mdl":"3047"}')}`);
    }
    expect(k.coverage).toEqual({
      total: 4035,
      withheld: [
        { reason: "contact_or_access_data", count: 1 },
        { reason: "sealed_or_restricted_text", count: 1 },
      ],
      withheldTotal: 2,
      noText: 370,
      collectedThrough: "2026-10-03",
      candidatesRead: 1,
    });
    expect(k.ledger.cmo.highest).toBe(1);
    expect(k.rule).toBe("orders/2");
    await expect(loadKeyOrders("0")).rejects.toThrow("Invalid MDL number.");
  });
});

describe("master docket and order PDFs", () => {
  const masterRows = [
    {
      id: "sw-md:3047:cand:4:2022-md-03047",
      cells: { mdl: "3047", role: "master", court_id: "cand", docket_number: "4:22-md-03047" },
    },
  ];

  it("takes the one master docket the registry records for the MDL, else none", () => {
    expect(parseMasterDocket("3047", masterRows)).toEqual({
      id: "sw-md:3047:cand:4:2022-md-03047",
      docketKey: "cand:4:2022-md-03047",
      courtId: "cand",
      docketNumber: "4:22-md-03047",
    });
    expect(
      parseMasterDocket("3047", [
        ...masterRows,
        { ...masterRows[0]!, id: "sw-md:3047:cand:4:2022-md-99999" },
      ]),
    ).toBeNull();
    expect(parseMasterDocket("3048", masterRows)).toBeNull();
  });

  it("drops document rows whose join keys do not come back exactly", () => {
    const master = parseMasterDocket("3047", masterRows)!;
    const byEntry = parseOrderDocuments(
      [
        {
          id: "d_1",
          mdl: "3047",
          court_id: "cand",
          docket_number: "4:22-md-03047",
          entry_number: 75,
          title: "CMO 1",
          source_url: "https://storage.courtlistener.com/x.pdf",
        },
        {
          id: "d_2",
          mdl: "3047",
          court_id: "cand",
          docket_number: "4:22-md-3047",
          entry_number: 82,
        },
        {
          id: "d_3",
          mdl: "2846",
          court_id: "cand",
          docket_number: "4:22-md-03047",
          entry_number: 82,
        },
      ],
      master,
      "3047",
    );
    expect(Object.keys(byEntry)).toEqual(["75"]);
    expect(byEntry["75"]![0]).toMatchObject({
      id: "d_1",
      title: "CMO 1",
      sourceUrl: "https://storage.courtlistener.com/x.pdf",
    });
  });

  it("asks only for master-docket entries and reports a missing lookup as not connected", async () => {
    restGet.mockReset();
    rpcPostOptional.mockReset();
    restGet.mockResolvedValue({ rows: masterRows, total: null });
    rpcPostOptional.mockResolvedValue(null);
    const out = await loadOrderDocuments("3047", [
      { docketKey: "cand:4:2022-md-03047", entryNumber: 75 },
      { docketKey: "cand:4:2023-cv-00001", entryNumber: 5 },
    ]);
    expect(rpcPostOptional).toHaveBeenCalledWith("documents_for_entries_v1", {
      p_mdl: "3047",
      p_court: "cand",
      p_docket: "4:22-md-03047",
      p_entries: [75],
    });
    expect(out).toEqual({
      connected: false,
      reason: "The order-document lookup is not available yet.",
    });
  });
});

describe("regulatory links", () => {
  it("keeps the link only for its own MDL and only openFDA source URLs", () => {
    const l = parseRegulatoryLink(
      {
        id: "sw-reg:2846:dev-enf:Z-2242-2023",
        title: "FDA recall Z-2242-2023",
        source_url:
          "https://api.fda.gov/device/enforcement.json?search=recall_number:%22Z-2242-2023%22",
        cells: {
          mdl: "2846",
          date: "2023-04-25",
          firm: "Davol, Inc.",
          fda_id: "Z-2242-2023",
          classification: "Class II",
          association: "Topical association — not MDL membership",
        },
        filters: { fda_kind: "recall", fda_record: "openfda:device/enforcement:Z-2242-2023" },
      },
      "2846",
    );
    expect(l).toMatchObject({
      fdaId: "Z-2242-2023",
      date: "2023-04-25",
      fdaKind: "recall",
      association: "Topical association — not MDL membership",
    });
    expect(
      parseRegulatoryLink(
        {
          id: "sw-reg:2846:x",
          title: null,
          source_url: null,
          cells: { mdl: "2846" },
          filters: null,
        },
        "3081",
      ),
    ).toBeNull();
  });
});

describe("defendant roster", () => {
  const party = (
    id: string,
    name: string,
    types: string,
    terminated: string | null,
    firms: [string, boolean][],
  ) => ({
    id: `sw-party:courtlistener:69674950:${id}`,
    cells: {
      party_name: name,
      party_types: types,
      date_terminated: terminated,
      counsel_count: firms.length,
      name_withheld: false,
    },
    counsel: firms.map(([firm, t], i) => ({
      firm,
      name: `A ${i}`,
      roles: [],
      terminated: t,
      native_attorney_id: String(i),
    })),
  });

  it("keeps exact 'Defendant' apart from mixed types, never merges firm spellings and states the capture", () => {
    const r = buildDefendantRoster(
      "3047",
      [
        party("1", "VIATRIS INC", "Defendant", "2025-07-10", [
          ["DECHERT LLP - NEW YORK NY", false],
        ]),
        party("2", "PFIZER INC", "Defendant", null, [
          ["Covington & Burling LLP", false],
          ["Covington and Burling LLP", false],
          ["Old Firm", true],
        ]),
        party("3", "META PLATFORMS", "Defendant / Plaintiff", null, [
          ["Covington & Burling LLP", false],
        ]),
      ],
      { published: 100, complete: false },
    );
    expect(r.defendants.map((d) => d.name)).toEqual(["PFIZER INC", "VIATRIS INC"]);
    expect(r.mixed.map((d) => d.name)).toEqual(["META PLATFORMS"]);
    expect(r.firms).toEqual([
      { firm: "Covington & Burling LLP", parties: 1 },
      { firm: "Covington and Burling LLP", parties: 1 },
      { firm: "DECHERT LLP - NEW YORK NY", parties: 1 },
    ]);
    expect(r.terminatedByMonth).toEqual([{ month: "2025-07", count: 1 }]);
    expect(r.captureNote).toBe(
      "3 defendant parties among 100 parties published; the party capture is incomplete, so the docket may list more.",
    );
  });
});

describe("typed events", () => {
  const link = (over: Record<string, unknown>) => ({
    source_dataset: "mdl_docket_documents",
    source_record_id: "r1",
    mdl: "2545",
    court_id: "ilnd",
    docket_number: "1:14-cv-01748",
    entry_number: "10",
    event_date: "2014-06-12",
    date_basis: "entry_date_filed",
    document_type: "Case management order",
    evidence_url: "https://www.courtlistener.com/docket/1/10/",
    linkage_basis: "Exact native CourtListener docket URL/identifier",
    ...over,
  });

  it("maps a blank-MDL row only by the exact master court and docket number", () => {
    const out = buildTypedEvents(
      "2545",
      [link({ source_record_id: "own", document_type: "Bellwether", event_date: null })],
      [
        link({ source_record_id: "b1", mdl: "" }),
        link({ source_record_id: "b2", mdl: "", docket_number: "1:14-cv-1748" }),
        link({ source_record_id: "b3", mdl: "", court_id: "ilsd" }),
        link({ source_record_id: "b4", mdl: "", document_type: "Other" }),
      ],
      { courtId: "ilnd", docketNumber: "1:14-cv-01748" },
    );
    expect(out.events.map((e) => [e.sourceRecordId, e.attribution])).toEqual([
      ["b1", "master_docket"],
      ["own", "mdl"],
    ]);
    expect(out.blankMdlAttributed).toBe(1);
    expect(out.byType).toEqual([
      { type: "Bellwether", count: 1, first: null, last: null, undated: 1 },
      {
        type: "Case management order",
        count: 1,
        first: "2014-06-12",
        last: "2014-06-12",
        undated: 0,
      },
    ]);
    expect(buildTypedEvents("2545", [], [link({ mdl: "" })], null).events).toEqual([]);
  });

  it("uses blank-MDL rows only when the master docket belongs to this MDL alone", async () => {
    restGet.mockReset();
    readAllRows.mockReset();
    restGet.mockImplementation(async (p: string) =>
      p.includes("role%22%3A%22master%22%2C%22court_id")
        ? {
            rows: [
              {
                id: "sw-md:2545:ilnd:1:2014-cv-01748",
                cells: { mdl: "2545", docket_number: "1:14-cv-01748" },
              },
              {
                id: "sw-md:9999:ilnd:1:2014-cv-01748",
                cells: { mdl: "9999", docket_number: "1:14-cv-01748" },
              },
            ],
            total: null,
          }
        : {
            rows: [
              {
                id: "sw-md:2545:ilnd:1:2014-cv-01748",
                cells: {
                  mdl: "2545",
                  role: "master",
                  court_id: "ilnd",
                  docket_number: "1:14-cv-01748",
                },
              },
            ],
            total: null,
          },
    );
    readAllRows.mockResolvedValue([]);
    const out = await loadTypedEvents("2545");
    expect(out.masterDocket).toBeNull();
    expect(readAllRows.mock.calls.some((c) => String(c[0]).includes("mdl=eq.&"))).toBe(false);
  });
});

describe("SEC registrants", () => {
  const verified = [
    {
      adsh: "0000010795-25-000001",
      form: "10-K",
      file_date: "2025-11-20",
      url: "https://www.sec.gov/Archives/edgar/data/10795/000001079525000001/bdx-20250930.htm",
      excerpt: "MDL No. 2846",
    },
  ];
  const linkRow = (cik: string, tier: string, review = false) => ({
    link: {
      cik,
      company: `Co ${cik}`,
      mdl: 2846,
      tier,
      mdl_title: "In re: Davol",
      verified,
      review,
      role: "defendant",
    },
  });

  it("joins by exact MDL and CIK, keeps tier C and review links apart and never sums anything", () => {
    const out = buildSecDefendants(
      "2846",
      [
        linkRow("0000010795", "A"),
        linkRow("0000000001", "C"),
        linkRow("0000000002", "B", true),
        { link: { ...linkRow("0000000003", "A").link, mdl: 2847 } },
      ],
      [
        {
          id: "0000010795",
          source_url: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000010795.json",
          annual: {
            litigation_accrual: [
              {
                fy: 2025,
                end: "2025-09-30",
                value: 1800000000,
                unit: "USD",
                concept: "LossContingencyAccrualAtCarryingValue",
                accn: "a",
                form: "10-K",
                filed: "2025-11-20",
                start: null,
              },
            ],
          },
          labels: { litigation_accrual: "Litigation / loss-contingency accrual" },
          retrieved: "2026-10-18",
        },
      ],
    );
    expect(out.named.map((n) => n.cik)).toEqual(["0000010795"]);
    expect(out.review.map((n) => n.cik)).toEqual(["0000000002", "0000000001"]);
    expect(out.named[0]!.accrual?.points[0]?.value).toBe(1800000000);
    expect(out.named[0]!.legalPayments).toBeNull();
    expect(out.review[1]!.accrual).toBeNull();
    expect(out.caveats.join(" ")).toMatch(/not attributable to this MDL/);
  });
});

describe("documents_for_entries_v1 contract", () => {
  const sql = readFileSync(path.resolve("database/contracts/documents-entries-v1.sql"), "utf8");
  it("is a SECURITY DEFINER function with an empty search_path, revoked from clients and granted to service_role", () => {
    expect(sql).toMatch(/create or replace function public\.documents_for_entries_v1\(/);
    expect(sql).toMatch(/security definer set search_path = ''/);
    expect(sql).toMatch(
      /revoke all on function public\.documents_for_entries_v1\(text, text, text, integer\[\]\) from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.documents_for_entries_v1\(text, text, text, integer\[\]\) to service_role;/,
    );
  });
  it("joins on mdl, court, docket number and entry number and never returns withheld documents", () => {
    expect(sql).toMatch(
      /d\.mdl = p_mdl\s+and d\.court_id = p_court\s+and d\.docket_number = p_docket\s+and d\.entry_number = any \(p_entries\)\s+and d\.withheld_reason is null/,
    );
    expect(sql).not.toMatch(/\b(insert|update|delete)\b/i);
  });
});

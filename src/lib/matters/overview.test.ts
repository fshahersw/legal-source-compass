import { describe, expect, it } from "vitest";
import {
  normalizeMdlNumber,
  orNotRecorded,
  parseJudge,
  parseMdlDetail,
  parseReports,
} from "./overview";

/** Synthetic record in the shape of the corpus's MDL detail JSON (values are invented for the test). */
function detail(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "IN RE: Example Products Liability Litigation",
    status: "pending",
    circuit: "Eleventh Circuit",
    court_name: "N.D. Florida",
    fjc_court_name: "U.S. District Court for the Northern District of Florida",
    mdl_number: 9001,
    cl_court_id: "flnd",
    district_code: "FLN",
    master_docket: "3:25-md-9001",
    date_filed: "2024-11-26",
    date_transferred: "2025-02-07",
    date_closed: null,
    total_actions: 6510,
    actions_pending: 6403,
    counts_label: "as listed in the JPML report dated 2026-09-01",
    litigation_type: "Products Liability",
    court: {
      cl_full_name: "District Court, N.D. Florida",
      cl_short_name: "N.D. Florida",
      circuit: "Eleventh Circuit",
      jpml_code: "FLN",
    },
    summary: {
      id: "mdl:9001",
      as_of: "2026-09-01",
      cl_docket_id: 111222333,
      cl_assigned_to_id: 4242,
      judge_name_as_printed: "A. Example Judge",
    },
    transferee_judge: {
      name_as_printed: "A. Example Judge",
      title_as_printed: "U.S. District Judge",
    },
    judge_links: [
      {
        basis: "cl_person_native_bridge",
        entity_id: "judge-entity-aaaa",
        display_name: "Alexandra Example Judge",
        fjc_jid: "1",
        fjc_nid: "2",
        cl_person_id: 4242,
        alias_basis: "native-id bridge: CourtListener person 4242 == FJC jid 1",
      },
    ],
    snapshots: [
      {
        as_of: "2026-03-31",
        total_actions: 100,
        actions_pending: 90,
        counts_label: "as listed in the JPML report dated 2026-03-31",
      },
      { as_of: "2026-09-01", total_actions: 6510, actions_pending: 6403, counts_label: "x" },
    ],
    documents: [
      {
        document_id: "jpmldoc-1",
        url: "/mdl-files/jpmldoc-1",
        kind: "report_pdf",
        report_kind: "by_mdl_number",
        title: "JPML MDL Statistics Report - Docket Summary Listing",
        report_date: "2026-09-01",
        final_url: "https://www.jpml.uscourts.gov/sites/jpml/files/example.pdf",
        pages: 6,
        bytes: 440352,
      },
    ],
    cases: {
      total: 1,
      by_court: { flnd: 1 },
      by_status: { supporting_master: 1 },
      by_filed_year: { "2024": 1 },
      by_membership_kind: { master_docket_of_mdl: 1 },
      jpml_total_actions: 6510,
      jpml_actions_pending: 6403,
      qualification: "q",
    },
    ...over,
  };
}

describe("MDL detail parser", () => {
  it("reads the header fields exactly as recorded", () => {
    const m = parseMdlDetail(detail())!;
    expect(m.mdl).toBe("9001");
    expect(m.recordId).toBe("mdl:9001");
    expect(m.court).toMatchObject({
      clId: "flnd",
      shortName: "N.D. Florida",
      fullName: "District Court, N.D. Florida",
      circuit: "Eleventh Circuit",
      districtCode: "FLN",
    });
    expect(m.masterDocket).toEqual({ number: "3:25-md-9001", clDocketId: "111222333" });
    expect(m.dates).toEqual({ filed: "2024-11-26", transferred: "2025-02-07", closed: null });
    expect(m.actions.total).toBe(6510);
    expect(m.actions.pending).toBe(6403);
    expect(m.asOf).toBe("2026-09-01");
    expect(m.actions.snapshots.map((s) => s.asOf)).toEqual(["2026-09-01", "2026-03-31"]);
    expect(m.keys.docketBird).toBe("flnd-3:2025-md-09001");
    expect(m.cases?.byMembershipKind).toEqual({ master_docket_of_mdl: 1 });
  });

  it("rejects non-MDL payloads and never invents a number", () => {
    expect(parseMdlDetail(null)).toBeNull();
    expect(parseMdlDetail([])).toBeNull();
    expect(parseMdlDetail({ title: "x" })).toBeNull();
    const sparse = parseMdlDetail({ mdl_number: 12 })!;
    expect(sparse.title).toBe("MDL 12");
    expect(sparse.actions).toEqual({ total: null, pending: null, snapshots: [] });
    expect(sparse.masterDocket).toEqual({ number: null, clDocketId: null });
    expect(sparse.keys.all).toEqual([]);
    expect(sparse.cases).toBeNull();
  });

  it("normalizes MDL numbers from route and record forms", () => {
    expect(normalizeMdlNumber("mdl:03047")).toBe("3047");
    expect(normalizeMdlNumber("MDL-3047")).toBe("3047");
    expect(normalizeMdlNumber(3047)).toBe("3047");
    for (const bad of ["", "abc", "0", "-5", "1234567", null, undefined, "30 47"])
      expect(normalizeMdlNumber(bad)).toBeNull();
  });
});

describe("presiding judge link policy", () => {
  it("links on a native-id bridge", () => {
    const j = parseJudge(detail());
    expect(j).toMatchObject({
      printedName: "A. Example Judge",
      profileName: "Alexandra Example Judge",
      entityId: "judge-entity-aaaa",
      nativeIdEvidence: true,
      fjcJid: "1",
      clPersonId: "4242",
    });
    expect(j.evidenceNote).toContain("native-id bridge");
  });

  it("links on a name-and-court join only when the CourtListener assigned_to person agrees", () => {
    const named = detail({
      judge_links: [
        {
          basis: "jpml_name_court",
          match_kind: "exact",
          entity_id: "judge-entity-bbbb",
          display_name: "B. Name",
        },
      ],
      cl_links: { agreement_with_name_join: "agree" },
    });
    expect(parseJudge(named)).toMatchObject({
      entityId: "judge-entity-bbbb",
      nativeIdEvidence: true,
    });
    const unverified = detail({
      judge_links: [
        {
          basis: "jpml_name_court",
          match_kind: "exact",
          entity_id: "judge-entity-bbbb",
          display_name: "B. Name",
        },
      ],
      cl_links: { agreement_with_name_join: "cl_docket_has_no_assigned_to_id" },
    });
    const j = parseJudge(unverified);
    expect(j.entityId).toBe("judge-entity-bbbb");
    expect(j.nativeIdEvidence).toBe(false);
  });

  it("does not link when there are zero or several candidate profiles, and keeps the printed name", () => {
    const none = parseJudge(detail({ judge_links: [] }));
    expect(none.entityId).toBeNull();
    expect(none.nativeIdEvidence).toBe(false);
    expect(none.printedName).toBe("A. Example Judge");
    const several = parseJudge(
      detail({
        judge_links: [
          { entity_id: "a", basis: "cl_person_native_bridge" },
          { entity_id: "b", basis: "cl_person_native_bridge" },
        ],
      }),
    );
    expect(several.entityId).toBeNull();
    expect(several.nativeIdEvidence).toBe(false);
  });
});

describe("JPML statistics reports", () => {
  it("keeps the publisher URL only when it is https and never invents a stored copy", () => {
    const [r] = parseReports(detail()["documents"]);
    expect(r).toMatchObject({
      documentId: "jpmldoc-1",
      kind: "by_mdl_number",
      reportDate: "2026-09-01",
      pages: 6,
      bytes: 440352,
      storedRoute: "/mdl-files/jpmldoc-1",
    });
    expect(r!.officialUrl).toBe("https://www.jpml.uscourts.gov/sites/jpml/files/example.pdf");
    const [insecure] = parseReports([{ document_id: "x", final_url: "http://example.test/a.pdf" }]);
    expect(insecure!.officialUrl).toBeNull();
    expect(parseReports([{ nothing: true }, null, 5])).toEqual([]);
    expect(parseReports("no")).toEqual([]);
  });
});

describe("display helper", () => {
  it("renders unknown values as Not recorded and never as zero", () => {
    expect(orNotRecorded(null)).toBe("Not recorded");
    expect(orNotRecorded(undefined)).toBe("Not recorded");
    expect(orNotRecorded("")).toBe("Not recorded");
    expect(orNotRecorded(0)).toBe("0");
    expect(orNotRecorded(6510)).toBe("6,510");
  });
});

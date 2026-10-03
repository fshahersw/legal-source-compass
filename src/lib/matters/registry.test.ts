import { describe, expect, it } from "vitest";
import {
  computeFacets,
  evidenceKindLabel,
  filterCases,
  mergeCases,
  masterCase,
  routeLabel,
  scopedFacets,
  type CaseRow,
} from "./cases";
import type { MatterOverview } from "./overview";
import {
  caseIdPlan,
  formatLocator,
  isLinkableSource,
  isRegistryRowOf,
  isNativeCaseId,
  parseRegistryDocket,
  parseRegistryDocketDetail,
  overviewFromRegistry,
  parseRegistryLabels,
  parseRegistryMatter,
  parseRegistryRecord,
  pdfLookupCaseIds,
  registryMetrics,
  withRegistryJpml,
} from "./registry";

/** Trimmed from the live sw_matters_v1 record for MDL 3140 (public court identifiers only). */
const matterRegistry = () => ({
  mdl: "3140",
  schema: "sw-matter-registry/1",
  tier: "tier1",
  gaps: ["Registry holds 35 distinct member-like dockets versus 6,412 actions pending."],
  jpml: {
    as_of: "2026-10-01",
    scope: "active MDL, all historical actions",
    pending: 6412,
    report_url: "https://www.jpml.uscourts.gov/sites/jpml/files/Pending_MDL_Dockets.pdf",
    historical_total: 6524,
  },
  judges: [
    {
      role: "assigned_to",
      basis: "courtlistener docket resource assigned_to",
      docket_key: "flnd:3:2025-md-03140",
      cl_person_id: "2755",
      source_string: "M. Casey Rodgers",
    },
    {
      role: "referred_to",
      basis: "courtlistener docket resource referred_to",
      docket_key: "flnd:3:2025-md-03140",
      cl_person_id: "9162",
      source_string: "Hope T. Cannon",
    },
  ],
  entries: [
    {
      captured: 1057,
      complete: true,
      provider: "courtlistener",
      docket_key: "flnd:3:2025-md-03140",
      observed_at: "2026-10-03T10:54:07.461Z",
      provider_total: 1057,
    },
  ],
  members: { rows: 35, actions: 35, by_basis: { jpml_schedule_a: 28, docketbird_relationship: 7 } },
  case_ids: [
    {
      role: "master",
      basis: ["jpml_master_docket_list", "cl_docket_header"],
      court_id: "flnd",
      docket_key: "flnd:3:2025-md-03140",
      docket_number: "3:25-md-03140",
      native_case_ids: [
        {
          id: "flnd-3:2025-md-03140",
          provider: "docketbird",
          source_system: "docketbird",
          resolution_basis: "provider_native_id",
        },
        {
          id: "69674950",
          provider: "courtlistener",
          pacer_case_id: "529488",
          source_system: "courtlistener",
          resolution_basis: "exact_docket_key",
        },
      ],
    },
    {
      role: "jpml_panel",
      basis: ["docketbird_search_exact"],
      court_id: "jpml",
      docket_key: "jpml:0:2024-md-03140",
      docket_number: "0:24-md-03140",
      native_case_ids: [
        {
          id: "jpml-0:2024-md-03140",
          provider: "jpml",
          source_system: "docketbird",
          resolution_basis: "provider_native_id",
        },
      ],
    },
  ],
  provenance: { run_ids: ["run-1"], projected_at: "2026-10-03T11:44:17.992Z" },
  jpml_orders: [
    {
      url: "https://www.jpml.uscourts.gov/sites/jpml/files/MDL-3140-Transfer_Order-1-25.pdf",
      rows: 27,
      cto_no: null,
      doc_date: "2025-02-07",
      doc_type: "transfer_order",
      alt_copies: [
        {
          url: "https://www.govinfo.gov/content/pkg/USCOURTS-jpml-1_24-F-03140/pdf/x.pdf",
          rows: 27,
          retrieved_at: "2026-10-03T11:28:31.140Z",
        },
      ],
      document_sha256: "e69c779098700f69ede68ec04982aa82f3fa43f5df7b602c4b3258cf3507a457",
    },
  ],
  pdf_case_ids: ["flnd-3:2025-md-03140", "69674950", "jpml-0:2024-md-03140"],
  parties_summary: [
    { kind: "parties", captured: 11, complete: true, provider: "courtlistener", docket_key: "k" },
    { kind: "attorneys", captured: 26, complete: true, provider: "courtlistener", docket_key: "k" },
  ],
  unassigned_native_case_ids: [],
});

describe("matter registry record", () => {
  it("reads the explicit case ids, coverage and JPML block", () => {
    const m = parseRegistryMatter(matterRegistry(), "3140")!;
    expect(m.pdfCaseIds).toEqual(["flnd-3:2025-md-03140", "69674950", "jpml-0:2024-md-03140"]);
    expect(m.caseIds[0]).toMatchObject({ role: "master", docketKey: "flnd:3:2025-md-03140" });
    expect(m.caseIds[0]!.nativeCaseIds[1]).toMatchObject({
      provider: "courtlistener",
      id: "69674950",
      pacerCaseId: "529488",
      basis: "exact_docket_key",
    });
    expect(m.members).toEqual({
      rows: 35,
      actions: 35,
      byBasis: { jpml_schedule_a: 28, docketbird_relationship: 7 },
    });
    expect(m.judges.map((j) => [j.role, j.clPersonId, j.sourceString])).toEqual([
      ["assigned_to", "2755", "M. Casey Rodgers"],
      ["referred_to", "9162", "Hope T. Cannon"],
    ]);
    expect(m.entries[0]).toMatchObject({ captured: 1057, providerTotal: 1057, complete: true });
    expect(m.parties.map((p) => [p.kind, p.captured])).toEqual([
      ["parties", 11],
      ["attorneys", 26],
    ]);
    expect(m.jpmlOrders[0]).toMatchObject({ rows: 27, docType: "transfer_order", ctoNo: null });
    expect(m.jpmlOrders[0]!.altCopies).toHaveLength(1);
    expect(m.projectedAt).toBe("2026-10-03T11:44:17.992Z");
  });

  it("accepts the contract's single-object parties summary", () => {
    const raw = {
      ...matterRegistry(),
      parties_summary: {
        docket_key: "k",
        provider: "courtlistener",
        parties_captured: 2,
        attorneys_captured: 5,
        complete: false,
      },
    };
    const m = parseRegistryMatter(raw)!;
    expect(m.parties.map((p) => [p.kind, p.captured, p.complete])).toEqual([
      ["parties", 2, false],
      ["attorneys", 5, false],
    ]);
  });

  it("fails closed on a foreign schema, a missing block or a different MDL", () => {
    expect(parseRegistryMatter(null)).toBeNull();
    expect(parseRegistryMatter({ ...matterRegistry(), schema: "other/1" })).toBeNull();
    expect(parseRegistryMatter({ ...matterRegistry(), mdl: "abc" })).toBeNull();
    expect(parseRegistryMatter(matterRegistry(), "3047")).toBeNull();
  });

  it("drops case ids that are not plain identifiers before they can reach the PDF reader", () => {
    const raw = {
      ...matterRegistry(),
      pdf_case_ids: ["flnd-3:2025-md-03140", "x y", "a'; drop", "", "69674950", "69674950"],
    };
    expect(parseRegistryMatter(raw)!.pdfCaseIds).toEqual(["flnd-3:2025-md-03140", "69674950"]);
    expect(isNativeCaseId("3:25md3140")).toBe(true);
    expect(isNativeCaseId("../etc")).toBe(false);
  });
});

describe("case-id plan for the PDF reader", () => {
  const registry = parseRegistryMatter(matterRegistry())!;

  it("uses only the registry's explicit ids for a matter the registry covers", () => {
    const plan = caseIdPlan(registry, ["flnd-3:2025-md-03140", "3:25md3140", "9:99md1"]);
    expect(plan).toEqual([
      { id: "flnd-3:2025-md-03140", basis: "registry" },
      { id: "69674950", basis: "registry" },
      { id: "jpml-0:2024-md-03140", basis: "registry" },
    ]);
  });

  it("falls back to the derived keys when the matter is not in the registry or lists no ids", () => {
    expect(caseIdPlan(null, ["a-1", "b-2"])).toEqual([
      { id: "a-1", basis: "derived" },
      { id: "b-2", basis: "derived" },
    ]);
    expect(caseIdPlan({ pdfCaseIds: [] }, ["a-1"])).toEqual([{ id: "a-1", basis: "derived" }]);
    expect(caseIdPlan(null, [])).toEqual([]);
  });
});

describe("provider case ids of one docket for the PDF reader", () => {
  it("keeps every usable id in order and drops duplicates", () => {
    expect(
      pdfLookupCaseIds([
        { provider: "courtlistener", id: "62613213", resolution_basis: "exact_docket_key" },
        { provider: "docketbird", id: "cand-4:2022-cv-00401" },
        { provider: "courtlistener", id: 62613213 },
        { provider: "official-court", id: "4:22cv401" },
      ]),
    ).toEqual(["62613213", "cand-4:2022-cv-00401", "4:22cv401"]);
  });

  it("drops an id whose own header conflicts with the docket, and anything unsafe", () => {
    expect(
      pdfLookupCaseIds([
        { id: "63571952", resolution_basis: "firm_crosswalk_only_courtlistener_header_conflicts" },
        { id: "70000001", pdf_lookup: false },
        { id: "../etc/passwd" },
        { id: "" },
        { id: "60866823", resolution_basis: "exact_docket_key", pdf_lookup: true },
      ]),
    ).toEqual(["60866823"]);
  });

  it("returns nothing for a missing or malformed list and caps the number of ids", () => {
    expect(pdfLookupCaseIds(null)).toEqual([]);
    expect(pdfLookupCaseIds("x")).toEqual([]);
    expect(pdfLookupCaseIds([null, 5, "a"])).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `id${i}` }));
    expect(pdfLookupCaseIds(many)).toHaveLength(30);
    expect(pdfLookupCaseIds(many, 3)).toEqual(["id0", "id1", "id2"]);
  });
});

describe("registry metrics", () => {
  it("computes the matter's numbers from the record: evidence mix, entries captured vs reported, last capture", () => {
    const reg = parseRegistryRecord(
      {
        title: "IN RE: Depo-Provera",
        cells: {
          status: "pending",
          entries_published: 1057,
          entries_withheld: 85,
          parties_published: 11,
          counsel_links: 53,
        },
        facts: [],
        registry: matterRegistry(),
      },
      "3140",
    )!;
    expect(registryMetrics(reg)).toEqual({
      dockets: 35,
      actions: 35,
      byBasis: [
        { kind: "jpml_schedule_a", count: 28 },
        { kind: "docketbird_relationship", count: 7 },
      ],
      entries: {
        captured: 1057,
        providerTotal: 1057,
        complete: true,
        published: 1057,
        withheld: 85,
      },
      parties: { published: 11, counselLinks: 53 },
      lastCaptured: "2026-10-03",
    });
  });

  it("leaves what the record does not state unknown, never zero", () => {
    const reg = parseRegistryMatter(
      { ...matterRegistry(), entries: [], members: {}, parties_summary: [] },
      "3140",
    )!;
    expect(registryMetrics(reg)).toEqual({
      dockets: null,
      actions: null,
      byBasis: [],
      entries: null,
      parties: null,
      lastCaptured: null,
    });
    expect(registryMetrics(null)).toBeNull();
  });

  it("sums several captures, reports a partial one as partial and a missing provider total as unknown", () => {
    const reg = parseRegistryMatter(
      {
        ...matterRegistry(),
        entries: [
          {
            provider: "courtlistener",
            docket_key: "a",
            captured: 100,
            provider_total: 400,
            complete: false,
            observed_at: "2026-10-02T01:00:00Z",
          },
          {
            provider: "courtlistener",
            docket_key: "b",
            captured: 50,
            provider_total: null,
            complete: true,
            observed_at: "2026-10-03T09:00:00Z",
          },
        ],
      },
      "3140",
    )!;
    expect(registryMetrics(reg)!.entries).toMatchObject({
      captured: 150,
      providerTotal: null,
      complete: false,
    });
    expect(registryMetrics(reg)!.lastCaptured).toBe("2026-10-03");
  });
});

describe("JPML counts from the registry", () => {
  const overview = (over: Partial<MatterOverview> = {}): MatterOverview =>
    ({
      mdl: "3140",
      asOf: "2026-09-01",
      countsLabel: "as of 2026-09-01",
      actions: {
        total: 6510,
        pending: 6403,
        snapshots: [{ asOf: "2026-09-01", total: 6510, pending: 6403, label: null }],
      },
      ...over,
    }) as MatterOverview;
  const registry = parseRegistryMatter(matterRegistry())!;

  it("makes a newer report current and keeps the older figures with their date", () => {
    const o = withRegistryJpml(overview(), registry);
    expect(o.asOf).toBe("2026-10-01");
    expect(o.actions.total).toBe(6524);
    expect(o.actions.pending).toBe(6412);
    expect(o.actions.snapshots.map((s) => [s.asOf, s.total, s.pending])).toEqual([
      ["2026-10-01", 6524, 6412],
      ["2026-09-01", 6510, 6403],
    ]);
  });

  it("never replaces a figure with an older or already-listed report", () => {
    const newer = overview({
      asOf: "2026-11-01",
      actions: {
        total: 7000,
        pending: 6900,
        snapshots: [{ asOf: "2026-11-01", total: 7000, pending: 6900, label: null }],
      },
    });
    const o = withRegistryJpml(newer, registry);
    expect(o.actions.total).toBe(7000);
    expect(o.actions.snapshots.map((s) => s.asOf)).toEqual(["2026-11-01", "2026-10-01"]);
    const same = overview({
      actions: {
        total: 1,
        pending: 1,
        snapshots: [{ asOf: "2026-10-01", total: 1, pending: 1, label: null }],
      },
    });
    expect(withRegistryJpml(same, registry)).toBe(same);
    expect(withRegistryJpml(overview(), null).actions.total).toBe(6510);
  });
});

const rowItem = (over: Record<string, unknown> = {}) => ({
  id: "sw-md:3140:flnd:3:2026-cv-03896",
  item: {
    id: "sw-md:3140:flnd:3:2026-cv-03896",
    cells: {
      mdl: "3140",
      role: "member",
      basis: "Provider-reported (DocketBird)",
      filed: "2026-05-25",
      route: "unknown",
      status: "no_termination_date_recorded",
      court_id: "flnd",
      action_id: "act:1270395ffbada72d",
      terminated: "Not recorded",
      docket_number: "3:26-cv-03896",
      evidence_count: 1,
      counts_as_action: true,
    },
    links: [
      {
        url: "https://www.docketbird.com/cases?case_id=flnd-3:2026-cv-03896",
        label: "DocketBird docket",
      },
    ],
    badges: ["MDL member case", "Caption withheld"],
  },
  filters: {
    mdl: "3140",
    role: "member",
    basis: ["docketbird_relationship"],
    route: "unknown",
    conflict: "false",
    court_id: "flnd",
    native_case_id: ["flnd-3:2026-cv-03896"],
    counts_as_action: "true",
  },
  ...over,
});

describe("registry docket rows", () => {
  it("turns a listing row into a case with the registry's own role, route and evidence kinds", () => {
    const c = parseRegistryDocket(rowItem())!;
    expect(c).toMatchObject({
      docketNumber: "3:26-cv-03896",
      courtId: "flnd",
      dateFiled: "2026-05-25",
      dateTerminated: null,
      status: null,
      role: "member",
      route: null,
      evidence: "registry",
      source: "registry",
      captionWithheld: true,
      caption: null,
      clDocketId: null,
    });
    expect(c.registry).toMatchObject({
      docketKey: "flnd:3:2026-cv-03896",
      basisKinds: ["docketbird_relationship"],
      evidenceCount: 1,
      countsAsAction: true,
      nativeCaseIds: ["flnd-3:2026-cv-03896"],
      conflict: false,
    });
  });

  it("shows a published caption exactly as printed, with whitespace collapsed and its source kept", () => {
    const item = rowItem();
    (item.item.cells as Record<string, unknown>)["caption"] = "JONES  v.\n PFIZER INC., ET AL.";
    (item.item.cells as Record<string, unknown>)["caption_source"] = "jpml_schedule";
    const c = parseRegistryDocket(item)!;
    expect(c.caption).toBe("JONES v. PFIZER INC., ET AL.");
    expect(c.captionWithheld).toBe(false);
    expect(c.registry?.captionSource).toBe("jpml_schedule");
  });

  it("reports no caption (not a guessed one) when the projection publishes none", () => {
    const none = parseRegistryDocket(rowItem())!;
    expect(none.caption).toBeNull();
    expect(none.captionWithheld).toBe(true);
    expect(none.registry?.captionSource).toBeNull();
    const item = rowItem();
    (item.item.cells as Record<string, unknown>)["caption"] = "Not recorded";
    expect(parseRegistryDocket(item)!.caption).toBeNull();
  });

  it("reads a CourtListener docket id only from a CourtListener link or a purely numeric provider id", () => {
    const withLink = parseRegistryDocket(
      rowItem({
        item: {
          cells: { role: "master", docket_number: "3:25-md-03140", court_id: "flnd" },
          links: [{ url: "https://www.courtlistener.com/docket/69674950/", label: "x" }],
        },
        filters: { basis: ["cl_docket_header"], native_case_id: ["flnd-3:2025-md-03140"] },
      }),
    )!;
    expect(withLink.clDocketId).toBe("69674950");
    expect(withLink.sourceUrl).toBe("https://www.courtlistener.com/docket/69674950/");
    const numeric = parseRegistryDocket(
      rowItem({ filters: { basis: [], native_case_id: ["flnd-3:2026-cv-1", "123456"] } }),
    )!;
    expect(numeric.clDocketId).toBe("123456");
  });

  it("keeps transferred as a route, calls an unstated status 'not recorded', and rejects foreign ids", () => {
    const t = parseRegistryDocket(
      rowItem({
        id: "sw-md:3140:cacd:2:2024-cv-09195",
        item: {
          cells: {
            role: "transferor",
            route: "transferred",
            status: "no_termination_date_recorded",
            filed: "Not recorded",
            docket_number: "2:24-09195",
            court_id: "cacd",
            counts_as_action: true,
          },
          links: [],
          badges: ["Transferor (originating) docket", "transferred", "Caption withheld"],
        },
        filters: { basis: ["jpml_schedule_a"], native_case_id: [], counts_as_action: "true" },
      }),
    )!;
    expect(t).toMatchObject({
      role: "transferor",
      route: "transferred",
      dateFiled: null,
      status: null,
    });
    expect(parseRegistryDocket({ id: "mdl:3140", item: {}, filters: {} })).toBeNull();
    expect(parseRegistryDocket({ id: "sw-md:3140:x", item: null, filters: {} })).toBeNull();
    expect(
      parseRegistryDocket(rowItem({ item: { cells: { role: "made-up" }, links: [] } }))!.role,
    ).toBe("unknown");
  });

  it("guards the on-demand detail lookup to the same MDL", () => {
    expect(isRegistryRowOf("sw-md:3140:flnd:3:2025-md-03140", "3140")).toBe(true);
    expect(isRegistryRowOf("sw-md:3047:cand:4:2022-md-03047", "3140")).toBe(false);
    expect(isRegistryRowOf("sw-md:3140:a b", "3140")).toBe(false);
  });
});

describe("registry facets, filters and merging", () => {
  const rows = (): CaseRow[] => [
    parseRegistryDocket(rowItem())!,
    parseRegistryDocket(
      rowItem({
        id: "sw-md:3140:cacd:2:2024-cv-09195",
        item: {
          cells: {
            role: "transferor",
            route: "transferred",
            filed: "Not recorded",
            docket_number: "2:24-09195",
            court_id: "cacd",
            counts_as_action: true,
          },
          links: [],
          badges: ["Caption withheld"],
        },
        filters: { basis: ["jpml_schedule_a"], native_case_id: [], counts_as_action: "true" },
      }),
    )!,
    parseRegistryDocket(
      rowItem({
        id: "sw-md:3140:cacd:2:2025-cv-00001",
        item: {
          cells: {
            role: "transferee",
            route: "transferred",
            docket_number: "2:25-cv-00001",
            court_id: "flnd",
            counts_as_action: false,
          },
          links: [],
        },
        filters: {
          basis: ["jpml_schedule_a", "docket_transfer_entry"],
          native_case_id: [],
          counts_as_action: "false",
        },
      }),
    )!,
  ];

  it("counts evidence per kind (a docket with two kinds counts under each) and rows that count as actions", () => {
    const f = computeFacets(rows());
    expect(f.evidence.map((o) => [o.value, o.count])).toEqual([
      ["jpml_schedule_a", 2],
      ["docket_transfer_entry", 1],
      ["docketbird_relationship", 1],
    ]);
    expect(f.role.map((o) => [o.value, o.label])).toEqual(
      expect.arrayContaining([
        ["transferor", "Transferor (originating)"],
        ["transferee", "Transferee (receiving)"],
        ["member", "Member"],
      ]),
    );
    expect(f.route.map((o) => [o.value, o.label, o.count])).toEqual([
      ["transferred", "Transferred (JPML order)", 2],
    ]);
    expect(f.actionRows).toBe(2);
  });

  it("filters by evidence kind, by role and by 'counts as an action'", () => {
    expect(filterCases(rows(), { evidence: "jpml_schedule_a" })).toHaveLength(2);
    expect(filterCases(rows(), { evidence: "docket_transfer_entry" })).toHaveLength(1);
    expect(filterCases(rows(), { role: "transferor" })).toHaveLength(1);
    expect(filterCases(rows(), { actions: "action" })).toHaveLength(2);
    expect(filterCases(rows(), { q: "flnd-3:2026-cv-03896" })).toHaveLength(1);
  });

  it("scopes the evidence facet to the other active filters", () => {
    const f = scopedFacets(rows(), { court: "cacd" });
    expect(f.evidence.map((o) => [o.value, o.count])).toEqual([["jpml_schedule_a", 1]]);
    expect(f.court.map((o) => o.value).sort()).toEqual(["cacd", "flnd"]);
  });

  it("takes labels from the dataset metadata when present", () => {
    const labels = parseRegistryLabels({
      listing: {
        filters: [
          {
            name: "basis",
            options: [{ value: "jpml_schedule_a", label: "JPML Schedule A (published)" }],
          },
          { name: "role", options: [{ value: "transferor", label: "Transferor docket" }] },
          { name: "mdl", options: [{ value: "3140", label: "MDL 3140" }] },
        ],
      },
    });
    expect(labels).toEqual({
      basis: { jpml_schedule_a: "JPML Schedule A (published)" },
      role: { transferor: "Transferor docket" },
    });
    expect(evidenceKindLabel("jpml_schedule_a", labels)).toBe("JPML Schedule A (published)");
    expect(evidenceKindLabel("native_crosswalk")).toBe("Firm dataset crosswalk");
    expect(evidenceKindLabel("some_new_kind")).toBe("some new kind");
    expect(routeLabel("pending_in_transferee_court")).toBe(
      "Already pending in the transferee court",
    );
    expect(routeLabel("odd_route")).toBe("odd route");
    expect(parseRegistryLabels(null)).toEqual({ basis: {}, role: {} });
  });

  it("merges a registry row into the legacy master row without losing either one's facts", () => {
    const legacy = masterCase({
      clDocketId: "69674950",
      docketNumber: "3:25-md-03140",
      courtId: "flnd",
      dateFiled: null,
      dateTerminated: null,
      title: "IN RE: DEPO-PROVERA",
    })!;
    const reg = parseRegistryDocket({
      id: "sw-md:3140:flnd:3:2025-md-03140",
      item: {
        cells: {
          role: "master",
          docket_number: "3:25-md-03140",
          court_id: "flnd",
          filed: "2025-02-07",
          counts_as_action: false,
        },
        links: [{ url: "https://www.courtlistener.com/docket/69674950/", label: "CL" }],
      },
      filters: {
        basis: ["jpml_master_docket_list", "cl_docket_header"],
        native_case_id: ["69674950"],
      },
    })!;
    const merged = mergeCases([legacy, reg]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      role: "master",
      caption: "IN RE: DEPO-PROVERA",
      dateFiled: "2025-02-07",
      clDocketId: "69674950",
    });
    expect(merged[0]!.registry?.basisKinds).toEqual([
      "jpml_master_docket_list",
      "cl_docket_header",
    ]);
    // Evidence filter now sees the registry kinds, not the legacy derivation.
    expect(filterCases(merged, { evidence: "cl_docket_header" })).toHaveLength(1);
    expect(filterCases(merged, { evidence: "master_docket" })).toHaveLength(0);
  });
});

describe("registry docket detail (drawer)", () => {
  const detail = {
    id: "sw-md:3140:cacd:2:2024-cv-09195",
    facts: [
      ["MDL", "3140"],
      ["Route", "transferred"],
    ],
    qualification: "One docket-in-matter.",
    provenance: { projected_at: "2026-10-03T11:44:17.992Z" },
    registry: {
      schema: "sw-matter-registry/1",
      held: [],
      conflicts: [],
      native_case_ids: [],
      linked_dockets: [{ docket_key: "flnd:3:2025-cv-00001", role: "transferee" }],
      evidence: [
        {
          kind: "jpml_schedule_a",
          label: "JPML order, Schedule A",
          asserted_role: "transferor",
          asserted_route: "transferred",
          source_url:
            "https://www.jpml.uscourts.gov/sites/jpml/files/MDL-3140-Transfer_Order-1-25.pdf",
          source_sha256: "e69c779098700f69ede68ec04982aa82f3fa43f5df7b602c4b3258cf3507a457",
          locator: { row: 1, page: 4, cto_no: null, as_printed: "2:24-09195" },
          retrieved_at: "2026-10-03T11:28:30.867Z",
          qualification: "Row of a JPML order schedule.",
          quote: null,
        },
        {
          kind: "cl_docket_header",
          source_url: "https://www.courtlistener.com/api/rest/v4/dockets/69674950/",
          source_sha256: "not-a-hash",
        },
        { label: "no kind" },
      ],
    },
  };

  it("lists each evidence assertion with a readable locator and links only pages a reader can open", () => {
    const d = parseRegistryDocketDetail(detail)!;
    expect(d.evidence).toHaveLength(2);
    expect(d.evidence[0]).toMatchObject({
      kind: "jpml_schedule_a",
      assertedRole: "transferor",
      assertedRoute: "transferred",
      linkable: true,
      locator: "row 1 · page 4 · as printed 2:24-09195",
    });
    expect(d.evidence[0]!.sourceSha256).toMatch(/^e69c/);
    expect(d.evidence[1]).toMatchObject({
      kind: "cl_docket_header",
      linkable: false,
      sourceSha256: null,
    });
    expect(d.linkedDockets).toEqual([{ docketKey: "flnd:3:2025-cv-00001", role: "transferee" }]);
    expect(d.facts[1]).toEqual(["Route", "transferred"]);
    expect(d.hasConflict).toBe(false);
    expect(isLinkableSource("https://www.courtlistener.com/api/rest/v4/dockets/1/")).toBe(false);
    expect(isLinkableSource("http://example.test/x")).toBe(false);
    expect(isLinkableSource(null)).toBe(false);
  });

  it("returns null for anything that is not a registry detail and flags conflicts", () => {
    expect(parseRegistryDocketDetail(null)).toBeNull();
    expect(parseRegistryDocketDetail({ id: "x", registry: { schema: "other/1" } })).toBeNull();
    const withConflict = {
      ...detail,
      registry: { ...detail.registry, conflicts: [{ mdl: "3094" }] },
    };
    expect(parseRegistryDocketDetail(withConflict)!.hasConflict).toBe(true);
    expect(formatLocator({ a: null, b: "" })).toBeNull();
    expect(formatLocator("x")).toBeNull();
  });
});

describe("matters the JPML directory does not hold", () => {
  const record = () => ({
    title: "IN RE: Equifax, Inc., Customer Data Security Breach Litigation",
    cells: {
      status: "terminated",
      transferee_court: "gand",
      judge_as_printed: "Thomas W. Thrash, Jr.",
    },
    facts: [
      ["MDL number", "2800"],
      ["Date centralized (earliest parsed JPML transfer order)", "2017-12-06"],
    ],
    registry: {
      ...matterRegistry(),
      mdl: "2800",
      case_ids: [
        {
          role: "master",
          docket_key: "gand:1:2017-md-02800",
          court_id: "gand",
          docket_number: "1:17-md-02800",
          basis: ["jpml_master_docket_list"],
          native_case_ids: [
            {
              id: "6254317",
              provider: "courtlistener",
              source_system: "courtlistener",
              resolution_basis: "exact_docket_key",
            },
          ],
        },
      ],
      judges: [
        {
          role: "assigned_to",
          basis: "courtlistener docket resource assigned_to",
          cl_person_id: "1234",
          source_string: "Thomas W. Thrash, Jr.",
        },
      ],
      docketbird_graph: [
        {
          retrieved_at: "2026-10-03T12:40:47Z",
          master_case_id: "gand-1:2017-md-02800",
          returned: 7,
          total_members: 20,
          truncated: true,
        },
        "not an object",
      ],
      jpml: {
        as_of: "2026-10-01",
        pending: 0,
        historical_total: 481,
        report_url: "https://www.jpml.uscourts.gov/x.pdf",
      },
    },
  });

  it("reads the record's own fields only from the closed vocabulary, and the DocketBird graph coverage", () => {
    const m = parseRegistryRecord(record(), "2800")!;
    expect(m.record).toEqual({
      caption: "IN RE: Equifax, Inc., Customer Data Security Breach Litigation",
      status: "terminated",
      transfereeCourt: "gand",
      judgeAsPrinted: "Thomas W. Thrash, Jr.",
      dateCentralized: "2017-12-06",
      entriesPublished: null,
      entriesWithheld: null,
      partiesPublished: null,
      counselLinks: null,
    });
    expect(m.docketbirdGraph).toEqual([
      {
        retrievedAt: "2026-10-03T12:40:47Z",
        masterCaseId: "gand-1:2017-md-02800",
        returned: 7,
        totalMembers: 20,
        truncated: true,
      },
    ]);
    const odd = parseRegistryRecord(
      { ...record(), cells: { status: "wat" }, facts: [["Date centralized", "someday"]] },
      "2800",
    )!;
    expect(odd.record).toMatchObject({
      status: null,
      dateCentralized: null,
      transfereeCourt: null,
      judgeAsPrinted: null,
    });
    expect(parseRegistryRecord(record(), "3140")).toBeNull();
    expect(parseRegistryRecord({ ...record(), registry: null }, "2800")).toBeNull();
  });

  it("reads how much of the timeline and the party list the projection published for the matter", () => {
    const m = parseRegistryRecord(
      {
        ...record(),
        cells: {
          status: "pending",
          entries_published: 4033,
          entries_withheld: 698,
          parties_published: 2160,
          counsel_links: 4726,
        },
      },
      "2800",
    )!;
    expect(m.record).toMatchObject({
      entriesPublished: 4033,
      entriesWithheld: 698,
      partiesPublished: 2160,
      counselLinks: 4726,
    });
    // Cells the projection has not filled yet stay unknown rather than zero.
    const early = parseRegistryRecord(
      { ...record(), cells: { status: "pending", entries_published: null } },
      "2800",
    )!;
    expect(early.record).toMatchObject({ entriesPublished: null, partiesPublished: null });
  });

  it("builds a matter page from the registry alone, with nothing the registry does not state", () => {
    const o = overviewFromRegistry(parseRegistryRecord(record(), "2800")!)!;
    expect(o).toMatchObject({
      mdl: "2800",
      title: "IN RE: Equifax, Inc., Customer Data Security Breach Litigation",
      status: "terminated",
      asOf: "2026-10-01",
      court: { clId: "gand", shortName: null },
      masterDocket: { number: "1:17-md-02800", clDocketId: "6254317" },
      dates: { filed: null, transferred: "2017-12-06", closed: null },
      actions: { total: 481, pending: 0 },
      judge: {
        printedName: "Thomas W. Thrash, Jr.",
        clPersonId: "1234",
        nativeIdEvidence: false,
        entityId: null,
      },
      cases: null,
      activity: null,
      counsel: null,
      reports: [],
    });
    expect(o.keys.all).toContain("gand-1:2017-md-02800");
  });

  it("returns nothing when the record has no caption or the machine block alone was read", () => {
    expect(overviewFromRegistry(parseRegistryMatter(matterRegistry())!)).toBeNull();
    expect(
      overviewFromRegistry(parseRegistryRecord({ ...record(), title: "  " }, "2800")!),
    ).toBeNull();
  });
});

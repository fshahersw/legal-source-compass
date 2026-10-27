import { describe, expect, it, vi } from "vitest";

const { restGet, rpcPostOptional } = vi.hoisted(() => ({
  restGet: vi.fn(),
  rpcPostOptional: vi.fn(),
}));
vi.mock("@/lib/external/rest.server", () => ({ restGet, rpcPostOptional }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (h: unknown) => h,
    inputValidator: (v: (d: unknown) => unknown) => ({
      handler: (h: (a: { data: unknown }) => unknown) => (a: { data: unknown }) =>
        h({ data: v(a.data) }),
    }),
  }),
}));

import {
  SUGGESTIBLE_FIELDS,
  acceptCandidate,
  currentAccepted,
  enforcementAnomalies,
  exactIdentifier,
  exportAccepted,
  isAfterReviewCutoff,
  mdlPublicDates,
  parseCpscRecall,
  parseDrugsFdaLabeling,
  parseEnforcement,
  parseHit,
  parseMdlProducts,
  parseNhtsaRecall,
  parsePmaLabeling,
  recordIdFor,
  suggestibleFields,
} from "./publicDates";
import { getPublicDates, searchPublicDateSources } from "./publicDates.functions";
import { createAssessmentExport } from "./deadlineAssessment";
import { assessmentExport } from "./guidedAssessment";
import type { BaselineInput, LimitationRule, LimitationsSnapshot } from "./types";

/* Rows shaped like the sampled corpus records (2026-10-27). */
const elmironOrder = {
  id: "order:USCOURTS-jpml-1_20-F-02973-0",
  source_url:
    "https://www.govinfo.gov/app/details/USCOURTS-jpml-1_20-F-02973/USCOURTS-jpml-1_20-F-02973-0",
  item: {
    id: "order:USCOURTS-jpml-1_20-F-02973-0",
    kind: "order",
    order: {
      mdl: 2973,
      pdf: "https://www.govinfo.gov/content/pkg/USCOURTS-jpml-1_20-F-02973/pdf/USCOURTS-jpml-1_20-F-02973-0.pdf",
      kind: "transfer_order",
      title: "IN RE: Elmiron (Pentosan Polysulfate Sodium) Products Liability Litigation",
      issued: "2020-12-15",
      signed_date: "2020-12-15",
    },
  },
};
const elmironMdl = {
  id: "2973",
  item: {
    title: "IN RE: Elmiron (Pentosan Polysulfate Sodium) Products Liability Litigation",
    as_of: "2026-10-01",
    date_transferred: "2020-12-15",
  },
};
const philips = {
  id: "openfda:device/enforcement:Z-1974-2021",
  source_url: "",
  item: {
    native_id: "Z-1974-2021",
    title: "SystemOne (Q-Series), DreamStation, DreamStation Go",
    dates: {
      report_date: "2021-07-21",
      termination_date: null,
      recall_initiation_date: "2021-06-14",
      center_classification_date: "2021-07-13",
    },
  },
  detail: {
    original_file: {
      final_url:
        "https://download.open.fda.gov/device/enforcement/device-enforcement-0001-of-0001.json.zip",
    },
  },
};
const elmironNda = {
  id: "openfda:drug/drugsfda:NDA020193",
  item: { title: "NDA020193 — ELMIRON", native_id: "NDA020193" },
  detail: {
    native_id: "NDA020193",
    original_file: {
      final_url: "https://download.open.fda.gov/drug/drugsfda/drug-drugsfda-0001-of-0001.json.zip",
    },
    submissions: [
      {
        submission_number: "14",
        submission_status: "AP",
        submission_class_code: "LABELING",
        submission_status_date: "2020-06-16",
      },
      {
        submission_number: "15",
        submission_status: "AP",
        submission_class_code: "MANUF (CMC)",
        submission_status_date: "2021-03-12",
      },
      {
        submission_number: "16",
        submission_status: "TA",
        submission_class_code: "LABELING",
        submission_status_date: "2021-04-01",
      },
    ],
  },
};
const cpsc = {
  id: "cpsc-api:73039",
  source_url:
    "https://www.cpsc.gov/Recalls/1973/CPSC-Warns-Of-Fire-Hazard-In-Decorative-Fireplace-Units",
  item: {
    title: "CPSC Warns Of Fire Hazard In Decorative Fireplace Units",
    cells: { date: "1973-11-10", recall_number: "73039" },
    dates: { date: "1973-11-10" },
  },
};
const nhtsa = {
  id: "10V377000",
  source_url: "https://www.nhtsa.gov/recalls?nhtsaId=10V377000",
  item: {
    title: "CORP. MICRO BIRD, INC. — EQUIPMENT",
    recall: { report_date: "2010-08-13", owner_notice: "2010-10-08", campaign: "10V377000" },
  },
};

describe("identifiers", () => {
  it("accepts only exact identifier shapes", () => {
    expect(exactIdentifier("mdl", "MDL 2973")).toBe("2973");
    expect(exactIdentifier("mdl", "Elmiron")).toBeNull();
    expect(exactIdentifier("drug_application", "nda 020193")).toBe("NDA020193");
    expect(exactIdentifier("device_pma", "P100047")).toBe("P100047");
    expect(exactIdentifier("fda_device_recall", "z-1974-2021")).toBe("Z-1974-2021");
    expect(exactIdentifier("fda_drug_recall", "Z-1974-2021")).toBeNull();
    expect(exactIdentifier("cpsc_recall", "73039")).toBe("73039");
    expect(exactIdentifier("nhtsa_recall", "10v377000")).toBe("10V377000");
    expect(recordIdFor("fda_device_recall", "Z-1974-2021")).toBe(
      "openfda:device/enforcement:Z-1974-2021",
    );
    expect(recordIdFor("cpsc_recall", "73039")).toBe("cpsc-api:73039");
  });
});

describe("MDL centralization dates", () => {
  it("returns the signed transfer-order date with the GovInfo link (MDL 2973 → 2020-12-15)", () => {
    const r = mdlPublicDates("2973", [elmironOrder], elmironMdl);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]!.date).toBe("2020-12-15");
    expect(r.candidates[0]!.officialUrl).toContain(
      "govinfo.gov/app/details/USCOURTS-jpml-1_20-F-02973",
    );
    expect(r.candidates[0]!.pdfUrl).toContain(".pdf");
    expect(r.candidates[0]!.caveat).toMatch(/not a limitations trigger/);
    expect(r.notes).toEqual([]);
  });
  it("never attaches an order for another MDL number", () => {
    expect(mdlPublicDates("2974", [elmironOrder], undefined).candidates).toEqual([]);
  });
  it("labels an issued date when no signed date is recorded", () => {
    const order = structuredClone(elmironOrder);
    (order.item.order as Record<string, unknown>)["signed_date"] = null;
    expect(mdlPublicDates("2973", [order], undefined).candidates[0]!.label).toMatch(
      /GovInfo issued date/,
    );
  });
  it("shows both dates with a mismatch flag when the two sources disagree", () => {
    const pending = structuredClone(elmironMdl);
    pending.item.date_transferred = "2020-12-16";
    const r = mdlPublicDates("2973", [elmironOrder], pending);
    expect(r.notes[0]).toMatch(/2020-12-16.*2020-12-15/);
    expect(r.candidates[0]!.anomaly).toMatch(/Differs/);
  });
  it("falls back to the JPML report with no link, and says when nothing is recorded", () => {
    const r = mdlPublicDates("2973", [], elmironMdl);
    expect(r.candidates[0]!.officialUrl).toBeNull();
    expect(r.notes[0]).toMatch(/No GovInfo transfer order/);
    expect(mdlPublicDates("9999", [], undefined).notes[0]).toMatch(/No centralization date/);
  });
  it("lists title-named products once", () => {
    expect(
      parseMdlProducts([
        {
          label: "Elmiron (pentosan polysulfate sodium)",
          kind: "drug",
          basis: "title_names_product",
        },
        {
          label: "elmiron (pentosan polysulfate sodium)",
          kind: "drug",
          basis: "title_names_product",
        },
      ]),
    ).toHaveLength(1);
  });
});

describe("recall and labeling dates", () => {
  it("returns the three FDA enforcement dates as published (Philips Z-1974-2021)", () => {
    const r = parseEnforcement("fda_device_recall", philips);
    expect(r.candidates.map((c) => [c.eventType, c.date])).toEqual([
      ["fda_recall_initiated", "2021-06-14"],
      ["fda_recall_classified", "2021-07-13"],
      ["fda_enforcement_report_posted", "2021-07-21"],
    ]);
    expect(r.candidates[0]!.urlKind).toBe("source_file");
    expect(r.candidates[0]!.anomaly).toBeNull();
  });
  it("flags date-ordering anomalies without correcting them", () => {
    expect(
      enforcementAnomalies({
        initiation: "1930-12-11",
        classification: "1930-12-01",
        report: "1930-12-01",
      }),
    ).toHaveLength(3);
    const odd = structuredClone(philips);
    odd.item.dates.center_classification_date = "2021-06-01";
    const r = parseEnforcement("fda_device_recall", odd);
    expect(r.candidates[1]!.date).toBe("2021-06-01");
    expect(r.candidates[1]!.anomaly).toMatch(/before the initiation/);
  });
  it("keeps only approved LABELING supplements and says what changed is not recorded", () => {
    const r = parseDrugsFdaLabeling(elmironNda);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]!.label).toBe(
      "S-014 approved 2020-06-16 — what changed is not recorded here",
    );
    expect(r.candidates[0]!.identifier).toBe("NDA020193 S-014");
  });
  it("keeps only PMA supplements whose reason is a labeling change, for that PMA only", () => {
    const rows = [
      {
        id: "openfda:device/pma:P100047:S215",
        item: {
          title: "HeartWare HVAD System",
          native_id: "P100047:S215",
          snippet: "Labeling Change - Indications/instructions/shelf life/tradename",
          dates: { decision_date: "2024-04-29" },
        },
      },
      {
        id: "openfda:device/pma:P100047:S216",
        item: {
          native_id: "P100047:S216",
          snippet: "Process Change - Manufacturer",
          dates: { decision_date: "2024-05-01" },
        },
      },
      {
        id: "openfda:device/pma:P1000470:S001",
        item: {
          native_id: "P1000470:S001",
          snippet: "Labeling Change - PAS",
          dates: { decision_date: "2024-05-02" },
        },
      },
    ];
    const r = parsePmaLabeling("P100047", rows);
    expect(r.candidates.map((c) => c.identifier)).toEqual(["P100047:S215"]);
  });
  it("reads CPSC 73039 and NHTSA 10V377000 with their official pages", () => {
    const c = parseCpscRecall(cpsc).candidates[0]!;
    expect([c.date, c.identifier, c.urlKind]).toEqual(["1973-11-10", "73039", "record"]);
    const n = parseNhtsaRecall(nhtsa).candidates;
    expect(n.map((x) => [x.eventType, x.date])).toEqual([
      ["nhtsa_part573_received", "2010-08-13"],
      ["nhtsa_owner_notification", "2010-10-08"],
    ]);
    expect(n[0]!.officialUrl).toBe("https://www.nhtsa.gov/recalls?nhtsaId=10V377000");
  });
  it("offers a search hit only when its identifier has the exact shape", () => {
    expect(parseHit("mdl", elmironOrder)?.identifier).toBe("2973");
    expect(
      parseHit("fda_device_recall", { item: { native_id: "Z-1974-2021", title: "x" } })?.identifier,
    ).toBe("Z-1974-2021");
    expect(parseHit("fda_device_recall", { item: { native_id: "1974", title: "x" } })).toBeNull();
    expect(
      parseHit("device_pma", { item: { native_id: "P100047:S215", title: "x" } })?.identifier,
    ).toBe("P100047");
  });
});

describe("calculator binding", () => {
  const fields = [
    { key: "accrualDate", label: "Confirmed accrual date" },
    { key: "actualDiscoveryDate", label: "Actual discovery" },
    { key: "constructiveDiscoveryDate", label: "Reasonable diligence" },
    { key: "injuryDate", label: "Injury" },
    { key: "deathDate", label: "Death" },
    { key: "firstProductDeliveryDate", label: "Delivery" },
  ];
  it("allows only SUGGESTIBLE_FIELDS, never personal or product-event fields", () => {
    expect(SUGGESTIBLE_FIELDS).toEqual([
      "constructiveDiscoveryDate",
      "accrualDate",
      "causeDiscoveryDate",
    ]);
    expect(
      suggestibleFields({ accrualBasis: "confirmed_accrual" }, fields).map((f) => f.key),
    ).toEqual(["accrualDate", "constructiveDiscoveryDate"]);
  });
  it("excludes an accrual field measured from death", () => {
    expect(suggestibleFields({ accrualBasis: "death" }, fields).map((f) => f.key)).toEqual([
      "constructiveDiscoveryDate",
    ]);
    expect(suggestibleFields(null, fields)).toEqual([]);
  });
  it("disables dates after the rule's review date", () => {
    expect(isAfterReviewCutoff("2026-10-01", "2026-09-30")).toBe(true);
    expect(isAfterReviewCutoff("2026-09-30", "2026-09-30")).toBe(false);
    expect(isAfterReviewCutoff("2026-10-01", null)).toBe(false);
  });
  it("drops provenance once the field no longer holds the accepted date", () => {
    const c = mdlPublicDates("2973", [elmironOrder], elmironMdl).candidates[0]!;
    const accepted = { accrualDate: acceptCandidate("accrualDate", c) };
    expect(currentAccepted(accepted, { accrualDate: "2020-12-15" })).toHaveLength(1);
    expect(currentAccepted(accepted, { accrualDate: "2020-12-16" })).toHaveLength(0);
    expect(
      exportAccepted(currentAccepted(accepted, { accrualDate: "2020-12-15" }))[0],
    ).toMatchObject({
      acceptedField: "accrualDate",
      dataset: "mdl_intel_hearing_orders",
      recordId: "order:USCOURTS-jpml-1_20-F-02973-0",
      identifier: "MDL 2973",
      eventType: "jpml_transfer_order",
      acceptedBy: "user",
    });
  });
});

describe("exports carry accepted provenance", () => {
  const rule = {
    id: "r",
    schemaVersion: "1.0.0",
    ruleVersion: "v1",
    jurisdiction: "IL",
    claimType: "product_liability",
    ruleKind: "limitations",
    computation: "baseline_only",
    reviewStatus: "statutory_text_verified",
    period: { amount: 2, unit: "calendar_years" },
    sourceIds: ["s"],
    pinpoint: "Synthetic § 1",
    scope: "Test only",
    accrualBasis: "confirmed_accrual",
    conditions: [],
    exclusions: [],
    warnings: [],
    effectiveFrom: null,
    effectiveThrough: null,
    validity: "Fixture",
    historicalApplicability: "Fixture",
  } as unknown as LimitationRule;
  const snapshot = {
    schemaVersion: "1.0.0",
    ruleVersion: "release1",
    snapshotDate: "2026-10-08",
    rules: [rule],
    sources: [{ id: "s", state: "IL", sha256: "a".repeat(64), url: "https://example.gov/x" }],
    cases: [],
    coverage: [{ state: "IL" }],
  } as unknown as LimitationsSnapshot;
  const input: BaselineInput = {
    jurisdiction: "IL",
    claimType: "product_liability",
    subtype: "general",
    accrualDate: "2020-12-15",
    governingLawConfirmed: false,
    accrualConfirmed: false,
    applicabilityConfirmed: false,
    exceptionReview: "unresolved",
    issues: [],
  };
  const c = mdlPublicDates("2973", [elmironOrder], elmironMdl).candidates[0]!;
  const accepted = [acceptCandidate("accrualDate", c)];
  it("deadline export lists the accepted suggestion and omits a stale one", () => {
    const out = createAssessmentExport(snapshot, input, null, "2026-10-27T00:00:00Z", {
      acceptedPublicDates: accepted,
    });
    expect(out.publicDateSuggestionsAccepted).toHaveLength(1);
    expect(out.publicDateSuggestionsAccepted[0]!.date).toBe("2020-12-15");
    const stale = createAssessmentExport(
      snapshot,
      { ...input, accrualDate: "2021-01-01" },
      null,
      "2026-10-27T00:00:00Z",
      { acceptedPublicDates: accepted },
    );
    expect(stale.publicDateSuggestionsAccepted).toEqual([]);
    expect(
      createAssessmentExport(snapshot, input, null, "x").publicDateSuggestionsAccepted,
    ).toEqual([]);
  });
  it("guided export lists the accepted suggestion", () => {
    const result = { status: "needs_review" as const, date: null, rule, reasons: [], steps: [] };
    const review = { answers: {}, contextKey: "", recordedQualificationsReviewed: false };
    const out = assessmentExport(snapshot, input, review, result, accepted);
    expect(out.publicDateSuggestionsAccepted[0]).toMatchObject({
      acceptedField: "accrualDate",
      identifier: "MDL 2973",
    });
  });
});

describe("server reads", () => {
  it("looks an MDL up by exact number and never by name", async () => {
    restGet.mockReset();
    rpcPostOptional.mockReset();
    restGet.mockImplementation(async (path: string) => ({
      rows: path.includes("dataset=eq.mdl_intel_hearing_orders") ? [elmironOrder] : [elmironMdl],
      total: null,
    }));
    rpcPostOptional.mockResolvedValue([
      {
        label: "Elmiron (pentosan polysulfate sodium)",
        kind: "drug",
        basis: "title_names_product",
      },
    ]);
    const r = await (
      getPublicDates as unknown as (a: {
        data: unknown;
      }) => Promise<{ candidates: { date: string }[]; products: unknown[] }>
    )({
      data: { kind: "mdl", id: "2973" },
    });
    expect(r.candidates[0]!.date).toBe("2020-12-15");
    expect(r.products).toHaveLength(1);
    const paths = restGet.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.includes("item->order->>mdl=eq.2973"))).toBe(true);
    expect(paths.every((p) => p.includes("dataset=eq."))).toBe(true);
  });
  it("rejects a non-identifier for a dated lookup", () => {
    expect(() =>
      (getPublicDates as unknown as (a: { data: unknown }) => unknown)({
        data: { kind: "mdl", id: "Elmiron" },
      }),
    ).toThrow();
  });
  it("runs a limited full-text search for words and returns pickable hits only", async () => {
    restGet.mockReset();
    restGet.mockResolvedValue({ rows: [philips], total: null });
    const r = await (
      searchPublicDateSources as unknown as (a: {
        data: unknown;
      }) => Promise<{ mode: string; hits: { identifier: string }[] }>
    )({
      data: { kind: "fda_device_recall", q: "DreamStation" },
    });
    expect(r.mode).toBe("words");
    expect(r.hits.map((h) => h.identifier)).toEqual(["Z-1974-2021"]);
    const path = String(restGet.mock.calls[0]![0]);
    expect(path).toContain("dataset=eq.agency_safety_openfda_device_enforcement");
    expect(path).toContain("limit=20");
  });
});

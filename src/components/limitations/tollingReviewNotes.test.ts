import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }) => {
    let href = to;
    for (const [k, v] of Object.entries(params ?? {})) href = href.replace(`$${k}`, v);
    const q = new URLSearchParams(search ?? {}).toString();
    return createElement("a", { href: q ? `${href}?${q}` : href }, children);
  },
}));
vi.mock("@/lib/documents/documents.functions", () => ({ searchDocuments: vi.fn() }));
vi.mock("@/lib/limitations/publicDates.functions", () => ({
  searchPublicDateSources: vi.fn(),
  getPublicDates: vi.fn(),
}));

import type { LimitationRule, LimitationsSnapshot } from "@/lib/limitations/types";
import { TollingReviewNotes } from "./TollingReviewNotes";
import { CLASS_TOLLING_CASES, tollingNotesFor } from "./tollingNotes";
import { DateSources, PublicDatePicker } from "./PublicDatePicker";
import { pickerApplies } from "@/lib/limitations/publicDates";

const rule = {
  id: "il-pi",
  jurisdiction: "IL",
  claimType: "personal_injury",
  accrualBasis: "confirmed_accrual",
  sourceIds: ["s"],
  conditions: [],
  exclusions: [],
  warnings: [],
  provenance: {
    entryStatus: "verified",
    flags: [],
    repose: [],
    tolling: [
      {
        text: "Minor or person under a legal disability may sue within 2 years after the disability is removed.",
        citation: "735 ILCS 5/13-211(a)",
      },
      {
        text: "Fraudulent concealment: action within 5 years after the person discovers the cause of action.",
        citation: "735 ILCS 5/13-215",
      },
    ],
  },
  crossReferenceLinks: [
    {
      kind: "tolling",
      index: 0,
      citation: "735 ILCS 5/13-211(a)",
      checkedAt: "2026-10-08T00:00:00Z",
      sectionsNamed: 1,
      sections: [{ nativeId: "IL:735 ILCS 5/13-211", textSha256: "a".repeat(64) }],
      termCheck: "all_present",
      terms: [{ term: "2 year", found: true }],
      intakeRunId: null,
    },
    {
      // A link whose citation no longer matches its note is never inherited.
      kind: "tolling",
      index: 1,
      citation: "735 ILCS 5/13-999",
      checkedAt: "2026-10-08T00:00:00Z",
      sectionsNamed: 1,
      sections: [{ nativeId: "IL:735 ILCS 5/13-999", textSha256: "b".repeat(64) }],
      termCheck: "all_present",
      terms: [],
      intakeRunId: null,
    },
  ],
} as unknown as LimitationRule;
const snapshot = {
  rules: [rule],
  sources: [],
  coverage: [],
  cases: [],
} as unknown as LimitationsSnapshot;

describe("tolling review notes", () => {
  it("routes the rule's own notes by category and links the cited section exactly", () => {
    const incapacity = tollingNotesFor(snapshot, rule, "incapacity");
    expect(incapacity.map((n) => n.note.citation)).toEqual(["735 ILCS 5/13-211(a)"]);
    expect(incapacity[0]!.link?.sectionIds).toEqual(["IL:735 ILCS 5/13-211"]);
    const concealment = tollingNotesFor(snapshot, rule, "concealment");
    expect(concealment.map((n) => n.note.citation)).toEqual(["735 ILCS 5/13-215"]);
    expect(concealment[0]!.link).toBeNull();
  });
  it("renders notes only, labelled not applied, with a code-reader link", () => {
    const html = renderToStaticMarkup(
      createElement(TollingReviewNotes, { snapshot, rule, category: "incapacity" }),
    );
    expect(html).toContain("not applied by the calculator");
    expect(html).toContain("/law/codes/IL?section=IL%3A735+ILCS+5%2F13-211");
    expect(html).not.toMatch(/deadline|extended to/i);
  });
  it("gives class actions one neutral sentence and the four case links, computing nothing", () => {
    const html = renderToStaticMarkup(
      createElement(TollingReviewNotes, { snapshot, rule, category: "class_action" }),
    );
    expect(html).toContain("nothing is computed");
    for (const c of CLASS_TOLLING_CASES) expect(html).toContain(`/cases/${c.cluster}`);
    expect(html).toContain("This rule records no tolling note on this topic");
  });
});

describe("public date picker", () => {
  const fields = [
    { key: "accrualDate", label: "Confirmed accrual date" },
    { key: "injuryDate", label: "Date of the injury" },
  ];
  it("is offered for injury, product and warranty claims only", () => {
    expect(pickerApplies("product_liability")).toBe(true);
    expect(pickerApplies("wrongful_death")).toBe(true);
    expect(pickerApplies(undefined)).toBe(false);
    expect(pickerApplies("contract" as never)).toBe(false);
  });
  it("starts collapsed and reads nothing until opened", () => {
    const html = renderToStaticMarkup(
      createElement(PublicDatePicker, {
        rule,
        dateFields: fields,
        cutoff: "2026-09-30",
        values: {},
        accepted: {},
        onAccept: () => {},
      }),
    );
    expect(html).toContain("Look up a product or event");
    expect(html).toContain("never applied");
  });
  it("renders nothing when the rule has no suggestible field", () => {
    const html = renderToStaticMarkup(
      createElement(PublicDatePicker, {
        rule,
        dateFields: [{ key: "injuryDate", label: "Date of the injury" }],
        cutoff: null,
        values: {},
        accepted: {},
        onAccept: () => {},
      }),
    );
    expect(html).toBe("");
  });
  it("lists each accepted date's source in the result", () => {
    const html = renderToStaticMarkup(
      createElement(DateSources, {
        labels: { accrualDate: "Confirmed accrual date" },
        list: [
          {
            field: "accrualDate",
            date: "2020-12-15",
            eventType: "jpml_transfer_order",
            event: "JPML transfer order",
            identifier: "MDL 2973",
            sourceDataset: "mdl_intel_hearing_orders",
            recordId: "order:USCOURTS-jpml-1_20-F-02973-0",
            publisher: "Judicial Panel on Multidistrict Litigation (GovInfo)",
            officialUrl:
              "https://www.govinfo.gov/app/details/USCOURTS-jpml-1_20-F-02973/USCOURTS-jpml-1_20-F-02973-0",
            urlKind: "record",
            acceptedBy: "user",
          },
        ],
      }),
    );
    expect(html).toContain("Date sources");
    expect(html).toContain("MDL 2973");
    expect(html).toContain("Accepted by user");
    expect(html).toContain("govinfo.gov");
  });
});

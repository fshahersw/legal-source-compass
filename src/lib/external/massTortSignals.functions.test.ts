import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { mergeTermCase, toSignals } from "./massTortSignals.functions";

// Shape of the published MDL 3026 record (agency_safety_mass_tort_signals, CAERS via openFDA).
const TERMS_3026 = [
  { term: "Diarrhoea", count: 292 },
  { term: "Vomiting", count: 270 },
  { term: "DIARRHOEA", count: 247 },
  { term: "VOMITING", count: 222 },
  { term: "Pyrexia", count: 187 },
  { term: "Salmonellosis", count: 117 },
  { term: "Crying", count: 82 },
  { term: "Lethargy", count: 61 },
  { term: "IRRITABILITY", count: 59 },
  { term: "Malaise", count: 58 },
  { term: "Decreased appetite", count: 57 },
  { term: "Haematochezia", count: 57 },
];

describe("mergeTermCase", () => {
  it("sums case variants, labels with the most reported spelling and re-sorts", () => {
    const out = mergeTermCase(TERMS_3026);
    expect(out.slice(0, 3)).toEqual([
      { term: "Diarrhoea", count: 539, variants: ["Diarrhoea", "DIARRHOEA"] },
      { term: "Vomiting", count: 492, variants: ["Vomiting", "VOMITING"] },
      { term: "Pyrexia", count: 187, variants: ["Pyrexia"] },
    ]);
    expect(out).toHaveLength(10);
    expect(new Set(out.map((t) => t.term.toLowerCase())).size).toBe(out.length);
    expect(out.reduce((s, t) => s + t.count, 0)).toBe(TERMS_3026.reduce((s, t) => s + t.count, 0));
  });

  it("breaks label ties by first seen and count ties by first seen", () => {
    const out = mergeTermCase([
      { term: "RASH", count: 5 },
      { term: "Fatigue", count: 10 },
      { term: "Rash", count: 5 },
      { term: "Nausea", count: 10 },
    ]);
    // RASH/Rash tie at 5 each: the first spelling seen labels the term; the term was first seen before Fatigue.
    expect(out.map((t) => [t.term, t.count])).toEqual([
      ["RASH", 10],
      ["Fatigue", 10],
      ["Nausea", 10],
    ]);
  });

  it("keeps the stored variants of already-merged terms (the builder's output) without changing counts", () => {
    const once = mergeTermCase(TERMS_3026);
    expect(mergeTermCase(once)).toEqual(once);
    expect(once.reduce((s, t) => s + t.variants.length, 0)).toBe(TERMS_3026.length);
    // a stored variant that does not fold to the term is ignored; a later raw spelling still adds its count
    expect(
      mergeTermCase([
        { term: "Diarrhoea", count: 539, variants: ["Diarrhoea", "DIARRHOEA", "Vomiting", 7] },
        { term: "diarrhoea", count: 3 },
      ]),
    ).toEqual([
      { term: "Diarrhoea", count: 542, variants: ["Diarrhoea", "DIARRHOEA", "diarrhoea"] },
    ]);
    // folding matches the builder's str.lower(): "ß" is not folded to "ss"
    expect(
      mergeTermCase([
        { term: "Straße", count: 1 },
        { term: "STRASSE", count: 1 },
      ]),
    ).toHaveLength(2);
  });

  it("drops malformed entries and leaves distinct terms alone", () => {
    expect(
      mergeTermCase([
        { term: "  Pain ", count: 3 },
        { term: "", count: 9 },
        { term: "Pain", count: -1 },
        { term: "Headache", count: "4" },
        null,
        "Pain",
        { term: "Pain upper", count: 2 },
      ]),
    ).toEqual([
      { term: "Pain", count: 3, variants: ["Pain"] },
      { term: "Pain upper", count: 2, variants: ["Pain upper"] },
    ]);
    expect(mergeTermCase(undefined)).toEqual([]);
    expect(mergeTermCase({ term: "x", count: 1 })).toEqual([]);
  });
});

describe("toSignals", () => {
  it("reads stored top terms through the case merge", () => {
    const [s] = toSignals({
      signal: { product: "Preterm infant formula", product_kind: "food", top_terms: TERMS_3026 },
      litigation: {
        mdl: 3026,
        title: "In re: Abbott Laboratories, et al., Preterm Infant Nutrition",
      },
    });
    expect(s!.topTerms[0]).toEqual({
      term: "Diarrhoea",
      count: 539,
      variants: ["Diarrhoea", "DIARRHOEA"],
    });
    expect(toSignals({ signal: {}, litigation: { mdl: "3026" } })).toEqual([]);
  });
});

describe("toSignals for MDLs centralized after the last JPML pending report", () => {
  it("keeps pending actions absent (never 0) and carries the transfer order", () => {
    const [s] = toSignals({
      signal: {
        product: "Abbott spinal cord stimulators",
        product_kind: "device",
        event_total: 1288,
      },
      litigation: {
        mdl: 3194,
        title: "IN RE: ABBOTT LABORATORIES SPINAL CORD STIMULATOR PRODUCTS LIABILITY LITIGATION",
        pending: null,
        total: null,
        jpml_evidence: {
          record_id: "matter:2026-09-24:3194:A",
          order_url:
            "https://www.jpml.uscourts.gov/sites/jpml/files/MDL-3194-Transfer_Order-9-26.pdf",
          order_date: "2026-10-02",
        },
      },
    });
    expect(s?.pending).toBeNull();
    expect(s?.total).toBeNull();
    expect(s?.jpmlEvidence?.orderDate).toBe("2026-10-02");
  });
  it("leaves out a product no FDA or NHTSA source reports on", () => {
    expect(
      toSignals({
        signal: { product: "Apple AirTag", product_kind: "consumer" },
        litigation: { mdl: 3199 },
      }),
    ).toEqual([]);
  });
});

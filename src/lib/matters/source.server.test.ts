import { describe, expect, it } from "vitest";
import { parseLegacyDocument } from "./source.server";

const item = (links: unknown) => ({
  id: "doc:65407433:1754:1754:14594",
  cells: {
    mdl: "3047",
    doc_type: "Pretrial order",
    description: "SUPPLEMENTAL ORDER",
    entry_date_filed: "2025-03-10",
  },
  links,
});
const recap =
  "https://storage.courtlistener.com/recap/gov.uscourts.cand.401490/gov.uscourts.cand.401490.1754.0.pdf";
const links = [
  { url: recap, label: "Document on CourtListener/RECAP (external)" },
  { url: "https://www.courtlistener.com/docket/65407433/1754/x/", label: "Docket entry" },
  { url: "#mdl/3047", label: "MDL page" },
];
const facts = (sealed: string, free: string) => [
  ["Sealed", sealed],
  ["Free document recorded (RECAP, as captured; not re-checked over the network)", free],
  ["Page count", "2"],
];

describe("saved-sample document links", () => {
  it("links only an explicitly unsealed, free document with a RECAP file URL", () => {
    const d = parseLegacyDocument(item(links), facts("no", "yes"))!;
    expect(d).toMatchObject({
      entryNumber: 1754,
      date: "2025-03-10",
      docType: "Pretrial order",
      pageCount: 2,
      recapUrl: recap,
      held: false,
      docketEntryUrl: "https://www.courtlistener.com/docket/65407433/1754/x/",
    });
  });

  it.each([
    ["yes", "yes"],
    ["", "yes"],
    ["unknown", "yes"],
    ["no", "no"],
    ["no", ""],
  ])("holds the document when sealed=%j and free=%j", (sealed, free) => {
    const d = parseLegacyDocument(item(links), facts(sealed, free))!;
    expect(d.recapUrl).toBeNull();
    expect(d.held).toBe(true);
  });

  it("holds the document when the only file link is not a RECAP PDF", () => {
    const d = parseLegacyDocument(
      item([{ url: "https://evil.example/a.pdf", label: "x" }]),
      facts("no", "yes"),
    )!;
    expect(d.held).toBe(true);
    expect(d.recapUrl).toBeNull();
    expect(
      parseLegacyDocument(
        item([{ url: "http://storage.courtlistener.com/recap/a.pdf", label: "x" }]),
        facts("no", "yes"),
      )!.held,
    ).toBe(true);
  });

  it("drops rows without an id", () => {
    expect(parseLegacyDocument({ cells: {} }, [])).toBeNull();
    expect(parseLegacyDocument(null, [])).toBeNull();
  });
});

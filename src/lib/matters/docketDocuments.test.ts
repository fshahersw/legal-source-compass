import { describe, expect, it } from "vitest";
import {
  casesFromMetadata,
  caseBelongsToMdl,
  entriesExact,
  exactSum,
  formatExactCount,
  parseDocketDocument,
  unlistedTotal,
} from "./docketDocuments";

const sha = "a".repeat(64);
const row = (cells: Record<string, unknown>) => ({
  cells: {
    native_document_id: "paed-2:2024-md-03094-00698-029",
    native_case_id: "paed-2:2024-md-03094",
    docket_key: "paed:2:2024-md-03094",
    mdl: "3094",
    entry_number: 698,
    date_filed: "2026-05-19",
    description: "Exhibit 179D",
    file_name: "paed-2:2024-md-03094-00698-029.pdf",
    availability: "stored",
    stored: true,
    sha256: sha,
    bytes: 12_939_975,
    label: null,
    ...cells,
  },
});

describe("docket documents", () => {
  it("links a stored document only through the authorised PDF route", () => {
    const d = parseDocketDocument(row({}))!;
    expect(d.availability).toBe("stored");
    expect(d.pdfUrl).toBe("/api/matter-pdf?source=docketbird&doc=paed-2%3A2024-md-03094-00698-029");
    expect(d.label).toBeNull();
    expect(d.entryNumber).toBe(698);
  });
  it("gives no link when the provider has not downloaded the file", () => {
    const d = parseDocketDocument(
      row({
        availability: "provider_not_downloaded",
        stored: false,
        sha256: null,
        bytes: null,
        file_name: null,
      }),
    )!;
    expect(d.availability).toBe("provider_not_downloaded");
    expect(d.pdfUrl).toBeNull();
  });
  it("never lists a restricted or sealed document", () => {
    expect(parseDocketDocument(row({ restricted: true }))).toBeNull();
    expect(
      parseDocketDocument(row({ description_withheld: "sealed_or_restricted_text" })),
    ).toBeNull();
    expect(parseDocketDocument(row({ description_withheld: "sealed_document" }))).toBeNull();
  });
  it("keeps a contact-withheld description off the row and still links a stored PDF", () => {
    const d = parseDocketDocument(
      row({ description: "call 215-779-6437", description_withheld: "contact_or_access_data" }),
      [["Parties of the matter in the registry", "83"]],
    )!;
    expect(d.description).toBeNull();
    expect(d.descriptionWithheld).toBe(true);
    expect(d.fileName).toBe("paed-2:2024-md-03094-00698-029.pdf");
    expect(d.parties).toBe("83");
    expect(d.pdfUrl).toBe("/api/matter-pdf?source=docketbird&doc=paed-2%3A2024-md-03094-00698-029");
  });
  it("leaves parties Not recorded when the registry fact is absent", () => {
    expect(parseDocketDocument(row({}))!.parties).toBeNull();
  });
  it("does not add a partial count", () => {
    expect(exactSum([2, null])).toEqual({ value: null, gap: "too-large" });
    expect(exactSum([2, 3])).toEqual({ value: 5, gap: "exact" });
    expect(entriesExact([{ docketKey: null, count: 4 }])).toEqual({
      value: null,
      gap: "not-recorded",
    });
    expect(entriesExact([{ docketKey: "paed:2:2024-md-03094", count: null }])).toEqual({
      value: null,
      gap: "too-large",
    });
    expect(unlistedTotal([{ rows: 4, entries: null, unnumbered: 1 }])).toBeNull();
    expect(unlistedTotal([{ rows: 4, entries: 0, unnumbered: null }])).toBe(4);
    expect(formatExactCount({ value: 12, gap: "exact" })).toBe("12");
    expect(formatExactCount({ value: null, gap: "too-large" })).toBe("too large to count");
    expect(formatExactCount({ value: null, gap: "not-recorded" })).toBe("Not recorded");
    expect(formatExactCount(null)).toBe("Not recorded");
  });
  it("rejects a row without a native document id and a stored row without a valid hash link", () => {
    expect(parseDocketDocument({ cells: {} })).toBeNull();
    expect(parseDocketDocument(row({ sha256: "not-a-hash" }))!.pdfUrl).toBeNull();
  });
  it("ties a case to an MDL by its own label or the MDL number in its exact id", () => {
    expect(caseBelongsToMdl({ caseId: "ilnd-1:2024-cv-06795", mdl: "3121" }, "3121")).toBe(true);
    expect(caseBelongsToMdl({ caseId: "paed-2:2001-md-03094", mdl: null }, "3094")).toBe(true);
    expect(caseBelongsToMdl({ caseId: "jpml-0:2024-md-03113", mdl: null }, "3094")).toBe(false);
    expect(caseBelongsToMdl({ caseId: "paed-2:2024-md-030941", mdl: null }, "3094")).toBe(false);
  });
  it("ties the unlabeled streamlined and JPML dockets to their MDL by the number in the exact case id", () => {
    const streamlined = { caseId: "paed-2:2001-md-03094", mdl: null };
    const jpml = { caseId: "jpml-0:2024-md-03113", mdl: null };
    expect(caseBelongsToMdl(streamlined, "3094")).toBe(true);
    expect(caseBelongsToMdl(jpml, "3113")).toBe(true);
    expect(caseBelongsToMdl(jpml, "3094")).toBe(false);
  });
  it("reads the cases from the dataset's own metadata, with the case filter as a fallback", () => {
    expect(
      casesFromMetadata(
        { by_case: { "a-1:2024-md-00001": { rows: 5, sheet_documents: 6, withheld_no_row: 1 } } },
        [],
      ),
    ).toEqual([{ caseId: "a-1:2024-md-00001", rows: 5, sheetDocuments: 6, withheld: 1 }]);
    expect(
      casesFromMetadata({}, [
        { name: "case_id", options: [{ value: "b-2:2025-md-00002", count: 7 }, { value: "" }] },
        { name: "mdl", options: [{ value: "9", count: 1 }] },
      ]),
    ).toEqual([{ caseId: "b-2:2025-md-00002", rows: 7, sheetDocuments: null, withheld: null }]);
    expect(casesFromMetadata(null, null)).toEqual([]);
  });
});

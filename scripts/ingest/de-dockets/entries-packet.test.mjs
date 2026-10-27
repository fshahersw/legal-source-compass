import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCapture, splitDocumentId, stripSignedQuery } from "./docketbird-capture.mjs";
import {
  sheetEntries,
  selectNew,
  gapAfterPublished,
  withholdingFor,
  docketbirdEntryRecord,
  entryAvailability,
  tally,
} from "./entries-packet.mjs";

const CASE = "njd-3:2026-md-03180";
const doc = (suffix, title, extra = {}) => ({
  id: `${CASE}-${suffix}`,
  title,
  filing_date: "2026-10-02",
  restricted: false,
  primary_docket_sheet_number: /^\d{5}$/.test(suffix) ? Number(suffix) : null,
  downloaded: 1,
  pdf_url: `https://docketbird-case-documents.s3.amazonaws.com/x.pdf?AWSAccessKeyId=AKIAEXAMPLE&Signature=abc&Expires=1`,
  canonical_url: `https://www.docketbird.com/court_documents?id=${CASE}-${suffix}&user_id=123`,
  ...extra,
});
const capture = (docs, extra = {}) =>
  JSON.stringify({
    remaining_today: 990,
    entries_total: 54,
    entries_returned: docs.length,
    documents: docs,
    docket_sheet_url: `https://www.docketbird.com/cases?case_id=${CASE}`,
    ...extra,
  });
const ctx = {
  mdl: "3180",
  docket_key: "njd:3:2026-md-03180",
  docket_number: "3:26-md-3180",
  court_id: "njd",
  docketbird_case_id: CASE,
};

test("document ids split into case, entry, attachment and text-entry parts", () => {
  assert.deepEqual(splitDocumentId(`${CASE}-00040`), {
    case_id: CASE,
    entry_number: 40,
    attachment_number: null,
    text_entry: null,
  });
  assert.deepEqual(splitDocumentId(`${CASE}-00038-001`), {
    case_id: CASE,
    entry_number: 38,
    attachment_number: 1,
    text_entry: null,
  });
  assert.deepEqual(splitDocumentId(`${CASE}-00036-t002`), {
    case_id: CASE,
    entry_number: 36,
    attachment_number: null,
    text_entry: 2,
  });
  assert.equal(splitDocumentId("not-an-id"), null);
});

test("signed query strings and the account user id never survive normalization", () => {
  assert.equal(
    stripSignedQuery("https://b.s3.amazonaws.com/a.pdf?AWSAccessKeyId=K&Signature=S&Expires=1"),
    "https://b.s3.amazonaws.com/a.pdf",
  );
  assert.equal(
    stripSignedQuery("https://www.docketbird.com/court_documents?id=x&user_id=123"),
    "https://www.docketbird.com/court_documents?id=x",
  );
  const cap = normalizeCapture(capture([doc("00040", "ORDER"), doc("00039", "NOTICE")]), {
    retrievedAt: "2026-10-27T00:00:00Z",
  });
  const body = JSON.stringify(cap);
  assert.ok(!/Signature=|AWSAccessKeyId|user_id=/.test(body));
  assert.equal(cap.case_id, CASE);
  assert.equal(cap.source_sha256.length, 64);
});

test("the sort order is read from the dates, and mixed cases are refused", () => {
  const asc = normalizeCapture(
    capture([
      doc("00001", "a", { filing_date: "2026-06-04" }),
      doc("00002", "b", { filing_date: "2026-06-11" }),
    ]),
  );
  assert.equal(asc.sort, "chronological");
  const desc = normalizeCapture(
    capture([
      doc("00002", "b", { filing_date: "2026-06-11" }),
      doc("00001", "a", { filing_date: "2026-06-04" }),
    ]),
  );
  assert.equal(desc.sort, "recent");
  assert.throws(
    () =>
      normalizeCapture(
        capture([doc("00001", "a"), { ...doc("00002", "b"), id: "njd-2:2019-md-02921-00002" }]),
      ),
    /CAPTURE_MIXED_CASES/,
  );
});

test("entries: attachments fold into their entry, attachment-level text entries are dropped, numbers come from the id", () => {
  const cap = normalizeCapture(
    capture([
      doc("00038", "Proposed Order"),
      doc("00038-001", "Text of Proposed Order"),
      doc("00036-t001", "Minute Entry", { downloaded: 0 }),
      doc("00023-001-t001", "Set Deadlines", { downloaded: 0 }),
    ]),
  );
  const { entries, stats } = sheetEntries([cap]);
  assert.equal(entries.length, 2);
  const e38 = entries.find((e) => e.entry_number === 38);
  assert.equal(e38.attachments.length, 1);
  const text = entries.find((e) => e.kind === "text");
  assert.equal(text.entry_number, null);
  assert.equal(text.anchor, 36);
  assert.equal(stats.attachment_text_skipped, 1);
});

test("only entries above the highest published number are new; a gap before the newest window is reported", () => {
  const cap = normalizeCapture(
    capture([
      doc("00040", "ORDER", { filing_date: "2026-10-22" }),
      doc("00038", "NOTICE", { filing_date: "2026-10-06" }),
      doc("00037", "CTO-5", { filing_date: "2026-10-02" }),
      doc("00036-t001", "Minute", { downloaded: 0, filing_date: "2026-10-01" }),
    ]),
  );
  assert.equal(cap.sort, "recent");
  const { entries, windows } = sheetEntries([cap]);
  assert.deepEqual(
    selectNew(entries, 37)
      .map((e) => e.entry_number)
      .sort(),
    [38, 40],
  );
  assert.equal(selectNew(entries, null).length, 4);
  assert.deepEqual(gapAfterPublished(windows, 20), { from: 21, to: 36 });
  assert.equal(gapAfterPublished(windows, 37), null);
});

test("withholding: provider restriction first, then the exclusion pattern (default only), then contact fields", () => {
  assert.equal(withholdingFor({ title: "ORDER", restricted: true }), "sealed_document");
  assert.equal(withholdingFor({ title: "ORDER", restricted: null }), "sealed_document");
  assert.equal(
    withholdingFor({ title: "MOTION to Seal exhibits", restricted: false }),
    "sealed_or_restricted_text",
  );
  assert.equal(
    withholdingFor(
      { title: "MOTION to Seal exhibits", restricted: false },
      { releaseTextMentions: true },
    ),
    null,
  );
  assert.equal(
    withholdingFor(
      { title: "Hearing. Dial 215-555-0100", restricted: false },
      { releaseTextMentions: true },
    ),
    "contact_or_access_data",
  );
  assert.equal(withholdingFor({ title: "ORDER granting motion", restricted: false }), null);
});

test("a DocketBird row has the sw_docket_entries_v1 shape and keeps no signed link", () => {
  const cap = normalizeCapture(
    capture([
      doc("00040", "ORDER granting 28 Unopposed Motion to Appoint Plaintiffs’ Co-Lead Counsel.", {
        filing_date: "2026-10-22",
      }),
      doc("00040-001", "Exhibit"),
    ]),
    { retrievedAt: "2026-10-27T14:48:03Z" },
  );
  const [entry] = sheetEntries([cap]).entries;
  const { rec, withheld } = docketbirdEntryRecord(entry, ctx, { run: "r" });
  assert.equal(withheld, null);
  assert.equal(rec.id, `sw-entry:docketbird:${CASE}-00040`);
  assert.equal(rec.item.cells.entry_number, 40);
  assert.equal(rec.item.cells.documents, 2);
  assert.equal(rec.item.cells.availability, "provider_pdf");
  assert.equal(rec.filters.mdl, "3180");
  assert.equal(rec.filters.year, "2026");
  assert.equal(rec.filters.description_withheld, "false");
  assert.equal(rec.ordinal, 3180 * 1e12 + Math.floor(Date.UTC(2026, 9, 22) / 86400000) * 1e6 + 400);
  assert.equal(rec.detail.provenance.projection_row_sha256.length, 64);
  assert.ok(!/Signature=|user_id=/.test(JSON.stringify(rec)));
  assert.equal(rec.source_url, `https://www.docketbird.com/court_documents?id=${CASE}-00040`);
});

test("a withheld DocketBird row shows no text, links the sheet, and is tallied", () => {
  const cap = normalizeCapture(
    capture([
      doc("00041", "SEALED MOTION", { restricted: true }),
      doc("00042", "Motion to file under seal"),
    ]),
  );
  const recs = sheetEntries([cap]).entries.map(
    (e) => docketbirdEntryRecord(e, ctx, { run: "r" }).rec,
  );
  for (const r of recs) {
    assert.equal(r.item.cells.description, null);
    assert.equal(r.item.cells.held, true);
    assert.ok(!r.text.includes("seal") && !r.text.includes("SEALED"));
  }
  const sealed = recs.find((r) => r.item.cells.entry_number === 41);
  assert.equal(sealed.item.cells.description_withheld, "sealed_document");
  assert.equal(sealed.source_url, `https://www.docketbird.com/cases?case_id=${CASE}`);
  const t = tally(recs);
  assert.equal(t.rows, 2);
  assert.equal(t.withheld, 2);
  assert.equal(t.sealed_document, 1);
  assert.equal(t.sealed_or_restricted_text, 1);
});

const recordFor = (docs, number) => {
  const cap = normalizeCapture(capture(docs));
  const e = sheetEntries([cap]).entries.find((x) => x.entry_number === number);
  return docketbirdEntryRecord(e, ctx, { run: "r" }).rec;
};

test("availability: a text-held entry whose PDF is open keeps its document counts", () => {
  const r = recordFor([doc("00050", "MOTION to file under seal")], 50);
  const c = r.item.cells;
  assert.equal(c.description_withheld, "sealed_or_restricted_text");
  assert.equal(c.description, null);
  assert.equal(c.documents, 1);
  assert.equal(c.documents_available, 1);
  assert.equal(c.documents_sealed, 0);
  assert.equal(c.availability, "provider_pdf");
  assert.deepEqual(c.document_ids, []);
  assert.equal(r.source_url, `https://www.docketbird.com/cases?case_id=${CASE}`);
  assert.ok(
    r.detail.facts.some(([k, v]) => k === "Documents" && v === "1 (1 held by the provider as PDF)"),
  );
});

test("availability: a restricted attachment marks the entry includes_sealed, a restricted entry document zeroes the available count", () => {
  const partly = recordFor(
    [doc("00051", "ORDER"), doc("00051-001", "Exhibit A", { restricted: true })],
    51,
  ).item.cells;
  assert.equal(partly.description_withheld, null);
  assert.equal(partly.availability, "includes_sealed");
  assert.equal(partly.documents, 2);
  assert.equal(partly.documents_sealed, 1);
  assert.equal(partly.documents_available, 1);
  const sealed = recordFor(
    [doc("00052", "ORDER", { restricted: true }), doc("00052-001", "Exhibit")],
    52,
  ).item.cells;
  assert.equal(sealed.description_withheld, "sealed_document");
  assert.equal(sealed.availability, "includes_sealed");
  assert.equal(sealed.documents_available, 0);
});

test("availability: documents listed but not held as PDF are never 'no_documents'", () => {
  const r = recordFor([doc("00053", "NOTICE of appearance", { downloaded: 0 })], 53);
  assert.equal(r.item.cells.documents, 1);
  assert.equal(r.item.cells.availability, "provider_not_downloaded");
  assert.equal(r.filters.has_documents, "true");
  assert.equal(entryAvailability(0, 0, 0), "no_documents");
  assert.equal(entryAvailability(2, 0, 0), "provider_not_downloaded");
  assert.equal(entryAvailability(2, 1, 1), "includes_sealed");
  assert.equal(entryAvailability(2, 0, 1), "provider_pdf");
});

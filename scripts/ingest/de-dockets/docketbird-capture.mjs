// DocketBird connector captures (get_docket_sheet) for the master-docket refresh (workstream de-dockets).
// A capture is the connector's JSON answer saved verbatim by the session harness. It carries signed S3 PDF links (access key id, signature,
// expiry): those query strings are removed before anything is written to the acquisition directory, and the sha256 of the original bytes is
// kept as evidence. The case identity and the sort order are read from the capture itself, never from a file name.
import { createHash } from "node:crypto";

export const sha256 = (x) => createHash("sha256").update(x).digest("hex");

/** Parses a capture; accepts the bare JSON object or an MCP content array [{type:'text', text:'{...}'}]. */
export function parseConnectorCapture(text) {
  let v = JSON.parse(text);
  if (Array.isArray(v) && v[0]?.type === "text" && typeof v[0].text === "string")
    v = JSON.parse(v[0].text);
  if (!v || typeof v !== "object" || !Array.isArray(v.documents))
    throw new Error("CAPTURE_NOT_A_DOCKET_SHEET");
  return v;
}

/** Removes the signed query of any URL that carries AWS signature parameters; the path is kept. */
export function stripSignedQuery(url) {
  if (typeof url !== "string") return url ?? null;
  if (/[?&](X-Amz-|AWSAccessKeyId=|Signature=|Expires=)/i.test(url)) return url.split("?")[0];
  // The connector appends the account's user_id to canonical links; it is an account identifier and is dropped.
  return url
    .replace(/([?&])user_id=[0-9]+(&|$)/, (m, p, tail) => (tail ? p : ""))
    .replace(/[?&]$/, "");
}

// <case>-<entry 5 digits>[-<attachment 3 digits>][-t<text entry 3 digits>]. A "-tNNN" id is a text-only (minute) entry that the provider
// files after the numbered entry it names; it carries no docket number of its own (primary_docket_sheet_number is null).
const DOC_ID = /^([a-z0-9]+-\d+:\d{4}-[a-z]{2,4}-\d{5})-(\d{5})(?:-(\d{3}))?(?:-t(\d{3}))?$/;

/** Splits a DocketBird document id into its case id, anchor entry number, attachment number and text-entry number (null when absent). */
export function splitDocumentId(id) {
  const m = String(id ?? "").match(DOC_ID);
  return m
    ? {
        case_id: m[1],
        entry_number: Number(m[2]),
        attachment_number: m[3] ? Number(m[3]) : null,
        text_entry: m[4] ? Number(m[4]) : null,
      }
    : null;
}

/**
 * Normalizes one capture: verifies that every document belongs to one case (exact id prefix), infers the sort order from the
 * dates as returned, strips signed links and returns a capture that is safe to store.
 */
export function normalizeCapture(text, { retrievedAt, expectCaseId = null } = {}) {
  const raw = parseConnectorCapture(text);
  const caseIds = new Set();
  const documents = raw.documents.map((d) => {
    const parts = splitDocumentId(d.id);
    if (!parts) throw new Error(`CAPTURE_DOCUMENT_ID_UNPARSEABLE ${String(d.id).slice(0, 60)}`);
    caseIds.add(parts.case_id);
    const out = {};
    for (const [k, v] of Object.entries(d)) out[k] = /url/i.test(k) ? stripSignedQuery(v) : v;
    return out;
  });
  if (caseIds.size !== 1) throw new Error(`CAPTURE_MIXED_CASES ${[...caseIds].join(",")}`);
  const caseId = [...caseIds][0];
  if (expectCaseId && caseId !== expectCaseId)
    throw new Error(`CAPTURE_CASE_MISMATCH ${caseId} != ${expectCaseId}`);
  const dated = documents.map((d) => d.filing_date).filter(Boolean);
  let asc = 0,
    desc = 0;
  for (let i = 1; i < dated.length; i++) {
    if (dated[i] > dated[i - 1]) asc++;
    else if (dated[i] < dated[i - 1]) desc++;
  }
  const sort = desc > asc ? "recent" : "chronological";
  return {
    schema_version: "de-dockets-docketbird-capture/1",
    case_id: caseId,
    sort,
    retrieved_at: retrievedAt ?? null,
    source_sha256: sha256(text),
    source_bytes: Buffer.byteLength(text),
    channel:
      "DocketBird MCP connector get_docket_sheet; saved verbatim by the session; signed PDF query strings removed",
    entries_total: Number.isInteger(raw.entries_total) ? raw.entries_total : null,
    entries_returned: Number.isInteger(raw.entries_returned)
      ? raw.entries_returned
      : documents.length,
    note: typeof raw.note === "string" ? raw.note : null,
    docket_sheet_url: stripSignedQuery(raw.docket_sheet_url ?? null),
    documents,
  };
}

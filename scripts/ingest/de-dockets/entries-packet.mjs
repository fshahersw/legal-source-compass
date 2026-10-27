// Pure builders for the de-dockets republish packet of sw_docket_entries_v1 (contract sw-matter-registry/1, docs/sw-matter-registry-contract.md §6.3).
// No I/O. Every row is built from a landed provider record; nothing is inferred.
//
// Rules (default packet, the current publication rule of §6.0):
//   * DocketBird docket-sheet rows: one row per docket entry. A numbered entry is the document whose id has no attachment or text part; its
//     attachments are counted on it. A text-only entry ("-NNNNN-tNNN", no number of its own) is one row; a text entry the provider files under an
//     attachment ("-NNNNN-NNN-tNNN") repeats the entry-level text and is not projected (counted).
//   * Description withheld when the provider flags the document restricted (restricted !== false: 'sealed_document', held), else when the text
//     matches the exclusion pattern ('sealed_or_restricted_text', held), else when it carries a contact field ('contact_or_access_data').
//   * Document counts and availability follow the documents, as for CourtListener rows (members-entry-record.mjs): no_documents only when no
//     document is listed; includes_sealed when the provider restricts one of them; provider_pdf when an open one is held as PDF; otherwise
//     provider_not_downloaded. A text hold keeps the counts; only a restricted entry document zeroes documents_available.
//   * No duplicates with rows already published: a numbered entry is added only when its number is above the highest entry number already
//     published for the MDL (CourtListener or DocketBird rows); a text-only entry only when the entry it follows is above that number.
//     Rows are only ever added; no existing row is changed.
// Optional packet (owner decision 2026-10-23 night, "dont withhold filings", NOT applied by default): the exclusion-pattern test is skipped;
// provider restriction flags and contact fields still withhold.
import {
  ws,
  excluded,
  hasContact,
  clipDescription,
  entryOrdinal,
  sha256,
  canon,
} from "../members-publish-rules.mjs";
import { splitDocumentId, stripSignedQuery } from "./docketbird-capture.mjs";

export const DS_ENTRIES = "sw_docket_entries_v1";
export const SCHEMA = "sw-matter-registry-view/1";
const enc = encodeURIComponent;
export const matterLink = (ctx) => `#record/sw_matters_v1/${enc(`sw-matter:${ctx.mdl}`)}`;
export const masterLink = (ctx) =>
  `#record/sw_matter_dockets_v1/${enc(`sw-md:${ctx.mdl}:${ctx.docket_key}`)}`;
export const clDocketUrl = (id) => `https://www.courtlistener.com/docket/${id}/`;
export const finish = (rec) => {
  rec.detail.provenance.projection_row_sha256 = sha256(
    canon([rec.id, rec.title, rec.item, rec.detail, rec.filters, rec.text, rec.source_url]),
  );
  return rec;
};

/** Merges captures of one case (recent and chronological windows) into docket entries keyed by document id. */
export function sheetEntries(captures) {
  const docs = new Map();
  const windows = [];
  for (const cap of [...captures].sort((a, b) =>
    String(a.retrieved_at).localeCompare(String(b.retrieved_at)),
  )) {
    const nums = [];
    for (const d of cap.documents) {
      docs.set(d.id, { doc: d, cap });
      const p = splitDocumentId(d.id);
      if (p && !p.attachment_number && !p.text_entry) nums.push(p.entry_number);
    }
    const dates = cap.documents
      .map((d) => d.filing_date)
      .filter(Boolean)
      .sort();
    windows.push({
      sort: cap.sort,
      retrieved_at: cap.retrieved_at,
      source_sha256: cap.source_sha256,
      entries_total: cap.entries_total,
      entries_returned: cap.entries_returned,
      min_date: dates[0] ?? null,
      max_date: dates.at(-1) ?? null,
      min_number: nums.length ? Math.min(...nums) : null,
      max_number: nums.length ? Math.max(...nums) : null,
    });
  }
  const entries = new Map();
  const stats = {
    documents: docs.size,
    numbered: 0,
    text_only: 0,
    attachments: 0,
    attachment_text_skipped: 0,
    orphan_attachments: 0,
    number_mismatch: 0,
  };
  for (const [id, { doc, cap }] of docs) {
    const p = splitDocumentId(id);
    if (p.text_entry != null && p.attachment_number != null) {
      stats.attachment_text_skipped++;
      continue;
    }
    if (p.text_entry != null) {
      entries.set(id, {
        id,
        kind: "text",
        entry_number: null,
        anchor: p.entry_number,
        doc,
        cap,
        attachments: [],
      });
      stats.text_only++;
      continue;
    }
    if (p.attachment_number != null) continue;
    if (
      Number.isInteger(doc.primary_docket_sheet_number) &&
      doc.primary_docket_sheet_number !== p.entry_number
    ) {
      stats.number_mismatch++;
      continue;
    }
    entries.set(id, {
      id,
      kind: "numbered",
      entry_number: p.entry_number,
      anchor: p.entry_number,
      doc,
      cap,
      attachments: [],
    });
    stats.numbered++;
  }
  for (const [id, { doc }] of docs) {
    const p = splitDocumentId(id);
    if (p.attachment_number == null || p.text_entry != null) continue;
    const main = entries.get(`${p.case_id}-${String(p.entry_number).padStart(5, "0")}`);
    if (main) {
      main.attachments.push(doc);
      stats.attachments++;
    } else stats.orphan_attachments++;
  }
  return { entries: [...entries.values()], windows, stats };
}

/** Entries that are not yet published: above the highest published entry number (null = nothing published with numbers). */
export function selectNew(entries, maxPublishedNumber) {
  if (maxPublishedNumber == null) return entries;
  return entries.filter((e) => e.anchor > maxPublishedNumber);
}

/** Missing stretch between what is published and the oldest entry of the newest window (null when the window reaches back far enough). */
export function gapAfterPublished(windows, maxPublishedNumber) {
  const recent = windows.filter((w) => w.sort === "recent" && w.min_number != null);
  if (!recent.length || maxPublishedNumber == null) return null;
  const lowest = Math.min(...recent.map((w) => w.min_number));
  return lowest > maxPublishedNumber + 1 ? { from: maxPublishedNumber + 1, to: lowest - 1 } : null;
}

/** Withholding decision for one DocketBird entry under the default rule or the optional 2026-10-23 rule. */
export function withholdingFor(doc, { releaseTextMentions = false } = {}) {
  const raw = ws(doc.title);
  if (doc.restricted !== false) return "sealed_document";
  if (!releaseTextMentions && excluded(raw)) return "sealed_or_restricted_text";
  if (hasContact(raw)) return "contact_or_access_data";
  return null;
}

/** Availability label of an entry's documents. Values shared with the CourtListener rows (no_documents, includes_sealed) keep their meaning;
 *  provider_pdf = at least one open document the provider holds as PDF; provider_not_downloaded = documents are listed and open, but the
 *  provider holds none of them as PDF. */
export function entryAvailability(documents, documentsSealed, downloadable) {
  if (documents === 0) return "no_documents";
  if (documentsSealed > 0) return "includes_sealed";
  return downloadable > 0 ? "provider_pdf" : "provider_not_downloaded";
}

/** One sw_docket_entries_v1 row from a DocketBird docket-sheet entry. ctx = {mdl, docket_key, docket_number, court_id, docketbird_case_id}. */
export function docketbirdEntryRecord(entry, ctx, { run, releaseTextMentions = false } = {}) {
  const d = entry.doc;
  const raw = ws(d.title);
  const withheld = withholdingFor(d, { releaseTextMentions });
  const held = !!withheld && withheld !== "contact_or_access_data";
  const clip = clipDescription(raw, 500);
  const description = withheld || !raw ? null : clip.text;
  const docsAll = entry.kind === "numbered" ? [d, ...entry.attachments] : [];
  const docsOpen = docsAll.filter((x) => x.restricted === false);
  const documentsSealed = docsAll.length - docsOpen.length;
  const downloadable = docsOpen.filter((x) => x.downloaded === 1 || x.downloaded === true).length;
  // Document availability follows the documents themselves (as members-entry-record.mjs does for CourtListener); a text hold changes the
  // description and the link, never the document counts.
  const availability = entryAvailability(docsAll.length, documentsSealed, downloadable);
  const documentsAvailable = withheld === "sealed_document" ? 0 : downloadable;
  const id = `sw-entry:docketbird:${d.id}`;
  const dateFiled =
    typeof d.filing_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.filing_date)
      ? d.filing_date
      : null;
  const sheetUrl = `https://www.docketbird.com/cases?case_id=${ctx.docketbird_case_id}`;
  const pageUrl = held ? sheetUrl : (stripSignedQuery(d.canonical_url) ?? sheetUrl);
  const numLabel = entry.entry_number != null ? `Entry ${entry.entry_number}` : "Docket text";
  const title = description
    ? `${numLabel} — ${description.length > 110 ? description.slice(0, 109) + "…" : description}`
    : `${numLabel} — description ${withheld ? "withheld" : "not recorded"}`;
  const label = "DocketBird docket sheet";
  const subtitle = `${ctx.docket_number} (${ctx.court_id}) · MDL ${ctx.mdl} · ${dateFiled ?? "date not recorded"} · ${label}`;
  const cells = {
    mdl: String(ctx.mdl),
    docket_key: ctx.docket_key,
    docket_number: ctx.docket_number,
    court_id: ctx.court_id,
    provider: "docketbird",
    native_entry_id: d.id,
    native_docket_id: null,
    entry_number: entry.entry_number,
    date_filed: dateFiled,
    time_filed: null,
    description,
    description_chars: clip.chars,
    description_truncated: clip.truncated && !withheld,
    description_withheld: withheld,
    documents: docsAll.length,
    documents_available: documentsAvailable,
    documents_sealed: documentsSealed,
    availability,
    document_ids: [],
    held,
    source_url: pageUrl,
  };
  const links = [
    { url: pageUrl, label },
    { url: masterLink(ctx), label: "Master docket in the matter registry" },
    { url: matterLink(ctx), label: "Matter" },
  ];
  const facts = [
    ["MDL", String(ctx.mdl)],
    ["Docket", `${ctx.docket_number} (${ctx.court_id})`],
    [
      "Entry number",
      entry.entry_number != null
        ? String(entry.entry_number)
        : `Not numbered (text entry after entry ${entry.anchor})`,
    ],
    ["Filed", dateFiled ?? "Not recorded"],
    [
      "Description",
      description ??
        (withheld === "sealed_document"
          ? "Withheld (the provider marks the document restricted)"
          : withheld === "contact_or_access_data"
            ? "Withheld (the text carries contact or hearing access data)"
            : withheld
              ? "Withheld (sealed, restricted or redacted in the court record)"
              : "Not recorded"),
    ],
    [
      "Documents",
      `${docsAll.length}${docsAll.length ? ` (${documentsAvailable} held by the provider as PDF${documentsSealed ? `; ${documentsSealed} restricted by the provider` : ""})` : ""}`,
    ],
    ["Source", label],
    ["Source id", d.id],
  ];
  if (clip.truncated && !withheld)
    facts.push(["Description length", `${clip.chars} characters in the record; first 499 shown`]);
  const source = {
    kind: "docketbird_get_docket_sheet",
    sort: entry.cap.sort,
    window: entry.cap.sort === "recent" ? "newest" : "oldest",
    case_id: ctx.docketbird_case_id,
    channel: entry.cap.channel,
    retrieved_at: entry.cap.retrieved_at,
    window_entries: entry.cap.entries_returned,
    provider_entries_total: entry.cap.entries_total,
    capture_sha256: entry.cap.source_sha256,
  };
  const recordSha = sha256(canon(d));
  const rec = {
    dataset: DS_ENTRIES,
    id,
    category: "sw_docket_entry",
    state: null,
    county_geoids: [],
    title,
    source_url: pageUrl,
    ordinal: entryOrdinal(ctx.mdl, dateFiled, entry.entry_number),
    item: {
      id,
      cells,
      links,
      title,
      badges: [
        "Docket entry",
        ...(availability === "provider_pdf" ? ["PDF at provider"] : []),
        ...(withheld ? ["Description withheld"] : []),
        `Source: ${label}`,
      ],
      subtitle,
    },
    detail: {
      id,
      title,
      subtitle,
      facts,
      links,
      sections: [],
      registry: {
        schema: "sw-matter-registry/1",
        mdl: String(ctx.mdl),
        docket_key: ctx.docket_key,
        native_case_ids: [
          { provider: "docketbird", source_system: "docketbird", id: ctx.docketbird_case_id },
        ],
        entry: {
          provider: "docketbird",
          native_entry_id: d.id,
          entry_number: entry.entry_number,
          follows_entry: entry.kind === "text" ? entry.anchor : null,
          date_filed: dateFiled,
          time_filed: null,
          recap_sequence_number: null,
          pacer_sequence_number: null,
        },
        description_withheld: withheld,
        documents: [],
        source,
      },
      provenance: {
        source_system: "docketbird-mcp",
        source_entity_type: "docket-sheet-document",
        source_native_id: d.id,
        source_record_sha256: recordSha,
        retrieved_at: entry.cap.retrieved_at,
        run_ids: [run],
        projection_schema: SCHEMA,
      },
      qualification:
        "One docket entry as the DocketBird docket sheet shows it (title as published, clipped to 500 characters). Collected for the master docket where the CourtListener copy is blocked, missing or behind; the list holds the provider window that was read (newest and, for some dockets, oldest entries), not the whole docket. Entries the provider marks restricted, or whose text is sealed, restricted, in camera, ex parte or redacted, are shown without description. Not legal advice.",
    },
    text: [
      description ?? "",
      entry.entry_number ?? "",
      ctx.docket_number,
      `MDL ${ctx.mdl}`,
      dateFiled ?? "",
      "docketbird",
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
    filters: {
      _listing: "true",
      native_id: d.id,
      mdl: String(ctx.mdl),
      docket_key: ctx.docket_key,
      native_docket_id: "",
      provider: "docketbird",
      year: dateFiled ? dateFiled.slice(0, 4) : "",
      availability,
      has_documents: docsAll.length ? "true" : "false",
      description_withheld: withheld ? "true" : "false",
    },
  };
  return { rec: finish(rec), withheld };
}

/** Per-MDL tally of a set of rows. */
export function tally(rows) {
  const t = {
    rows: 0,
    withheld: 0,
    sealed_or_restricted_text: 0,
    sealed_document: 0,
    contact_or_access_data: 0,
    max_date: null,
    min_date: null,
  };
  for (const r of rows) {
    const c = r.item.cells;
    t.rows++;
    if (c.description_withheld) {
      t.withheld++;
      t[c.description_withheld]++;
    }
    if (c.date_filed) {
      if (!t.max_date || c.date_filed > t.max_date) t.max_date = c.date_filed;
      if (!t.min_date || c.date_filed < t.min_date) t.min_date = c.date_filed;
    }
  }
  return t;
}

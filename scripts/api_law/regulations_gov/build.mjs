#!/usr/bin/env node
/**
 * Build regulations_gov_documents and regulations_gov_dockets from the acquired API records (acquire.mjs), the comment
 * counts (counts.jsonl) and the Federal Register links (fr_links.mjs). No network. Rows are made by the same functions
 * the scheduled refresh uses (src/lib/ingest/sources/regulationsGov.ts).
 *
 *   node scripts/api_law/regulations_gov/build.mjs [--out DIR]
 *
 * Writes <out>/<dataset>.rows.jsonl.gz (rows in dataset order, newest first) and <out>/<dataset>.header.json
 * ({dataset, label, listing_block, summary, built_at, inputs}) for scripts/api_law/publish_stream.py.
 */
import fs from "node:fs";
import path from "node:path";
import { BUILD, ensureStripTypes, fileDigest, flag, nowIso, readJsonl, writeJson, writeJsonlGz } from "../lib/node.mjs";
import { countFilters, listing, presentOptions } from "../lib/listing.mjs";

ensureStripTypes(import.meta.url);
const R = await import("../../../src/lib/ingest/sources/regulationsGov.ts");
const args = process.argv.slice(2);
const out = path.resolve(flag(args, "--out", path.join(BUILD, "regulations_gov")));
const inputs = [];

async function readDir(sub) {
  const recs = [];
  const dir = path.join(out, sub);
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    if (!f.endsWith(".jsonl.gz")) continue;
    inputs.push(fileDigest(path.join(dir, f)));
    for await (const line of readJsonl(path.join(dir, f))) recs.push(line);
  }
  return recs;
}

const stats = { documents_read: 0, documents_held: 0, dockets_read: 0, dockets_held: 0 };
const docs = new Map();
for (const line of await readDir("documents")) {
  stats.documents_read++;
  const d = R.normalizeDocument(line.record);
  if (!d || !R.AGENCY_IDS.includes(d.agencyId) || !R.DOC_TYPES.includes(d.documentType)) {
    stats.documents_held++;
    continue;
  }
  docs.set(d.id, { doc: d, prov: { api_url: line.api_url, retrieved_at: line.retrieved_at } });
}
const dockets = new Map();
for (const line of await readDir("dockets")) {
  stats.dockets_read++;
  const d = R.normalizeDocket(line.record);
  if (!d || !R.AGENCY_IDS.includes(d.agencyId)) {
    stats.dockets_held++;
    continue;
  }
  dockets.set(d.id, { d, prov: { api_url: line.api_url, retrieved_at: line.retrieved_at } });
}
const counts = new Map();
const countsFile = path.join(out, "counts.jsonl");
if (fs.existsSync(countsFile)) {
  inputs.push(fileDigest(countsFile));
  // the last reading of a record wins
  for await (const c of readJsonl(countsFile))
    counts.set(`${c.scope}:${c.id}`, { posted: c.posted, scope: c.scope, read_on: c.read_on, api_url: c.api_url });
}
const fr = new Map();
const frFile = path.join(out, "fr_links.jsonl.gz");
if (fs.existsSync(frFile)) {
  inputs.push(fileDigest(frFile));
  for await (const l of readJsonl(frFile)) fr.set(R.frUrl(l.doc_num), { id: l.record_id, filters: { cfr_pair: l.cfr_pairs } });
}
const frResolved = fs.existsSync(frFile);

/* ---------------------------------------------------------------- documents */
const docOrder = R.sortDocumentsNewestFirst([...docs.values()].map((x) => x.doc));
const docStats = { rows: 0, with_fr_number: 0, fr_in_corpus: 0, fr_not_in_corpus: 0, with_count: 0, count_wanted: 0, by_type: {}, by_agency: {} };
const docFilterCounts = { agency: {}, type: {}, year: {}, comments: {}, fr_linked: {} };
function* docRows() {
  for (const doc of docOrder) {
    const link = frResolved ? R.frLinkFor(doc, fr) : { document_number: doc.frDocNum, record_id: null, status: doc.frDocNum ? "not_in_corpus" : "none_stated", cfr_pairs: [] };
    const c = counts.get(`document:${doc.id}`) ?? null;
    const row = R.documentRow(doc, link, c, docs.get(doc.id).prov);
    docStats.rows++;
    docStats.with_fr_number += doc.frDocNum ? 1 : 0;
    docStats.fr_in_corpus += link.status === "in_corpus" ? 1 : 0;
    docStats.fr_not_in_corpus += link.status === "not_in_corpus" ? 1 : 0;
    docStats.with_count += c ? 1 : 0;
    docStats.count_wanted += R.wantsDocumentCount(doc) ? 1 : 0;
    docStats.by_type[doc.documentType] = (docStats.by_type[doc.documentType] ?? 0) + 1;
    docStats.by_agency[doc.agencyId] = (docStats.by_agency[doc.agencyId] ?? 0) + 1;
    const fc = countFilters([row], Object.keys(docFilterCounts));
    for (const [k, vs] of Object.entries(fc)) for (const [v, n] of Object.entries(vs)) docFilterCounts[k][v] = (docFilterCounts[k][v] ?? 0) + n;
    yield row;
  }
}
const docFile = await writeJsonlGz(path.join(out, `${R.DOCS_DATASET}.rows.jsonl.gz`), docRows());

/* ---------------------------------------------------------------- dockets */
const docketOrder = R.sortDocketsNewestFirst([...dockets.values()].map((x) => x.d));
const docketStats = { rows: 0, with_count: 0, by_type: {}, by_agency: {}, referenced_by_documents: 0 };
const referenced = new Set([...docs.values()].map((x) => x.doc.docketId).filter(Boolean));
const docketFilterCounts = { agency: {}, docket_type: {}, id_year: {}, comments: {} };
function* docketRows() {
  for (const d of docketOrder) {
    const c = counts.get(`docket:${d.id}`) ?? null;
    const row = R.docketRow(d, c, dockets.get(d.id).prov);
    docketStats.rows++;
    docketStats.with_count += c ? 1 : 0;
    docketStats.referenced_by_documents += referenced.has(d.id) ? 1 : 0;
    docketStats.by_type[d.docketType ?? "not recorded"] = (docketStats.by_type[d.docketType ?? "not recorded"] ?? 0) + 1;
    docketStats.by_agency[d.agencyId] = (docketStats.by_agency[d.agencyId] ?? 0) + 1;
    const fc = countFilters([row], Object.keys(docketFilterCounts));
    for (const [k, vs] of Object.entries(fc)) for (const [v, n] of Object.entries(vs)) docketFilterCounts[k][v] = (docketFilterCounts[k][v] ?? 0) + n;
    yield row;
  }
}
const docketFile = await writeJsonlGz(path.join(out, `${R.DOCKETS_DATASET}.rows.jsonl.gz`), docketRows());
const docketsMissing = [...referenced].filter((id) => !dockets.has(id)).length;

const agencyOptions = Object.fromEntries(R.AGENCIES.map((a) => [a.id, `${a.name} (${a.id})`]));
const manifests = fs.readdirSync(out).filter((f) => /^manifest\.(documents|dockets)\./.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(out, f), "utf8")));
const common = {
  source: "Regulations.gov API v4 (General Services Administration eRulemaking Program), https://api.regulations.gov/v4",
  documentation: R.REGS_DOCS,
  licence: "Regulations.gov records are U.S. government works (17 U.S.C. 105); comments are counted, never copied",
  agencies: R.AGENCIES.map((a) => ({ regulations_gov_id: a.id, federal_register_agency_id: a.frId, name: a.name })),
  agency_rule: "Twelve agencies of the atlas's rulemaking views; each Regulations.gov agency id equals the agency's Federal Register short name (checked 2026-10-23)",
  time_rule: "Instants are kept as published (UTC); calendar dates are their Eastern-time dates, as Regulations.gov shows them",
  comment_rule: "Public comments posted = the comments API's totalElements for the document (filter[commentOnId]) or docket (filter[docketId]); agencies may post fewer comments than they receive. A count not read yet shows as Not recorded.",
  acquisition: manifests,
  built_at: nowIso(),
};
writeJson(path.join(out, `${R.DOCS_DATASET}.header.json`), {
  dataset: R.DOCS_DATASET,
  label: "Regulations.gov documents: rules, proposed rules and notices of twelve federal agencies",
  listing_block: listing(
    [["agency", "Agency"], ["type", "Type"], ["posted", "Posted"], ["docket", "Docket"], ["fr_doc", "FR document"], ["comments", "Comments posted"]],
    [
      ["agency", "Agency", agencyOptions],
      ["type", "Document type", { proposed_rule: "Proposed Rule", rule: "Rule", notice: "Notice" }],
      ["year", "Year posted", presentOptions(docFilterCounts.year)],
      ["comments", "Comments posted", R.COMMENT_BUCKETS],
      ["fr_linked", "Federal Register record", { in_corpus: "In this atlas", not_in_corpus: "Not in this atlas", none_stated: "No FR number stated" }],
    ],
    docFilterCounts,
  ),
  summary: {
    ...common,
    scope: "Every Rule, Proposed Rule and Notice the twelve agencies posted on Regulations.gov in the acquired range; supporting materials, comments and other document types are not included",
    fr_rule: "A document links to the Federal Register record of this atlas only when that record's source_url is https://www.federalregister.gov/d/<frDocNum>; CFR parts are that record's cfr_pair values",
    records: docStats.rows,
    stats: { ...stats, ...docStats, federal_register_links_resolved: frResolved },
  },
  built_at: nowIso(),
  inputs,
  output: docFile,
});
writeJson(path.join(out, `${R.DOCKETS_DATASET}.header.json`), {
  dataset: R.DOCKETS_DATASET,
  label: "Regulations.gov dockets of twelve federal agencies, with public comment counts",
  listing_block: listing(
    [["agency", "Agency"], ["docket_type", "Docket type"], ["modified", "Last modified"], ["comments", "Comments posted"]],
    [
      ["agency", "Agency", agencyOptions],
      ["docket_type", "Docket type", { rulemaking: "Rulemaking", nonrulemaking: "Nonrulemaking", other: "Not recorded" }],
      ["id_year", "Year in docket ID", presentOptions(docketFilterCounts.id_year)],
      ["comments", "Comments posted", R.COMMENT_BUCKETS],
    ],
    docketFilterCounts,
  ),
  summary: {
    ...common,
    scope: "Every docket of the twelve agencies on Regulations.gov (rulemaking and nonrulemaking)",
    records: docketStats.rows,
    stats: { ...stats, ...docketStats, document_dockets_not_in_listing: docketsMissing },
  },
  built_at: nowIso(),
  inputs,
  output: docketFile,
});
console.log(JSON.stringify({ documents: docFile, dockets: docketFile, docStats, docketStats, docketsMissing }));

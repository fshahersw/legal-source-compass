#!/usr/bin/env node
/**
 * Build congress_amendments, congress_nominations, congress_treaties and congress_committee_reports from the acquired
 * Congress.gov records (acquire.mjs) with the row functions the scheduled refresh uses (src/lib/ingest/sources/
 * congressGov.ts). Exact-link checks read the held ids of congress_bills, congress_members, congress_committees and
 * judicial_nominations once (read-only, cached under <out>/known/) and GovInfo's CRPT listing when acquired
 * (scripts/api_law/govinfo/acquire.mjs listing CRPT).
 *
 *   . private/scratch/env.sh && node scripts/api_law/congress/build.mjs [amendments,nominations,treaties,reports] [--out DIR]
 *
 * Writes <out>/<dataset>.rows.jsonl.gz and <out>/<dataset>.header.json for scripts/api_law/publish_stream.py.
 */
import fs from "node:fs";
import path from "node:path";
import { BUILD, ensureStripTypes, fileDigest, flag, knownIds, nowIso, readJsonl, writeJson, writeJsonlGz } from "../lib/node.mjs";
import { countFilters, listing, presentOptions } from "../lib/listing.mjs";

ensureStripTypes(import.meta.url);
const C = await import("../../../src/lib/ingest/sources/congressGov.ts");
const args = process.argv.slice(2);
const which = (args[0] && !args[0].startsWith("--") ? args[0] : "amendments,nominations,treaties,reports").split(",");
const out = path.resolve(flag(args, "--out", path.join(BUILD, "congress")));
const govinfoOut = path.resolve(flag(args, "--govinfo", path.join(BUILD, "govinfo")));
const knownDir = path.join(out, "known");
fs.mkdirSync(knownDir, { recursive: true });

const known = C.emptyKnown();
known.bills = await knownIds("congress_bills", knownDir);
known.members = await knownIds("congress_members", knownDir);
known.committees = await knownIds("congress_committees", knownDir);
known.judicial = await knownIds("judicial_nominations", knownDir);
const crptDir = path.join(govinfoOut, "CRPT", "listing");
const crptState = path.join(govinfoOut, "CRPT", "state.json");
if (fs.existsSync(crptState) && JSON.parse(fs.readFileSync(crptState, "utf8")).done) {
  for (const f of fs.readdirSync(crptDir).sort())
    for await (const l of readJsonl(path.join(crptDir, f))) {
      const k = C.reportKeyOfPackage(l.package.packageId);
      if (k && !known.govinfoReports.has(k)) known.govinfoReports.set(k, l.package.packageId);
    }
  known.govinfoChecked = true;
}

async function* lines(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).sort()) if (f.endsWith(".jsonl.gz")) yield* readJsonl(path.join(dir, f));
}
const inputs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl.gz")).sort().map((f) => fileDigest(path.join(dir, f))) : []);

async function details(collection) {
  const map = new Map();
  for await (const d of lines(path.join(out, collection, "details"))) if (d.body) map.set(d.detail_url, d);
  return map;
}

const COMMON = {
  source: "Congress.gov API v3 (Library of Congress), https://api.congress.gov/v3",
  documentation: C.CG_DOCS,
  licence: "Congress.gov data are works of the U.S. Government (Library of Congress); no copyright restrictions",
  links_rule: "Exact identifiers only: congress_bills ids from Congress.gov's own bill references, congress_members by bioguide id, congress_committees by system code, judicial_nominations by the same Congress and PN citation",
};

async function emit(dataset, label, rows, columns, filters, filterNames, summary, inputFiles) {
  const counts = countFilters(rows, filterNames);
  const file = await writeJsonlGz(path.join(out, `${dataset}.rows.jsonl.gz`), rows);
  writeJson(path.join(out, `${dataset}.header.json`), {
    dataset,
    label,
    listing_block: listing(columns, filters(counts), counts),
    summary: { ...COMMON, ...summary, records: rows.length, built_at: nowIso() },
    built_at: nowIso(),
    inputs: inputFiles,
    output: file,
  });
  console.log(JSON.stringify({ dataset, rows: rows.length, sha256: file.sha256 }));
}

const congressOptions = (counts) => presentOptions(counts.congress ?? {}, { order: "desc", label: (c) => `${C.ordinal(Number(c))} Congress` });

if (which.includes("amendments")) {
  const det = await details("amendments");
  const rows = new Map();
  let withDetail = 0;
  for await (const l of lines(path.join(out, "amendments", "list"))) {
    const u = String(l.list.url ?? "").replace(/\?format=json$/, "");
    const d = det.get(u);
    const a = C.normalizeAmendment(l.list, d?.body ?? null);
    if (!a) continue;
    if (a.detail) withDetail++;
    const row = C.amendmentRow(a, known, { api_url: l.api_url, retrieved_at: l.retrieved_at, ...(d ? { detail_url: u, detail_retrieved_at: d.retrieved_at } : {}) });
    rows.set(row.id, row);
  }
  const ordered = [...rows.values()].sort(C.amendmentOrder);
  await emit(
    "congress_amendments",
    "Amendments in Congress (Congress.gov)",
    ordered,
    [["congress", "Congress"], ["type", "Type"], ["amends", "Amends"], ["sponsor", "Sponsor"], ["latest_action_date", "Latest action"]],
    (counts) => [
      ["congress", "Congress", congressOptions(counts)],
      ["type", "Type", { hamdt: "House amendment", samdt: "Senate amendment", suamdt: "Senate unprinted amendment" }],
      ["chamber", "Chamber", { House: "House", Senate: "Senate" }],
      ["year", "Year", presentOptions(counts.year ?? {})],
      ["detail", "Sponsor and amended bill read", { yes: "Yes", no: "Not yet" }],
    ],
    ["congress", "type", "chamber", "year", "detail"],
    {
      scope: "Every House and Senate amendment Congress.gov lists for the acquired Congresses; sponsor, chamber and the amended bill come from each amendment's detail record, read newest first within the request budget",
      stats: { amendments: ordered.length, with_detail: withDetail, amended_bill_links: ordered.filter((r) => r.filters.amended_bill.length && (r.item.links ?? []).some((x) => String(x.url).startsWith("/law/legislation/federal/"))).length },
    },
    [...inputs(path.join(out, "amendments", "list")), ...inputs(path.join(out, "amendments", "details"))],
  );
}

if (which.includes("nominations")) {
  const rows = new Map();
  for await (const l of lines(path.join(out, "nominations", "list"))) {
    const n = C.normalizeNomination(l.list);
    if (!n) continue;
    const row = C.nominationRow(n, known, { api_url: l.api_url, retrieved_at: l.retrieved_at });
    rows.set(row.id, row);
  }
  const ordered = [...rows.values()].sort(C.nominationOrder);
  await emit(
    "congress_nominations",
    "Presidential nominations received by the Senate (Congress.gov)",
    ordered,
    [["citation", "Citation"], ["congress", "Congress"], ["organization", "Organization"], ["kind", "Civilian or military"], ["received", "Received"], ["latest_action", "Latest action"]],
    (counts) => [
      ["congress", "Congress", congressOptions(counts)],
      ["kind", "Civilian or military", { civilian: "Civilian", military: "Military", not_recorded: "Not recorded" }],
      ["status", "Latest action", C.STATUS_LABEL],
      ["year", "Year received", presentOptions(counts.year ?? {})],
      ["judicial", "Judicial nomination record", { yes: "Yes", no: "No" }],
    ],
    ["congress", "kind", "status", "year", "judicial"],
    {
      scope: "Every nomination (PN citation, including parts) Congress.gov lists for the acquired Congresses: civilian and military, with the latest action as published",
      status_rule: "Status words come only from the latest action text (Confirmed by the Senate…, Received message of withdrawal…, Returned to the President…); anything else is 'other'",
      judicial_rule: "A nomination links to judicial_nominations when a record with the same Congress and PN citation is held; the judge link is that record's own exact FJC match",
      stats: { nominations: ordered.length, judicial_links: ordered.filter((r) => r.filters.judicial[0] === "yes").length },
    },
    inputs(path.join(out, "nominations", "list")),
  );
}

if (which.includes("treaties")) {
  const det = await details("treaties");
  const rows = new Map();
  for await (const l of lines(path.join(out, "treaties", "list"))) {
    const u = String(l.list.url ?? "").replace(/\?format=json$/, "");
    const d = det.get(u);
    const t = C.normalizeTreaty(l.list, d?.body ?? null);
    if (!t) continue;
    const row = C.treatyRow(t, { api_url: l.api_url, retrieved_at: l.retrieved_at, ...(d ? { detail_url: u, detail_retrieved_at: d.retrieved_at } : {}) });
    rows.set(row.id, row);
  }
  const ordered = [...rows.values()].sort(C.treatyOrder);
  await emit(
    "congress_treaties",
    "Treaty documents transmitted to the Senate (Congress.gov)",
    ordered,
    [["document", "Treaty document"], ["topic", "Topic"], ["transmitted", "Transmitted"], ["in_force", "In force"]],
    (counts) => [
      ["congress", "Congress received", congressOptions(counts)],
      ["topic", "Topic", presentOptions(counts.topic ?? {}, { order: "count" })],
      ["in_force", "Entered into force", { yes: "Date recorded", no: "Not recorded" }],
    ],
    ["congress", "topic", "in_force"],
    { scope: "Every treaty document Congress.gov lists, with titles, parties, index terms and the resolution of advice and consent from its detail record", stats: { treaties: ordered.length, with_detail: ordered.filter((r) => r.item.treaty.detail).length } },
    [...inputs(path.join(out, "treaties", "list")), ...inputs(path.join(out, "treaties", "details"))],
  );
}

if (which.includes("reports")) {
  const det = await details("reports");
  const rows = new Map();
  let skippedNoDetail = 0;
  for await (const l of lines(path.join(out, "reports", "list"))) {
    const u = String(l.list.url ?? "").replace(/\?format=json$/, "");
    const d = det.get(u);
    if (!d) {
      // the list entry has no title, committees or bills: a report is published once its detail is read
      skippedNoDetail++;
      continue;
    }
    const r = C.normalizeReport(l.list, d.body);
    if (!r) continue;
    const row = C.reportRow(r, known, { api_url: l.api_url, retrieved_at: l.retrieved_at, detail_url: u, detail_retrieved_at: d.retrieved_at });
    rows.set(row.id, row);
  }
  const ordered = [...rows.values()].sort(C.reportOrder);
  await emit(
    "congress_committee_reports",
    "Committee reports of the House and Senate (Congress.gov, with GovInfo texts)",
    ordered,
    [["citation", "Citation"], ["issued", "Issued"], ["bills", "Associated bills"], ["committees", "Committees"]],
    (counts) => [
      ["congress", "Congress", congressOptions(counts)],
      ["type", "Report type", { hrpt: "House report", srpt: "Senate report", erpt: "Senate executive report" }],
      ["year", "Year issued", presentOptions(counts.year ?? {})],
      ["conference", "Conference report", { yes: "Yes", no: "No" }],
    ],
    ["congress", "type", "year", "conference"],
    {
      scope: "Committee reports whose Congress.gov detail record was read (title, committees, associated bills); list entries without a detail are not published",
      govinfo_rule: known.govinfoChecked ? "GovInfo package link only where GovInfo's Congressional Reports listing has the package id of that report and part" : "GovInfo listing not read for this build: package links are Not recorded",
      stats: { reports: ordered.length, list_entries_without_detail: skippedNoDetail, govinfo_packages: ordered.filter((r) => r.item.govinfo_package).length },
    },
    [...inputs(path.join(out, "reports", "list")), ...inputs(path.join(out, "reports", "details"))],
  );
}

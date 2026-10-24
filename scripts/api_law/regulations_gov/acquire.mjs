#!/usr/bin/env node
/**
 * Regulations.gov API v4 full acquisition (wave 1025, api-law). Stages, each resumable (a finished agency file is
 * skipped; counts already read are skipped):
 *
 *   documents  every Rule / Proposed Rule / Notice of each agency, read in postedDate windows small enough for the API's
 *              5,000-record query limit (a window over the limit is halved; a single day over it is split by type)
 *              → <out>/documents/<AGENCY>.jsonl.gz  (one line per API record: {record, api_url, retrieved_at})
 *   dockets    every docket of each agency, in lower-bound lastModifiedDate passes of up to 5,000 records (Eastern
 *              time, as the API reads it; the API ignores a lower bound given with an upper one)
 *              → <out>/dockets/<AGENCY>.jsonl.gz
 *   counts     public comments posted (comments API totalElements): proposed rules first, then rulemaking dockets, then
 *              other documents with a comment period, newest first, until --max requests or the end
 *              → <out>/counts.jsonl (appended)
 *
 *   set -a && eval "$(grep '^DATA_GOV_API_KEY=' private/scratch/secrets.env)" && set +a && \
 *     node scripts/api_law/regulations_gov/acquire.mjs documents [--agencies FDA,CPSC] [--posted-from 1990-01-01]
 *       [--posted-to YYYY-MM-DD] [--out DIR] [--interval-ms 4000]
 *
 * The key is shared with other jobs (Regulations.gov allows 1,000 requests an hour per key): requests start at most
 * every --interval-ms (default 4,000 ms = 900 an hour), and below 120 remaining in the hour window the client waits
 * 10 minutes. Every response is recorded in <out>/requests.jsonl (URL without key, status, bytes, sha256, time).
 */
import fs from "node:fs";
import path from "node:path";
import { BUILD, ensureStripTypes, flag, nowIso, politeClient, readJsonl, writeJson, writeJsonlGz } from "../lib/node.mjs";

ensureStripTypes(import.meta.url);
const R = await import("../../../src/lib/ingest/sources/regulationsGov.ts");

const args = process.argv.slice(2);
const stage = args[0];
const out = path.resolve(flag(args, "--out", path.join(BUILD, "regulations_gov")));
const agencies = (flag(args, "--agencies", R.AGENCY_IDS.join(",")) ?? "").split(",").filter(Boolean);
for (const a of agencies) if (!R.AGENCY_IDS.includes(a)) throw new Error(`agency ${a} is outside the dataset's scope`);
const key = process.env.DATA_GOV_API_KEY;
if (!key) {
  console.error("DATA_GOV_API_KEY must be set (load it from private/scratch/secrets.env in the same command)");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const client = politeClient({
  minIntervalMs: Number(flag(args, "--interval-ms", "4000")),
  lowWater: 120,
  pauseMs: 600_000,
  maxRequests: Number(flag(args, "--max", "Infinity")),
  headers: { "X-Api-Key": key },
  ledger: path.join(out, "requests.jsonl"),
});
const log = (o) => console.error(JSON.stringify({ at: nowIso(), ...o }));
const day = (iso) => iso.slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400_000);

async function list(url) {
  const { body, record } = await client.getJson(url);
  const p = R.parseListPage(JSON.stringify(body));
  return { ...p, record };
}

/** Read all records of one query whose total is known to be at most 5,000. */
async function pageAll(build, total, sink) {
  const pages = Math.ceil(total / R.PAGE_SIZE);
  for (let page = 1; page <= pages; page++) {
    const p = await list(build(page));
    for (const rec of p.data) sink(rec, p.record);
    if (!p.hasNextPage) break;
  }
}

async function documents() {
  const from = flag(args, "--posted-from", "1990-01-01");
  const to = flag(args, "--posted-to", day(new Date().toISOString()));
  const manifest = { stage: "documents", posted_from: from, posted_to: to, agencies: {} };
  for (const agency of agencies) {
    const file = path.join(out, "documents", `${agency}.jsonl.gz`);
    if (fs.existsSync(file)) {
      log({ agency, skip: "already acquired" });
      continue;
    }
    const seen = new Map();
    const windows = [{ from, to, types: R.DOC_TYPES }];
    let reads = 0;
    const held = [];
    // the agency's total in the date range, to check the windows add up
    const all = await list(R.documentsQuery({ agencies: [agency], postedFrom: from, postedTo: to, size: 5 }));
    while (windows.length) {
      const w = windows.shift();
      const q = (page, size = R.PAGE_SIZE) =>
        R.documentsQuery({ agencies: [agency], types: w.types, postedFrom: w.from, postedTo: w.to, sort: "postedDate,documentId", page, size });
      const first = await list(q(1));
      reads++;
      if (first.total > R.PAGE_SIZE * R.MAX_PAGES_PER_QUERY) {
        if (w.from < w.to) {
          const mid = addDays(w.from, Math.floor(daysBetween(w.from, w.to) / 2));
          windows.unshift({ ...w, to: mid }, { ...w, from: addDays(mid, 1) });
        } else if (w.types.length > 1) {
          for (const t of w.types) windows.unshift({ ...w, types: [t] });
        } else {
          held.push({ window: w, total: first.total, reason: "more than 5,000 records of one type on one day" });
        }
        continue;
      }
      const sink = (rec, record) => {
        if (typeof rec.id === "string") seen.set(rec.id, { record: rec, api_url: record.url, retrieved_at: record.retrieved_at });
      };
      for (const rec of first.data) sink(rec, first.record);
      if (first.hasNextPage) {
        const pages = Math.ceil(first.total / R.PAGE_SIZE);
        for (let page = 2; page <= pages; page++) {
          const p = await list(q(page));
          reads++;
          for (const rec of p.data) sink(rec, p.record);
          if (!p.hasNextPage) break;
        }
      }
      log({ agency, window: `${w.from}..${w.to}`, types: w.types.length, total: first.total, held_so_far: seen.size });
    }
    const written = await writeJsonlGz(file, [...seen.values()].sort((a, b) => (a.record.id < b.record.id ? -1 : 1)));
    manifest.agencies[agency] = {
      api_total_in_range: all.total,
      acquired: seen.size,
      not_reached: all.total - seen.size,
      held,
      reads,
      file: written,
    };
    log({ agency, done: manifest.agencies[agency] });
  }
  writeJson(path.join(out, `manifest.documents.${agencies.join("-")}.json`), { ...manifest, finished_at: nowIso() });
}

async function dockets() {
  const from = flag(args, "--modified-from", "1990-01-01 00:00:00");
  const manifest = { stage: "dockets", modified_from_et: from, agencies: {} };
  for (const agency of agencies) {
    const file = path.join(out, "dockets", `${agency}.jsonl.gz`);
    if (fs.existsSync(file)) {
      log({ agency, skip: "already acquired" });
      continue;
    }
    const seen = new Map();
    const all = await list(R.docketsQuery({ agencies: [agency], modifiedFromEt: from, size: 5 }));
    const held = [];
    let reads = 0;
    // Lower-bound (keyset) passes: the API applies only the upper bound when both lastModifiedDate bounds are given
    // (checked 2026-10-24: a one-second FDA window returned the agency's oldest 5,000 dockets), so each pass asks for
    // the dockets modified at or after `ge`, sorted by modification time, up to 5,000 records, and the next pass
    // starts at the last record's modification time (records at that second are read again and kept once).
    let ge = from;
    for (;;) {
      const q = (page) => R.docketsQuery({ agencies: [agency], modifiedFromEt: ge, page });
      const first = await list(q(1));
      reads++;
      let last = null;
      const take = (p) => {
        for (const rec of p.data) {
          if (typeof rec.id === "string") seen.set(rec.id, { record: rec, api_url: p.record.url, retrieved_at: p.record.retrieved_at });
          last = rec.attributes?.lastModifiedDate ?? last;
        }
      };
      take(first);
      const pages = Math.min(R.MAX_PAGES_PER_QUERY, Math.ceil(first.total / R.PAGE_SIZE));
      if (first.hasNextPage) {
        for (let page = 2; page <= pages; page++) {
          const p = await list(q(page));
          reads++;
          take(p);
          if (!p.hasNextPage) break;
        }
      }
      log({ agency, from_et: ge, total_from_here: first.total, held_so_far: seen.size });
      if (first.total <= R.PAGE_SIZE * R.MAX_PAGES_PER_QUERY) break; // this pass reached the end
      const next = last ? R.etFilterTime(last) : null;
      if (!next || next <= ge) {
        held.push({ from_et: ge, total_from_here: first.total, reason: "more than 5,000 dockets modified in one second" });
        break;
      }
      ge = next;
    }
    const written = await writeJsonlGz(file, [...seen.values()].sort((a, b) => (a.record.id < b.record.id ? -1 : 1)));
    manifest.agencies[agency] = { api_total_in_range: all.total, acquired: seen.size, not_reached: all.total - seen.size, held, reads, file: written };
    log({ agency, done: manifest.agencies[agency] });
  }
  writeJson(path.join(out, `manifest.dockets.${agencies.join("-")}.json`), { ...manifest, finished_at: nowIso() });
}

async function counts() {
  const since = flag(args, "--since", "1990-01-01");
  const countsFile = path.join(out, "counts.jsonl");
  const done = new Set();
  if (fs.existsSync(countsFile)) for await (const c of readJsonl(countsFile)) done.add(`${c.scope}:${c.id}`);
  const want = [];
  for (const f of fs.existsSync(path.join(out, "documents")) ? fs.readdirSync(path.join(out, "documents")) : []) {
    if (!f.endsWith(".jsonl.gz")) continue;
    for await (const line of readJsonl(path.join(out, "documents", f))) {
      const d = R.normalizeDocument(line.record);
      if (!d || !R.wantsDocumentCount(d) || !agencies.includes(d.agencyId)) continue;
      const posted = R.etDate(d.postedDate) ?? "";
      if (posted < since) continue;
      want.push({ scope: "document", id: d.id, objectId: d.objectId, tier: d.documentType === "Proposed Rule" ? 0 : 2, at: posted });
    }
  }
  for (const f of fs.existsSync(path.join(out, "dockets")) ? fs.readdirSync(path.join(out, "dockets")) : []) {
    if (!f.endsWith(".jsonl.gz")) continue;
    for await (const line of readJsonl(path.join(out, "dockets", f))) {
      const d = R.normalizeDocket(line.record);
      if (!d || d.docketType !== "Rulemaking" || !agencies.includes(d.agencyId)) continue;
      const modified = R.etDate(d.lastModifiedDate) ?? "";
      if (modified < since) continue;
      want.push({ scope: "docket", id: d.id, tier: 1, at: modified });
    }
  }
  want.sort((a, b) => a.tier - b.tier || (b.at < a.at ? -1 : b.at > a.at ? 1 : 0) || (a.id < b.id ? -1 : 1));
  const todo = want.filter((w) => !done.has(`${w.scope}:${w.id}`));
  log({ counts_wanted: want.length, already: want.length - todo.length, todo: todo.length });
  let n = 0;
  for (const w of todo) {
    const url = w.scope === "document" ? R.docCommentsUrl(w.objectId) : R.docketCommentsUrl(w.id);
    let res;
    try {
      res = await client.getJson(url);
    } catch (error) {
      if (/budget/.test(String(error))) break;
      throw error;
    }
    const posted = R.commentTotal(res.body);
    if (posted === null) continue;
    fs.appendFileSync(
      countsFile,
      JSON.stringify({ scope: w.scope, id: w.id, posted, read_on: res.record.retrieved_at.slice(0, 10), api_url: res.record.url, retrieved_at: res.record.retrieved_at }) + "\n",
    );
    if (++n % 100 === 0) log({ counts_read: n, remaining_todo: todo.length - n, rate_remaining: client.remaining });
  }
  log({ counts_read: n });
}

if (stage === "documents") await documents();
else if (stage === "dockets") await dockets();
else if (stage === "counts") await counts();
else {
  console.error("usage: acquire.mjs documents|dockets|counts [options]  (see the header)");
  process.exit(2);
}

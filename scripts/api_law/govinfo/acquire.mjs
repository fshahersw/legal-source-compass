#!/usr/bin/env node
/**
 * GovInfo full acquisition for the api-law datasets: collection listings (BILLS, CHRG, CPRT, GAOREPORTS, and CRPT for the
 * committee-report package links) and package summaries. Each stage is resumable.
 *
 *   listing    every package of a collection modified since --since (GovInfo's lastModified listing, 1,000 a request,
 *              offsetMark paging; the next mark is saved after every chunk of 20 requests)
 *                                                       → <out>/<COLLECTION>/listing/<n>.jsonl.gz, state.json
 *   summaries  the summary of listed packages, newest issue first, until --max requests or the end (CHRG/CPRT/
 *              GAOREPORTS; not BILLS) → <out>/<COLLECTION>/summaries/<n>.jsonl.gz (1,000 each)
 *
 *   set -a && eval "$(grep '^DATA_GOV_API_KEY=' private/scratch/secrets.env)" && set +a && \
 *     node scripts/api_law/govinfo/acquire.mjs listing CHRG [--since 1990-01-01T00:00:00Z] [--prefix CHRG-] [--out DIR]
 *     node scripts/api_law/govinfo/acquire.mjs summaries CHRG [--max 5000] [--interval-ms 300]
 *
 * GovInfo allows 36,000 requests an hour on the key in use; the key is shared, so requests start at most every
 * --interval-ms (default 300 ms ≈ 12,000 an hour) and below 2,000 remaining the client waits 10 minutes.
 */
import fs from "node:fs";
import path from "node:path";
import { BUILD, ensureStripTypes, flag, nowIso, politeClient, readJsonl, writeJson, writeJsonlGz } from "../lib/node.mjs";

ensureStripTypes(import.meta.url);
const G = await import("../../../src/lib/ingest/sources/govinfo.ts");
const args = process.argv.slice(2);
const [stage, collection] = args;
if (!["listing", "summaries"].includes(stage) || !["BILLS", "CHRG", "CPRT", "GAOREPORTS", "CRPT"].includes(collection)) {
  console.error("usage: acquire.mjs listing|summaries BILLS|CHRG|CPRT|GAOREPORTS|CRPT [options]");
  process.exit(2);
}
const key = process.env.DATA_GOV_API_KEY;
if (!key) {
  console.error("DATA_GOV_API_KEY must be set (load it from private/scratch/secrets.env in the same command)");
  process.exit(2);
}
const out = path.resolve(flag(args, "--out", path.join(BUILD, "govinfo")));
const dir = path.join(out, collection);
const client = politeClient({
  minIntervalMs: Number(flag(args, "--interval-ms", "300")),
  lowWater: 2000,
  pauseMs: 600_000,
  maxRequests: Number(flag(args, "--max", "Infinity")),
  headers: { "X-Api-Key": key },
  ledger: path.join(out, "requests.jsonl"),
});
const log = (o) => console.error(JSON.stringify({ at: nowIso(), collection, ...o }));
// only the package ids of the dataset (CRPT also lists Serial Set volumes; those are not committee reports of 104th+)
const prefix = flag(args, "--prefix", collection === "CRPT" ? "CRPT-" : collection === "BILLS" ? "BILLS-" : `${collection}-`);

if (stage === "listing") {
  const since = flag(args, "--since", "1990-01-01T00:00:00Z");
  const until = flag(args, "--until", undefined);
  const ldir = path.join(dir, "listing");
  fs.mkdirSync(ldir, { recursive: true });
  const statePath = path.join(dir, "state.json");
  let state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : { since, until: until ?? null, mark: "*", chunk: 0, listed: 0, kept: 0, total: null, done: false };
  if (state.done) {
    log({ skip: "listing already complete", ...state });
    process.exit(0);
  }
  let buf = [];
  let pages = 0;
  for (;;) {
    const { body, record } = await client.getJson(G.collectionUrl(collection, state.since, state.mark, 1000, state.until ?? undefined));
    pages++;
    state.total = body.count ?? state.total;
    for (const raw of Array.isArray(body.packages) ? body.packages : []) {
      state.listed++;
      if (typeof raw.packageId === "string" && raw.packageId.startsWith(prefix)) {
        buf.push({ package: raw, listing_url: record.url, retrieved_at: record.retrieved_at });
        state.kept++;
      }
    }
    const next = typeof body.nextPage === "string" ? /offsetMark=([^&]+)/.exec(body.nextPage) : null;
    const mark = next ? decodeURIComponent(next[1]) : null;
    if (pages % 20 === 0 || !mark) {
      await writeJsonlGz(path.join(ldir, `${String(state.chunk).padStart(5, "0")}.jsonl.gz`), buf);
      buf = [];
      state = { ...state, chunk: state.chunk + 1, mark: mark ?? state.mark, done: !mark };
      writeJson(statePath, state);
      log({ listed: state.listed, kept: state.kept, total: state.total });
    } else state.mark = mark;
    if (!mark) break;
  }
} else {
  if (collection === "BILLS" || collection === "CRPT") {
    console.error(`${collection}: the listing carries every field the dataset uses`);
    process.exit(2);
  }
  const sdir = path.join(dir, "summaries");
  fs.mkdirSync(sdir, { recursive: true });
  const done = new Set();
  const chunks = fs.readdirSync(sdir).filter((f) => /^\d{5}\.jsonl\.gz$/.test(f)).sort();
  for (const f of chunks) for await (const s of readJsonl(path.join(sdir, f))) done.add(s.packageId);
  let chunkNo = chunks.length ? Number(chunks.at(-1).slice(0, 5)) + 1 : 0;
  const want = [];
  for (const f of fs.readdirSync(path.join(dir, "listing")).sort())
    for await (const l of readJsonl(path.join(dir, "listing", f)))
      if (!done.has(l.package.packageId)) want.push({ id: l.package.packageId, issued: String(l.package.dateIssued ?? "") });
  want.sort((a, b) => (a.issued < b.issued ? 1 : a.issued > b.issued ? -1 : a.id < b.id ? -1 : 1));
  log({ summaries_wanted: want.length + done.size, already: done.size, todo: want.length });
  let buf = [];
  let n = 0;
  const flush = async () => {
    if (!buf.length) return;
    await writeJsonlGz(path.join(sdir, `${String(chunkNo++).padStart(5, "0")}.jsonl.gz`), buf);
    buf = [];
  };
  for (const w of want) {
    let r;
    try {
      r = await client.get(G.summaryUrl(w.id));
    } catch (error) {
      await flush();
      if (/budget/.test(String(error))) break;
      throw error;
    }
    if (r.status !== 200 && r.status !== 404) {
      await flush();
      throw new Error(`HTTP ${r.status} for ${r.record.url}`);
    }
    const body = r.status === 200 ? JSON.parse(r.text) : null;
    if (body) delete body.download;
    buf.push({ packageId: w.id, status: r.status, summary_url: r.record.url, retrieved_at: r.record.retrieved_at, summary: body });
    if (buf.length >= 1000) await flush();
    if (++n % 500 === 0) log({ summaries_read: n, todo_left: want.length - n, rate_remaining: client.remaining });
  }
  await flush();
  log({ summaries_read: n });
}

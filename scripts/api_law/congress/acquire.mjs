#!/usr/bin/env node
/**
 * Congress.gov API v3 full acquisition for the api-law datasets (amendments, nominations, treaties, committee reports).
 * Two stages per collection, each resumable:
 *
 *   list     every list item, per Congress (offset paging, 250 a request)  → <out>/<collection>/list/<congress>.jsonl.gz
 *            (treaties: one list across Congresses)                         → <out>/treaties/list/all.jsonl.gz
 *   details  the detail record of list items, newest update first, until --max requests or the end; a detail already
 *            read is skipped                                        → <out>/<collection>/details/<n>.jsonl.gz (1,000 each)
 *
 *   set -a && eval "$(grep '^DATA_GOV_API_KEY=' private/scratch/secrets.env)" && set +a && \
 *     node scripts/api_law/congress/acquire.mjs list amendments --congresses 97-119 [--out DIR] [--interval-ms 700]
 *     node scripts/api_law/congress/acquire.mjs details amendments --congresses 110-119 [--max 20000]
 *
 * Congress.gov allows 5,000 requests an hour per key (the key in use reports 20,000); the key is shared, so requests
 * start at most every --interval-ms (default 700 ms ≈ 5,100 an hour) and below 500 remaining the client waits 10 minutes.
 */
import fs from "node:fs";
import path from "node:path";
import { BUILD, ensureStripTypes, flag, nowIso, politeClient, readJsonl, writeJson, writeJsonlGz } from "../lib/node.mjs";

ensureStripTypes(import.meta.url);
const args = process.argv.slice(2);
const [stage, collection] = args;
const COLLECTIONS = {
  amendments: { path: "amendment", key: "amendments", perCongress: true, detail: true },
  nominations: { path: "nomination", key: "nominations", perCongress: true, detail: false },
  treaties: { path: "treaty", key: "treaties", perCongress: false, detail: true },
  reports: { path: "committee-report", key: "reports", perCongress: true, detail: true },
};
const conf = COLLECTIONS[collection];
if (!conf || !["list", "details"].includes(stage)) {
  console.error("usage: acquire.mjs list|details amendments|nominations|treaties|reports [--congresses A-B] [--max N]");
  process.exit(2);
}
const key = process.env.DATA_GOV_API_KEY;
if (!key) {
  console.error("DATA_GOV_API_KEY must be set (load it from private/scratch/secrets.env in the same command)");
  process.exit(2);
}
const out = path.resolve(flag(args, "--out", path.join(BUILD, "congress")));
const [c0, c1] = (flag(args, "--congresses", "97-119") ?? "").split("-").map(Number);
const congresses = Array.from({ length: c1 - c0 + 1 }, (_, i) => c0 + i);
const dir = path.join(out, collection);
fs.mkdirSync(path.join(dir, "list"), { recursive: true });
const client = politeClient({
  minIntervalMs: Number(flag(args, "--interval-ms", "700")),
  lowWater: 500,
  pauseMs: 600_000,
  maxRequests: Number(flag(args, "--max", "Infinity")),
  headers: { "X-Api-Key": key },
  ledger: path.join(out, "requests.jsonl"),
});
const log = (o) => console.error(JSON.stringify({ at: nowIso(), ...o }));
const API = "https://api.congress.gov/v3";

async function listAll(base, label) {
  const items = [];
  for (let offset = 0; ; offset += 250) {
    const { body, record } = await client.getJson(`${base}${base.includes("?") ? "&" : "?"}limit=250&offset=${offset}&format=json`);
    const page = Array.isArray(body[conf.key]) ? body[conf.key] : [];
    for (const it of page) items.push({ list: it, api_url: record.url.replace(/[?&]format=json/, ""), retrieved_at: record.retrieved_at });
    const total = body.pagination?.count ?? 0;
    if (page.length < 250 || offset + 250 >= total) {
      log({ collection, label, listed: items.length, total });
      return { items, total };
    }
  }
}

if (stage === "list") {
  const manifest = { collection, stage, congresses: conf.perCongress ? congresses : "all", files: {} };
  const targets = conf.perCongress ? congresses.map((c) => [String(c), `${API}/${conf.path}/${c}`]) : [["all", `${API}/${conf.path}`]];
  for (const [label, base] of targets) {
    const file = path.join(dir, "list", `${label}.jsonl.gz`);
    if (fs.existsSync(file)) {
      log({ collection, label, skip: "already listed" });
      continue;
    }
    const { items, total } = await listAll(base, label);
    manifest.files[label] = { api_total: total, listed: items.length, file: await writeJsonlGz(file, items) };
  }
  writeJson(path.join(dir, `manifest.list.${congresses[0]}-${congresses.at(-1)}.json`), { ...manifest, finished_at: nowIso() });
} else {
  if (!conf.detail) {
    console.error(`${collection}: the list entries carry every field the dataset uses; no detail stage`);
    process.exit(2);
  }
  // details are kept in gzip chunks of 1,000 records (details/<n>.jsonl.gz); a chunk is written whole, so an interrupted
  // run loses at most the chunk in progress and a re-run skips every detail already in a chunk
  const ddir = path.join(dir, "details");
  fs.mkdirSync(ddir, { recursive: true });
  const done = new Set();
  const chunks = fs.readdirSync(ddir).filter((f) => /^\d{5}\.jsonl\.gz$/.test(f)).sort();
  for (const f of chunks) for await (const d of readJsonl(path.join(ddir, f))) done.add(d.detail_url);
  let chunkNo = chunks.length ? Number(chunks.at(-1).slice(0, 5)) + 1 : 0;
  const want = [];
  for (const f of fs.readdirSync(path.join(dir, "list")).sort()) {
    if (!f.endsWith(".jsonl.gz")) continue;
    const label = f.replace(".jsonl.gz", "");
    if (conf.perCongress && !congresses.includes(Number(label))) continue;
    for await (const line of readJsonl(path.join(dir, "list", f))) {
      const u = String(line.list?.url ?? "").replace(/\?format=json$/, "");
      if (u.startsWith(API) && !done.has(u)) want.push({ url: u, updated: String(line.list?.updateDate ?? "") });
    }
  }
  want.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  log({ collection, details_wanted: want.length + done.size, already: done.size, todo: want.length });
  let n = 0;
  let buf = [];
  const flush = async () => {
    if (!buf.length) return;
    await writeJsonlGz(path.join(ddir, `${String(chunkNo).padStart(5, "0")}.jsonl.gz`), buf);
    chunkNo++;
    buf = [];
  };
  for (const w of want) {
    let r;
    try {
      r = await client.get(`${w.url}?format=json`);
    } catch (error) {
      if (/budget/.test(String(error))) break;
      await flush();
      throw error;
    }
    if (r.status !== 200 && r.status !== 404) {
      await flush();
      throw new Error(`HTTP ${r.status} for ${r.record.url}`);
    }
    buf.push({ detail_url: w.url, status: r.status, retrieved_at: r.record.retrieved_at, body: r.status === 200 ? JSON.parse(r.text) : null });
    if (buf.length >= 1000) await flush();
    if (++n % 200 === 0) log({ collection, details_read: n, todo_left: want.length - n, rate_remaining: client.remaining });
  }
  await flush();
  log({ collection, details_read: n });
}

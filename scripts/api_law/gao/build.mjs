#!/usr/bin/env node
/**
 * Build gao_legal_decisions from GAO's Legal Products RSS feed (one request; gao.gov's robots.txt asks for 420 s between
 * requests, so nothing else is fetched). The scheduled source (ingest-gao-legal) adds each later decision.
 *
 *   node scripts/api_law/gao/build.mjs [--from-file private/acq/w1025_api-law/gao/reportslegal.xml] [--out DIR]
 */
import fs from "node:fs";
import path from "node:path";
import { ACQ, BUILD, ensureStripTypes, flag, nowIso, politeClient, sha256, writeJson, writeJsonlGz } from "../lib/node.mjs";
import { countFilters, listing, presentOptions } from "../lib/listing.mjs";

ensureStripTypes(import.meta.url);
const G = await import("../../../src/lib/ingest/sources/gaoLegal.ts");
const args = process.argv.slice(2);
const out = path.resolve(flag(args, "--out", path.join(BUILD, "gao")));
const from = flag(args, "--from-file");
let xml;
let retrieved;
if (from) {
  xml = fs.readFileSync(from, "utf8");
  const stamp = path.join(path.dirname(from), "last_fetch.txt");
  retrieved = fs.existsSync(stamp) ? fs.readFileSync(stamp, "utf8").trim() : fs.statSync(from).mtime.toISOString().replace(/\.\d{3}Z$/, "Z");
} else {
  const r = await politeClient({ minIntervalMs: 420_000, headers: { Accept: "application/rss+xml, application/xml" } }).get(G.GAO_FEED);
  if (r.status !== 200) throw new Error(`gao.gov HTTP ${r.status}`);
  xml = r.text;
  retrieved = r.record.retrieved_at;
  fs.mkdirSync(path.join(ACQ, "gao"), { recursive: true });
  fs.writeFileSync(path.join(ACQ, "gao", "reportslegal.xml"), xml);
  fs.writeFileSync(path.join(ACQ, "gao", "last_fetch.txt"), retrieved);
}
const items = G.parseFeed(xml);
const rows = [...new Map(items.map((it) => { const r = G.gaoRow(it, { feed_url: G.GAO_FEED, retrieved_at: retrieved }); return [r.id, r]; })).values()];
rows.sort((a, b) => (a.item.decision.published !== b.item.decision.published ? (a.item.decision.published < b.item.decision.published ? 1 : -1) : a.id < b.id ? 1 : -1));
const counts = countFilters(rows, ["year", "month"]);
fs.mkdirSync(out, { recursive: true });
const file = await writeJsonlGz(path.join(out, "gao_legal_decisions.rows.jsonl.gz"), rows);
writeJson(path.join(out, "gao_legal_decisions.header.json"), {
  dataset: "gao_legal_decisions",
  label: "GAO legal decisions (bid protests and Comptroller General decisions), from GAO's Legal Products feed",
  listing_block: listing([["b_number", "Decision"], ["published", "Published"], ["summary", "Summary (as published)"]], [["year", "Year", presentOptions(counts.year ?? {})], ["month", "Month", presentOptions(counts.month ?? {})]], counts),
  summary: {
    source: `GAO Legal Products RSS feed, ${G.GAO_FEED} (listed on ${G.GAO_FEEDS_PAGE})`,
    licence: "GAO products are U.S. Government works",
    scope: `The decisions in GAO's feed on ${retrieved.slice(0, 10)} and every decision the scheduled source reads after it; gao.gov asks crawlers for 420 s between requests, so the earlier history is not copied (1994-2008 reports and decisions are in govinfo_gao_reports)`,
    records: rows.length,
    feed_sha256: sha256(Buffer.from(xml, "utf8")),
    retrieved_at: retrieved,
    built_at: nowIso(),
  },
  built_at: nowIso(),
  inputs: [{ url: G.GAO_FEED, retrieved_at: retrieved, sha256: sha256(Buffer.from(xml, "utf8")) }],
  output: file,
});
console.log(JSON.stringify({ dataset: "gao_legal_decisions", rows: rows.length, sha256: file.sha256 }));

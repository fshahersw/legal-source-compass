#!/usr/bin/env node
/**
 * Parity of the scheduled SEC port with the held rows: rebuild rows of sec_enforcement_actions from sec.gov listing page 0
 * (litigation releases and administrative proceedings) and the newest N litigation-release pages, then compare with the
 * stored rows (read-only REST). Nothing is written.
 *
 *   . private/scratch/env.sh && node scripts/api_law/enforcement/sec_parity.mjs [--lr 12] [--out DIR]
 */
import fs from "node:fs";
import path from "node:path";
import { ACQ, corpusGet, ensureStripTypes, flag, politeClient, writeJson } from "../lib/node.mjs";

ensureStripTypes(import.meta.url);
const S = await import("../../../src/lib/ingest/sources/secEnforcement.ts");
const { canonical, diffPaths } = await import("../../../src/lib/ingest/rows.ts");
const args = process.argv.slice(2);
const nLr = Number(flag(args, "--lr", "12"));
const out = flag(args, "--out", path.join(ACQ, "sec"));
fs.mkdirSync(out, { recursive: true });
const client = politeClient({ minIntervalMs: 1000, headers: { Accept: "text/html,application/xml" } });
async function page(url, file) {
  const f = path.join(out, file);
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8");
  const r = await client.get(url);
  if (r.status !== 200) throw new Error(`HTTP ${r.status} ${url}`);
  fs.writeFileSync(f, r.text);
  return r.text;
}
const lk = S.defaultLookups();
const lrItems = S.parseListing(await page(S.LR_LIST, "lr_list_0.html"));
const apItems = S.parseListing(await page(S.AP_LIST, "ap_list_0.html"));
const built = [];
for (const item of apItems) built.push(S.apRow(item, lk));
for (const item of lrItems.slice(0, nLr)) {
  const num = item.release_number.toLowerCase();
  const raw = await page(item.url, `${num}.html`);
  const [title, text] = S.releaseText(raw, item.url);
  built.push(S.lrRow(item, title, text, lk));
}
const ids = built.map((r) => r.id);
const stored = new Map();
for (let i = 0; i < ids.length; i += 40) {
  const chunk = ids.slice(i, i + 40).map((x) => `"${x}"`).join(",");
  for (const r of await corpusGet(`corpus_records?select=id,category,state,title,source_url,item,detail,text,filters&dataset=eq.sec_enforcement_actions&id=in.(${encodeURIComponent(chunk)})`))
    stored.set(r.id, r);
}
const report = { built: built.length, held: 0, identical: 0, differ: [], not_held: [] };
for (const b of built) {
  const s = stored.get(b.id);
  if (!s) {
    report.not_held.push(b.id);
    continue;
  }
  report.held++;
  const want = { category: s.category, state: s.state ?? "", title: s.title, source_url: s.source_url, item: s.item, detail: s.detail, text: s.text, filters: s.filters };
  const got = { category: b.category, state: b.state, title: b.title, source_url: b.source_url, item: b.item, detail: b.detail, text: b.text, filters: b.filters };
  if (canonical(got) === canonical(want)) report.identical++;
  else report.differ.push({ id: b.id, paths: diffPaths(want, got, 12) });
}
writeJson(path.join(out, "sec_parity.json"), report);
console.log(JSON.stringify({ ...report, differ: report.differ.slice(0, 10) }, null, 1));

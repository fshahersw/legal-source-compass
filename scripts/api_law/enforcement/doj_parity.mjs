#!/usr/bin/env node
/**
 * Parity of the scheduled DOJ port with the held rows: rebuild releases from the harvested News API pages the builder
 * read (private/acq/enforcement_actions/doj/pages, read-only) and compare with the stored rows of their
 * doj_press_releases_<year> partition (read-only REST). Nothing is written.
 *
 *   . private/scratch/env.sh && node scripts/api_law/enforcement/doj_parity.mjs [--pages p05480,p05494] [--sample 3]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { BUILD, ROOT, corpusGet, ensureStripTypes, flag, writeJson } from "../lib/node.mjs";

ensureStripTypes(import.meta.url);
const D = await import("../../../src/lib/ingest/sources/dojPressReleases.ts");
const { canonical, diffPaths } = await import("../../../src/lib/ingest/rows.ts");
const args = process.argv.slice(2);
const dir = path.join(ROOT, "private/acq/enforcement_actions/doj/pages");
const all = fs.readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort();
const sample = Number(flag(args, "--sample", "0"));
let pages = (flag(args, "--pages", "") || "").split(",").filter(Boolean).map((p) => p + ".json.gz");
if (!pages.length) {
  // every n-th page across the whole harvest plus the last two
  const step = Math.max(1, Math.floor(all.length / 40));
  pages = [...all.filter((_, i) => i % step === 0), ...all.slice(-2)];
}
const lk = D.defaultDojLookups();
const built = [];
for (const p of pages) {
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, p))).toString("utf8"));
  const results = (data.results ?? []).filter((r) => r.uuid);
  for (const r of sample ? results.slice(0, sample) : results) {
    const [year, row] = await D.buildRelease(r, lk);
    built.push({ year, row, page: p, changed: D.timeAttr(r.changed) });
  }
}
const report = { pages: pages.length, built: built.length, held: 0, identical: 0, differ: [], not_held: 0, newer_copy_held: 0 };
const byYear = new Map();
for (const b of built) (byYear.get(b.year) ?? byYear.set(b.year, []).get(b.year)).push(b);
for (const [year, list] of byYear) {
  for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40);
    const ids = chunk.map((b) => `"${b.row.id}"`).join(",");
    const stored = new Map(
      (await corpusGet(`corpus_records?select=id,category,state,title,source_url,item,detail,text,filters&dataset=eq.doj_press_releases_${year}&id=in.(${encodeURIComponent(ids)})`)).map((r) => [r.id, r]),
    );
    for (const b of chunk) {
      const s = stored.get(b.row.id);
      if (!s) {
        report.not_held++;
        continue;
      }
      report.held++;
      if ((s.item?.release?.changed ?? "") > (b.changed ?? "")) {
        // the builder kept a later copy of this release from another page
        report.newer_copy_held++;
        continue;
      }
      const want = { category: s.category, state: s.state ?? "", title: s.title, source_url: s.source_url, item: s.item, detail: s.detail, text: s.text, filters: s.filters };
      const got = { category: b.row.category, state: b.row.state, title: b.row.title, source_url: b.row.source_url, item: b.row.item, detail: b.row.detail, text: b.row.text, filters: b.row.filters };
      if (canonical(got) === canonical(want)) report.identical++;
      else report.differ.push({ id: b.row.id, year, paths: diffPaths(want, got, 12) });
    }
  }
}
writeJson(path.join(BUILD, "doj", "doj_parity.json"), report);
console.log(JSON.stringify({ ...report, differ: report.differ.slice(0, 8) }, null, 1));

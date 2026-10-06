// Live check that a re-projection reproduces the projected values: take live corrected rows, rewind them with their ledger ops to the
// pre-projection state (what a projector rebuilds from the bundles), run the overlay on the evidence, and compare with the live row.
//   node verify-reprojection.mjs <evidenceDir> <ledger.jsonl|.gz> [sample=N]
import fs from 'node:fs';
import zlib from 'node:zlib';
import {Live} from './gap-analysis-live.mjs';
import {applyOps, sameJson} from './project-registry.mjs';
import {loadEvidenceDir, overlayRecords} from './gapfill-overlay.mjs';

const [dir, ledgerFile, sampleArg] = process.argv.slice(2);
const n = Number(sampleArg ?? 300);
let text = fs.readFileSync(ledgerFile); if (ledgerFile.endsWith('.gz')) text = zlib.gunzipSync(text);
const all = text.toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const step = Math.max(1, Math.floor(all.length / n)), sample = all.filter((_, i) => i % step === 0).slice(0, n);
const live = new Live(), index = loadEvidenceDir(dir);
let same = 0, diff = 0; const bad = [];
for (let i = 0; i < sample.length; i += 40) {
  const chunk = sample.slice(i, i + 40);
  const q = chunk.map(e => `"${e.id}"`).join(',');
  const rows = await (await fetch(`${live.url}/rest/v1/corpus_records?select=id,dataset,item,detail,filters&dataset=eq.${chunk[0].dataset}&id=in.(${encodeURIComponent(q)})`, {headers: live.headers})).json();
  const byId = new Map(rows.map(r => [r.id, r]));
  for (const e of chunk) {
    const row = byId.get(e.id); if (!row) continue;
    const rebuilt = {...row, ...applyOps({item: row.item, detail: row.detail, filters: row.filters}, e.ops, 'revert').cols};
    const out = overlayRecords([rebuilt], index, 'now').records[0];
    // projected_at differs by design
    const strip = r => JSON.parse(JSON.stringify({item: r.item, detail: r.detail, filters: r.filters}, (k, v) => (k === 'projected_at' ? undefined : v)));
    if (sameJson(strip(out), strip(row))) same++; else { diff++; if (bad.length < 3) bad.push(e.id); }
  }
}
console.log(JSON.stringify({ledger: ledgerFile.split('/').pop(), sampled: sample.length, reproduced_identically: same, different: diff, examples: bad}));

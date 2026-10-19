// Read-only dump of one corpus dataset (id, cells, profile) to private/build/matter_xanalysis/lookups/<dataset>.json.
// Needs EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY (private/scratch/env.sh); nothing is written to the corpus.
//
//   node scripts/enrichment/matter_xanalysis/dump_dataset.mjs <dataset> [<dataset> ...]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const dir = join(root, "private", "build", "matter_xanalysis", "lookups");
const url = process.env.EXTERNAL_SUPABASE_URL.replace(/\/$/, "");
const key = process.env.EXTERNAL_SUPABASE_KEY;
const headers = { apikey: key, Accept: "application/json" };
if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
mkdirSync(dir, { recursive: true });

for (const dataset of process.argv.slice(2)) {
  if (!/^[a-z0-9_]{1,80}$/.test(dataset)) throw new Error(`bad dataset ${dataset}`);
  const rows = [];
  let last = "";
  for (;;) {
    const path = `corpus_records?select=id,source_url,c:item->cells,p:item->profile&dataset=eq.${dataset}&order=id.asc&limit=1000${last ? `&id=gt.${encodeURIComponent(last)}` : ""}`;
    const res = await fetch(`${url}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`${dataset}: ${res.status}`);
    const page = await res.json();
    if (!page.length) break;
    rows.push(...page);
    last = page.at(-1).id;
  }
  const meta = await (await fetch(`${url}/rest/v1/corpus_datasets?select=id,label,metadata&id=eq.${dataset}`, { headers })).json();
  writeFileSync(join(dir, `${dataset}.json`), JSON.stringify({ dataset, retrieved_at: new Date().toISOString(), meta: meta[0] ?? null, rows }));
  console.log(dataset, rows.length);
}

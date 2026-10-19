// Read-only extract of sw_matter_dockets_v1 (cells and the CourtListener docket id from the record's links) into
// private/build/matter_xanalysis/lookups/sw_matter_dockets.jsonl, paged by id. Needs EXTERNAL_SUPABASE_URL and
// EXTERNAL_SUPABASE_KEY in the environment (private/scratch/env.sh); nothing is written to the corpus.
//
//   node scripts/enrichment/matter_xanalysis/extract_dockets.mjs
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const out = join(root, "private", "build", "matter_xanalysis", "lookups", "sw_matter_dockets.jsonl");
const url = process.env.EXTERNAL_SUPABASE_URL.replace(/\/$/, "");
const key = process.env.EXTERNAL_SUPABASE_KEY;
const headers = { apikey: key, Accept: "application/json" };
if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
const CL = /courtlistener\.com\/docket\/(\d+)\//;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, "");
let last = "";
let total = 0;
for (;;) {
  const path = `corpus_records?select=id,c:item->cells,l:item->links&dataset=eq.sw_matter_dockets_v1&order=id.asc&limit=1000${last ? `&id=gt.${encodeURIComponent(last)}` : ""}`;
  let rows = null;
  for (let attempt = 0; attempt < 4 && rows === null; attempt++) {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers });
    if (res.ok) rows = await res.json();
    else await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  if (rows === null) throw new Error(`page after ${last} failed`);
  if (!rows.length) break;
  appendFileSync(
    out,
    rows
      .map((r) => {
        const cl = (r.l ?? []).map((x) => CL.exec(x?.url ?? "")).find(Boolean);
        return JSON.stringify({ id: r.id, ...r.c, cl_docket_id: cl ? Number(cl[1]) : null });
      })
      .join("\n") + "\n",
  );
  total += rows.length;
  last = rows.at(-1).id;
  if (total % 20000 < 1000) console.log(total, last);
}
console.log("done", total, out);

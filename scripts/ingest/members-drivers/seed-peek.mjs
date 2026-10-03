import fs from 'node:fs';
const seed = JSON.parse(fs.readFileSync(new URL('./matters-seed.json', import.meta.url), 'utf8'));
const want = process.argv.slice(2).map(Number);
const rows = want.length ? want.map(m => seed.find(s => s.mdl === m)).filter(Boolean) : seed;
for (const s of rows) {
  console.log(JSON.stringify({ mdl: s.mdl, tier: s.tier, rank: s.tier_rank, key: s.master?.docket_key ?? null, db: s.master_docketbird_id, cl: s.cl_ids_parent_csv, jpml: s.census_latest ? `${s.census_latest.pending}/${s.census_latest.historical}@${s.census_latest.report_date}` : null, cap: String(s.census_latest?.caption ?? s.caption_parent_csv).slice(0, 70) }));
}

// Fetches JPML orders from GovInfo's USCOURTS-jpml collection (free official PDFs) and records sha256 + retrieval time.
// Usage: node fetch-govinfo-jpml.mjs <mdl:yy> ... ; years yy, yy-1, yy+1 are tried; docs -0..-N are fetched until a miss.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const work = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members';
const dir = path.join(work, 'jpml-pdfs');
fs.mkdirSync(dir, { recursive: true });
const index = path.join(dir, 'fetch-index.jsonl');
const have = new Set(fs.existsSync(index) ? fs.readFileSync(index, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).url) : []);
for (const spec of process.argv.slice(2)) {
  const [mdl, yyArg] = spec.split(':');
  const base = Number(yyArg);
  let found = false;
  for (const yy of [base, base - 1, base + 1]) {
    const pkg = `USCOURTS-jpml-1_${String(yy).padStart(2, '0')}-F-${String(mdl).padStart(5, '0')}`;
    let any = false;
    for (let n = 0; n < 15; n++) {
      const url = `https://www.govinfo.gov/content/pkg/${pkg}/pdf/${pkg}-${n}.pdf`;
      if (have.has(url)) { any = true; continue; }
      let r;
      try { r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SeegerWeissCorpus/1.0)' }, signal: AbortSignal.timeout(60000) }); }
      catch (e) { console.log(JSON.stringify({ mdl, url, error: String(e.message) })); break; }
      if (!r.ok) break;
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.subarray(0, 5).toString().startsWith('%PDF')) break;
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      const file = path.join(dir, `govinfo-${pkg}-${n}.pdf`);
      fs.writeFileSync(file, buf);
      const rec = { mdl: Number(mdl), url, file, bytes: buf.length, sha256: sha, retrieved_at: new Date().toISOString(), status: r.status };
      fs.appendFileSync(index, JSON.stringify(rec) + '\n');
      console.log(JSON.stringify({ mdl, pkg, n, bytes: buf.length }));
      any = true;
    }
    if (any) { found = true; break; }
  }
  if (!found) console.log(JSON.stringify({ mdl, found: false }));
}

// Turns the JPML-site rows of mdl-members' hand-off file (_work/contracts/pdf-queue-additions/official/*.jsonl, provider official-court host www.jpml.uscourts.gov) into a discovery file
// in the format build-jpml-queue.mjs reads. The hand-off file's own sha256 and mtime are recorded as the discovery evidence.
//   node scripts/ingest/official-mdl/make-jpml-handoff-discovery.mjs --in=<jsonl> --out=<_work/agents/official-mdl/discovery/jpml-handoff-mdl-members.json>
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from './store.mjs';

const args = parseArgs(process.argv.slice(2));
const input = path.resolve(String(args.in)), out = path.resolve(String(args.out));
const bytes = fs.readFileSync(input), stat = fs.statSync(input);
const rows = bytes.toString('utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => { try { return new URL(r.url).hostname === 'www.jpml.uscourts.gov'; } catch { return false; } });
const byMdl = new Map();
for (const r of rows) { const k = String(r.mdl); if (!byMdl.has(k)) byMdl.set(k, []); byMdl.get(k).push(r); }
const searches = [...byMdl].map(([mdl, list]) => ({ mdl, query: 'hand-off from mdl-members: ' + path.basename(input), operation_id: null, searched_at: stat.mtime.toISOString(), handoff_file_sha256: createHash('sha256').update(bytes).digest('hex'),
  results: list.map(r => ({ url: r.url, title: null, description: 'hand-off row: doc_kind ' + r.doc_kind + ', doc_date ' + (r.doc_date ?? 'null') + ', expected_sha256 ' + (r.expected_sha256 ?? 'null') + ', expected_bytes ' + (r.expected_bytes ?? 'null') })) }));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ schema: 'official-mdl-discovery/1', note: 'JPML-site document URLs handed over by mdl-members (they fetched each once for the registry). The official-mdl transfer worker fetches them again and verifies the bytes; expected_sha256 is only a cross-check.', searches }, null, 1));
console.log(JSON.stringify({ out, mdls: searches.length, documents: rows.length }));

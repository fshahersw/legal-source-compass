import { execFileSync } from 'node:child_process';
const root = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined';
const passes = [
  'C:/Users/firas/OneDrive/Documents/ChatGPT/corpusss/audit/2026-10-02/metadata',
  'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T101805Z',
  'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T112700Z',
  'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T115000Z',
  'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T124500Z',
  'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-03T1045Z-members',
].join(',');
const jobs = process.argv.slice(2).map(s => s.split(':')); // mdl:docket:filter
for (const [mdl, docket, filter] of jobs) {
  const out = `${root}/_work/contracts/pdf-queue-additions/mdl${mdl}-${filter === 'cto' ? 'cto-schedules' : 'master-docs'}-2026-10-03.jsonl`;
  const res = execFileSync('node', ['--use-system-ca', 'scripts/ingest/members-pdf-queue.mjs', `--out=${out}`, `--dockets=${docket}`, `--filter=${filter}`, `--passes=${passes}`, `--note=MDL ${mdl} ${filter === 'cto' ? 'CTO/transfer-order schedule PDFs (evidence of member dockets)' : 'master docket documents'}`], { cwd: `${root}/wt-members`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const m = JSON.parse(res.trim().split('\n').pop());
  console.log(mdl, docket, filter, JSON.stringify({ rows: m.rows, stats: m.stats }));
}

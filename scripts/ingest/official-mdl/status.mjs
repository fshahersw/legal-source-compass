// One-screen status of the official-court run: per queue label, transfer progress, registration completion, supervisor state, and library totals from receipts.
//   node scripts/ingest/official-mdl/status.mjs [--run-dir=<dir>]
import fs from 'node:fs';
import path from 'node:path';
import { resolveRunDir, parseArgs, readJsonl } from './store.mjs';

const args = parseArgs(process.argv.slice(2));
const runDir = resolveRunDir(args['run-dir']);
const json = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const transfersDir = path.join(runDir, 'transfers');
const labels = fs.existsSync(transfersDir) ? fs.readdirSync(transfersDir).sort() : [];
const total = { queued: 0, processed: 0, cloud_verified: 0, new_objects: 0, verified_existing: 0, failed: 0, registered: 0, rejected: 0 };
const out = [];
for (const label of labels) {
  const progress = json(path.join(transfersDir, label, 'progress.json'));
  const completion = json(path.join(runDir, 'registration', label, 'completion.json'));
  const supervisor = json(path.join(runDir, 'status-' + label + '.json'));
  const regLines = readJsonl(path.join(runDir, 'registration', label, 'registration-receipts.jsonl'));
  const acknowledged = new Set(regLines.filter(x => x.state === 'registration_acknowledged').flatMap(x => x.transfer_receipt_sha256s)).size;
  const entry = { label, supervisor: supervisor?.state ?? null, attempt: supervisor?.attempt ?? null, delay_ms: supervisor?.delay_ms ?? null,
    eligible: progress?.eligible ?? null, processed: progress?.processed ?? 0, verified: progress?.cloud_verified ?? 0, new_objects: progress?.new_objects ?? 0, existing: progress?.verified_existing ?? 0, failed: progress?.failed ?? 0,
    stop_reason: progress?.stop_reason ?? null, complete: progress?.complete ?? false, registered_acknowledged: acknowledged, registration_done: completion ? { registered: completion.registered_receipts, rejected: completion.rejected_receipts } : null };
  out.push(entry);
  total.queued += entry.eligible ?? 0; total.processed += entry.processed; total.cloud_verified += entry.verified; total.new_objects += entry.new_objects; total.verified_existing += entry.existing; total.failed += entry.failed; total.registered += acknowledged; total.rejected += completion?.rejected_receipts ?? 0;
}
if (args.brief) {
  console.log(new Date().toISOString());
  for (const e of out) console.log(`${e.label.padEnd(12)} ${String(e.supervisor).padEnd(13)} ${e.processed}/${e.eligible} verified=${e.verified} new=${e.new_objects} existing=${e.existing} failed=${e.failed} registered=${e.registered_acknowledged}${e.registration_done ? ' (done, rejected ' + e.registration_done.rejected + ')' : ''}${e.stop_reason ? ' STOP ' + e.stop_reason : ''}`);
  console.log(`TOTAL queued=${total.queued} processed=${total.processed} verified=${total.cloud_verified} new_objects=${total.new_objects} existing=${total.verified_existing} failed=${total.failed} registered=${total.registered} rejected=${total.rejected}`);
} else console.log(JSON.stringify({ at: new Date().toISOString(), batches: out, total }, null, 1));

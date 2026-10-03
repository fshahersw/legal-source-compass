// node requeue.mjs rename <queue file name> <new priority>   |   node requeue.mjs retry <failed file name> <priority>
// Queue-directory maintenance for the CourtListener service (agent: mdl-members). Never deletes: a retry copies the task, the failed record stays.
import fs from 'node:fs';
import path from 'node:path';
const pass = process.env.CL_PASS ?? 'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-03T1045Z-members';
const [cmd, name, prio] = process.argv.slice(2);
const pr = String(prio).padStart(2, '0');
if (cmd === 'rename') {
  const from = path.join(pass, 'queue', name);
  const to = path.join(pass, 'queue', pr + name.slice(2));
  fs.renameSync(from, to);
  console.log('renamed', name, '->', path.basename(to));
} else if (cmd === 'retry') {
  const rec = JSON.parse(fs.readFileSync(path.join(pass, 'failed', name), 'utf8'));
  const task = { ...rec.task }; delete task.attempts; delete task.last_error; task.priority = Number(prio);
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const out = `${pr}-${stamp}-retry-${(task.label ?? 'task').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 50)}.json`;
  fs.writeFileSync(path.join(pass, 'queue', out), JSON.stringify(task, null, 1));
  console.log('requeued as', out, JSON.stringify(task));
} else console.log('usage: rename|retry');

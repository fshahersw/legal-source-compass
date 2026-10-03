// node bundle-only.mjs <comma mdls> — builds registry-staging/bundle-<mdl>.json for each MDL (no database writes) and prints the master identity summary.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const cwd = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/wt-members';
const staging = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members/registry-staging';
for (const m of (process.argv[2] ?? '').split(',').filter(Boolean)) {
  try {
    execFileSync('node', ['--use-system-ca', 'scripts/ingest/members-bundle.mjs', `--mdl=${m}`], { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 600000 });
    const b = JSON.parse(fs.readFileSync(`${staging}/bundle-${m}.json`, 'utf8'));
    const master = b.dockets.find(d => d.role === 'master');
    console.log(JSON.stringify({ mdl: m, tier: b.seed.tier, master: master.key, ids: master.provider_ids.map(p => `${p.provider}:${p.id}:${p.resolution_basis}${p.blocked ? ':blocked' : ''}`), notes: master.notes, judges: master.judge_refs.map(j => `${j.role}:${j.source_string ?? '-'}${j.cl_person_id ? '#' + j.cl_person_id : ''}`), members: b.counts.member_like_dockets }));
  } catch (e) { console.log(JSON.stringify({ mdl: m, error: String(e.message).slice(0, 300) })); }
}

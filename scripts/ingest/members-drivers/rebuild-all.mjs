// node rebuild-all.mjs <comma mdls> <registry run uuid> [--post] [--extras] [--project] [--ready]
//   1 bundle per matter -> 2 enrich (lake CourtListener headers: captions, exact court+key resolution) -> 3 post (registry entities)
//   -> 4 extras (sw_docket_entries_v1 / sw_matter_parties_v1) -> 5 project (sw_matters_v1 / sw_matter_dockets_v1)
import { execFileSync } from 'node:child_process';
const [mdlsArg, run, ...flags] = process.argv.slice(2);
const mdls = mdlsArg.split(',').filter(Boolean);
const cwd = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/wt-members';
const node = (script, args, timeout = 900000) => execFileSync('node', ['--use-system-ca', script, ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout });
for (const m of mdls) {
  const out = node('scripts/ingest/members-bundle.mjs', [`--mdl=${m}`]).trim().split('\n').pop();
  console.log('bundle', m, JSON.stringify(JSON.parse(out).counts));
}
console.log('enrich', node('scripts/ingest/members-bundle-enrich.mjs', [`--mdls=${mdls.join(',')}`], 1_800_000).trim().split('\n').pop());
for (const m of mdls) {
  if (flags.includes('--post')) console.log('post', node('scripts/ingest/members-registry-post.mjs', [`--mdl=${m}`, `--run=${run}`]).trim().split('\n').pop());
  else node('scripts/ingest/members-registry-post.mjs', [`--mdl=${m}`, `--run=${run}`, '--dry-run=true']);
}
if (flags.includes('--extras')) {
  const args = [`--mdls=${mdls.join(',')}`, `--run=${run}`];
  if (flags.includes('--ready')) args.push('--ready=true');
  console.log('extras', node('scripts/ingest/members-project-extras.mjs', args, 3_600_000).trim().split('\n').slice(-4).join(' | '));
}
if (flags.includes('--project')) {
  const args = [`--mdls=${mdls.join(',')}`, `--run=${run}`];
  if (flags.includes('--ready')) args.push('--ready=true');
  console.log('project', node('scripts/ingest/members-project.mjs', args).trim().split('\n').slice(-2).join(' | '));
}

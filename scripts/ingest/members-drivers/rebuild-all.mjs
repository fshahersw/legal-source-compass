// node rebuild-all.mjs <comma mdls> <registry run uuid> [--post] [--project] [--ready]
import { execFileSync } from 'node:child_process';
const [mdlsArg, run, ...flags] = process.argv.slice(2);
const mdls = mdlsArg.split(',').filter(Boolean);
const cwd = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/wt-members';
const node = (script, args) => execFileSync('node', ['--use-system-ca', script, ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 900000 });
for (const m of mdls) {
  const out = node('scripts/ingest/members-bundle.mjs', [`--mdl=${m}`]).trim().split('\n').pop();
  const j = JSON.parse(out);
  console.log('bundle', m, JSON.stringify(j.counts));
  if (flags.includes('--post')) {
    const p = node('scripts/ingest/members-registry-post.mjs', [`--mdl=${m}`, `--run=${run}`]).trim().split('\n').pop();
    console.log('post', p);
  } else node('scripts/ingest/members-registry-post.mjs', [`--mdl=${m}`, `--run=${run}`, '--dry-run=true']);
}
if (flags.includes('--project')) {
  const args = [`--mdls=${mdls.join(',')}`, `--run=${run}`];
  if (flags.includes('--ready')) args.push('--ready=true');
  console.log('project', node('scripts/ingest/members-project.mjs', args).trim().split('\n').slice(-2).join(' | '));
}

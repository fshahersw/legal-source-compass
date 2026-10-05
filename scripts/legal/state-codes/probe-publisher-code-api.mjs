// Read-only capability probe; no schema changes, run creation or Storage writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { publisherCredentials } from './run-publisher-code-intake.mjs';
import { hashBytes } from '../../admin/local-catalog-evidence-contract.mjs';

const [credentialFile, outputFile] = process.argv.slice(2);
if (!credentialFile || !outputFile) throw Error('PRIVATE_CREDENTIAL_FILE_AND_NEW_PRIVATE_OUTPUT_REQUIRED');
const privateRoot = await fs.realpath('private'), parent = await fs.realpath(path.dirname(path.resolve(outputFile)));
const relative = path.relative(privateRoot, parent);
if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('PRIVATE_OUTPUT_REQUIRED');
const cfg = publisherCredentials(JSON.parse(await fs.readFile(credentialFile, 'utf8')));
const target = path.join(parent, path.basename(outputFile));
const handle = await fs.open(target, 'wx');
const evidence = { project_id: 'xosqzzsnhxcyehcnirpa', started_at: new Date().toISOString(), read_only: true, requests: [], mutations: 0 };
try {
  const response = await fetch(`${cfg.url}/rest/v1/`, { headers: { ...cfg.headers, Accept: 'application/openapi+json' }, redirect: 'error', signal: AbortSignal.timeout(45000) });
  const body = []; let bytes = 0;
  for await (const chunk of response.body ?? []) { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) throw Error('CAPABILITY_RESPONSE_LIMIT'); body.push(Buffer.from(chunk)); }
  const raw = Buffer.concat(body);
  evidence.requests.push({ method: 'GET', path: '/rest/v1/', http_status: response.status, response_bytes: bytes, response_sha256: hashBytes(raw) });
  if (response.status !== 200) throw Error('CAPABILITY_HTTP_REJECTED');
  const schema = JSON.parse(raw.toString('utf8'));
  const rpcPaths = Object.keys(schema.paths ?? {}).filter(p => p.startsWith('/rpc/'));
  const required = ['corpus_publisher_code_register_v1', 'corpus_publisher_code_intake_v1', 'corpus_publisher_code_status_v1', 'corpus_publisher_code_verify_batch_v1'];
  evidence.exposed_rpc_count = rpcPaths.length;
  evidence.publisher_capabilities = Object.fromEntries(required.map(name => [name, rpcPaths.includes(`/rpc/${name}`)]));
  evidence.administrative_rpc_names = rpcPaths.filter(p => /corpus_admin|publisher_code/.test(p)).map(p => p.slice('/rpc/'.length));
  evidence.status = 'read_only_capabilities_observed';
} catch (error) {
  evidence.status = 'probe_failed'; evidence.error_code = /^[A-Z_]+$/.test(error.message) ? error.message : 'READ_ONLY_PROBE_FAILED'; process.exitCode = 1;
} finally {
  evidence.finished_at = new Date().toISOString();
  await handle.writeFile(JSON.stringify(evidence, null, 2) + '\n'); await handle.sync(); await handle.close();
  console.log(JSON.stringify(evidence));
}

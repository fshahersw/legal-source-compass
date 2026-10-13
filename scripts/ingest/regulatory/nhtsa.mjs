import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireValue, record, MonitorError } from './core.mjs';
export const NHTSA_BULK = {
  nhtsa_recalls: { url: 'https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip', dictionary: 'https://static.nhtsa.gov/odi/ffdd/rcl/RCL.txt', dictionarySha256: '3438cc7e4131efa401dfe6437dbe035607e092c129155dfb411d459d58802203' },
  nhtsa_investigations: { url: 'https://static.nhtsa.gov/odi/ffdd/inv/FLAT_INV.zip', dictionary: 'https://static.nhtsa.gov/odi/ffdd/inv/INV.txt', dictionarySha256: '04d3eef957004ff6d235ffbefe1ab270be27b72c1671ca5c3e8cfa96951bf8d2' },
};
export function pythonCommand(env = process.env) {
  const candidates = env.PYTHON ? [[env.PYTHON, []]] : [['python3', []], ['python', []], ['py', ['-3']], ...(env.LOCALAPPDATA ? [[path.join(env.LOCALAPPDATA, 'Programs/Python/Python311/python.exe'), []]] : [])];
  for (const [command, args] of candidates) { const r = spawnSync(command, [...args, '-c', 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)'], { timeout: 10000, stdio: 'ignore' }); if (!r.error && r.status === 0) return { command, args }; }
  throw new MonitorError('PYTHON_310_REQUIRED');
}
export async function collectNhtsa(client, source, options) {
  const config = NHTSA_BULK[source]; requireValue(config, 'SOURCE_NOT_CONFIGURED');
  const dictionary = await client.capture(config.dictionary, 'bytes');
  // Exact reviewed dictionary pins protect against same-width column reorder/rename.
  requireValue(dictionary.receipt.sha256 === config.dictionarySha256, 'NHTSA_DICTIONARY_CHANGED');
  const bulk = await client.capture(config.url, 'bytes', { maxBytes: 100 * 1024 * 1024 });
  requireValue(bulk.bytes.subarray(0, 4).toString('hex') === '504b0304', 'NHTSA_ZIP_INVALID');
  const output = path.join(options.directory, `nhtsa-parsed-${source}.json`); const python = pythonCommand();
  const result = spawnSync(python.command, [...python.args, '-B', '-X', 'utf8', fileURLToPath(new URL('./nhtsa_bulk.py', import.meta.url)), '--input', path.join(options.directory, 'objects', bulk.receipt.sha256 + '.raw'), '--source', source, '--from', options.from, '--through', options.through, '--maximum', String(options.maxRecords), '--output', output], { timeout: 180000, encoding: 'utf8', maxBuffer: 100000 });
  requireValue(!result.error && result.status === 0, 'NHTSA_BULK_PARSE_FAILED');
  const parsed = JSON.parse(await fs.readFile(output, 'utf8')); requireValue(parsed.records.length === parsed.selected_native_groups, 'NHTSA_GROUP_COUNT_MISMATCH');
  const rows = parsed.records.map((data) => record(data, bulk, `zip:${parsed.member};native_id:${data.native_id}`));
  return { rows, expected: rows.length, scope: { date_basis: source === 'nhtsa_recalls' ? 'report receipt or record creation' : 'opened or closed', selection: 'Complete native groups with a source date within inclusive window; all associations of selected groups preserved', full_history: false, source_release_last_modified: bulk.receipt.publisher_last_modified, total_source_rows: parsed.total_source_rows, total_source_native_groups: parsed.total_source_native_groups, selected_native_groups: parsed.selected_native_groups, dictionary_sha256: dictionary.receipt.sha256, uncompressed_bytes: parsed.uncompressed_bytes, qualification: 'Older changes with no date in the selected window are outside this rolling scope; longer reconciliation is required.' } };
}

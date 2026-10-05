import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(root, 'src/lib/private-data/manifest.server.json');
const sqlPath = path.join(root, 'scripts/admin/corpus-storage-audit.sql');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
if (manifest.project_id !== 'xosqzzsnhxcyehcnirpa' || manifest.bucket !== 'corpus-originals'
  || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
  throw new Error('Expected the pinned private bundle manifest for xosqzzsnhxcyehcnirpa/corpus-originals');
}
const rows = Object.entries(manifest.files).map(([file, item]) => {
  if (!/^[a-f0-9]{64}$/.test(item?.sha256 ?? '') || !Number.isSafeInteger(item?.bytes) || item.bytes < 1
    || item.storage_key !== `atlas-private-data/sha256/${item.sha256.slice(0, 2)}/${item.sha256}.bin`) {
    throw new Error('Invalid pinned private bundle entry');
  }
  const quote = value => `'${String(value).replaceAll("'", "''")}'`;
  return `  (${quote(file)},${quote(item.sha256)},${item.bytes},${quote(item.storage_key)})`;
}).join(',\n');

let sql = await fs.readFile(sqlPath, 'utf8');
const begin = '  /* PRIVATE_BUNDLE_MANIFEST_BEGIN */';
const end = '  /* PRIVATE_BUNDLE_MANIFEST_END */';
const beginIndex = sql.indexOf(begin);
const endIndex = sql.indexOf(end);
if (beginIndex < 0 || endIndex <= beginIndex || sql.indexOf(begin, beginIndex + begin.length) >= 0
  || sql.indexOf(end, endIndex + end.length) >= 0) {
  throw new Error('Expected one private bundle manifest block in the audit SQL');
}
sql = sql.slice(0, beginIndex + begin.length) + '\n' + rows + '\n' + sql.slice(endIndex);
await fs.writeFile(sqlPath, sql);
console.log(JSON.stringify({ refreshed_manifest_entries: Object.keys(manifest.files).length, sql_path: 'scripts/admin/corpus-storage-audit.sql' }));

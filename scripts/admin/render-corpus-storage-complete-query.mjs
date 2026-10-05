import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sqlPath = path.join(root, 'scripts/admin/corpus-storage-audit.sql');
const evidencePath = path.join(root, 'private/audit-2026-10-05/legal-archive-chunk-refs.json');
const outputPath = path.join(root, 'private/audit-2026-10-05/storage-reconcile-complete-query.sql');
const sourceRoot = process.argv[2] ?? 'C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02';
const fullMatterReport = process.argv[3] ?? 'C:/Users/firas/OneDrive/Documents/ChatGPT/corpusss/audit/2026-10-02/seeger-weiss-full-matter-coverage';
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
if (evidence.evidence_schema !== 'read-only-legal-archive-chunk-references/1'
  || evidence.target_project !== 'xosqzzsnhxcyehcnirpa' || evidence.target_bucket !== 'corpus-originals'
  || evidence.descriptor_count !== 21 || !Array.isArray(evidence.chunk_references)
  || evidence.chunk_reference_count !== evidence.chunk_references.length) throw Error('Expected verified private archive chunk evidence');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readJsonl = file => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
function requireCloudObject(row, key, hash, bytes) {
  if (row?.bucket !== 'corpus-originals' || row.storage_key !== key || !/^[a-f0-9]{64}$/.test(hash ?? '')
    || !Number.isSafeInteger(bytes) || bytes < 1) throw Error('Invalid private storage ledger row');
  return { ref_kind: row.ref_kind, key, hash, bytes };
}

const initialDir = path.join(sourceRoot, 'private-metadata-cloud-references-v1');
const recentDir = path.join(sourceRoot, 'private-metadata-cloud-references-recent-v1');
const initialManifest = readJson(path.join(initialDir, 'manifest.json'));
const recentManifest = readJson(path.join(recentDir, 'manifest.json'));
const initialMapFile = path.join(initialDir, 'private-capture-cloud-objects.jsonl');
const recentMapFile = path.join(recentDir, 'recent-private-capture-cloud-objects.jsonl');
function verifyManifestArtifact(manifest, fileName, filePath, expectedRecords) {
  const bytes = fs.readFileSync(filePath);
  const item = manifest.artifacts?.find(value => path.basename(value.file) === fileName);
  if (manifest.project_id !== 'xosqzzsnhxcyehcnirpa' || manifest.bucket !== 'corpus-originals'
    || !item || item.records !== expectedRecords || item.bytes !== bytes.length || item.sha256 !== digest(bytes)) {
    throw Error(`Private ledger manifest mismatch for ${fileName}`);
  }
}
verifyManifestArtifact(initialManifest, path.basename(initialMapFile), initialMapFile, 1511);
verifyManifestArtifact(recentManifest, path.basename(recentMapFile), recentMapFile, 1035);
const initialMap = readJsonl(initialMapFile);
const recentMap = readJsonl(recentMapFile);
const paginationDir = path.join(sourceRoot, 'firecrawl-dockets/pagination-v1/original-upload-plan-v1');
const paginationPlanFile = path.join(paginationDir, 'pagination-original-metadata-upload-plan-v1.json');
const paginationPlanBytes = fs.readFileSync(paginationPlanFile);
const paginationPlan = JSON.parse(paginationPlanBytes.toString('utf8'));
const paginationReceipts = readJsonl(path.join(paginationDir, 'root-upload-receipts-v1.jsonl'));
const tailDir = path.join(sourceRoot, 'metadata-originals-tail-firecrawl-v1');
const tailPlan = readJson(path.join(tailDir, 'original-metadata-upload-plan-v1.json'));
const tailReceipts = readJsonl(path.join(tailDir, 'root-upload-receipts-v1.jsonl'));
function verifiedReceipts(plan, receipts, expectedCount) {
  const planSha = digest(fs.readFileSync(plan));
  const verified = receipts.filter(row => row.state === 'metadata_cloud_verified');
  if (verified.length !== expectedCount || verified.some(row => row.project_id !== 'xosqzzsnhxcyehcnirpa'
    || row.bucket !== 'corpus-originals' || row.plan_sha256 !== planSha)) throw Error('Original-metadata receipt scope mismatch');
  return new Map(verified.map(row => [row.storage_key, row]));
}
const paginationVerified = verifiedReceipts(paginationPlanFile, paginationReceipts, 38);
const tailVerified = verifiedReceipts(path.join(tailDir, 'original-metadata-upload-plan-v1.json'), tailReceipts, 45);
if (paginationPlan.project_id !== 'xosqzzsnhxcyehcnirpa' || paginationPlan.bucket !== 'corpus-originals'
  || paginationPlan.files?.length !== 38 || tailPlan.project_id !== 'xosqzzsnhxcyehcnirpa' || tailPlan.bucket !== 'corpus-originals'
  || tailPlan.files?.length !== 45 || initialMap.length !== 1511 || recentMap.length !== 1035) throw Error('Expected pinned Seeger Weiss preservation ledgers');
const metadataRefs = [];
for (const row of initialMap) {
  if (row.project_id !== 'xosqzzsnhxcyehcnirpa' || row.private_original_evidence !== true || row.public_projection_allowed !== false
    || row.storage_key !== `seeger-weiss/metadata-sha256/${row.whole_file_sha256?.slice(0, 2)}/${row.whole_file_sha256}.json`) throw Error('Invalid initial metadata object-map row');
  metadataRefs.push(requireCloudObject({ ...row, bucket: row.bucket, ref_kind: 'seeger_initial_metadata_capture' }, row.storage_key, row.whole_file_sha256, row.whole_file_bytes));
}
for (const row of recentMap) {
  if (row.project_id !== 'xosqzzsnhxcyehcnirpa' || row.private_original_evidence !== true || row.public_projection_allowed !== false
    || row.storage_key !== `seeger-weiss/metadata-sha256/${row.whole_file_sha256?.slice(0, 2)}/${row.whole_file_sha256}.json`) throw Error('Invalid recent metadata object-map row');
  metadataRefs.push(requireCloudObject({ ...row, bucket: row.bucket, ref_kind: 'seeger_recent_metadata_capture' }, row.storage_key, row.whole_file_sha256, row.whole_file_bytes));
}
for (const row of paginationPlan.files) {
  const receipt = paginationVerified.get(row.storage_key);
  if (row.storage_key !== `seeger-weiss/metadata-sha256/${row.sha256?.slice(0, 2)}/${row.sha256}.json`
    || !receipt || receipt.source_file_sha256 !== row.sha256 || receipt.source_bytes !== row.bytes) throw Error('Pagination original lacks exact verified cloud receipt');
  metadataRefs.push({ ref_kind: 'seeger_pagination_metadata_capture', key: row.storage_key, hash: row.sha256, bytes: row.bytes });
}
const initialMetadataMap = new Map(initialMap.map(row => [row.storage_key, row]));
for (const row of tailPlan.files) {
  const receipt = tailVerified.get(row.storage_key), previous = initialMetadataMap.get(row.storage_key);
  if (!receipt || !previous || receipt.source_file_sha256 !== row.sha256 || receipt.source_bytes !== row.bytes
    || previous.whole_file_sha256 !== row.sha256 || previous.whole_file_bytes !== row.bytes) throw Error('Tail plan overlap is not proven by initial cloud map and verified receipt');
  metadataRefs.push({ ref_kind: 'seeger_tail_original_duplicate_reference', key: row.storage_key, hash: row.sha256, bytes: row.bytes });
}
const fullMapFile = path.join(fullMatterReport, 'supabase-preservation.json');
const fullMap = readJson(fullMapFile);
if (fullMap.private_only !== true || !Array.isArray(fullMap.files) || fullMap.files.length !== 26) throw Error('Full-matter preservation map mismatch');
for (const row of fullMap.files) {
  if (row.whole_object_readback_verified !== true || row.bucket !== 'corpus-originals'
    || row.storage_key !== `seeger-weiss/full-matter-audit-sha256/${row.sha256?.slice(0, 2)}/${row.sha256}`) throw Error('Full-matter object lacks readback/hash-path evidence');
  metadataRefs.push({ ref_kind: 'seeger_full_matter_archive_file', key: row.storage_key, hash: row.sha256, bytes: row.bytes });
}
const currentFullManifest = { at: fullMap.at, private_only: fullMap.private_only, files: fullMap.files };
const currentFullManifestBytes = Buffer.from(JSON.stringify(currentFullManifest, null, 2));
const currentFullManifestSha = digest(currentFullManifestBytes);
if (fullMap.manifest_storage_key !== `seeger-weiss/full-matter-audit-sha256/${currentFullManifestSha.slice(0, 2)}/${currentFullManifestSha}`) throw Error('Current full-matter manifest content-address mismatch');
metadataRefs.push({ ref_kind: 'seeger_full_matter_current_manifest', key: fullMap.manifest_storage_key, hash: currentFullManifestSha, bytes: currentFullManifestBytes.length });
const historicalManifestBytes = fs.readFileSync(path.join(root, 'private/audit-2026-10-05/unmapped-fullmatter-manifest.raw.json'));
const historicalManifestSha = digest(historicalManifestBytes);
const historicalManifest = JSON.parse(historicalManifestBytes.toString('utf8'));
if (historicalManifestSha !== 'de7b16ff9f481bbb3d9312dfe8b66889f06ce501ff975620a5e511f4bcce67f8'
  || historicalManifest.files?.length !== 25) throw Error('Historical full-matter manifest readback evidence mismatch');
for (const row of historicalManifest.files) {
  const current = fullMap.files.find(item => item.storage_key === row.storage_key);
  if (!current || current.sha256 !== row.sha256 || current.bytes !== row.bytes) throw Error('Historical full-matter manifest references differ from current map');
}
metadataRefs.push({ ref_kind: 'seeger_full_matter_historical_manifest', key: `seeger-weiss/full-matter-audit-sha256/${historicalManifestSha.slice(0, 2)}/${historicalManifestSha}`, hash: historicalManifestSha, bytes: historicalManifestBytes.length });
const distinctRefs = new Map();
for (const row of metadataRefs) {
  const prior = distinctRefs.get(row.key);
  if (prior && (prior.hash !== row.hash || prior.bytes !== row.bytes)) throw Error('Conflicting private preservation ledgers for one storage key');
  if (!prior) distinctRefs.set(row.key, row);
}
if (distinctRefs.size !== 2612 || metadataRefs.length !== 2657) throw Error('Expected 2,612 distinct external private preservation object references');
const preservationRows = [...distinctRefs.values()].map(row =>
  `    (${quote(row.ref_kind)},'corpus-originals',${quote(row.key)},${quote(row.hash)},${row.bytes})`).join(',\n');
const chunkRows = evidence.chunk_references.map(row => {
  if (!/^[a-f0-9]{64}$/.test(row.archive_sha256 ?? '') || !/^[a-f0-9]{64}$/.test(row.archive_manifest_sha256 ?? '')
    || !/^legal-atlas\/originals\/sha256\/[a-f0-9]{64}\/manifest\.json$/.test(row.archive_manifest_key ?? '')
    || !Number.isSafeInteger(row.index) || row.index < 0 || !Number.isSafeInteger(row.bytes) || row.bytes < 1
    || !Number.isSafeInteger(row.offset) || row.offset < 0 || !/^[a-f0-9]{64}$/.test(row.sha256 ?? '')
    || !/^legal-atlas\/(?:originals\/sha256\/[a-f0-9]{64}\/chunk-[0-9]{6}-[a-f0-9]{64}|chunks\/sha256\/[a-f0-9]{64})$/.test(row.object_key ?? '')) {
    throw Error('Invalid validated archive chunk evidence row');
  }
  return `    (${quote(row.archive_sha256)},${quote(row.archive_manifest_key)},${quote(row.object_key)},${quote(row.sha256)},${row.bytes})`;
}).join(',\n');
let source = fs.readFileSync(sqlPath, 'utf8');
const start = source.indexOf('WITH private_bundle_manifest(');
const endMarker = 'ORDER BY section, bucket_id NULLS FIRST, ref_kind NULLS FIRST;';
const end = source.indexOf(endMarker, start);
if (start < 0 || end < start) throw Error('Could not locate section-1 CTE in base storage audit');
let query = source.slice(start, end + endMarker.length);
query = query.replace('), refs(ref_kind, bucket_id, object_key, expected_sha256, expected_bytes) AS (', () =>
  `), archive_chunk_manifest_refs(archive_sha256, archive_manifest_key, object_key, sha256, bytes) AS (\n  VALUES\n${chunkRows}\n), preservation_object_refs(ref_kind, bucket_id, object_key, sha256, bytes) AS (\n  VALUES\n${preservationRows}\n), refs(ref_kind, bucket_id, object_key, expected_sha256, expected_bytes) AS (`);
query = query.replace('), ref_status AS (', () =>
  `  UNION ALL\n  SELECT p.ref_kind, p.bucket_id, p.object_key, p.sha256, p.bytes::bigint\n  FROM preservation_object_refs p\n  UNION ALL\n  SELECT 'legal_archive_chunk', 'corpus-originals', c.object_key, c.sha256, c.bytes::bigint\n  FROM archive_chunk_manifest_refs c\n), ref_status AS (`);
query = query.replace("\nSELECT 'bucket_totals'", () => "\n,result AS (\nSELECT 'bucket_totals'");
query = query.replace(endMarker, () =>
  `)\nSELECT jsonb_build_object(\n  'reconciliation', coalesce((SELECT jsonb_agg(to_jsonb(result) ORDER BY section, bucket_id NULLS FIRST, ref_kind NULLS FIRST) FROM result), '[]'::jsonb),\n  'unknown_key_count', (SELECT count(*)::bigint FROM storage.objects o WHERE NOT EXISTS (SELECT 1 FROM refs r WHERE r.bucket_id=o.bucket_id AND r.object_key=o.name)),\n  'unknown_keys', coalesce((\n    SELECT jsonb_agg(jsonb_build_array(o.bucket_id, o.name, CASE WHEN o.metadata->>'size' ~ '^[0-9]+$' THEN (o.metadata->>'size')::bigint END) ORDER BY o.bucket_id, o.name)\n    FROM storage.objects o\n    WHERE NOT EXISTS (SELECT 1 FROM refs r WHERE r.bucket_id=o.bucket_id AND r.object_key=o.name)\n  ), '[]'::jsonb)\n) AS storage_reconciliation_report;`);
if (query.includes(endMarker) || !query.includes('FROM archive_chunk_manifest_refs c') || !query.includes('FROM preservation_object_refs p') || !query.includes("'unknown_keys'")
  || !query.includes("o.metadata->>'size' ~ '^[0-9]+$' THEN")) throw Error('Complete reconciliation query generation failed or literal SQL regex was altered');
const header = `-- READ-ONLY completed storage reconciliation for ${evidence.target_project}.\n-- Includes ${evidence.descriptor_count} pinned archive manifests / ${evidence.chunk_reference_count} SHA-verified chunk references and ${distinctRefs.size} distinct Seeger Weiss private preservation objects.\n-- External preservation maps, upload receipts, and both full-matter manifest versions were locally validated before inclusion.\n-- One JSON result includes aggregate reconciliation and compact [bucket,key,bytes] unknown-key candidates.\n-- Unknown keys remain candidates only: other registries, historical recovery use, opaque clients, and full-body hashes must be checked.\n`;
fs.writeFileSync(outputPath, header + query + '\n');
console.log(JSON.stringify({ archive_manifests: evidence.descriptor_count, chunk_references: evidence.chunk_reference_count,
  preservation_distinct_keys: distinctRefs.size, preservation_ledger_rows: metadataRefs.length, query_bytes: Buffer.byteLength(header + query) }));
